import {config} from './config.js';
import {db} from './db.js';
import {loginUser,setCookie} from './auth.js';

// Raqio adalah penyedia login tunggal. Akses per produk: akun Raqio hanya boleh masuk bila org-nya memegang
// produk "wasuite" (Customer Service Agent). Dua jalur:
//  - startRaqioSession: cookie raqio_session terbaca langsung (deployment satu hostname dengan Raqio).
//  - redeemRaqioTicket: tiket sekali pakai 60 detik dari Raqio (/go/wasuite → /#raqio-ticket=…), dikirim halaman lewat
//    POST /api/login {raqio_ticket} lalu ditukar server-ke-server dengan RAQIO_SSO_SECRET. Untuk WA-Suite di host lain;
//    cookie sesi Raqio tidak pernah dibagikan, dan tiket di fragmen tidak masuk log server maupun Referer.
const WASUITE='wasuite';
const hasWaSuite=profile=>Array.isArray(profile?.products)&&profile.products.includes(WASUITE);

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
  if(!hasWaSuite(profile)){
    return res.status(403).json({code:'RAQIO_PRODUCT_REQUIRED',error:'Akun RAQIO ini belum memiliki WA-Suite (Customer Service Agent).',loginUrl});
  }
  const user=db.prepare('SELECT id,username,role,platform_role FROM users WHERE email=? COLLATE NOCASE').get(profile.email);
  if(!user)return res.status(403).json({code:'RAQIO_WA_ACCESS_REQUIRED',error:'Akun RAQIO ini belum memiliki akses WA-Suite.',loginUrl});

  const out=loginUser(user,req);
  setCookie(res,out.token,out.expires);
  return res.json({user:out.user,loginUrl});
}

// POST /api/login {raqio_ticket}: tukar tiket sekali pakai dari Raqio (dibawa di fragmen URL #raqio-ticket),
// buat sesi WA-Suite. Jawaban JSON sama bentuknya dengan startRaqioSession, jadi halaman memakai notifikasi yang sama.
export async function redeemRaqioTicket(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(!config.raqioSso)return res.status(404).json({code:'RAQIO_SSO_DISABLED'});
  const loginUrl=config.raqioLoginUrl;
  const ticket=req.body?.raqio_ticket;
  if(!config.raqioSsoSecret){
    return res.status(503).json({code:'RAQIO_SSO_MISCONFIGURED',error:'Login Raqio lintas host belum dikonfigurasi (RAQIO_SSO_SECRET kosong).',loginUrl});
  }
  if(typeof ticket!=='string'||!/^[0-9a-f]{64}$/.test(ticket)){
    return res.status(400).json({code:'RAQIO_TICKET_INVALID',error:'Tautan masuk tidak valid. Buka WA-Suite dari halaman pilih agen di Raqio.',loginUrl});
  }
  let profile;
  try{
    const response=await fetch(new URL('/auth/sso/redeem',config.raqioApiUrl),{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${config.raqioSsoSecret}`},
      body:JSON.stringify({ticket,product:WASUITE}),
      redirect:'error',
      signal:AbortSignal.timeout(5000),
    });
    if(response.status===401)return res.status(401).json({code:'RAQIO_TICKET_INVALID',error:'Tautan masuk sudah dipakai atau kedaluwarsa. Buka lagi WA-Suite dari halaman pilih agen di Raqio.',loginUrl});
    if(response.status===403)return res.status(403).json({code:'RAQIO_PRODUCT_REQUIRED',error:'Akun Raqio ini belum memiliki WA-Suite (Customer Service Agent).',loginUrl});
    if(!response.ok)throw new Error('RAQIO ticket redeem failed');
    profile=await response.json();
  }catch{
    return res.status(503).json({code:'RAQIO_LOGIN_UNAVAILABLE',error:'Layanan login RAQIO sedang tidak tersedia.',loginUrl});
  }
  if(profile.guest!==false||profile.verified!==true||typeof profile.email!=='string'){
    return res.status(403).json({code:'RAQIO_ACCOUNT_REQUIRED',error:'Masuk dengan akun RAQIO yang emailnya sudah terverifikasi.',loginUrl});
  }
  if(!hasWaSuite(profile)){
    return res.status(403).json({code:'RAQIO_PRODUCT_REQUIRED',error:'Akun Raqio ini belum memiliki WA-Suite (Customer Service Agent).',loginUrl});
  }
  const user=db.prepare('SELECT id,username,role,platform_role FROM users WHERE email=? COLLATE NOCASE').get(profile.email);
  if(!user)return res.status(403).json({code:'RAQIO_WA_ACCESS_REQUIRED',error:'Akun RAQIO ini belum memiliki akses WA-Suite.',loginUrl});

  const out=loginUser(user,req);
  setCookie(res,out.token,out.expires);
  return res.json({user:out.user,loginUrl});
}
