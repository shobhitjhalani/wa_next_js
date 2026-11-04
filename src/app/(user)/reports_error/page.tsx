import type { Metadata } from 'next';
import { MessagesReport } from '../reports/MessagesReport';

export const metadata: Metadata = { title: 'Reports Error' };

/** Messages the API rejected (User\ReportController::errors). */
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <MessagesReport type="error" title="Reports Error" searchParams={searchParams} />;
}
