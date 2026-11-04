'use client';

import { useRef, useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import type { ActionResult } from '@/lib/actions';

type Key = 'dos' | 'donts';

/** Editable Do's / Don'ts lists (resources/views/user/ai/do_dont.blade.php). */
export function DoDontForm({ action, dos, donts }: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  dos: string[];
  donts: string[];
}) {
  const next = useRef(0);
  const init = (items: string[]) => (items.length ? items : ['']).map((value) => ({ id: next.current++, value }));
  const [lists, setLists] = useState<Record<Key, { id: number; value: string }[]>>(() => ({ dos: init(dos), donts: init(donts) }));

  const add = (key: Key) => setLists((l) => ({ ...l, [key]: [...l[key], { id: next.current++, value: '' }] }));
  const remove = (key: Key, id: number) => setLists((l) => ({ ...l, [key]: l[key].filter((i) => i.id !== id) }));

  return (
    <ActionForm action={action}>
      <div className="row">
        {([['dos', "Do's"], ['donts', "Don'ts"]] as [Key, string][]).map(([key, label]) => (
          <div className="col-lg-6" key={key}>
            <div className="card">
              <div className="card-header d-flex align-items-center">
                <h5 className="card-title mb-0 flex-grow-1">{label}</h5>
                <button type="button" className="btn btn-sm btn-success" aria-label="Add" onClick={() => add(key)}>+ Add</button>
              </div>
              <div className="card-body" id={`list_${key}`}>
                {lists[key].map((item) => (
                  <div className="input-group mb-2" key={item.id}>
                    <input type="text" className="form-control" name={`${key}[]`} defaultValue={item.value} aria-label={label} />
                    <button type="button" className="btn btn-outline-danger" aria-label="Remove" onClick={() => remove(key, item.id)}>−</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <SubmitButton className="btn btn-success">Save</SubmitButton>
    </ActionForm>
  );
}
