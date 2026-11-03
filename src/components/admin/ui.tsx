import { qs, type SearchParams } from "@/lib/admin/params";

/** Page title row with breadcrumb (repeated at the top of every wamaster view). */
export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="row">
      <div className="col-12">
        <div className="page-title-box d-sm-flex align-items-center justify-content-between">
          <h4 className="mb-sm-0">{title}</h4>
          <div className="page-title-right d-flex align-items-center gap-2">
            <ol className="breadcrumb m-0">
              <li className="breadcrumb-item">
                <a href="/wamaster/dashboard">Dashboard</a>
              </li>
              <li className="breadcrumb-item active">{title}</li>
            </ol>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Card({ title, actions, children, bodyClass = "" }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; bodyClass?: string }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-header align-items-center d-flex">
          <h4 className="card-title mb-0 flex-grow-1">{title}</h4>
          {actions}
        </div>
      )}
      <div className={`card-body ${bodyClass}`}>{children}</div>
    </div>
  );
}

export function StatCard({ label, value, href, icon = "bx bx-message-square-detail" }: { label: string; value: React.ReactNode; href?: string; icon?: string }) {
  return (
    <div className="col-xl-3 col-md-6">
      <div className="card card-animate">
        <div className="card-body">
          <p className="text-uppercase fw-medium text-muted text-truncate mb-0">{label}</p>
          <div className="d-flex align-items-end justify-content-between mt-4">
            <div>
              <h4 className="fs-22 fw-semibold ff-secondary mb-4">{value}</h4>
              {href && (
                <a href={href} target="_blank" className="link-secondary text-decoration-underline">
                  View
                </a>
              )}
            </div>
            <div className="avatar-sm flex-shrink-0">
              <span className="avatar-title bg-primary-subtle rounded fs-3">
                <i className={`${icon} text-primary`}></i>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Alert({ msg, type = "success" }: { msg?: string; type?: "success" | "danger" | "info" }) {
  if (!msg) return null;
  return <div className={`alert alert-${type}`}>{msg}</div>;
}

/** Port of fun_select_page_no(): First / page window / Last, keeping current filters. */
export function Pagination({ total, pageSize, current, sp, colSpan }: { total: number; pageSize: number; current: number; sp: SearchParams; colSpan: number }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const windowSize = 20;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  const end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const link = (p: number, label: React.ReactNode) => (
    <a key={`${p}-${String(label)}`} href={qs(sp, { curpage: p })} className={`mx-1 ${p === current ? "fw-bold text-decoration-underline" : ""}`}>
      {label}
    </a>
  );
  return (
    <tr style={{ backgroundColor: "#eeeeee" }}>
      <td colSpan={colSpan} className="text-center">
        {current > 1 && link(1, "First")}
        {Array.from({ length: end - start + 1 }, (_, i) => link(start + i, start + i))}
        {current < pages && link(pages, "Last")}
        <span className="ms-3 text-muted">
          {total} records, page {current} of {pages}
        </span>
      </td>
    </tr>
  );
}

export function Empty({ colSpan, text = "No Record Found" }: { colSpan: number; text?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center text-muted">
        {text}
      </td>
    </tr>
  );
}
