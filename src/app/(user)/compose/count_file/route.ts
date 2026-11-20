import { teamAccount } from '@/lib/auth';
import { ImportError, NUMBER_FILE_EXTENSIONS, readNumbersFile } from '@/lib/services/contacts-import';

const MAX_NUMBERS_FILE = 10 * 1024 * 1024;

/** POST /compose/count_file (multipart "file") → how many valid numbers the compose screen's Excel upload holds, its headings and a sample row. */
export async function POST(req: Request) {
  const user = (await teamAccount((p) => p.campaignCreate))?.user;
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  const file = (await req.formData().catch(() => null))?.get('file');
  if (!(file instanceof File) || !file.size) return Response.json({ message: 'Choose a file.' }, { status: 422 });
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!NUMBER_FILE_EXTENSIONS.includes(ext)) return Response.json({ message: 'Upload an .xlsx, .csv or .txt file.' }, { status: 422 });
  if (file.size > MAX_NUMBERS_FILE) return Response.json({ message: 'The file must not be larger than 10 MB.' }, { status: 422 });
  try {
    const r = await readNumbersFile({ bytes: Buffer.from(await file.arrayBuffer()), extension: ext });
    return Response.json({
      rows: r.rows, valid: r.numbers.length, invalid: r.invalid, duplicates: r.duplicates,
      // For mapping template variables to columns
      headings: r.headings, mobileColumn: r.mobileColumn, sample: r.sample.map((v) => v.slice(0, 200)), emptyByColumn: r.emptyByColumn,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof ImportError) return Response.json({ message: e.message }, { status: 422 });
    throw e;
  }
}
