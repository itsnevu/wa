import {sqliteTenantConnection} from './database/transactions.js';

const pageSize = 500;
const pageQuery = 'SELECT * FROM messages WHERE tenant_id=? AND chat_id=?';
const pageOrder = 'ORDER BY ts DESC,id DESC LIMIT 501';
export const chatMessagePageSql = `${pageQuery} AND (ts,id) < (?,?) ${pageOrder}`;
const legacyPageSql = `${pageQuery} AND ts < ? ${pageOrder}`;

export function parseMessageCursor(value) {
  if (value === undefined) return {ts:Date.now()};
  const match = typeof value === 'string' && /^(-?\d+)(?:_(-?\d+))?$/.exec(value);
  if (!match) throw Object.assign(new Error('Cursor pesan tidak valid'), {status:400});
  const ts = Number(match[1]);
  const id = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isSafeInteger(ts) || (id !== undefined && !Number.isSafeInteger(id))) {
    throw Object.assign(new Error('Cursor pesan tidak valid'), {status:400});
  }
  return {ts,id};
}

export {withSqliteTenantRead as withTenantRead} from './database/transactions.js';

export async function readChatMessages(tx,{tenantId,userId,chatId,before}) {
  const connection = sqliteTenantConnection(tx,tenantId);
  const chat = connection.prepare(`SELECT n.owner_id FROM chats c JOIN numbers n
    ON n.id=c.number_id AND n.tenant_id=c.tenant_id WHERE c.id=? AND c.tenant_id=?`).get(chatId,tenantId);
  if (!chat) return {status:404,error:'chat tidak ada'};
  const member = connection.prepare(`SELECT u.role FROM tenant_members m
    JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id
    WHERE m.tenant_id=? AND m.user_id=? AND t.status='active' AND t.deleted_at IS NULL`).get(tenantId,userId);
  if (!member) return {status:403,error:'tidak punya akses'};

  if (member.role !== 'admin' && chat.owner_id !== userId) return {status:403,error:'tidak punya akses'};

  // Numeric legacy cursors deliberately exclude the entire boundary timestamp.
  const rows = before.id === undefined
    ? connection.prepare(legacyPageSql).all(tenantId,chatId,before.ts)
    : connection.prepare(chatMessagePageSql).all(tenantId,chatId,before.ts,before.id);
  const labels = connection.prepare(`SELECT l.* FROM chat_labels cl JOIN labels l
    ON l.id=cl.label_id AND l.tenant_id=cl.tenant_id WHERE cl.tenant_id=? AND cl.chat_id=?`).all(tenantId,chatId);
  const hasMore = rows.length > pageSize;
  const messages = rows.slice(0,pageSize).reverse();
  const nextCursor = hasMore ? `${messages[0].ts}_${messages[0].id}` : null;
  return {messages,labels,hasMore,nextCursor};
}
