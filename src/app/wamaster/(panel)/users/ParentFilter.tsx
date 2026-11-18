'use client';

import { useState } from 'react';
import { SearchSelect, type SearchOption } from '@/components/SearchSelect';

/** Users list: searchable "Parent company" filter; submitted with the GET search form as ?parent=. */
export function ParentFilter({ options, value }: { options: SearchOption[]; value: string }) {
  const [parent, setParent] = useState(value);
  return (
    <div style={{ width: 280 }}>
      <SearchSelect
        id="parent_filter" name="parent" value={parent} onChange={setParent}
        options={[{ value: '', label: 'All parent companies' }, ...options]}
        placeholder="All parent companies" searchPlaceholder="Search parent company…" emptyText="No parent company matches"
      />
    </div>
  );
}
