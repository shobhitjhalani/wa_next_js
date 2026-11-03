"use client";

/** Submit button that asks for confirmation first (the PHP onClick="return confirm(...)"). */
export default function ConfirmButton({
  message,
  className,
  title,
  name,
  value,
  children,
}: {
  message: string;
  className?: string;
  title?: string;
  name?: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      title={title}
      name={name}
      value={value}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
