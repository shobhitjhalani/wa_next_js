'use client';

import { useEffect, useRef, useState } from 'react';
import { SearchSelect, type SearchOption } from '@/components/SearchSelect';

/**
 * Searchable dropdown for GET filter forms (uncontrolled: starts at `defaultValue`, submits as `name`).
 * `autoSubmit` submits the form after a choice (e.g. the user filter reloads the user's templates).
 */
export function FilterSelect({ name, options, defaultValue = '', placeholder, searchPlaceholder, autoSubmit, id }: {
  name: string;
  options: SearchOption[];
  defaultValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  autoSubmit?: boolean;
  id?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [submit, setSubmit] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Submit after the hidden input has the new value
  useEffect(() => {
    if (!submit) return;
    setSubmit(false);
    root.current?.closest('form')?.requestSubmit();
  }, [submit]);
  return (
    <div ref={root} className="filter-select">
      <SearchSelect
        id={id} name={name} value={value} options={options} placeholder={placeholder} searchPlaceholder={searchPlaceholder}
        onChange={(v) => { setValue(v); if (autoSubmit) setSubmit(true); }}
      />
    </div>
  );
}
