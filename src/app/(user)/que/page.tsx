import type { Metadata } from 'next';
import { MessagesReport } from '../reports/MessagesReport';

export const metadata: Metadata = { title: 'In Que Messages' };

/** Queued messages (User\ReportController::queue, legacy que.php). */
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <MessagesReport type="queue" title="In Que Messages" searchParams={searchParams} />;
}
