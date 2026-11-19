import type { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { uploadProblem } from '@/lib/bot-flow';
import { storePublic } from '@/lib/services/media';
import { sameOrigin } from '../../chat/inbox';

/** POST /bot_flows/upload — a file for a flow's media / buttons attachment; answers its public URL. Limits: UPLOAD_MAX_MB. */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  if (Number(user.u_bot_flow) !== 1) return Response.json({ message: 'Chatbot Flows are not enabled for this account.' }, { status: 403 });
  if (!sameOrigin(req)) return Response.json({ message: 'CSRF token mismatch.' }, { status: 419 });

  let file: File | null = null;
  try {
    const f = (await req.formData()).get('file');
    file = f instanceof File && f.size > 0 ? f : null;
  } catch (e) {
    console.error('[bot_flows] upload: could not read the form data', e);
    return Response.json({ message: 'The upload was incomplete. Try again.' }, { status: 400 });
  }
  if (!file) return Response.json({ message: 'Choose a file.' }, { status: 422 });
  const problem = uploadProblem(file.name, file.size);
  if (problem) return Response.json({ message: problem }, { status: 422 });

  const url = await storePublic(file, 'bot_flow/' + (user.u_code || user.u_id));
  return Response.json({ url, name: file.name });
}
