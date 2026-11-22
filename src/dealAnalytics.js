import { db } from './db.js';
import { config } from './config.js';
import { DAY, appendDealEvent } from './dealReview.js';

const WEEK = 7*DAY;
const owner = scope => !scope.grant && ['owner','tenant_admin'].includes(scope.role);
const error = (status,message) => Object.assign(Error(message),{status});
export function authorizeDealAnalytics(scope) {
  if (!owner(scope)) throw error(403,'Analytics penjualan hanya tersedia bagi pengelola tenant.');
}
// Only the time zone is stored per tenant (v8). Opening hours come from server config until the
// per-day schedule of v9 lands.
const tenantHours = db.prepare(`SELECT analytics_timezone AS timezone FROM tenants WHERE id=? AND deleted_at IS NULL`);
const setTimezone = db.prepare(`UPDATE tenants SET analytics_timezone=? WHERE id=? AND deleted_at IS NULL`);
const history = db.prepare(`SELECT e.deal_id,e.type,e.payload_json,e.actor,e.at FROM deals d
  JOIN deal_events e ON e.deal_id=d.id WHERE d.tenant_id=? AND d.created_at>=? AND d.created_at<?
  AND e.at<=? AND e.type IN ('analytics_opened','analytics_dimensions','analytics_baseline','decision','proof_recorded',
    'analytics_qualified','analytics_unanswered','analytics_answered','refund','dp_hangus','sla_expired')
  ORDER BY d.id,e.id`);
const oneHistory = db.prepare(`SELECT e.deal_id,e.type,e.payload_json,e.actor,e.at FROM deals d
  JOIN deal_events e ON e.deal_id=d.id WHERE d.tenant_id=? AND d.id=? ORDER BY e.id`);
const dealRow = db.prepare('SELECT id,tenant_id,chat_id,state FROM deals WHERE tenant_id=? AND id=?');
const latestInbound = db.prepare(`SELECT id,ts FROM messages WHERE tenant_id=? AND chat_id=? AND from_me=0
  AND kind<>'call' ORDER BY id DESC LIMIT 1`);
const replied = db.prepare(`SELECT 1 FROM messages WHERE tenant_id=? AND chat_id=? AND from_me=1
  AND kind<>'call' AND id>? LIMIT 1`);
const tenants = db.prepare("SELECT id FROM tenants WHERE deleted_at IS NULL");
// v9: only these states can be "unanswered"; the threshold is measured in operating time.
const openForReply = db.prepare(`SELECT d.id,d.chat_id FROM deals d WHERE d.tenant_id=?
  AND d.state IN ('candidate','awaiting_proof','dp_aktif')`);
const hoursRows = db.prepare('SELECT weekday,open_min,close_min,closed FROM tenant_business_hours WHERE tenant_id=? ORDER BY weekday');
const holidayRows = db.prepare('SELECT day,label FROM tenant_holidays WHERE tenant_id=? ORDER BY day');
const putHours = db.prepare(`INSERT INTO tenant_business_hours(tenant_id,weekday,open_min,close_min,closed) VALUES(?,?,?,?,?)
  ON CONFLICT(tenant_id,weekday) DO UPDATE SET open_min=excluded.open_min,close_min=excluded.close_min,closed=excluded.closed`);
const clearHolidays = db.prepare('DELETE FROM tenant_holidays WHERE tenant_id=?');
const putHoliday = db.prepare('INSERT INTO tenant_holidays(tenant_id,day,label) VALUES(?,?,?)');
const markUnanswered = db.prepare('INSERT OR IGNORE INTO deal_unanswered_marks(deal_id,bucket,created_at) VALUES(?,?,?)');
const dealPaid = db.prepare('SELECT id,amount,paid_amount FROM deals WHERE tenant_id=? AND created_at>=? AND created_at<?');
// A qualified customer message counts as unanswered after this much OPERATING time without a reply.
// (24 hours remains an owner escalation, not a counting criterion.)
export const UNANSWERED_AFTER = 4*60*60*1000;
const STEP = 5*60*1000;
const DIGITS = /\+?\d(?:[ .()-]*\d){6,}/g;

