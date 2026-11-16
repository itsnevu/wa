import { q } from '../db.js';
import { aiDay } from '../limits.js';
import { emit } from '../wa.js';

export function stopNotice(numberId, chat, s) {
  const fresh = q.addNotice.run(numberId, chat.id, aiDay(), 'stop').changes > 0;
  q.setChatState.run('pending', chat.id);
  if (fresh && chat.assignee_id) {
    q.insertNotification.run(chat.assignee_id, numberId, chat.id, Date.now());
    emit({ type: 'notification', userId: chat.assignee_id, numberId, chatId: chat.id, body: 'AI berhenti, chat perlu agen' });
  }
  return fresh ? s.stop_reply : null;
}

export function warnOnce(numberId, level) {
  if (!q.addAlert.run(numberId, aiDay(), level, Date.now()).changes) return;
  emit({ type: 'ai.alert', numberId, level });
  if (process.env.AI_ALERT_WEBHOOK) {
    fetch(process.env.AI_ALERT_WEBHOOK, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ numberId, level, at: Date.now() }), signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
}
