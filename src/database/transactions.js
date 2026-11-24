import {join} from 'node:path';
import Database from './sqlite.js';
import {config} from '../config.js';
import {createPostgresTenantAuth} from '../postgresTenantAuth.js';
import {withPostgresControl} from '../postgresTenantJobs.js';

const sqliteScopes = new WeakMap();

async function sqliteTransaction(filename, readOnly, work) {
  // Keep a transaction on a dedicated handle across async operations.
  // Fail fast on write contention so SQLite cannot block another JS transaction.
  const db = new Database(filename,{readonly:readOnly,fileMustExist:true,timeout:readOnly ? 5000 : 0});
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readOnly ? 'BEGIN DEFERRED' : 'BEGIN IMMEDIATE');
    const result = await work(db);
    db.exec('COMMIT');
    return result;
  } finally {
    try {
      if (db.inTransaction) db.exec('ROLLBACK');
    } finally {
      db.close();
    }
  }
}

export function createSqliteTransactions(filename) {
  const tenantTransaction = (tenantId,readOnly,work) => {
    if (!tenantId) return Promise.reject(new Error('Tenant scope required'));
    return sqliteTransaction(filename,readOnly,async connection => {
      const tx = Object.freeze({});
      sqliteScopes.set(tx,{tenantId,connection});
      try {
        return await work(tx);
      } finally {
        sqliteScopes.delete(tx);
      }
    });
  };
  return Object.freeze({
    withAuth: work => sqliteTransaction(filename,false,work),
    withControl: work => sqliteTransaction(filename,true,work),
    withTenantRead: (tenantId,work) => tenantTransaction(tenantId,true,work),
    withTenantWrite: (tenantId,work) => tenantTransaction(tenantId,false,work),
  });
}

export function withSqliteTenantRead(tenantId,work) {
  return createSqliteTransactions(join(config.dataDir,'app.db')).withTenantRead(tenantId,work);
}

export function sqliteTenantConnection(tx,tenantId) {
  const scope = sqliteScopes.get(tx);
  if (!scope || scope.tenantId !== tenantId) throw new Error('Invalid tenant read scope');
  return scope.connection;
}

export function createPostgresTransactions(appPool,controlPool,stats) {
  const auth = createPostgresTenantAuth(appPool,stats);
  return Object.freeze({
    ...auth,
    withControl: work => withPostgresControl(controlPool,work),
  });
}