const DAY_INDEX={Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6};
function defaultDay(weekday) {
  const open=config.businessStart===config.businessEnd?0:config.businessStart*60;
  const close=config.businessStart===config.businessEnd?1440:config.businessEnd*60;
  return {weekday,open_min:open,close_min:close,closed:false};
}
// Per-weekday schedule (0=Monday) and holidays, stored per tenant since v9.
export function businessHours(tenantId) {
  const hours = tenantHours.get(tenantId);
  if (!hours) throw error(404,'Tenant tidak ditemukan.');
  const stored = new Map(hoursRows.all(tenantId).map(r=>[r.weekday,{...r,closed:Boolean(r.closed)}]));
  const days = Array.from({length:7},(_,w)=>stored.get(w) ?? defaultDay(w));
  return { timezone:hours.timezone, days, holidays:holidayRows.all(tenantId), source:'tenant_schedule' };
}
function localParts(at,timezone) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',
    weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,weekday:DAY_INDEX[p.weekday],minute:Number(p.hour)*60+Number(p.minute)};
}
export function insideBusinessHours(at,{timezone,days,holidays}) {
  const {date,weekday,minute}=localParts(at,timezone);
  if (holidays?.some(h=>h.day===date)) return false;
  const d=days[weekday];
  if (!d || d.closed) return false;
  if (d.open_min===d.close_min) return false;
  return d.open_min<d.close_min ? minute>=d.open_min && minute<d.close_min : minute>=d.open_min || minute<d.close_min;
}
// Operating time between two instants, sampled every 5 minutes and stopping once `cap` is reached.
export function operatingElapsed(from,to,hours,cap=Infinity) {
  let total=0;
  for (let at=from; at<to && total<cap; at+=STEP) if (insideBusinessHours(at,hours)) total+=Math.min(STEP,to-at);
  return total;
}
const HHMM=/^\d{1,4}$/;
export function configureDealHours(scope,body) {
  authorizeDealAnalytics(scope);
  const {timezone,days,holidays} = body || {};
  if (typeof timezone!=='string' || timezone.length>64) throw error(400,'Zona waktu tidak valid.');
  try { new Intl.DateTimeFormat('en-GB',{timeZone:timezone}); } catch { throw error(400,'Zona waktu IANA tidak valid.'); }
  if (days!==undefined && (!Array.isArray(days) || days.length!==7)) throw error(400,'Jadwal harus berisi 7 hari.');
  for (const d of days ?? []) {
    if (!Number.isInteger(d?.weekday) || d.weekday<0 || d.weekday>6 || !HHMM.test(String(d.open_min)) || !HHMM.test(String(d.close_min))
      || d.open_min<0 || d.open_min>1440 || d.close_min<0 || d.close_min>1440 || (!d.closed && d.open_min===d.close_min)) {
      throw error(400,'Jam buka/tutup tidak valid.');
    }
  }
  if (holidays!==undefined && (!Array.isArray(holidays) || holidays.length>366)) throw error(400,'Daftar hari libur tidak valid.');
  for (const h of holidays ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h?.day ?? '') || Number.isNaN(Date.parse(h.day)) || (h.label!=null && String(h.label).length>80)) {
      throw error(400,'Tanggal libur tidak valid.');
    }
  }
  db.transaction(()=>{
    setTimezone.run(timezone,scope.tenantId);
    for (const d of days ?? []) putHours.run(scope.tenantId,d.weekday,d.open_min,d.close_min,d.closed?1:0);
    if (holidays) { clearHolidays.run(scope.tenantId); for (const h of new Map(holidays.map(h=>[h.day,h])).values()) putHoliday.run(scope.tenantId,h.day,h.label ?? null); }
  }).immediate();
  return businessHours(scope.tenantId);
}

