import 'dotenv/config';
import path from 'node:path';

export const config = {
  allowAutoMigrate: process.env.ALLOW_AUTO_MIGRATE === '1',
  migrationBackupKeep: Math.max(1, Number.parseInt(process.env.MIGRATION_BACKUP_KEEP || '5',10) || 5),
  multitenantEnabled: process.env.MULTITENANT_ENABLED === '1',
  aiProvider: process.env.AI_PROVIDER === 'ollama' ? 'ollama' : 'venice',
  aiModel: process.env.AI_MODEL || 'venice-uncensored',
  aiOllamaUrl: process.env.AI_OLLAMA_URL || 'http://127.0.0.1:11434/v1',
  aiVeniceUrl: process.env.AI_VENICE_URL || 'https://api.venice.ai/api/v1',
  aiVeniceKey: process.env.AI_VENICE_KEY || '',
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
  aiMaxToolSteps: Math.min(3, Math.max(1, Number(process.env.AI_MAX_TOOL_STEPS || 3))),
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  trustProxy: process.env.TRUST_PROXY === '1',
  secureCookie: process.env.SECURE_COOKIE === '1',
  loginMax: Number(process.env.LOGIN_MAX || 5),
  loginLockMin: Number(process.env.LOGIN_LOCK_MIN || 15),
  passMin: Math.max(12, Number.parseInt(process.env.PASS_MIN || '12', 10) || 12),
  dataDir: process.env.DATA_DIR || path.resolve('data'),
  mediaSignedUrlsEnabled: process.env.MEDIA_SIGNED_URLS_ENABLED === '1',
  mediaSigningKey: process.env.MEDIA_SIGNING_KEY || '',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'admin123',
  delayMin: Number(process.env.SEND_DELAY_MIN || 1200),
  delayMax: Number(process.env.SEND_DELAY_MAX || 3500),
  ratePerMinute: Number(process.env.RATE_PER_MINUTE || 8),
  chatCooldownMin: Number(process.env.CHAT_COOLDOWN_MIN || 10),
  dailyCap: Number(process.env.DAILY_CAP || 200),
  warmupEnabled: process.env.WARMUP_ENABLED !== '0',
  warmupStart: Number(process.env.WARMUP_START || 25),
  warmupStep: Number(process.env.WARMUP_STEP || 15),
  businessStart: Number(process.env.BUSINESS_START || 0),
  businessEnd: Number(process.env.BUSINESS_END || 0),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 7),
  backupDir: process.env.BACKUP_DIR || path.resolve('backups'),
  backupKeep: Number(process.env.BACKUP_KEEP || 7),
  backupHour: Number(process.env.BACKUP_HOUR ?? 3),
  backupMedia: process.env.BACKUP_MEDIA === '1',
  retentionDays: Number(process.env.RETENTION_DAYS || 0),
  callAutoReject: process.env.CALL_AUTO_REJECT === '1',
  callReply: process.env.CALL_REPLY || '',
};

// T01 only: routes/workers/sockets still require T02–T15 before activation.
if (config.multitenantEnabled) {
  throw new Error('MULTITENANT_ENABLED requires the remaining tenant isolation stages; T01 is foundation only');
}

// Validate before db.js can create/migrate a database. Never log the supplied key.
if (config.mediaSignedUrlsEnabled && config.mediaSigningKey.length < 32) {
  throw new Error('MEDIA_SIGNING_KEY wajib minimal 32 karakter saat media bertanda tangan diaktifkan');
}
