import type { NextRequest } from 'next/server';
import { fileExt } from '@/lib/actions';
import { getUser } from '@/lib/auth';
import { storePublic } from '@/lib/services/media';
import { sameOrigin } from '../../chat/inbox';

/** WhatsApp accepts these as media messages / headers; images ≤ 5 MB, others ≤ 16 MB. */
const TYPES: Record<string, number> = {
  jpg: 5120, jpeg: 5120, png: 5120,
  mp4: 16384, '3gp': 16384,
  pdf: 16384, doc: 16384, docx: 16384, xls: 16384, xlsx: 16384, ppt: 16384, pptx: 16384, txt: 16384, csv: 16384,
  mp3: 16384, ogg: 16384, aac: 16384, amr: 16384, m4a: 16384,
};

/** POST /bot_flows/upload — a file for a flow's media / buttons header; answers its public URL. */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  if (Number(user.u_bot_flow) !== 1) return Response.json({ message: 'Chatbot Flows are not enabled for this account.' }, { status: 403 });
  if (!sameOrigin(req)) return Response.json({ message: 'CSRF token mismatch.' }, { status: 419 });

  let file: File | null = null;
  try {
    const f = (await req.formData()).get('file');
    file = f instanceof File && f.size > 0 ? f : null;
  } catch {
    file = null;
  }
  if (!file) return Response.json({ message: 'Choose a file.' }, { status: 422 });
  const ext = fileExt(file);
  const maxKb = TYPES[ext];
  if (!maxKb) return Response.json({ message: 'Use an image (JPG, PNG), video (MP4), document (PDF, Word, Excel…) or audio file.' }, { status: 422 });
  if (file.size > maxKb * 1024) return Response.json({ message: `The file must not be larger than ${maxKb / 1024} MB.` }, { status: 422 });

  const url = await storePublic(file, 'bot_flow/' + (user.u_code || user.u_id));
  return Response.json({ url, name: file.name });
}
