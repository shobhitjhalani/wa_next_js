/** Read-only employee card used by teams/view and profile. */
export default function EmployeeDetails({ e }: { e: { emp_name: string | null; emp_email_id: string | null; emp_mobile: string | null; emp_username: string | null; emp_status: number; emp_code: string | null } }) {
  const items: [string, React.ReactNode][] = [
    ["Code:", e.emp_code],
    ["Name:", e.emp_name],
    ["Primary Email ID:", e.emp_email_id],
    ["Mobile No:", e.emp_mobile],
    ["Username:", e.emp_username],
    ["Status:", e.emp_status === 1 ? "Active" : "Inactive"],
  ];
  return (
    <div className="row">
      {items.map(([label, value]) => (
        <div key={label} className="col-md-4 mb-3">
          <label>{label}</label>
          <br />
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}
