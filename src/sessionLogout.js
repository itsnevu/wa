import {config} from './config.js';
import {cookieId,revokeSession} from './sessionStore.js';
import {expirePostgresSession,sessionTokenHash} from './postgresTenantAuth.js';

export async function logoutSqlite(req,transactions) {
  const token = cookieId(req);
  if (token) await transactions.withAuth(db => revokeSession(token,db));
}

export async function logoutPostgres(req,transactions) {
  const token = cookieId(req);
  if (token) await transactions.withAuth(client => expirePostgresSession(client,sessionTokenHash(token)));
}

export function clearCookie(res) {
  res.setHeader('Set-Cookie',`sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${config.secureCookie ? '; Secure' : ''}`);
}

export function createLogoutHandler(logout) {
  return async (req,res) => {
    await logout(req);
    clearCookie(res);
    res.json({ok:true});
  };
}
