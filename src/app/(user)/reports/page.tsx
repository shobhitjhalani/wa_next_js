import type { Metadata } from 'next';
import { MessagesReport } from './MessagesReport';

export const metadata: Metadata = { title: 'WA Reports' };

/** All outgoing messages (User\ReportController::all, legacy reports.php). */
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <MessagesReport type="all" title="WA Reports" searchParams={searchParams} />;
}
