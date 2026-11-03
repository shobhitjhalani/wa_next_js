// Lookup arrays from wamaster/applicationtop.php.

/** PHP F_YEAR was hard-coded to "23-24"; recharges are tagged with it (ur_year). */
export const F_YEAR = process.env.FINANCIAL_YEAR ?? "23-24";

/** js_message.m_status labels as shown in the admin reports. */
export const WA_STATUS: Record<number, string> = {
  1: "In Que",
  3: "Send",
  4: "Error",
  5: "System Cancelled",
  6: "Processing",
  7: "Invalid Mobile No",
  8: "Re-Send",
  9: "Opt-Out",
};

export const USER_STATUS: Record<number, string> = { 1: "Active", 2: "Pending", 3: "Blocked" };
export const ACTIVE_INACTIVE: Record<number, string> = { 1: "Active", 2: "Inactive" };

/** js_user.u_type */
export const USER_TYPE = { Corporate: 1, WhatsApp: 2 } as const;

/** js_master_value.mv_type groups used by the admin pages. */
export const MV_TYPE = { UserType: 94, Country: 42, State: 43, Plans: 82, PaymentSource: 95, SheetType: 96 } as const;
