import { addDays, dayStart, phpDate } from '@/lib/time';

/** "Overdue · 19 Nov, 10:00 AM" / "Today, 03:30 PM" / "Tomorrow, 10:00 AM" / "Sat 28 Nov, 10:00 AM" + a colour class. */
export function followupLabel(ts: number, at: number): { text: string; tone: string } {
  if (!ts) return { text: '', tone: 'text-muted' };
  const today = dayStart(at);
  const time = phpDate('h:i A', ts);
  if (ts < at) return { text: `Overdue · ${phpDate(ts >= today ? '' : 'd M, ', ts)}${time}`, tone: 'text-danger' };
  if (ts < addDays(today, 1)) return { text: `Today, ${time}`, tone: 'text-warning' };
  if (ts < addDays(today, 2)) return { text: `Tomorrow, ${time}`, tone: 'text-body' };
  return { text: phpDate(ts < addDays(today, 300) ? 'D d M, ' : 'd M Y, ', ts) + time, tone: 'text-body' };
}
