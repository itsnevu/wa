import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const missing=()=>Object.assign(new Error('Resource not found'),{status:404});
export const routeSql=`SELECT jid FROM tenant_data.wa_chats
  WHERE tenant_id=$1::uuid AND number_id=$2::bigint AND id=$3::bigint`;
export const ruleSql=`SELECT id,pattern,reply FROM tenant_data.wa_rules
  WHERE tenant_id=$1::uuid AND number_id=$2::bigint AND enabled
  ORDER BY priority,id`;
export const mediaSql=`SELECT m.storage_key,n.owner_id FROM tenant_data.wa_media m
  JOIN tenant_data.wa_numbers n ON n.tenant_id=m.tenant_id AND n.id=m.number_id
  WHERE m.tenant_id=$1::uuid AND m.id=$2::uuid`;

export function mediaStorageKey(tenantId,id) {
  if (!uuid.test(tenantId) || !uuid.test(id)) throw missing();
  return `${tenantId}/${id}`;
}

export async function registerPostgresMedia({client,tenantId},numberId,messageId,id) {
  const key=mediaStorageKey(tenantId,id);
  await client.query(`INSERT INTO tenant_data.wa_media(tenant_id,id,number_id,message_id,storage_key)
    VALUES($1::uuid,$2::uuid,$3::bigint,$4::bigint,$5::text)`,[tenantId,id,numberId,messageId,key]);
  return key;
}

export async function ingestPostgresMessage({client,tenantId},numberId,input,matchRule) {
  const {rows:[route]}=await client.query(routeSql,[tenantId,numberId,input.chatId]);
  if (!route) throw missing();
  const inserted=await client.query(`INSERT INTO tenant_data.wa_messages
    (tenant_id,number_id,chat_id,wa_id,body,from_me,ts)
    VALUES($1::uuid,$2::bigint,$3::bigint,$4::text,$5::text,$6::boolean,$7::bigint)
    ON CONFLICT(tenant_id,number_id,wa_id) DO NOTHING RETURNING id`,
  [tenantId,numberId,input.chatId,input.waId,input.body,input.fromMe,input.ts]);
  if (!inserted.rowCount) return {duplicate:true};
  let reply=null;
  if (input.event==='notify' && !input.fromMe && input.body && !route.jid.endsWith('@g.us')) {
    const {rows}=await client.query(ruleSql,[tenantId,numberId]);
    const chosen=await matchRule(rows,input.body);
    const rule=rows.find(r=>r.id===chosen);
    if (rule) reply={tenantId,numberId,jid:route.jid,text:rule.reply};
  }
  return {duplicate:false,messageId:inserted.rows[0].id,reply};
}

export async function openPostgresMedia({client,tenantId,userId,role},id,root) {
  const key=mediaStorageKey(tenantId,id);
  const {rows:[row]}=await client.query(mediaSql,[tenantId,id]);
  if (!row || row.storage_key!==key || (!['owner','tenant_admin'].includes(role) && row.owner_id!==String(userId))) throw missing();
  try {
    const parent=await realpath(root);
    const intended=path.join(parent,tenantId,id);
    const file=await realpath(intended);
    if (file!==intended || !(await lstat(file)).isFile()) throw missing();
    return file;
  } catch(error) {
    if (error.code==='ENOENT') throw missing();
    throw error;
  }
}
