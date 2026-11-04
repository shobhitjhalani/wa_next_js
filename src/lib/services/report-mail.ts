import 'server-only';
import { config } from '../config';
import { escapeHtml, numberFormat } from '../text';
import { phpDate } from '../time';
import type { Matrix } from './reports';

/** HTML for the daily report emails (resources/views/emails/*.blade.php). */

const CELL = 'border:1px solid #d9dee3;padding:5px 8px;font-size:13px;';

function matrixHtml(matrix: Matrix, firstCol: string, rowTotal = true): string {
  if (!matrix.rows.length) return '<p style="color:#878a99;font-size:13px;">No messages for this period.</p>';
  const totals: Record<string, number> = {};
  for (const [, row] of matrix.rows) for (const c of matrix.columns) totals[c] = (totals[c] ?? 0) + (row[c] ?? 0);
  const sum = (r: Record<string, number>) => matrix.columns.reduce((a, c) => a + (r[c] ?? 0), 0);
  const e = escapeHtml;
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:24px;">
<thead><tr style="background:#f3f6f9;"><th style="${CELL}text-align:left;">#</th><th style="${CELL}text-align:left;">${e(firstCol)}</th>${matrix.columns.map((c) => `<th style="${CELL}text-align:right;">${e(c)}</th>`).join('')}${rowTotal ? `<th style="${CELL}text-align:right;">Total</th>` : ''}</tr></thead>
<tbody>${matrix.rows.map(([label, row], i) => `<tr><td style="${CELL}">${i + 1}</td><td style="${CELL}">${e(label)}</td>${matrix.columns.map((c) => `<td style="${CELL}text-align:right;">${numberFormat(row[c] ?? 0)}</td>`).join('')}${rowTotal ? `<th style="${CELL}text-align:right;">${numberFormat(sum(row))}</th>` : ''}</tr>`).join('\n')}</tbody>
<tfoot><tr style="background:#f3f6f9;"><th colspan="2" style="${CELL}text-align:left;">Total</th>${matrix.columns.map((c) => `<th style="${CELL}text-align:right;">${numberFormat(totals[c] ?? 0)}</th>`).join('')}${rowTotal ? `<th style="${CELL}text-align:right;">${numberFormat(sum(totals))}</th>` : ''}</tr></tfoot>
</table>`;
}

function page(body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:20px;background:#f3f3f9;font-family:Arial,Helvetica,sans-serif;color:#212529;">
<div style="max-width:960px;margin:0 auto;background:#ffffff;padding:20px;border-radius:4px;">${body}
<p style="color:#878a99;font-size:12px;margin-bottom:0;">Sent by ${escapeHtml(config.appName)}.</p></div></body></html>`;
}

/** Admin summary (emails/wa_report.blade.php). */
export function adminReportHtml(report: { users: Matrix; templates: Matrix }): string {
  return page(`<h3 style="margin-top:0;">WhatsApp Summary as on ${phpDate('M d, Y')}</h3>
${matrixHtml(report.users, 'User', false)}
<h3>User Template Report</h3>
${matrixHtml(report.templates, 'User — Template')}`);
}

/** Client template report (emails/wa_templates.blade.php). */
export function userReportHtml(report: { today: Matrix; month: Matrix }): string {
  return page(`<h3 style="margin-top:0;">WhatsApp Summary on ${phpDate('M d, Y')}</h3>
${matrixHtml(report.today, 'Template Name')}
<h3>WhatsApp Summary of ${phpDate('M Y')}</h3>
${matrixHtml(report.month, 'Template Name')}`);
}
