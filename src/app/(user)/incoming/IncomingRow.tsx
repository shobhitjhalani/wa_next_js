'use client';

import { useState, type ReactNode } from 'react';

/**
 * One incoming-message row. Viewing an attachment marks it read on the server
 * (/view_attachment/{id}); the row shows that at once instead of after a reload.
 */
export function IncomingRow({ id, read, attachment, children }: { id: number; read: boolean; attachment: boolean; children: ReactNode }) {
  const [isRead, setRead] = useState(read);
  return (
    <tr className={isRead ? '' : 'fw-semibold'}>
      <td><input type="checkbox" className="form-check-input mids" name="mids" value={id} aria-label="Select" /></td>
      {children}
      <td>
        {isRead
          ? <span className="badge bg-success-subtle text-success">Read</span>
          : <span className="badge bg-warning-subtle text-warning">Un-Read</span>}
      </td>
      {attachment && (
        <td>
          <a href={`/view_attachment/${id}`} target="_blank" rel="noopener" className="btn btn-sm btn-soft-primary" onClick={() => setRead(true)}>
            <i className="ri-eye-line" /> View
          </a>
        </td>
      )}
    </tr>
  );
}
