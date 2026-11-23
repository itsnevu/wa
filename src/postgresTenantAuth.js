import {createHash,randomBytes} from 'node:crypto';
import {cookieId,sessionError} from './sessionStore.js';

const hash = token => createHash('sha256').update(token).digest('hex');
export const newSessionToken = () => randomBytes(32).toString('hex');
export const sessionTokenHash = hash;
const invalid = () => sessionError(401,'SESSION_INVALID');
const lockSql = 'SELECT pg_advisory_xact_lock_shared(hashtextextended($1::uuid::text, 3201))';
const activeSessionSql = `SELECT token_hash,user_id,tenant_id,expires_at,created_at FROM tenant_auth.sessions
  WHERE token_hash=$1::text AND expires_at>clock_timestamp()`;

export async function lookupMembership(db,userId,tenantId) {
  if (userId==null || !tenantId) throw new Error('Membership lookup requires user_id and tenant_id');
  const {rows:[row]}=await db.query(`SELECT role FROM tenant_auth.tenant_members
    WHERE user_id=$1::bigint AND tenant_id=$2::uuid`,[userId,tenantId]);
  return row?.role;
}

export function createPostgresTenantAuth(pool, stats={}) {
  stats.checkouts ??= 0;
  stats.contextViolations ??= 0;
  const loginRole='app_login';
  async function clean(client) {
    const {rows:[row]}=await client.query(`SELECT current_user AS role,
      nullif(current_setting('app.tenant_id',true),'') AS tenant`);
    if (row.role!==loginRole || row.tenant!==null) {
      stats.contextViolations++;
      throw new Error('PostgreSQL connection carried a role or tenant across transactions');
    }
  }

  async function transaction(fn,readOnly=false) {
    const client=await pool.connect();
    stats.checkouts++;
    let discard=true;
    try {
      await clean(client);
      await client.query(readOnly?'BEGIN READ ONLY':'BEGIN');
      await clean(client);
      const result=await fn(client);
      if (client.getTransactionStatus()!=='T') throw new Error('PostgreSQL transaction cannot commit');
      await client.query('COMMIT');
      discard=false;
      return result;
    } finally {
      try {
        if (['T','E'].includes(client.getTransactionStatus())) {
          await client.query('ROLLBACK');
          discard=false;
        }
        if (client.getTransactionStatus()!=='I') discard=true;
        if (!discard) await clean(client);
      } catch(error) { discard=true;throw error; }
      finally {client.release(discard);}
    }
  }

  async function asAuth(client) {
    await client.query('SET LOCAL ROLE auth_role');
  }
  async function asTenant(client,tenantId) {
    await client.query('SET LOCAL ROLE app_role');
    await client.query("SELECT set_config('app.tenant_id',$1::uuid::text,true)",[tenantId]);
  }
  const withAuth=fn=>transaction(async client=>{
    await asAuth(client);
    return fn(client);
  });
  const revoke=tokenHash=>withAuth(client=>client.query(`UPDATE tenant_auth.sessions
    SET expires_at=clock_timestamp() WHERE token_hash=$1::text AND expires_at>clock_timestamp()`,[tokenHash]));

  async function resolve(req) {
    const token=cookieId(req);
    if (!token) throw invalid();
    const tokenHash=hash(token);
    const {rows:[session]}=await withAuth(db=>db.query(activeSessionSql,[tokenHash]));
    if (!session?.tenant_id) throw invalid();
    return session;
  }

  async function withinTenant(req,hostTenantId,fn,readOnly) {
    const session=await resolve(req);
    const tenantId=session.tenant_id;
    if (tenantId!==hostTenantId) throw sessionError(404,'TENANT_NOT_FOUND');
    const outcome=await transaction(async client=>{
      await client.query(lockSql,[tenantId]);
      await asTenant(client,tenantId);
      const {rowCount}=await client.query(`SELECT id FROM tenant_data.tenants
        WHERE id=$1::uuid AND status='active' AND deleted_at IS NULL`,[tenantId]);
      await asAuth(client);
      const role=await lookupMembership(client,session.user_id,tenantId);
      const {rowCount:stillLive}=await client.query(activeSessionSql,[session.token_hash]);
      if (!role || !rowCount || !stillLive) return {revoked:true};
      await asTenant(client,tenantId);
      const value=await fn({client,tenantId,userId:session.user_id,role});
      return {value};
    },readOnly);
    if (outcome.revoked) {
      await revoke(session.token_hash);
      throw invalid();
    }
    return outcome.value;
  }

  async function rotate(req,hostTenantId,targetTenantId=hostTenantId) {
    const session=await resolve(req);
    if (session.tenant_id!==hostTenantId) throw sessionError(404,'TENANT_NOT_FOUND');
    const token=newSessionToken();
    const changed=hostTenantId!==targetTenantId;
    const expiry=await transaction(async client=>{
      for (const tenant of [...new Set([hostTenantId,targetTenantId])].sort()) await client.query(lockSql,[tenant]);
      for (const tenant of [...new Set([hostTenantId,targetTenantId])]) {
        await asTenant(client,tenant);
        const {rowCount}=await client.query(`SELECT id FROM tenant_data.tenants
          WHERE id=$1::uuid AND status='active' AND deleted_at IS NULL`,[tenant]);
        await asAuth(client);
        if (!rowCount || !await lookupMembership(client,session.user_id,tenant)) throw invalid();
      }
      const updated=await client.query(`UPDATE tenant_auth.sessions SET token_hash=$2::text,tenant_id=$3::uuid
        WHERE token_hash=$1::text AND expires_at>clock_timestamp() RETURNING expires_at`,
      [session.token_hash,hash(token),targetTenantId]);
      if (updated.rowCount!==1) throw invalid();
      if (changed) {
        await asTenant(client,targetTenantId);
        await client.query(`INSERT INTO tenant_data.session_audit(tenant_id,user_id,prior_tenant)
          VALUES($1::uuid,$2::bigint,$3::uuid)`,[targetTenantId,session.user_id,hostTenantId]);
      }
      return updated.rows[0].expires_at.getTime();
    });
    return {id:token,expires_at:expiry};
  }

  return {withAuth,withTenantRead:(req,tenant,fn)=>withinTenant(req,tenant,fn,true),
    withTenantWrite:(req,tenant,fn)=>withinTenant(req,tenant,fn,false),rotate};
}

export async function consumePostgresQuota({client,tenantId},numberId,day,cap) {
  if (!Number.isSafeInteger(cap) || cap<0) throw new Error('Invalid quota cap');
  if (!cap) return false;
  const result=await client.query(`INSERT INTO tenant_data.send_quota AS q(tenant_id,number_id,day,used)
    VALUES($1::uuid,$2::bigint,$3::date,1) ON CONFLICT(tenant_id,number_id,day)
    DO UPDATE SET used=q.used+1 WHERE q.used<$4::integer RETURNING used`,[tenantId,numberId,day,cap]);
  return result.rowCount===1;
}
