export const postgresTimeouts=Object.freeze({statement:'2s',idleInTransaction:'5s'});
const retryable=new Set(['40001','57P01','08006']);

export async function pinPostgresTimeouts(client) {
  await client.query(`SELECT set_config('statement_timeout',$1::text,true),
    set_config('idle_in_transaction_session_timeout',$2::text,true)`,
  [postgresTimeouts.statement,postgresTimeouts.idleInTransaction]);
}

export async function retryPostgresIdempotent(work,onRetry) {
  for(let retries=0;;retries++){
    try {return await work();}
    catch(error){
      if(retries===2 || !retryable.has(error.code))throw error;
      onRetry?.();
    }
  }
}
