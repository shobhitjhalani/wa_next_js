import { decodeEntities, escapeHtml } from './text';

/**
 * Renders WhatsApp message text as safe HTML: escapes it, then applies
 * WhatsApp's *bold*, _italic_, ~strike~ and ```mono``` markers and links
 * URLs. Pure — usable from server and client components
 * (<span dangerouslySetInnerHTML={{ __html: waToHtml(text) }} />).
 */
export function waToHtml(text: unknown): string {
  let html = escapeHtml(decodeEntities(text));

  html = html.replace(/```([\s\S]+?)```/g, '<code>$1</code>');
  // A marker must open after a boundary and close before one, so URLs and snake_case stay intact
  const markers: [string, string][] = [['\\*', 'strong'], ['_', 'em'], ['~', 'del']];
  for (const [marker, tag] of markers) {
    const re = new RegExp(`(^|[\\s(>])${marker}(\\S(?:[^\\n]*?\\S)??)${marker}(?=$|[\\s).,!?:;<])`, 'gmu');
    html = html.replace(re, `$1<${tag}>$2</${tag}>`);
  }

  return html.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,!?:;)\]]/gu, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

/**
 * Editor helper: wrap text[start, end) in a WhatsApp marker (* bold, _ italic), or remove
 * the marker when that range is already wrapped. Surrounding spaces stay outside the
 * markers (WhatsApp only formats when a marker touches the text); an empty range inserts
 * the pair. Returns the new text and the range to select afterwards.
 */
export function toggleWaMarker(text: string, start: number, end: number, marker: string): { text: string; from: number; to: number } {
  const m = marker.length;
  const selected = text.slice(start, end);
  const s = start + (selected.length - selected.trimStart().length);
  const e = Math.max(s, end - (selected.length - selected.trimEnd().length));
  const inner = text.slice(s, e);

  if (text.slice(s - m, s) === marker && text.slice(e, e + m) === marker && s >= m) {
    return { text: text.slice(0, s - m) + inner + text.slice(e + m), from: s - m, to: e - m };
  }
  if (inner.length > 2 * m && inner.startsWith(marker) && inner.endsWith(marker)) {
    return { text: text.slice(0, s) + inner.slice(m, -m) + text.slice(e), from: s, to: e - 2 * m };
  }
  return { text: text.slice(0, s) + marker + inner + marker + text.slice(e), from: s + m, to: e + m };
}
