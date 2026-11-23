const active = new WeakMap();
const limit = 500;
const fields = `id,number_id,chat_id,from_me,body,ts,agent_id,kind,media_path,mime,wa_id,tenant_id,analytics_source`;
const scopedMessages = `SELECT ${fields} FROM app.messages WHERE tenant_id=$1::uuid AND chat_id=$2::bigint`;
const order = 'ORDER BY ts DESC,id DESC LIMIT 501';
export const postgresMessagePageSql = `${scopedMessages} AND (ts,id) < ($3::bigint,$4::bigint) ${order}`;
const legacySql = `${scopedMessages} AND ts < $3::bigint ${order}`;

function integer(value) {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError('PostgreSQL integer outside JSON safe range');
  return n;
}

export async function withTenantRead(pool,tenantId,work) {
  if (!tenantId) throw new Error('Tenant scope required');
  return pool.transaction(tenantId,async client=>{
    const tx = Object.freeze({tenantId});
    active.set(tx,client);
    try { return await work(tx); }
    finally { active.delete(tx); }
  }, {readOnly:true});
}

export async function readChatMessages(tx,{tenantId,userId,chatId,before}) {
  const db=active.get(tx);
  if (!db || tenantId!==tx.tenantId) throw new Error('Invalid tenant read scope');
  const {rows:[chat]}=await db.query(`SELECT n.owner_id FROM app.chats c JOIN app.numbers n
    ON n.id=c.number_id AND n.tenant_id=c.tenant_id WHERE c.tenant_id=$1::uuid AND c.id=$2::bigint`,[tenantId,chatId]);
  if (!chat) return {status:404,error:'chat tidak ada'};
  const {rows:[{role}]}=await db.query('SELECT app.message_reader_role($1::bigint) AS role',[userId]);
  if (!role || (role!=='admin' && integer(chat.owner_id)!==userId)) return {status:403,error:'tidak punya akses'};
  const {rows}=await (before.id===undefined
    ? db.query(legacySql,[tenantId,chatId,before.ts])
    : db.query(postgresMessagePageSql,[tenantId,chatId,before.ts,before.id]));
  const {rows:labels}=await db.query(`SELECT l.id,l.name,l.color,l.tenant_id FROM app.chat_labels cl
    JOIN app.labels l ON l.id=cl.label_id AND l.tenant_id=cl.tenant_id
    WHERE cl.tenant_id=$1::uuid AND cl.chat_id=$2::bigint`,[tenantId,chatId]);
  const hasMore=rows.length>limit;
  const messages=rows.slice(0,limit).reverse().map(row=>({...row,
    id:integer(row.id),number_id:integer(row.number_id),chat_id:integer(row.chat_id),
    ts:integer(row.ts),agent_id:integer(row.agent_id),from_me:Number(row.from_me)}));
  return {messages,labels:labels.map(row=>({...row,id:integer(row.id)})),hasMore,
    nextCursor:hasMore?`${messages[0].ts}_${messages[0].id}`:null};
}
