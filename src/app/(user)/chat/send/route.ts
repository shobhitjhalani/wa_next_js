import type { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { fileExt } from '@/lib/actions';
import { contactWindowLeft } from '@/lib/format';
import { chatReply } from '@/lib/services/messages';
import { sendPending } from '@/lib/services/sender';
import { bubble, cleanMobile, contact, convRow, messageById, sameOrigin } from '../inbox';
import type { SendResponse } from '../types';

const MIMES = ['jpg', 'jpeg', 'png', 'webp', 'mp4', '3gp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'mp3', 'ogg', 'aac', 'amr', 'm4a'];
const MAX_KB = 16384;

function invalid(errors: Record<string, string>) {
  const list = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]]));
  return Response.json({ message: Object.values(errors)[0], errors: list }, { status: 422 });
}

/**
 * POST /chat/send — reply inside the 24-hour window, optionally with one
 * attachment. Like the Laravel action it sends straight away and answers
 * with the stored bubble, so a Meta error shows under the message.
 */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  if (!sameOrigin(req)) return Response.json({ message: 'CSRF token mismatch.' }, { status: 419 });

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return invalid({ mb: 'The mb field is required.' });
  }
  const mbRaw = typeof fd.get('mb') === 'string' ? String(fd.get('mb')).trim() : '';
  const msg = typeof fd.get('msg') === 'string' ? String(fd.get('msg')).trim() : '';
  const f = fd.get('file');
  const file = f instanceof File && f.size > 0 ? f : null;

  const errors: Record<string, string> = {};
  if (mbRaw === '') errors.mb = 'The mb field is required.';
  else if (mbRaw.length > 20) errors.mb = 'The mb field must not be greater than 20 characters.';
  if (msg === '' && !file) errors.msg = 'Type a message or attach a file.';
  else if (msg.length > 4096) errors.msg = 'The msg field must not be greater than 4096 characters.';
  if (file) {
    if (file.size > MAX_KB * 1024) errors.file = `The file field must not be greater than ${MAX_KB} kilobytes.`;
    else if (!MIMES.includes(fileExt(file))) errors.file = `The file field must be a file of type: ${MIMES.join(', ')}.`;
  }
  if (Object.keys(errors).length) return invalid(errors);

  const mobile = cleanMobile(mbRaw);
  if (contactWindowLeft(await contact(user.u_id, mobile)) <= 0) {
    return Response.json({ message: 'The 24-hour reply window is closed. Send a template to restart the conversation.' }, { status: 422 });
  }

  const created = await chatReply(user, mobile, msg, file);
  await sendPending(created.m_id);
  const [m, c] = await Promise.all([messageById(user.u_id, created.m_id), contact(user.u_id, mobile)]);
  const b = bubble(m ?? created);

  return Response.json({
    message: b,
    id: b.id,
    error: b.failed ? b.status : null,
    row: convRow(c),
  } satisfies SendResponse);
}
