"use client";

/** Header checkbox that toggles every row checkbox with class "mids" (PHP selectAll()). */
export default function SelectAll() {
  return (
    <input
      type="checkbox"
      className="me-1"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>("input.mids").forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}
