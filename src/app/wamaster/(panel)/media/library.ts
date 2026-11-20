/** Media library: what may be uploaded (client-safe). HTML / SVG / scripts are never allowed: they would run on our domain. */

export const LIBRARY_TYPES: Record<string, { mime: string; kind: 'image' | 'video' | 'audio' | 'document' }> = {
  jpg: { mime: 'image/jpeg', kind: 'image' }, jpeg: { mime: 'image/jpeg', kind: 'image' }, png: { mime: 'image/png', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' }, gif: { mime: 'image/gif', kind: 'image' },
  mp4: { mime: 'video/mp4', kind: 'video' }, '3gp': { mime: 'video/3gpp', kind: 'video' },
  mp3: { mime: 'audio/mpeg', kind: 'audio' }, ogg: { mime: 'audio/ogg', kind: 'audio' }, aac: { mime: 'audio/aac', kind: 'audio' }, m4a: { mime: 'audio/mp4', kind: 'audio' },
  pdf: { mime: 'application/pdf', kind: 'document' }, doc: { mime: 'application/msword', kind: 'document' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  xls: { mime: 'application/vnd.ms-excel', kind: 'document' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'document' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'document' },
  txt: { mime: 'text/plain', kind: 'document' }, csv: { mime: 'text/csv', kind: 'document' }, zip: { mime: 'application/zip', kind: 'document' },
};

/** Upload limit (the web server accepts up to 100 MB per request). */
export const LIBRARY_MAX_MB = 95;

export const LIBRARY_ACCEPT = Object.keys(LIBRARY_TYPES).map((e) => '.' + e).join(',');

/** "Tata Brochures 2026" → "tata-brochures-2026" (folder and file names in the URL). */
export function slug(v: string, max = 60): string {
  return v.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max);
}

export function fileIcon(ext: string): string {
  const kind = LIBRARY_TYPES[ext]?.kind;
  if (ext === 'pdf') return 'ri-file-pdf-2-line text-danger';
  if (['doc', 'docx', 'txt'].includes(ext)) return 'ri-file-word-2-line text-primary';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'ri-file-excel-2-line text-success';
  if (['ppt', 'pptx'].includes(ext)) return 'ri-file-ppt-2-line text-warning';
  if (ext === 'zip') return 'ri-file-zip-line text-secondary';
  if (kind === 'video') return 'ri-film-line text-info';
  if (kind === 'audio') return 'ri-music-2-line text-info';
  return 'ri-file-line text-secondary';
}

export function sizeLabel(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
