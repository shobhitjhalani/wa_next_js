/**
 * Row shapes of the main js_* tables (column names unchanged from the
 * legacy schema). Dates are unix seconds unless the column is a timestamp
 * ("Y-m-d H:i:s" string). Fetch only the columns you need and Pick<> them.
 */

export interface UserRow {
  u_id: number;
  u_code: string | null;
  u_access_code: string | null;
  u_parent_id: number;
  u_own_account: number | null;
  u_type: number; // 1 corporate / Google sheet, 2 WhatsApp user
  u_name: string | null;
  u_tag: string | null;
  u_company_name: string | null;
  u_company_gst_no: string | null;
  u_mobile_no: string | null;
  u_email_id: string | null;
  u_billing_email_id: string | null;
  u_total_no_of_sheets_allowed: number;
  u_total_no_of_sheets_used: number;
  u_username: string | null;
  u_password: string | null;
  u_google_sheet: number;
  u_google_sheet_email: string | null;
  u_status: number;
  u_has_wa: number;
  u_wa_status: number;
  u_wa_coexistence: number;
  u_wa_no: string | null;
  u_wa_phone_id: string | null;
  u_wa_b_id: string | null;
  u_business_id: string | null;
  u_wa_key: string | null;
  u_wa_enable_incoming: number;
  u_wa_incoming_url: string | null;
  u_last_wa_send: number;
  u_wa_enable_catalogue: number;
  u_wa_catalogue_url: string | null;
  u_wa_form_url: string | null;
  u_wa_app_url: string | null;
  u_last_wa_check: number;
  u_daily_limit: number;
  u_msg_limit: number | null;
  u_msg_used: number;
  u_template_categories: string | null;
  u_is_new_no: number;
  u_enable_ai: number;
  u_enable_calling: number;
  u_calling_url: string | null;
  u_ai_key: string | null;
  u_start_time: number;
  u_end_time: number;
  u_send_wa: number;
  u_send_app: number;
  u_active_session: string | null;
  u_active_plan: number;
  u_wa_plan_status: number;
  u_valid_till: number;
  u_incoming_valid_till: number;
  u_country: number | null;
  u_state: number;
  u_last_recharge: number;
  u_balance: number;
  u_api_url: string | null;
  u_last_active: number;
  u_assign_to: number;
  u_created_on: number;
  u_created_by: number;
  u_updated_by: number;
  u_system_time: string;
  u_updated_on: number;
  u_dstatus: number;
  u_entry_code: string | null;
}

export const USER_TYPE = { CORPORATE: 1, WHATSAPP: 2 } as const;

export interface EmployeeRow {
  emp_id: number;
  emp_m_type: number; // 4 = super admin
  emp_code: string | null;
  emp_name: string | null;
  emp_mobile: string | null;
  emp_email_id: string | null;
  emp_username: string | null;
  emp_password: string | null;
  emp_status: number;
  emp_is_left: number;
  emp_is_login: number;
  emp_last_active: number;
  emp_created_on: number | null;
  emp_updated_on: number;
  emp_dstatus: number;
  [key: string]: unknown;
}

export const SUPER_ADMIN = 4;

export interface MessageRow {
  m_id: number;
  m_user_id: number;
  m_contact_id: number;
  m_campaign_id: number;
  m_unique_id: string | null;
  m_reply_template: number;
  m_is_incoming: number; // 1 incoming, 2 outgoing
  m_msg_lite: number;
  m_mobile_no: string | null;
  m_active_prompt: number;
  m_source: number;
  m_msg_type: string | null;
  m_msg_template_name: string | null;
  m_msg_template_para: string | null;
  m_sender_name: string | null;
  m_title: string | null;
  m_msg_title: string | null;
  m_msg_values: string | null;
  m_content: string | null;
  m_buttons: string | null;
  m_button_url: string | null;
  m_image: string | null;
  m_carousel: string | null;
  m_base_file: string | null;
  m_sheet_id: string | null;
  m_message_id: string | null;
  m_is_read: number; // 1 read, 2 unread
  m_created_on: number;
  m_created_date: number;
  m_system_time: string;
  m_status: number; // see config.messageStatus
  m_delivery_status: string | null;
  m_response_file_name: string | null;
  m_updated_on: number;
  m_in_process_on: number;
  m_error_codes: string | null;
  m_msg_id_count: number;
  m_status_response: string | null;
  m_dstatus: number;
}

