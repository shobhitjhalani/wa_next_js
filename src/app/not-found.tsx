import Link from 'next/link';

/** 404 page (Laravel abort(404) / findOrFail). */
export default function NotFound() {
  return (
    <div className="auth-page-wrapper py-5 d-flex justify-content-center align-items-center min-vh-100">
      <div className="text-center">
        <h1 className="display-1 fw-medium">404</h1>
        <h3 className="text-uppercase">Not Found</h3>
        <p className="text-muted mb-4">The page you are looking for does not exist.</p>
        <Link href="/" className="btn btn-success"><i className="mdi mdi-home me-1" />Back to home</Link>
      </div>
    </div>
  );
}
