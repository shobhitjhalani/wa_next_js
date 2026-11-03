"use client";

import { useState } from "react";

type Option = { id: number; name: string };

/** Plan / invoice / payment fields of view/user/recharge.php (payment fields appear when "Payment Received" is on). */
export default function RechargeFields({ plans, sources, today }: { plans: Option[]; sources: Option[]; today: string }) {
  const [paid, setPaid] = useState(false);
  return (
    <div className="row">
      <div className="col-md-4 mb-3">
        <label>WA Plan:</label>
        <select className="form-control" name="data[order_id]" required>
          <option value="">Select Plan</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="col-md-2 mb-3">
        <label>Generate Invoice:</label>
        <div className="form-check form-switch">
          <input className="form-check-input" type="checkbox" name="data[generate_invoice]" value="1" />
        </div>
      </div>
      <div className="col-md-2 mb-3">
        <label>Payment Received:</label>
        <div className="form-check form-switch">
          <input className="form-check-input" type="checkbox" name="data[payment_status]" value="1" onChange={(e) => setPaid(e.target.checked)} />
        </div>
      </div>
      {paid && (
        <>
          <div className="col-md-3 mb-3">
            <label>Payment Source:</label>
            <select className="form-control" name="data[payment_source]">
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3 mb-3">
            <label>Payment Date:</label>
            <input className="form-control" type="text" name="payment_date" defaultValue={today} />
          </div>
          <div className="col-md-3 mb-3">
            <label>Payment Ref No.:</label>
            <input className="form-control" type="text" name="data[payment_ref_no]" />
          </div>
          <div className="col-md-3 mb-3">
            <label>Payment Amount Received:</label>
            <input className="form-control" type="text" name="data[payment_amount]" />
          </div>
        </>
      )}
    </div>
  );
}
