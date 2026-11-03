"use client";

import { useState } from "react";

// The +/− rows of do_dont.php (fun_add_block / fun_minus_block).
function List({ name, label, initial }: { name: string; label: string; initial: string[] }) {
  const [rows, setRows] = useState(() => (initial.length ? initial : [""]).map((v, i) => ({ k: i, v })));
  const [next, setNext] = useState(rows.length);
  const add = () => {
    setRows([...rows, { k: next, v: "" }]);
    setNext(next + 1);
  };
  return (
    <div className="col-md-6">
      <label className="form-label">{label}</label>
      {rows.map((r) => (
        <div className="btn-group w-100 mb-3" role="group" key={r.k}>
          <input type="text" name={name} className="form-control" defaultValue={r.v} />
          <button type="button" className="btn btn-success" onClick={add}>+</button>
          <button type="button" className="btn btn-danger" onClick={() => setRows(rows.length > 1 ? rows.filter((x) => x.k !== r.k) : rows)}>
            −
          </button>
        </div>
      ))}
    </div>
  );
}

export default function DoDontLists({ dos, donts }: { dos: string[]; donts: string[] }) {
  return (
    <div className="row">
      <List name="dos" label="Do's" initial={dos} />
      <List name="dont" label="Don'ts" initial={donts} />
    </div>
  );
}
