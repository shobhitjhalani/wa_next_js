-- Composite / partial indexes the new app relies on (not present in MySQL).
-- Run after indexes.ts. CONCURRENTLY: safe on a live database; run outside a transaction.
-- Worker claim: WHERE m_user_id = ? AND m_status = 1 ... ORDER BY m_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS js_message_user_status_id ON js_message (m_user_id, m_status, m_id);
-- Admin reports (wa_send, wa_que, wa_in_process ...): outgoing messages by status, newest first
CREATE INDEX CONCURRENTLY IF NOT EXISTS js_message_out_status ON js_message (m_status, m_id DESC) INCLUDE (m_delivery_status) WHERE m_is_incoming = 2 AND m_dstatus = 0;
-- Admin wa_failed report
CREATE INDEX CONCURRENTLY IF NOT EXISTS js_message_out_failed ON js_message (m_delivery_status, m_id DESC) INCLUDE (m_status) WHERE m_is_incoming = 2 AND m_dstatus = 0;

-- Admin message reports default to the current month and list newest first by date.
CREATE INDEX CONCURRENTLY IF NOT EXISTS js_message_created_id ON js_message (m_created_on DESC, m_id DESC);
-- Template report: queued/processing templates per user/template (counted over all dates, as in PHP).
CREATE INDEX CONCURRENTLY IF NOT EXISTS js_message_status_type_user_tpl ON js_message (m_status, m_msg_type, m_user_id, m_msg_template_name);

-- A freshly loaded table has no visibility map, so index-only scans still read the heap.
-- Vacuum once after migration (autovacuum keeps it up to date afterwards).
VACUUM (ANALYZE) js_message;
