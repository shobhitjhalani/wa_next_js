"use client";

// Submit button / link with the PHP pages' onclick="return confirm('Are you sure?')".
export function ConfirmSubmit({
  className,
  title,
  message = "Are you sure?",
  children,
  name,
  value,
  form,
}: {
  form?: string;
  className?: string;
  title?: string;
  message?: string;
  children: React.ReactNode;
  name?: string;
  value?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      title={title}
      name={name}
      value={value}
      form={form}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

export function ConfirmLink({
  href,
  className,
  title,
  message = "Are you sure?",
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  message?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

/** "Select all" checkbox for the mids[] lists (selectAll() in the PHP pages). */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      name="selectall"
      id="selectall"
      value="all"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>('input[name="mids"]').forEach((c) => {
          c.checked = e.target.checked;
        });
      }}
    />
  );
}
