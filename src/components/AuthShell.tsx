import { config } from "@/lib/config";

// Cover-style auth page wrapper shared by the user and admin login pages (index.php markup).
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page-wrapper auth-bg-cover py-5 d-flex justify-content-center align-items-center min-vh-100">
      <div className="bg-overlay"></div>
      <div className="auth-page-content overflow-hidden pt-lg-5">
        <div className="container">
          <div className="row">
            <div className="col-lg-12">
              <div className="card overflow-hidden border-0">
                <div className="row g-0">
                  <div className="col-lg-6">
                    <div className="p-lg-5 p-4 auth-one-bg h-100">
                      <div className="bg-overlay"></div>
                      <div className="position-relative h-100 d-flex flex-column">
                        <div className="mb-4">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${config.assetsUrl}images/logo-light.png`}
                            alt=""
                            style={{ maxHeight: 100, height: "auto", maxWidth: 100, width: "auto" }}
                          />
                        </div>
                        <div className="mt-auto">
                          <div className="mb-3">
                            <i className="ri-double-quotes-l display-4 text-success"></i>
                          </div>
                          <div className="text-center text-white pb-5">
                            <p className="fs-15 fst-italic">&quot; WhatsApp Tool</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col-lg-6">
                    <div className="p-lg-5 p-4">{children}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <footer className="footer">
        <div className="container">
          <div className="row">
            <div className="col-lg-12">
              <div className="text-center">
                <p className="mb-0">
                  &copy; {new Date().getFullYear()} {config.siteName}
                </p>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
