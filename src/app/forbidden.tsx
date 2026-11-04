import Link from 'next/link';

/** 403 page (Laravel abort(403)) — rendered by forbidden() from lib/auth guards. */
export default function Forbidden() {
  return (
    <div className="auth-page-wrapper py-5 d-flex justify-content-center align-items-center min-vh-100">
      <div className="text-center">
        <h1 className="display-1 fw-medium">403</h1>
        <h3 className="text-uppercase">Forbidden</h3>
        <p className="text-muted mb-4">You do not have access to this page.</p>
        <Link href="/" className="btn btn-success"><i className="mdi mdi-home me-1" />Back to home</Link>
      </div>
    </div>
  );
}
