import {pinPostgresTimeouts} from './postgresTransactionPolicy.js';

export async function withPostgresControl(pool,work) {
  const client=await pool.connect();
  let discard=true;
  try {
    await client.query('BEGIN READ ONLY');
    await pinPostgresTimeouts(client);
    const {rows:[state]}=await client.query(`SELECT current_user AS role,
      nullif(current_setting('app.tenant_id',true),'') AS tenant`);
    if (state.role!=='control_login' || state.tenant!==null) throw new Error('Dirty control connection');
    await client.query('SET LOCAL ROLE control_role');
    const value=await work(client);
    if (client.getTransactionStatus()!=='T') throw new Error('Control transaction cannot commit');
    await client.query('COMMIT');
    discard=false;
    return value;
  } finally {
    try {if(['T','E'].includes(client.getTransactionStatus())) await client.query('ROLLBACK');}
    finally {client.release(discard);}
  }
}

export async function controlReadiness(client,expectedVersion,now=Date.now()) {
  const {rows:[row]}=await client.query(`SELECT schema_version,queue_depth,drops_by_reason,oldest_pending_at,running_jobs
    FROM tenant_ops.readiness WHERE singleton=true`);
  if (!row || row.schema_version!==expectedVersion) {
    return {status:503,body:{ready:false,reasons:['schema_not_migrated']}};
  }
  const {schema_version,queue_depth,drops_by_reason,oldest_pending_at,running_jobs}=row;
  return {status:200,body:{ready:true,schema_version,metrics:{queue_depth,drops_by_reason,
    oldest_pending_job_age_ms:oldest_pending_at===null?null:Math.max(0,now-Number(oldest_pending_at)),running_jobs}}};
}

export async function discoverJobTenants(client) {
  const {rows}=await client.query('SELECT id FROM tenant_ops.active_tenants ORDER BY id');
  return rows.map(row=>row.id);
}

export const aiHistorySql=`SELECT id,body,from_me FROM tenant_data.wa_messages
  WHERE tenant_id=$1::uuid AND number_id=$2::bigint AND chat_id=$3::bigint
  ORDER BY ts DESC,id DESC LIMIT 8`;
export async function readPostgresAiHistory({client,tenantId},numberId,chatId) {
  const {rows}=await client.query(aiHistorySql,[tenantId,numberId,chatId]);
  return rows.reverse().map(row=>({role:row.from_me?'assistant':'user',content:row.body}));
}

export const claimDealSql=`WITH due AS (
  SELECT id FROM tenant_data.deal_work WHERE tenant_id=$1::uuid AND state='pending'
  ORDER BY id LIMIT $2::integer FOR UPDATE SKIP LOCKED
) UPDATE tenant_data.deal_work job SET state='claimed' FROM due
  WHERE job.tenant_id=$1::uuid AND job.id=due.id RETURNING job.id,job.tenant_id`;
export async function claimPostgresDealJobs({client,tenantId},limit) {
  return (await client.query(claimDealSql,[tenantId,limit])).rows;
}

export const retentionSql='DELETE FROM tenant_data.wa_messages WHERE tenant_id=$1::uuid AND ts<$2::bigint';
export async function retainPostgresTenantMessages({client,tenantId},cutoff) {
  return (await client.query(retentionSql,[tenantId,cutoff])).rowCount;
}