function pendingInbound(tenantId,chatId,now) {
  const inbound=latestInbound.get(tenantId,chatId);
  if (!inbound || inbound.ts>now || replied.get(tenantId,chatId,inbound.id)) return null;
  return inbound;
}
// Writes replayable facts so the metric survives message retention. Runs ONLY from the background job
// (never from a read request). Idempotent through the unique (deal_id, bucket) mark.
export const sweepUnanswered=db.transaction((tenantId,now=Date.now())=>{
  const hours=businessHours(tenantId);
  let recorded=0;
  for (const deal of openForReply.all(tenantId)) {
    const inbound=pendingInbound(tenantId,deal.chat_id,now);
    // Messages received outside the schedule (or on a holiday) never count; the 4h is operating time.
    if (!inbound || !insideBusinessHours(inbound.ts,hours)) continue;
    if (operatingElapsed(inbound.ts,now,hours,UNANSWERED_AFTER)<UNANSWERED_AFTER) continue;
    if (!markUnanswered.run(deal.id,'inbound:'+inbound.id,now).changes) continue;
    appendDealEvent(deal.id,'analytics_unanswered',{eligible:true,inbound_id:inbound.id,inbound_at:inbound.ts,source:'job',
      threshold_ms:UNANSWERED_AFTER,timezone:hours.timezone},null,now);
    recorded++;
  }
  return recorded;
});
export function sweepAllUnanswered(now=Date.now()) {
  let recorded=0;
  for (const {id} of tenants.all()) recorded+=sweepUnanswered(id,now);
  return recorded;
}
// 5-minute job; returns the interval handle so the caller can stop it on shutdown.
export function startUnansweredJob(every=5*60*1000) {
  const run=()=>{ try { sweepAllUnanswered(); } catch (err) { console.error('[analytics] unanswered sweep failed',err.message); } };
  return setInterval(run,every).unref();
}

function readHistory(rows) {
  const facts = new Map();
  for (const event of rows) {
    const p = JSON.parse(event.payload_json);
    const f = facts.get(event.deal_id) ?? {
      id:event.deal_id, state:'no_signal', origin:'direct', gross:0, refunded:0, dimensions:{}, qualified:false,
      candidate:false, proof:false, unanswered:false, paid:false, everDP:false,
    };
    facts.set(f.id,f);
    switch(event.type) {
      case 'analytics_opened':
        f.opened = event.at;
        if (!f.stateChanged && ['no_signal','candidate','awaiting_proof','proof_submitted'].includes(p.state)) f.state=p.state;
        f.candidate ||= ['candidate','awaiting_proof','proof_submitted'].includes(p.state);
        break;
      case 'analytics_dimensions': f.dimensions=p; break;
      case 'analytics_baseline':
        // A v7 terminal state without a matching verification is kept visible but never treated as an outcome.
        if (!f.stateChanged) f.state=(!['verified_lunas','rejected','refunded'].includes(p.state) || p.verified) ? p.state : 'unverified_legacy';
        f.everDP ||= p.ledger_paid>0 && p.origin==='dp';
        if (f.everDP) { f.origin='dp'; f.dpStarted=p.dp_started ?? f.dpStarted; f.paid=true; }
        if (f.closedAt==null && p.verified && ['verified_lunas','refunded'].includes(p.state)) {
          f.closedAt=event.at; f.closer=p.closer ?? event.actor; f.gross=p.amount ?? 0; f.paid=true;
        }
        if (f.state==='rejected') f.reason ??= p.reason_code;
        break;
      case 'analytics_qualified': f.qualified=true; break;
      case 'analytics_unanswered': f.qualified=true; f.unanswered=p.eligible===true; break;
      case 'analytics_answered': f.unanswered=false; break;
      case 'proof_recorded': f.proof=true; break;
      case 'decision':
        f.state=p.decision;
        f.stateChanged=true;
        f.candidate=true;
        f.proof ||= p.decision==='proof_submitted';
        if (p.decision==='dp_aktif') {
          f.origin='dp'; f.everDP=true; f.dpStarted ??= event.at; f.paid=true;
        }
        if (p.decision==='verified_lunas') {
          f.closedAt ??= event.at; f.closer ??= event.actor; f.gross=p.amount ?? 0; f.paid=true;
        }
        if (p.decision==='rejected') f.reason=p.reason_code;
        break;
      case 'refund': f.refunded+=Number(p.amount); break;
      case 'dp_hangus': f.state='dp_hangus'; f.hangusAt=event.at; f.stateChanged=true; break;
      case 'sla_expired': f.state='expired'; f.stateChanged=true; break;
    }
  }
  return [...facts.values()].filter(f=>f.opened!=null);
}

