import { IncomingListing } from '../incoming/listing';

/** Incoming media messages (IncomingController::attachments). */
export default async function IncomingAttachmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <IncomingListing params={await searchParams} attachments />;
}
