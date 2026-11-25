import type { NextRequest } from 'next/server';
import { getAccount } from '@/lib/auth';
import { uploadProblem } from '@/lib/bot-flow';
import { storePublic } from '@/lib/services/media';
import { sameOrigin } from '../../chat/inbox';

/** POST /quick_replies/upload — the file of a quick reply (media, or the media on top of buttons); answers its public URL. */
export async function POST(req: NextRequest) {
  const account = await getAccount();
  if (!account || account.member) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  if (!sameOrigin(req)) return Response.json({ message: 'CSRF token mismatch.' }, { status: 419 });

  let file: File | null = null;
  try {
    const f = (await req.formData()).get('file');
    file = f instanceof File && f.size > 0 ? f : null;
  } catch {
    return Response.json({ message: 'The upload was incomplete. Try again.' }, { status: 400 });
  }
  if (!file) return Response.json({ message: 'Choose a file.' }, { status: 422 });
  const problem = uploadProblem(file.name, file.size);
  if (problem) return Response.json({ message: problem }, { status: 422 });

  const url = await storePublic(file, 'quick_reply/' + (account.user.u_code || account.user.u_id));
  return Response.json({ url, name: file.name });
}
