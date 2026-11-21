import { dealReasons } from './dealReasons.js';

const agentId = `COALESCE((SELECT assignee_id FROM chats WHERE id=d.chat_id AND tenant_id=d.tenant_id),
     (SELECT agent_id FROM messages WHERE chat_id=d.chat_id AND tenant_id=d.tenant_id AND from_me=1 AND agent_id IS NOT NULL ORDER BY id DESC LIMIT 1))`;
const dimensions = `json_object(
  'number_id',d.session_id,'number',(SELECT name FROM numbers WHERE id=d.session_id AND tenant_id=d.tenant_id),
  'product_id',d.product_id,'product',(SELECT name FROM products WHERE id=d.product_id AND tenant_id=d.tenant_id),
  'agent',(SELECT u.username FROM users u JOIN tenant_members tm ON tm.user_id=u.id AND tm.tenant_id=d.tenant_id
     WHERE u.id=${agentId}),
  'agent_id',${agentId},
  'handler',CASE
    WHEN EXISTS(SELECT 1 FROM messages m WHERE m.chat_id=d.chat_id AND m.tenant_id=d.tenant_id AND m.from_me=1 AND m.analytics_source='ai')
    THEN CASE WHEN EXISTS(SELECT 1 FROM messages m WHERE m.chat_id=d.chat_id AND m.tenant_id=d.tenant_id AND m.from_me=1 AND m.agent_id IS NOT NULL) THEN 'mixed' ELSE 'ai' END
    WHEN EXISTS(SELECT 1 FROM messages m WHERE m.chat_id=d.chat_id AND m.tenant_id=d.tenant_id AND m.from_me=1 AND m.agent_id IS NOT NULL) THEN 'human'
    ELSE 'unknown' END)`;

// Registry of every deal_events type. Tests fail when code writes a type missing here.
// is_system: written by jobs/triggers (actor NULL) rather than by a person. Delete rules do not depend on it.
export const DEAL_EVENT_TYPES = Object.freeze({
  analytics_opened:1, analytics_dimensions:1, analytics_baseline:1, analytics_answered:1, analytics_unanswered:1,
  sla_escalated:1, sla_expired:1, dp_hangus:1, dp_h_minus_1:1, dp_h_plus_1:1, dp_reminder_skipped:1,
  decision:0, proof_recorded:0, dp_termin:0, refund:0, analytics_qualified:0, audit_sampled:0, audit_completed:0,
});
// A deal is decided by its state or by any recorded decision; decided deals block chat/number deletion.
export const DECIDED_STATES = ['verified_lunas','dp_aktif','dp_termin','dp_hangus','rejected','refunded','cancelled'];
const decided = `(OLD.state IN (${DECIDED_STATES.map(s=>`'${s}'`).join(',')})
  OR EXISTS(SELECT 1 FROM deal_events WHERE deal_id=OLD.id AND type='decision'))`;
const reasonCheck = Object.keys(dealReasons).map(code => "'" + code + "'").join(',');
// Display name of a message author, frozen into evidence so retention cannot erase who sent the proof.
const senderName = (m,c) => `CASE WHEN ${m}.from_me=1 THEN COALESCE((SELECT username FROM users WHERE id=${m}.agent_id),'Tim')
  ELSE COALESCE((SELECT name FROM contacts_v2 WHERE number_id=${c}.number_id AND jid=${c}.jid),NULLIF(${c}.name,''),
    NULLIF(${c}.push_name,''),${c}.pn,${c}.jid,'') END`;
const evidenceInChat = `EXISTS(SELECT 1 FROM deals d JOIN messages m ON m.chat_id=d.chat_id AND m.number_id=d.session_id
  AND m.tenant_id=d.tenant_id WHERE d.id=NEW.deal_id AND m.id=NEW.message_id)`;
const verifierInTenant = `EXISTS(SELECT 1 FROM deals d JOIN tenant_members tm ON tm.tenant_id=d.tenant_id
  WHERE d.id=NEW.deal_id AND tm.user_id=NEW."by")`;

export function migrateDealAnalytics(db) {
  // Triggers on other tables that mention a rebuilt table are set aside and restored with their exact SQL,
  // because SQLite re-validates them during the rename step of the rebuild.
  const dependents = db.prepare(`SELECT name,sql FROM sqlite_master WHERE type='trigger'
    AND tbl_name NOT IN ('deal_evidence','deal_verifications')
    AND (sql LIKE '%deal_verifications%' OR sql LIKE '%deal_evidence%')`).all();
  for (const t of dependents) db.exec(`DROP TRIGGER "${t.name}"`);
  rebuildAndExtend(db);
  for (const t of dependents) db.exec(t.sql);
}

