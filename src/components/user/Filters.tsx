// Filter inputs shared by the report pages (GET forms; flatpickr is attached by ThemeScripts).

export function DateRangeInput({ value }: { value: string }) {
  return (
    <div className="col-3">
      <label className="visually-hidden">Date</label>
      <div className="input-group">
        <input
          type="text"
          className="form-control flatpickr-input active"
          data-provider="flatpickr"
          data-date-format="d-m-Y"
          data-range-date="true"
          defaultValue={value}
          name="wa_date"
          readOnly
          placeholder="Date Range"
        />
      </div>
    </div>
  );
}

export function TextFilter({ name, value, placeholder, col = 3 }: { name: string; value: string; placeholder: string; col?: number }) {
  return (
    <div className={`col-${col}`}>
      <label className="visually-hidden">{placeholder}</label>
      <div className="input-group">
        <input type="text" className="form-control" name={name} defaultValue={value} placeholder={placeholder} />
      </div>
    </div>
  );
}

export function SelectFilter({
  name,
  value,
  options,
  label,
  col = 3,
}: {
  name: string;
  value: string;
  options: [string, string][];
  label: string;
  col?: number;
}) {
  return (
    <div className={`col-${col}`}>
      <label className="visually-hidden">{label}</label>
      <div className="input-group">
        <select className="form-control" name={name} defaultValue={value}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SearchButton() {
  return (
    <div className="col-1">
      <button type="submit" className="btn btn-secondary">Search</button>
    </div>
  );
}
