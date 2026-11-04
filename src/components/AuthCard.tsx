import { config } from '@/lib/config';

/** Sign-in page frame (layouts/auth.blade.php). */
export function AuthCard({ tagline, children }: { tagline: string; children: React.ReactNode }) {
  return (
    <div className="auth-page-wrapper auth-bg-cover py-5 d-flex justify-content-center align-items-center min-vh-100">
      <div className="bg-overlay" />
      <div className="auth-page-content overflow-hidden pt-lg-5">
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-lg-10">
              <div className="card overflow-hidden border-0">
                <div className="row g-0">
                  <div className="col-lg-6">
                    <div className="p-lg-5 p-4 auth-one-bg h-100">
                      <div className="bg-overlay" />
                      <div className="position-relative h-100 d-flex flex-column">
                        <div className="mb-4">
                          <img src="/assets/images/logo-light.png" alt={config.appName} style={{ maxHeight: 100, maxWidth: 100 }} />
                        </div>
                        <div className="mt-auto text-white">
                          <i className="ri-double-quotes-l display-4 text-success" />
                          <p className="fs-15 fst-italic">{tagline}</p>
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
        <div className="container text-center">
          <p className="mb-0">&copy; {new Date().getFullYear()} {config.appName}</p>
        </div>
      </footer>
    </div>
  );
}