function rebuildAndExtend(db) {
  db.exec(`
    CREATE TABLE deal_event_types (type TEXT PRIMARY KEY, is_system INTEGER NOT NULL CHECK(is_system IN (0,1)));
    ${Object.entries(DEAL_EVENT_TYPES).map(([t,s])=>`INSERT INTO deal_event_types VALUES('${t}',${s});`).join('\n    ')}

    -- Evidence survives message retention: the message link becomes NULL, the snapshot stays.
    CREATE TABLE deal_evidence_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL, kind TEXT NOT NULL,
      snapshot_sender_name TEXT NOT NULL DEFAULT '', snapshot_body TEXT NOT NULL DEFAULT '',
      snapshot_at INTEGER NOT NULL DEFAULT 0, UNIQUE(deal_id,message_id)
    );
    INSERT INTO deal_evidence_v8(id,deal_id,message_id,kind,snapshot_sender_name,snapshot_body,snapshot_at)
      SELECT e.id,e.deal_id,e.message_id,e.kind,COALESCE(${senderName('m','c')},''),COALESCE(m.body,''),COALESCE(m.ts,0)
      FROM deal_evidence e LEFT JOIN messages m ON m.id=e.message_id LEFT JOIN chats c ON c.id=m.chat_id;
    DROP TABLE deal_evidence;
    ALTER TABLE deal_evidence_v8 RENAME TO deal_evidence;
    CREATE TRIGGER deal_evidence_scope_INSERT BEFORE INSERT ON deal_evidence WHEN NOT ${evidenceInChat}
      BEGIN SELECT RAISE(ABORT,'deal tenant relationship mismatch'); END;
    CREATE TRIGGER deal_evidence_scope_UPDATE BEFORE UPDATE ON deal_evidence
      WHEN NEW.message_id IS NOT NULL AND NOT ${evidenceInChat}
      BEGIN SELECT RAISE(ABORT,'deal tenant relationship mismatch'); END;
    CREATE TRIGGER deal_evidence_snapshot AFTER INSERT ON deal_evidence WHEN NEW.message_id IS NOT NULL BEGIN
      UPDATE deal_evidence SET
        snapshot_sender_name=(SELECT COALESCE(${senderName('m','c')},'') FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=NEW.message_id),
        snapshot_body=(SELECT COALESCE(body,'') FROM messages WHERE id=NEW.message_id),
        snapshot_at=(SELECT ts FROM messages WHERE id=NEW.message_id)
      WHERE id=NEW.id;
    END;

    -- Verifiers can be deleted; their name stays on every decision they made.
    CREATE TABLE deal_verifications_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      decision TEXT NOT NULL, reason_code TEXT CHECK(reason_code IN (${reasonCheck})), note TEXT,
      "by" INTEGER REFERENCES users(id) ON DELETE SET NULL, actor_label TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL,
      CHECK(decision <> 'rejected' OR reason_code IS NOT NULL),
      CHECK(reason_code IS NOT 'lain_lain' OR (note IS NOT NULL AND length(trim(note)) >= 10))
    );
    INSERT INTO deal_verifications_v8(id,deal_id,decision,reason_code,note,"by",actor_label,at)
      SELECT v.id,v.deal_id,v.decision,v.reason_code,v.note,v."by",COALESCE((SELECT username FROM users WHERE id=v."by"),''),v.at
      FROM deal_verifications v;
    DROP TABLE deal_verifications;
    ALTER TABLE deal_verifications_v8 RENAME TO deal_verifications;
    CREATE TRIGGER deal_verifications_scope_INSERT BEFORE INSERT ON deal_verifications
      WHEN NEW."by" IS NULL OR NOT ${verifierInTenant}
      BEGIN SELECT RAISE(ABORT,'deal tenant relationship mismatch'); END;
    CREATE TRIGGER deal_verifications_scope_UPDATE BEFORE UPDATE ON deal_verifications
      WHEN NEW."by" IS NOT NULL AND NOT ${verifierInTenant}
      BEGIN SELECT RAISE(ABORT,'deal tenant relationship mismatch'); END;
    CREATE TRIGGER deal_verifications_label AFTER INSERT ON deal_verifications WHEN NEW.actor_label='' BEGIN
      UPDATE deal_verifications SET actor_label=COALESCE((SELECT username FROM users WHERE id=NEW."by"),'') WHERE id=NEW.id;
    END;
    CREATE INDEX deal_verification_by_decision ON deal_verifications(deal_id,decision,id);

    -- Deletion: a decided deal blocks chat/number deletion with a named error; an undecided deal is
    -- removed together with its whole event history, whatever event types it carries.
    DROP TRIGGER deal_events_no_delete;
    CREATE TRIGGER deal_events_no_delete BEFORE DELETE ON deal_events
      WHEN EXISTS(SELECT 1 FROM deals d JOIN chats c ON c.id=d.chat_id JOIN numbers n ON n.id=d.session_id WHERE d.id=OLD.deal_id)
      BEGIN SELECT RAISE(ABORT,'deal events are append-only'); END;
    CREATE TRIGGER deal_decided_delete_guard BEFORE DELETE ON deals WHEN ${decided}
      BEGIN SELECT RAISE(ABORT,'DEAL_DECIDED: deal sudah diputuskan dan tidak dapat dihapus'); END;
    CREATE TRIGGER deal_analytics_purge BEFORE DELETE ON deals WHEN NOT ${decided}
      BEGIN DELETE FROM deal_events WHERE deal_id=OLD.id; END;

    ALTER TABLE tenants ADD COLUMN analytics_timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta';
    ALTER TABLE messages ADD COLUMN analytics_source TEXT CHECK(analytics_source IN ('ai','human'));
    CREATE INDEX deal_analytics_opened ON deals(tenant_id,created_at,id);
    CREATE INDEX deal_analytics_messages ON messages(tenant_id,chat_id,from_me,id);

    CREATE TRIGGER deal_analytics_insert AFTER INSERT ON deals BEGIN
      INSERT INTO deal_events(deal_id,type,payload_json,actor,at)
      SELECT d.id,'analytics_opened',json_object('state',d.state),
        NULL,d.created_at FROM deals d WHERE d.id=NEW.id;
    END;
    INSERT INTO deal_events(deal_id,type,payload_json,actor,at)
    SELECT d.id,'analytics_opened',json_object('state',COALESCE((SELECT json_extract(e.payload_json,'$.from') FROM deal_events e WHERE e.deal_id=d.id AND e.type='decision' ORDER BY e.id LIMIT 1),
      CASE WHEN d.state IN ('no_signal','candidate','awaiting_proof','proof_submitted') THEN d.state ELSE 'candidate' END)),NULL,d.created_at FROM deals d;
    INSERT INTO deal_events(deal_id,type,payload_json,actor,at)
    SELECT d.id,'analytics_dimensions',${dimensions},NULL,d.created_at FROM deals d;
    CREATE TRIGGER deal_analytics_dimensions AFTER INSERT ON deal_events
    WHEN NEW.type IN ('analytics_opened','decision','analytics_qualified','analytics_unanswered') BEGIN
      INSERT INTO deal_events(deal_id,type,payload_json,actor,at)
      SELECT d.id,'analytics_dimensions',${dimensions},NULL,NEW.at FROM deals d WHERE d.id=NEW.deal_id;
    END;
    CREATE TRIGGER deal_analytics_answered AFTER INSERT ON messages WHEN NEW.from_me=1 AND NEW.kind<>'call' BEGIN
      INSERT INTO deal_events(deal_id,type,payload_json,actor,at)
      SELECT d.id,'analytics_answered','{}',NULL,NEW.ts FROM deals d
      WHERE d.tenant_id=NEW.tenant_id AND d.chat_id=NEW.chat_id AND d.session_id=NEW.number_id
      AND d.state IN ('candidate','awaiting_proof','proof_submitted','expired')
      AND (SELECT e.type FROM deal_events e WHERE e.deal_id=d.id
        AND e.type IN ('analytics_unanswered','analytics_answered') ORDER BY e.id DESC LIMIT 1)='analytics_unanswered';
    END;

    -- Preserve the last observable state of older drafts and the verified metadata of older DP.
    INSERT INTO deal_events(deal_id,type,payload_json,actor,at)
    SELECT d.id,'analytics_baseline',json_object('state',d.state,'origin',d.origin,'amount',d.amount,
      'paid_amount',d.paid_amount,'reason_code',d.reason_code,
      'closer',(SELECT v."by" FROM deal_verifications v WHERE v.deal_id=d.id AND v.decision='verified_lunas' ORDER BY v.id DESC LIMIT 1),
      'verified',EXISTS(SELECT 1 FROM deal_verifications v WHERE v.deal_id=d.id AND
        v.decision=CASE WHEN d.state='refunded' THEN 'verified_lunas' ELSE d.state END),
      'ledger_paid',COALESCE((SELECT SUM(amount) FROM dp_payments WHERE deal_id=d.id),0),
      'dp_started',(SELECT MIN(at) FROM dp_payments WHERE deal_id=d.id)),NULL,COALESCE(d.decided_at,d.created_at)
    FROM deals d;
  `);
}
