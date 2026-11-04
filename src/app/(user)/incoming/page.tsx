import { IncomingListing } from './listing';

/** Incoming messages (IncomingController::index). */
export default async function IncomingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <IncomingListing params={await searchParams} attachments={false} />;
}
