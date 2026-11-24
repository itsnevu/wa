import {config} from './config.js';
import {db} from './db.js';
import {loginUser,setCookie} from './auth.js';

export async function startRaqioSession(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(!config.raqioSso)return res.status(404).json({code:'RAQIO_SSO_DISABLED'});

  const loginUrl=config.raqioLoginUrl;
  const cookies=(req.headers.cookie||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith('raqio_session='));
  if(cookies.length!==1)return res.status(401).json({code:'RAQIO_LOGIN_REQUIRED',loginUrl});

  let profile;
  try{
    const response=await fetch(new URL('/auth/me',config.raqioApiUrl),{
      headers:{Cookie:cookies[0],Accept:'application/json'},
      redirect:'error',
      signal:AbortSignal.timeout(5000),
    });
    if(response.status===401||response.status===403)return res.status(401).json({code:'RAQIO_LOGIN_REQUIRED',loginUrl});
    if(!response.ok)throw new Error('RAQIO session check failed');
    profile=await response.json();
  }catch{
    return res.status(503).json({code:'RAQIO_LOGIN_UNAVAILABLE',error:'Layanan login RAQIO sedang tidak tersedia.'});
  }
  if(profile.guest!==false||profile.verified!==true||typeof profile.email!=='string'){
    return res.status(403).json({code:'RAQIO_ACCOUNT_REQUIRED',error:'Masuk dengan akun RAQIO yang emailnya sudah terverifikasi.',loginUrl});
  }
  const user=db.prepare('SELECT id,username,role,platform_role FROM users WHERE email=? COLLATE NOCASE').get(profile.email);
  if(!user)return res.status(403).json({code:'RAQIO_WA_ACCESS_REQUIRED',error:'Akun RAQIO ini belum memiliki akses WA-Suite.',loginUrl});

  const out=loginUser(user,req);
  setCookie(res,out.token,out.expires);
  return res.json({user:out.user,loginUrl});
}
