import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

/**
 * Outgoing mail. MAIL_MAILER=log prints the message to the console (worker
 * log) instead of sending, like Laravel's log mailer.
 */

let transport: Transporter | null = null;

function transporter(): Transporter {
  if (!transport) {
    transport = config.mail.mailer === 'log'
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port,
        secure: config.mail.secure,
        auth: config.mail.username ? { user: config.mail.username, pass: config.mail.password } : undefined,
      });
  }
  return transport;
}

export async function sendMail(opts: { to: string | { name: string; address: string }; bcc?: string[]; subject: string; html: string }): Promise<void> {
  const info = await transporter().sendMail({
    from: { name: config.mail.fromName, address: config.mail.fromAddress },
    to: opts.to,
    bcc: opts.bcc?.length ? opts.bcc : undefined,
    subject: opts.subject,
    html: opts.html,
  });
  if (config.mail.mailer === 'log') {
    console.log(`[mail] (log mailer) to=${JSON.stringify(opts.to)} subject=${JSON.stringify(opts.subject)} bytes=${opts.html.length}`);
  } else {
    console.log(`[mail] sent ${info.messageId} to=${JSON.stringify(opts.to)}`);
  }
}
