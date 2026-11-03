import { redirect } from "next/navigation";

// reports/index.php listed all outgoing messages; reports/wa_send shows the same with more filters.
export default function ReportsIndex() {
  redirect("/wamaster/view/reports/wa_send");
}
