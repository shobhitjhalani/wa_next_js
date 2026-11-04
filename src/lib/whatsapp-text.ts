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
