-- Columns the current PHP code uses that are missing from the (older) local MySQL copy.
-- Idempotent: run after pgloader. On a fresh production dump these already exist.
ALTER TABLE public.js_message ADD COLUMN IF NOT EXISTS m_button_url text;
-- Written by the public API (create_wa / send_message) and read by status_wa (waapi/api.php).
ALTER TABLE public.js_message ADD COLUMN IF NOT EXISTS m_unique_id char(36);
CREATE INDEX IF NOT EXISTS js_message_m_unique_id ON public.js_message (m_unique_id);
-- Used by waapi/webhook.php (fun_incoming_msg / fun_incoming_log / u_send_app forwarding).
ALTER TABLE public.js_message ADD COLUMN IF NOT EXISTS m_reply_message_id varchar(255);
ALTER TABLE public.js_incoming_log ADD COLUMN IF NOT EXISTS post_url varchar(255);
ALTER TABLE public.js_user ADD COLUMN IF NOT EXISTS u_send_app smallint NOT NULL DEFAULT 2;

-- User panel (compose / templates). Production stores 'template' / 'flow' here.
ALTER TABLE public.js_user_templates ADD COLUMN IF NOT EXISTS ut_parameters text;
ALTER TABLE public.js_user_templates ALTER COLUMN ut_template_type DROP DEFAULT;
ALTER TABLE public.js_user_templates ALTER COLUMN ut_template_type TYPE varchar(25) USING ut_template_type::text;
ALTER TABLE public.js_user_templates ALTER COLUMN ut_template_type SET DEFAULT 'template';
ALTER TABLE public.js_message ADD COLUMN IF NOT EXISTS m_campaign_id integer NOT NULL DEFAULT 0;
-- One row per compose submission; uc_unique_code blocks double submits ("Duplicate Campaign").
CREATE TABLE IF NOT EXISTS public.js_user_campaign (
  uc_id serial PRIMARY KEY,
  uc_unique_code varchar(255) NOT NULL UNIQUE,
  uc_template varchar(255),
  uc_user_id integer NOT NULL DEFAULT 0,
  uc_total_contacts integer NOT NULL DEFAULT 0,
  uc_created_on timestamptz NOT NULL DEFAULT now()
);
