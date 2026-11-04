import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, url } from '../config';
import { phpDate } from '../time';

/**
 * Public media (files Meta must fetch by URL). Stored under MEDIA_PATH and
 * served by app/media/[...path]/route.ts at /media/<folder>/<name>.
 */

export function mediaDir(folder: string): string {
  const dir = path.resolve(config.mediaPath, folder);
  if (!dir.startsWith(path.resolve(config.mediaPath))) throw new Error('Invalid media folder');
  return dir;
}

export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._]/g, '_');
}

/** Save an upload under MEDIA_PATH/<folder> and return its absolute URL. */
export async function storePublic(file: File, folder: string): Promise<string> {
  const dir = mediaDir(folder);
  await mkdir(dir, { recursive: true });
  const name = phpDate('YmdHis') + '-' + safeFileName(file.name);
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return url(`${config.mediaUrl}/${folder}/${name}`);
}

/** Write raw bytes under MEDIA_PATH/<folder>/<name> and return the absolute URL. */
export async function storeBytes(bytes: Buffer, folder: string, name: string): Promise<string> {
  const dir = mediaDir(folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return url(`${config.mediaUrl}/${folder}/${name}`);
}
