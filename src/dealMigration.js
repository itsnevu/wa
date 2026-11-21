import { dealReasons } from './dealReasons.js';

const reasonCheck = Object.keys(dealReasons).map(code => "'" + code + "'").join(',');
const states = "'no_signal','candidate','awaiting_proof','proof_submitted','dp_aktif','dp_termin','verified_lunas','dp_hangus','rejected','expired','refunded','cancelled'";

export function migrateDeals(db) {
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      session_id INTEGER NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
      chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      state TEXT NOT NULL CHECK(state IN (${states})),
      origin TEXT NOT NULL DEFAULT 'direct' CHECK(origin IN ('direct','dp')),
      amount INTEGER CHECK(amount >= 0), paid_amount INTEGER NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
      amount_due INTEGER CHECK(amount_due >= 0), due_at INTEGER, method TEXT,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, qty INTEGER CHECK(qty > 0),
      confidence REAL CHECK(confidence BETWEEN 0 AND 1), suggested_status TEXT, classifier_version TEXT,
      reason_code TEXT CHECK(reason_code IN (${reasonCheck})), assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      due_sla_at INTEGER, created_at INTEGER NOT NULL, decided_at INTEGER,
      CHECK(state <> 'rejected' OR reason_code IS NOT NULL),
      CHECK(state NOT IN ('dp_aktif','dp_termin','dp_hangus') OR origin = 'dp'),
      CHECK(state <> 'dp_aktif' OR (amount_due IS NOT NULL AND due_at IS NOT NULL))
    );
    CREATE UNIQUE INDEX deals_order_unique ON deals(tenant_id,order_id) WHERE order_id IS NOT NULL;
    CREATE INDEX deals_chat_scope ON deals(tenant_id,chat_id);
    CREATE TABLE deal_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, kind TEXT NOT NULL, UNIQUE(deal_id,message_id)
    );
    CREATE TABLE deal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE RESTRICT,
      type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), actor TEXT, at INTEGER NOT NULL
    );
    CREATE TRIGGER deal_events_no_update BEFORE UPDATE ON deal_events BEGIN SELECT RAISE(ABORT,'deal events are append-only'); END;
    CREATE TRIGGER deal_events_no_delete BEFORE DELETE ON deal_events BEGIN SELECT RAISE(ABORT,'deal events are append-only'); END;
    CREATE TRIGGER deal_events_no_replace BEFORE INSERT ON deal_events
      WHEN EXISTS(SELECT 1 FROM deal_events WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'deal events are append-only'); END;
    CREATE TABLE dp_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL CHECK(amount > 0), method TEXT NOT NULL,
      proof_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL, at INTEGER NOT NULL
    );
    CREATE TABLE deal_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      decision TEXT NOT NULL, reason_code TEXT CHECK(reason_code IN (${reasonCheck})), note TEXT,
      "by" INTEGER NOT NULL REFERENCES users(id), at INTEGER NOT NULL,
      CHECK(decision <> 'rejected' OR reason_code IS NOT NULL),
      CHECK(reason_code IS NOT 'lain_lain' OR (note IS NOT NULL AND length(trim(note)) >= 10))
    );
    CREATE TABLE classifier_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE, version TEXT NOT NULL,
      message_range TEXT NOT NULL, output_json TEXT NOT NULL CHECK(json_valid(output_json)),
      tokens INTEGER NOT NULL CHECK(tokens >= 0), status TEXT NOT NULL, at INTEGER NOT NULL,
      UNIQUE(chat_id,message_range,version)
    );
    CREATE INDEX deal_messages_cursor ON messages(tenant_id,chat_id,id);
    CREATE INDEX classifier_cursor ON classifier_runs(tenant_id,chat_id,version,id DESC);

    CREATE TRIGGER deals_tenant_immutable BEFORE UPDATE OF tenant_id ON deals
      WHEN NEW.tenant_id <> OLD.tenant_id BEGIN SELECT RAISE(ABORT,'deal tenant is immutable'); END;
    CREATE TRIGGER deals_other_reason_insert BEFORE INSERT ON deals
      WHEN NEW.state='rejected' AND NEW.reason_code='lain_lain'
      BEGIN SELECT RAISE(ABORT,'lain_lain requires a verification note'); END;
    CREATE TRIGGER deals_other_reason_update BEFORE UPDATE ON deals
      WHEN NEW.state='rejected' AND NEW.reason_code='lain_lain' AND NOT EXISTS(
        SELECT 1 FROM deal_verifications WHERE deal_id=NEW.id AND decision='rejected'
        AND reason_code='lain_lain' AND length(trim(note)) >= 10)
      BEGIN SELECT RAISE(ABORT,'lain_lain requires a verification note'); END;
  `);

  const dealScope = `NOT EXISTS(SELECT 1 FROM chats WHERE id=NEW.chat_id AND number_id=NEW.session_id AND tenant_id=NEW.tenant_id)
    OR (NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id
      AND number_id=NEW.session_id AND (chat_id IS NULL OR chat_id=NEW.chat_id) AND tenant_id=NEW.tenant_id))
    OR (NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id
      AND number_id=NEW.session_id AND tenant_id=NEW.tenant_id))
    OR (NEW.assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tenant_members WHERE tenant_id=NEW.tenant_id AND user_id=NEW.assigned_to))`;
  const sameChat = column => `NOT EXISTS(SELECT 1 FROM deals d JOIN messages m
    ON m.chat_id=d.chat_id AND m.number_id=d.session_id AND m.tenant_id=d.tenant_id
    WHERE d.id=NEW.deal_id AND m.id=NEW.${column})`;
  const predicates = {
    deals: dealScope,
    deal_evidence: sameChat('message_id'),
    dp_payments: `NEW.proof_message_id IS NOT NULL AND ${sameChat('proof_message_id')}`,
    deal_verifications: `NOT EXISTS(SELECT 1 FROM deals d JOIN tenant_members tm ON tm.tenant_id=d.tenant_id
      WHERE d.id=NEW.deal_id AND tm.user_id=NEW."by")`,
    classifier_runs: `NOT EXISTS(SELECT 1 FROM chats WHERE id=NEW.chat_id AND tenant_id=NEW.tenant_id)`,
  };
  for (const [table, predicate] of Object.entries(predicates)) {
    for (const operation of ['INSERT','UPDATE']) {
      db.exec(`CREATE TRIGGER ${table}_scope_${operation} BEFORE ${operation} ON ${table}
        WHEN ${predicate} BEGIN SELECT RAISE(ABORT,'deal tenant relationship mismatch'); END`);
    }
  }
}