export const FUNNEL_NOTE='Inquiry hanya mencakup percakapan yang sudah tercatat sebagai deal oleh deteksi; chat tanpa sinyal deal tidak dihitung.';
const metric = (numerator,n) => ({numerator,n,value:n ? numerator/n : null,low_sample:n<10});
function distribution(values) {
  const sorted = [...values].sort((a,b)=>a-b);
  return { n:sorted.length, average:sorted.length ? sorted.reduce((a,b)=>a+b,0)/sorted.length : null,
    p90:sorted.length ? sorted[Math.ceil(sorted.length*0.9)-1] : null };
}
function summarize(rows,now) {
  const counts={verified_lunas:0,rejected:0,qualified_unanswered:0,dp_hangus:0,dp_aktif:0,awaiting_proof:0,
    pending_verification:0,dp_paid:0,money_in:0,settled_dp:0,settled_direct:0,unverified_legacy:0};
  const funnel={inquiry:rows.length,qualified:0,candidate:0,proof:0,lunas:0};
  const closingTimes=[],queueAge=[],activeDP=[],forfeitedDP=[];
  const reasons={};
  let gross=0,refund=0,cashIn=0,mismatch=0;
  for (const f of rows) {
    const settled=f.closedAt!=null;
    const lost=f.state==='dp_hangus' && f.everDP;
    const rejected=f.state==='rejected' && !settled;
    const unattended=f.unanswered && ['candidate','awaiting_proof','dp_aktif'].includes(f.state);
    if (settled) {
      counts.verified_lunas++; funnel.lunas++;
      counts[f.origin==='dp'?'settled_dp':'settled_direct']++;
      gross+=f.gross; refund+=f.refunded;
      // Cash in comes from the recorded payments, never from OCR.
      const paid=f.cashIn ?? 0; cashIn+=paid; if (paid<f.gross) mismatch++;
      closingTimes.push(Math.max(0,f.closedAt-f.opened));
    } else if (rejected) {
      counts.rejected++;
      const reason=f.reason || 'unknown';
      reasons[reason]=(reasons[reason]||0)+1;
    } else if (lost) {
      counts.dp_hangus++;
      if (f.dpStarted!=null && f.hangusAt!=null) forfeitedDP.push(Math.max(0,f.hangusAt-f.dpStarted));
    } else if (unattended) counts.qualified_unanswered++;
    if (f.qualified || f.candidate || f.proof || settled) funnel.qualified++;
    if (f.candidate || f.proof || settled) funnel.candidate++;
    if (f.proof || f.everDP || settled) funnel.proof++;
    if (f.everDP) counts.dp_paid++;
    if (f.paid) counts.money_in++;
    if (f.state==='dp_aktif' && f.everDP) {
      counts.dp_aktif++;
      if (f.dpStarted!=null) activeDP.push(Math.max(0,now-f.dpStarted));
    }
    if (f.state==='unverified_legacy') counts.unverified_legacy++;
    if (f.state==='awaiting_proof') counts.awaiting_proof++;
    if (['candidate','proof_submitted'].includes(f.state)) counts.pending_verification++;
    if (['candidate','proof_submitted','awaiting_proof'].includes(f.state)) queueAge.push(Math.max(0,now-f.opened));
  }
  const {verified_lunas,rejected,qualified_unanswered,dp_hangus,dp_aktif,awaiting_proof,settled_dp,money_in,dp_paid,pending_verification}=counts;
  return { n:rows.length,counts,funnel,funnel_note:FUNNEL_NOTE,reasons,
    closing_rate:metric(verified_lunas,verified_lunas+rejected+qualified_unanswered+dp_hangus),
    dp_share:metric(dp_paid,money_in),dp_settle:metric(settled_dp,settled_dp+dp_hangus),
    open_deals:{value:dp_aktif+awaiting_proof,n:dp_aktif+awaiting_proof,dp_aktif,awaiting_proof},
    pending_verification:{value:pending_verification,n:pending_verification},
    revenue:{gross,net:gross-refund,refund,cash_in:cashIn,amount_mismatch:mismatch,n:verified_lunas},aov:{gross:verified_lunas?gross/verified_lunas:null,net:verified_lunas?(gross-refund)/verified_lunas:null,n:verified_lunas},
    time_to_close:distribution(closingTimes),aging:{review:distribution(queueAge),dp_active:distribution(activeDP),dp_hangus:distribution(forfeitedDP)} };
}

