/** Shown instantly while a admin-panel page loads (the sidebar stays in place). */
export default function Loading() {
  return (
    <div className="d-flex justify-content-center align-items-center py-5 text-muted">
      <div className="spinner-border spinner-border-sm me-2" role="status" />
      Loading…
    </div>
  );
}
