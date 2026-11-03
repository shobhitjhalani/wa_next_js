"use client";

import { useEffect, useRef } from "react";

// <script>document.redirect.submit();</script> of paycca.php
export default function AutoSubmit({ action, fields }: { action: string; fields: Record<string, string> }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.submit();
  }, []);
  return (
    <form ref={ref} method="post" action={action} name="redirect">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </form>
  );
}