export interface ContactRow {
  cl_id: number;
  cl_user_id: number;
  cl_name: string | null;
  cl_mobile_no: string | null;
  cl_opt_out: number; // 1 opted out, 2 not
  cl_enable_ai: number;
  cl_active_prompt: number;
  cl_created_on: string;
  cl_updated_on: string;
  cl_last_msg: string | null;
  cl_last_msg_id: number;
  cl_last_preview: string | null;
  cl_last_dir: number; // 1 incoming, 2 outgoing
  cl_last_in: number;
  cl_unread: number;
}

export interface TemplateRow {
  ut_id: number;
  ut_template_type: string; // template, flow, carousel, Authentication
  ut_template_category: string | null;
  ut_user_id: number;
  ut_language: string | null;
  ut_name: string;
  ut_header_type: string | null;
  ut_header: string | null;
  ut_message: string | null;
  ut_parameters: string | null;
  ut_footer: string | null;
  ut_buttons: string | null;
  ut_cards: string | null;
  ut_file: string | null;
  ut_created_on: number;
  ut_status: number;
  ut_dstatus: number;
}

export interface CampaignPayload {
  type: string;
  fields: Record<string, unknown>;
  numbers: string[];
  lite: boolean;
}

export interface CampaignStats {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  delivery_failed: number;
  skipped: number;
  replied?: number;
}

export interface CampaignRow {
  uc_id: number;
  uc_unique_code: string;
  uc_name: string | null;
  uc_user_id: number;
  uc_template: string | null;
  uc_template_id: number;
  uc_group_ids: string | null;
  uc_total_contacts: number;
  uc_status: number; // 1 scheduled, 2 dispatched, 4 cancelled
  uc_scheduled_at: number;
  uc_started_at: number;
  uc_resent_at: number;
  uc_skipped: number;
  uc_created_on: string;
  uc_payload: CampaignPayload | null;
  uc_stats: CampaignStats | null;
  uc_stats_at: number;
}

export const CAMPAIGN = { SCHEDULED: 1, DISPATCHED: 2, CANCELLED: 4 } as const;

export interface GroupRow {
  ug_id: number;
  ug_user_id: number;
  up_group_name: string | null;
  ug_created_on: string;
  ug_updated_on: number;
  ug_dstatus: number;
}

export interface MasterValueRow {
  mv_id: number;
  mv_type: number;
  mv_name: string | null;
  mv_code: string | null;
  mv_desc: string | null;
  mv_display_order: number;
  mv_status: number;
  mv_value: string;
  mv_value1: string | null;
  mv_value2: string | null;
  mv_value3: string | null;
  mv_value_decimal: number;
  mv_updated_on: number;
  mv_dstatus: number;
  [key: string]: unknown;
}

export interface RechargeRow {
  ur_id: number;
  ur_year: string;
  ur_recharge_type: number;
  ur_user_id: number;
  ur_plan_id: number;
  ur_valid_till: number;
  ur_amount: number;
  ur_gst_amount: number;
  ur_received_amount: number;
  ur_generate_invoice: number;
  ur_invoice_no: string | null;
  ur_payment_log_id: number;
  ur_payment_source: number | null;
  ur_payment_ref_no: string | null;
  ur_remark: string | null;
  ur_status: number;
  ur_created_on: number;
  ur_created_by: number;
  ur_created_from: number;
  ur_dstatus: number;
}

export interface PaymentLogRow {
  p_id: number;
  p_gateway: number;
  p_payment_type: number;
  p_no: string;
  p_user_id: number;
  p_plan_id: number;
  p_order_no: number;
  p_amount: number;
  p_status: number; // 1 pending, 2 paid, 3 refund, 4 failed
  p_reference_no: string;
  p_payment_mode: string;
  p_payment_option: string;
  p_payment_id: string;
  p_payment_method: number;
  p_created_on: string;
  p_created_by: number;
  p_created_from: number;
  p_ip_address: string;
}
