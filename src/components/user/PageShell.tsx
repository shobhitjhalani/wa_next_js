import { config } from "@/lib/config";

type Crumb = { href: string; label: string };

// The "main-content > page-content > container-fluid" wrapper, page title box with
// breadcrumb, and the footer from includes/footer.php.
export default function PageShell({
  title,
  crumbs = [],
  hideTitle = false,
  children,
}: {
  title: string;
  crumbs?: Crumb[];
  hideTitle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="vertical-overlay"></div>
      <div className="main-content">
        <div className="page-content">
          <div className="container-fluid">
            {!hideTitle && (
              <div className="row">
                <div className="col-12">
                  <div className="page-title-box d-sm-flex align-items-center justify-content-between">
                    <h4 className="mb-sm-0">{title}</h4>
                    <div className="page-title-right">
                      <ol className="breadcrumb m-0">
                        <li className="breadcrumb-item">
                          <a href="/dashboard">Dashboard</a>
                        </li>
                        {crumbs.map((c) => (
                          <li key={c.href} className="breadcrumb-item">
                            <a href={c.href}>{c.label}</a>
                          </li>
                        ))}
                        <li className="breadcrumb-item active">{title}</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {children}
          </div>
        </div>
        <footer className="footer">
          <div className="container-fluid">
            <div className="row">
              <div className="col-sm-6">
                {new Date().getFullYear()} © {config.siteName}.
              </div>
              <div className="col-sm-6">
                <div className="text-sm-end d-none d-sm-block"></div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

/** One card with an optional alert, used by most pages. */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="row">
      <div className="col-xl-12">
        <div className={`card ${className}`}>{children}</div>
      </div>
    </div>
  );
}

export function Alert({ msg, kind = "danger" }: { msg?: string | null; kind?: "danger" | "success" | "info" }) {
  if (!msg) return null;
  return <div className={`col-md-12 alert alert-${kind}`}>{msg}</div>;
}
