'use server';

import { unlink, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { fFile, flash, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { requireRight } from '@/lib/admin-access';
import { config, url } from '@/lib/config';
import { exec, one } from '@/lib/db';
import { mediaDir } from '@/lib/services/media';
import { now } from '@/lib/time';
import { LIBRARY_MAX_MB, LIBRARY_TYPES, slug } from './library';

const exists = (p: string) => access(p).then(() => true, () => false);

/** Upload one file into the media library: Folder + Name → MEDIA_PATH/library/<folder>/<name>.<ext>, public URL. */
export async function uploadMedia(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { admin } = await requireRight('media_library', 'add');
  const folderRaw = fStr(fd, 'folder');
  const name = fStr(fd, 'name').replace(/\s+/g, ' ').slice(0, 120);
  const file = fFile(fd, 'file');
  const errors: Record<string, string> = {};
  const folder = slug(folderRaw);
  if (!folder) errors.folder = 'Enter a folder name (letters and digits).';
  if (!name || !slug(name, 80)) errors.name = 'Enter a name for the file (letters and digits).';
  const ext = file ? path.extname(file.name).slice(1).toLowerCase() : '';
  if (!file) errors.file = 'Choose a file or image to upload.';
  else if (!LIBRARY_TYPES[ext]) errors.file = `This file type is not allowed. Allowed: ${Object.keys(LIBRARY_TYPES).join(', ')}.`;
  else if (file.size > LIBRARY_MAX_MB * 1048576) errors.file = `The file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${LIBRARY_MAX_MB} MB.`;
  if (Object.keys(errors).length) return invalid(errors);

  const dir = mediaDir(path.join('library', folder));
  await mkdir(dir, { recursive: true });
  // Same name in the folder → nexon-ev-2.pdf, nexon-ev-3.pdf … (an existing URL never changes)
  const base = slug(name, 80);
  let fileName = `${base}.${ext}`;
  for (let i = 2; await exists(path.join(dir, fileName)); i++) fileName = `${base}-${i}.${ext}`;
  await writeFile(path.join(dir, fileName), Buffer.from(await file!.arrayBuffer()));

  const rel = `library/${folder}/${fileName}`;
  await exec(
    `INSERT INTO js_media_file (mf_folder, mf_name, mf_path, mf_mime, mf_size, mf_emp_id, mf_created_on) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [folder, name, rel, LIBRARY_TYPES[ext].mime, file!.size, admin.emp_id, now()]);
  revalidatePath('/wamaster/media');
  return ok(`Uploaded. Public URL: ${url(`${config.mediaUrl}/${rel}`)}`, { url: url(`${config.mediaUrl}/${rel}`) });
}

/** Delete a library file (its URL stops working). */
export async function deleteMedia(id: number): Promise<void> {
  await requireRight('media_library', 'delete');
  const row = await one<{ mf_path: string; mf_name: string }>('DELETE FROM js_media_file WHERE mf_id = $1 RETURNING mf_path, mf_name', [id]);
  if (!row) {
    await flash('error', 'This file no longer exists.');
  } else {
    const file = path.resolve(config.mediaPath, row.mf_path);
    if (file.startsWith(path.resolve(config.mediaPath, 'library') + path.sep)) await unlink(file).catch(() => undefined);
    await flash('success', `“${row.mf_name}” deleted. Its URL no longer works.`);
  }
  revalidatePath('/wamaster/media');
}
