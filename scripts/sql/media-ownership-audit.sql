-- Read-only; run before release. IDs only: no message body, phone, or secret.
-- Legacy mismatch (works before the registry migration).
SELECT m.id AS message_id, m.number_id AS message_number_id,
       c.id AS chat_id, c.number_id AS chat_number_id
FROM messages m LEFT JOIN chats c ON c.id=m.chat_id
LEFT JOIN numbers n ON n.id=c.number_id
WHERE m.media_path IS NOT NULL
  AND (c.id IS NULL OR n.id IS NULL OR m.number_id<>c.number_id);

-- Registry mismatch (run after expand migration/backfill).
SELECT r.uuid, r.message_id, r.number_id AS media_number_id,
       m.number_id AS message_number_id, c.number_id AS chat_number_id
FROM media_records r LEFT JOIN messages m ON m.id=r.message_id
LEFT JOIN chats c ON c.id=m.chat_id LEFT JOIN numbers n ON n.id=c.number_id
WHERE m.id IS NULL OR c.id IS NULL OR n.id IS NULL
   OR r.number_id<>m.number_id OR m.number_id<>c.number_id
   OR r.storage_path IS NOT m.media_path;

-- Ambiguous legacy file: never automatically assign one physical file to two numbers.
SELECT m.id AS message_id, m.number_id
FROM messages m WHERE m.media_path IS NOT NULL
AND EXISTS (SELECT 1 FROM messages other
            WHERE other.media_path=m.media_path AND other.number_id<>m.number_id);

-- Unregistered legacy messages: must be zero after backfill unless quarantined.
SELECT m.id AS message_id, m.number_id
FROM messages m LEFT JOIN media_records r ON r.message_id=m.id
WHERE m.media_path IS NOT NULL AND m.media_path<>'' AND r.uuid IS NULL;