const labelOf = (id,name,fallback) => id==null ? 'Belum tercatat' : name || fallback+' #'+id;
function group(rows,field,now) {
  const groups=new Map();
  for (const f of rows) {
    const d=f.dimensions;
    const ids={product:d.product_id,number:d.number_id,agent:d.agent_id,handler:d.handler || 'unknown'};
    const names={product:labelOf(d.product_id,d.product,'Produk'),number:labelOf(d.number_id,d.number,'Nomor'),
      agent:labelOf(d.agent_id,d.agent,'Agen'),handler:ids.handler};
    const key=ids[field] ?? 'unknown';
    if (!groups.has(key)) groups.set(key,{label:names[field],rows:[]});
    groups.get(key).rows.push(f);
  }
  return [...groups].map(([key,g])=>({key,label:g.label,...summarize(g.rows,now)}));
}
const WEEKDAY={Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6};
// Monday (YYYY-MM-DD) of the local calendar week in the tenant time zone.
export function weekOf(at,timezone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',
    day:'2-digit',weekday:'short'}).formatToParts(at).map(p=>[p.type,p.value]));
  return new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day-WEEKDAY[parts.weekday])).toISOString().slice(0,10);
}
function weekly(rows,from,to,now,timezone) {
  const buckets=new Map();
  for (let at=from;at<to;at+=DAY) if (!buckets.has(weekOf(at,timezone))) buckets.set(weekOf(at,timezone),[]);
  buckets.set(weekOf(to-1,timezone),buckets.get(weekOf(to-1,timezone)) ?? []);
  for (const f of rows) buckets.get(weekOf(f.opened,timezone))?.push(f);
  return [...buckets].map(([week,items])=>({week,...summarize(items,now)}));
}
export function analyticsRange(query,now=Date.now(),exporting=false) {
  // A future end is clamped (client and server clocks differ by a few ms); it can never reveal future events.
  const to=query.to===undefined ? now+1 : Math.min(Number(query.to),now+1);
  let from=query.from===undefined ? Math.max(0,to-84*DAY) : Number(query.from);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from<0 || to<=from || to-from>366*DAY) {
    throw error(400,'Rentang tanggal tidak valid. Maksimal 366 hari.');
  }
  if (exporting && Number.isFinite(config.retentionDays) && config.retentionDays>0) {
    from=Math.max(from,Math.min(to,now-config.retentionDays*DAY));
  }
  return {from,to,now};
}
// Read-only: opening the dashboard must never write (v9).
function scopedFacts(tenantId,{from,to,now}) {
  const money=new Map(dealPaid.all(tenantId,from,to).map(r=>[r.id,r]));
  return readHistory(history.all(tenantId,from,to,now)).map(f=>({...f,cashIn:money.get(f.id)?.paid_amount ?? 0}));
}
export function tenantDealAnalytics(scope,range) {
  authorizeDealAnalytics(scope);
  const rows=scopedFacts(scope.tenantId,range);
  const hours=businessHours(scope.tenantId);
  const examples=rows.filter(f=>f.closedAt!=null || ['no_signal','candidate','awaiting_proof','proof_submitted','expired'].includes(f.state))
    .sort((a,b)=>b.opened-a.opened || b.id-a.id).slice(0,60).map(f=>({
      id:f.id,state:f.state,gross:f.gross,refunded:f.refunded,closed: f.closedAt!=null,
      qualified:f.qualified,unanswered:f.unanswered,
    }));
  return {range,hours,summary:summarize(rows,range.now),weekly:weekly(rows,range.from,range.to,range.now,hours.timezone),
    groups:Object.fromEntries(['product','number','agent','handler'].map(field=>[field,group(rows,field,range.now)])),deals:examples};
}
export function platformDealAnalytics(range) {
  const perTenant=tenants.all().map(t=>scopedFacts(t.id,range));
  const rows=perTenant.flat();
  // Cross-tenant totals only: no groups, deal rows, names or chat text. Weeks use UTC because tenants differ.
  return {range,tenants:perTenant.filter(list=>list.length).length,summary:summarize(rows,range.now),
    weekly:weekly(rows,range.from,range.to,range.now,'UTC')};
}

