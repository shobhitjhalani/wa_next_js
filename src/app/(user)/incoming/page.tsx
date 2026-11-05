import type { Metadata } from 'next';
import { IncomingListing } from './listing';

export const metadata: Metadata = { title: 'Incoming Msg' };

/** Incoming messages (IncomingController::index). */
export default async function IncomingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <IncomingListing params={await searchParams} attachments={false} />;
}
