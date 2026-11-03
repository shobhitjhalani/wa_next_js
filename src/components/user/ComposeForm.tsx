"use client";

import { useActionState, useEffect, useState } from "react";
import type { TemplateView } from "@/lib/user/templates";

type Option = { id: number; title: string };

/** The WhatsApp-style preview card (templates_content.php ty=1). */
export function TemplatePreview({ v }: { v: TemplateView | null }) {
  if (!v) return null;
  return (
    <div className="preview-wrap w-100">
      <div className="card wh-card mx-auto">
        <div className="media-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {v.headerType === "IMAGE" && <img src={v.header} className="img-fluid" alt="Header" />}
          {v.headerType === "DOCUMENT" && "Upload Document"}
          {v.headerType === "VIDEO" && (
            <video width={320} height={240} controls>
              <source src={v.header} type="video/mp4" />
            </video>
          )}
          {v.headerType === "TEXT" && v.header}
        </div>
        <div className="wh-msg">
          <p className="mb-2" style={{ whiteSpace: "pre-wrap" }}>{v.message}</p>
        </div>
        {v.buttons.map((b, i) => (
          <a key={i} href="#" className="wh-action">
            {b.text}
          </a>
        ))}
      </div>
    </div>
  );
}

/** Parameter + header file inputs (templates_content.php ty=2). */
function TemplateInputs({ v }: { v: TemplateView | null }) {
  if (!v) return null;
  const accept: Record<string, [string, string, string]> = {
    IMAGE: ["Header Image", "image/png, image/jpg, image/jpeg", ".jpg,.png,.jpeg"],
    DOCUMENT: ["Header Document", ".pdf,application/pdf", ".pdf"],
    VIDEO: ["Header Video", ".mp4,video/mp4", ".mp4"],
  };
  const file = accept[v.headerType];
  return (
    <>
      {Array.from({ length: v.paramCount }, (_, i) => (
        <div key={i}>
          <label className="form-label">
            Parameter {`{{${i + 1}}}`} Value<span style={{ color: "red" }}>*</span>
          </label>
          <input name="body_parameters" required type="text" className="form-control mb-3" />
        </div>
      ))}
      {file && (
        <>
          <label className="form-label">
            {file[0]} <span style={{ color: "red" }}>*</span>
          </label>
          <input name="img_value" required accept={file[1]} type="file" className="form-control" />
          <span>Kindly Upload: {file[2]}</span>
        </>
      )}
    </>
  );
}

export default function ComposeForm({
  templates,
  selected,
  mobile,
  ucode,
  action,
}: {
  templates: Option[];
  selected: number;
  mobile: string;
  ucode: string;
  action: (prev: string, form: FormData) => Promise<string>;
}) {
  const [msg, formAction, pending] = useActionState(action, "");
  const [tid, setTid] = useState(selected || (templates.length === 1 ? templates[0].id : 0));
  const [view, setView] = useState<TemplateView | null>(null);

  useEffect(() => {
    if (!tid) return setView(null);
    fetch(`/templates_content?id=${tid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setView)
      .catch(() => setView(null));
  }, [tid]);

  return (
    <>
      {msg && <div className="col-md-12 alert alert-danger">{msg}</div>}
      <div className="live-preview">
        <form action={formAction}>
          <div className="row">
            <div className="col-8 col-offset-3">
              <div className="col-md-10">
                <div className=" mb-3">
                  <label htmlFor="temp_id" className="form-label">Template</label>
                  <select className="form-control" name="temp_id" id="temp_id" required value={tid || ""}
                    onChange={(e) => setTid(Number(e.target.value))}>
                    {templates.length > 1 && <option value="">Select Template</option>}
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-3" id="header_div">
                  <TemplateInputs v={view} />
                </div>
                <div className="mb-3">
                  <label htmlFor="txt_contact" className="form-label">Contact List (Seperate by &quot;,&quot; or new line)</label>
                  <textarea name="txt_contact" id="txt_contact" className="form-control" rows={10} defaultValue={mobile} />
                </div>
              </div>
              <div className="row">
                <div className="col-lg-12">
                  <div className="text-start">
                    <input name="ucode" value={ucode} type="hidden" />
                    <button type="submit" className="btn btn-success" disabled={pending}>
                      {pending ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-4">
              <p><strong>Template Sample View:</strong></p>
              <div id="template_content">
                <TemplatePreview v={view} />
              </div>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
