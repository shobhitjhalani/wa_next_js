"use client";

import { useActionState, useState } from "react";

type Option = { id: number | string; name: string };
type Action = (prev: string, form: FormData) => Promise<string>;

export type UserFormValues = Record<string, string | number | null | undefined>;

function Switch({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className="col-md-3 mb-3">
      <label>{label}</label>
      <div className="form-check form-switch">
        <input className="form-check-input" type="checkbox" role="switch" name={`data[${name}]`} value="1" defaultChecked={checked} onChange={(e) => onChange?.(e.target.checked)} />
      </div>
    </div>
  );
}

function Text({ name, label, value, required, type = "text", col = "col-md-4" }: { name: string; label: string; value?: string | number | null; required?: boolean; type?: string; col?: string }) {
  return (
    <div className={`${col} mb-3`}>
      <label>{label}</label>
      <input className="form-control" type={type} name={`data[${name}]`} defaultValue={value ?? ""} required={required} />
    </div>
  );
}

function Select({ name, label, value, options, placeholder, required }: { name: string; label: string; value?: string | number | null; options: Option[]; placeholder: string; required?: boolean }) {
  return (
    <div className="col-md-4 mb-3">
      <label>{label}</label>
      <select className="form-control" name={`data[${name}]`} defaultValue={value ?? ""} required={required}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** wamaster/view/user/add.php (+ the custom_fields.php AJAX toggles). */
export default function UserForm({
  action,
  ut,
  id,
  v,
  companies,
  countries,
  states,
  employees,
  backHref,
}: {
  action: Action;
  ut: number;
  id?: number;
  v: UserFormValues;
  companies: Option[];
  countries: Option[];
  states: Option[];
  employees: Option[];
  backHref: string;
}) {
  const [msg, formAction, pending] = useActionState(action, "");
  const on = (k: string) => String(v[k] ?? "") === "1";
  const [sendWa, setSendWa] = useState(on("send_wa"));
  const [ai, setAi] = useState(on("enable_ai"));
  const [app, setApp] = useState(on("send_app"));
  const [catalogue, setCatalogue] = useState(on("wa_enable_catalogue"));
  const [sheet, setSheet] = useState(on("google_sheet"));

  return (
    <form action={formAction}>
      {msg && <div className="alert alert-danger">{msg}</div>}
      <input type="hidden" name="ut" value={ut} />
      {id && <input type="hidden" name="id" value={id} />}
      <div className="row">
        <Text name="name" label="Name:" value={v.name} required />
        {ut === 2 && <Select name="parent_id" label="Company Name:" value={v.parent_id} options={companies} placeholder="Company Name" required />}
        {ut === 1 && (
          <>
            <Text name="company_name" label="Company Name:" value={v.company_name} />
            <Text name="company_gst_no" label="Company GSTIN No.:" value={v.company_gst_no} />
            <Select name="country" label="Country:" value={v.country} options={countries} placeholder="Select Country" />
            <Select name="state" label="State:" value={v.state} options={states} placeholder="Select State" />
            <Text name="email_id" label="Primary Email ID:" value={v.email_id} type="email" required />
            <Text name="billing_email_id" label="Billing Email ID:" value={v.billing_email_id} />
            <Text name="mobile_no" label="Mobile No:" value={v.mobile_no} required />
          </>
        )}
      </div>

      <div className="row">
        <Switch name="status" label="Status:" checked={on("status")} />
        {ut === 2 && (
          <>
            <Switch name="send_wa" label="Send Flow:" checked={sendWa} onChange={setSendWa} />
            <Switch name="enable_ai" label="AI:" checked={ai} onChange={setAi} />
            <Switch name="send_app" label="App URL:" checked={app} onChange={setApp} />
            <Switch name="is_new_no" label="MM Lite:" checked={on("is_new_no")} />
            <Switch name="wa_enable_catalogue" label="Catalogue:" checked={catalogue} onChange={setCatalogue} />
            <Text name="daily_limit" label="Daily Limit:" value={v.daily_limit} col="col-md-3" />
            <Text name="msg_limit" label="Total Limit:" value={v.msg_limit} col="col-md-3" />
          </>
        )}
        {ut === 1 && (
          <>
            <Text name="balance" label="Previous Balance:" value={v.balance} col="col-md-3" />
            <Switch name="google_sheet" label="Google Sheet:" checked={sheet} onChange={setSheet} />
            {sheet && <Text name="google_sheet_email" label="Google Sheet Activation Email ID:" value={v.google_sheet_email} type="email" required />}
            <Switch name="own_account" label="Client Card:" checked={on("own_account")} />
          </>
        )}
      </div>

      {ut === 2 && (
        <div className="row">
          <Text name="wa_no" label="WA Phone No:" value={v.wa_no} />
          <Text name="wa_phone_id" label="WA Phone ID:" value={v.wa_phone_id} />
          <Text name="wa_b_id" label="WABA ID:" value={v.wa_b_id} />
          <Text name="business_id" label="Business ID:" value={v.business_id} />
          <Text name="wa_incoming_url" label="Incoming URL :" value={v.wa_incoming_url} col="col-md-8" />
          {sendWa && <Text name="wa_form_url" label="Flow URL:" value={v.wa_form_url} required />}
          {catalogue && <Text name="wa_catalogue_url" label="Catalogue URL :" value={v.wa_catalogue_url} required />}
          {ai && <Text name="ai_key" label="AI API Key :" value={v.ai_key} required />}
          {app && <Text name="wa_app_url" label="APP Vendor ID:" value={v.wa_app_url} required />}
        </div>
      )}

      <div className="row">
        <Text name="username" label="Username:" value={v.username} />
        <div className="col-md-4 mb-3">
          <label>Password (Leave Blank to Unchnage):</label>
          <input type="text" className="form-control" name="txtpassword" autoComplete="new-password" />
        </div>
        <Select name="assign_to" label="Assign To" value={v.assign_to} options={employees} placeholder="Select" />
      </div>

      <div className="d-flex gap-2">
        <button type="submit" className="btn btn-success" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </button>
        <a href={backHref} className="btn btn-light btn-label ms-auto">
          Back <i className="ri-arrow-left-line label-icon align-middle fs-16 me-2"></i>
        </a>
      </div>
    </form>
  );
}
