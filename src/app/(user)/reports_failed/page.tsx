import type { Metadata } from 'next';
import { MessagesReport } from '../reports/MessagesReport';

export const metadata: Metadata = { title: 'Reports Failed' };

/** Messages WhatsApp reported as failed (User\ReportController::failed). */
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <MessagesReport type="failed" title="Reports Failed" searchParams={searchParams} />;
}
