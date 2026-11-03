"use client";

import { useState } from "react";

// "Add More Attachment" block of templates_add.php (js.php #btn1 / removemy()).
export default function AttachmentInputs({ existing }: { existing: string[] }) {
  const [rows, setRows] = useState(() => (existing.length ? existing : [""]).map((old, i) => ({ key: i, old })));
  const [next, setNext] = useState(rows.length);
  return (
    <div className="row">
      {rows.map((r, idx) => (
        <div className="col-4" key={r.key}>
          <div className="mb-3">
            <label>Attachment(s):</label>
            <div className="input-group">
              <input name="img_value" type="file" className="form-control" />
              {idx > 0 && (
                <button className="btn p7 btn2 remove_attachment btn-danger" type="button" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                  <i className="ri-delete-bin-5-line"></i>
                </button>
              )}
            </div>
            <span>Kindly Upload: .jpg,.png,.pdf,.jpeg,.mov</span>
            {r.old && (
              <div className="small text-muted">Current: {r.old}</div>
            )}
            <input name="txt_old_img" value={r.old} type="hidden" />
          </div>
        </div>
      ))}
      <div className="col-12 mb-3">
        <button
          className="btn btn-info add_more_attachments p7"
          type="button"
          onClick={() => {
            if (rows.length > 5) return alert("Maximum 5 Attachement(s) can be added");
            setRows([...rows, { key: next, old: "" }]);
            setNext(next + 1);
          }}
        >
          <i className="ri-add-line"></i> Add More Attachment
        </button>
      </div>
    </div>
  );
}