export const recordAnalyticsOutcome=db.transaction((scope,id,body,now=Date.now())=>{
  authorizeDealAnalytics(scope);
  const row=dealRow.get(scope.tenantId,id);
  if (!row) throw error(404,'Deal tidak ditemukan.');
  const f=readHistory(oneHistory.all(scope.tenantId,id))[0];
  const {action}=body || {};
  if (action==='refund') {
    const amount=body.amount;
    if (!f?.closedAt || !Number.isSafeInteger(amount) || amount<=0) throw error(400,'Nominal refund tidak valid atau deal belum lunas.');
    if (!f.closer || Number(f.closer)===scope.userId) throw error(403,'Refund memerlukan pengelola berbeda dari pemeriksa pelunasan.');
    const note=typeof body.note==='string'?body.note.trim():'';
    if (note.length<10 || note.length>500) throw error(400,'Alasan refund harus 10 hingga 500 karakter.');
    if (typeof body.request_id!=='string' || !/^[\w-]{8,80}$/.test(body.request_id)) throw error(400,'Identitas refund tidak valid.');
    const earlier=oneHistory.all(scope.tenantId,id).find(e=>e.type==='refund' && JSON.parse(e.payload_json).request_id===body.request_id);
    if (earlier) {
      if (JSON.parse(earlier.payload_json).amount!==amount) throw error(409,'Identitas refund sudah dipakai.');
      return {recorded:true};
    }
    if (amount>f.gross-f.refunded) throw error(400,'Nominal refund melebihi saldo deal.');
    appendDealEvent(id,'refund',{amount,reason_code:'refund',note,request_id:body.request_id},scope.userId,now);
  } else if (['qualify','unanswered'].includes(action)) {
    if (!['no_signal','candidate','awaiting_proof','proof_submitted','expired'].includes(row.state)) throw error(409,'Deal sudah diputuskan.');
    if (action==='qualify') {
      if (!f?.qualified) appendDealEvent(id,'analytics_qualified',{},scope.userId,now);
    } else {
      const inbound=pendingInbound(scope.tenantId,row.chat_id,now);
      if (!inbound) throw error(409,'Tidak ada pesan masuk yang masih menunggu jawaban.');
      const hours=businessHours(scope.tenantId);
      const eligible=insideBusinessHours(inbound.ts,hours);
      if (!markUnanswered.run(id,'inbound:'+inbound.id,now).changes) return {recorded:false,eligible};
      appendDealEvent(id,'analytics_unanswered',{eligible,inbound_id:inbound.id,inbound_at:inbound.ts,source:'manual',timezone:hours.timezone},scope.userId,now);
      return {recorded:true,eligible};
    }
  } else throw error(400,'Aksi tidak dikenal.');
  return {recorded:true};
});

export function maskAnalyticsText(value) {
  return String(value ?? '').replace(DIGITS,match=>{
    const digits=match.replace(/\D/g,'');
    return digits.slice(0,2)+'*'.repeat(digits.length-4)+digits.slice(-2);
  });
}
const escapeField = value => {
  const masked=typeof value==='string'?maskAnalyticsText(value):String(value ?? '');
  const safe=/^[\t\r]|^\s*[=+@-]/.test(masked) && typeof value==='string' ? "'"+masked : masked;
  return '"'+safe.replaceAll('"','""')+'"';
};
export function exportDealAnalytics(scope,range) {
  authorizeDealAnalytics(scope);
  const rows=scopedFacts(scope.tenantId,range);
  const header=['deal_id','opened_at','state','origin','product','number','agent','handler','verified_gross','refund','verified_net','qualified_unanswered'];
  const lines=rows.map(f=>[f.id,new Date(f.opened).toISOString(),f.state,f.origin,f.dimensions.product,f.dimensions.number,
    f.dimensions.agent,f.dimensions.handler,f.gross,f.refunded,f.gross-f.refunded,Number(f.unanswered &&
      ['candidate','awaiting_proof','expired','no_signal'].includes(f.state))]);
  return [header,...lines].map(row=>row.map(escapeField).join(',')).join('\r\n')+'\r\n';
}
