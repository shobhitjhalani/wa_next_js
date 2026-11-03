// SMTP e-mail (Amazon SES). Port of Email::fun_send_email() (PHPMailer).
// Without SMTP credentials, or with MAIL_DRY_RUN=1, mail is rendered but not sent.
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "@/lib/config";

type Address = { email: string; name?: string };

let transporter: Transporter | null = null;

export const mailDryRun = () => process.env.MAIL_DRY_RUN === "1" || !process.env.SMTP_HOST || !process.env.SMTP_USERNAME;

function transport(): Transporter {
  if (transporter) return transporter;
  transporter = mailDryRun()
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: false, // STARTTLS on 587, like PHPMailer SMTPSecure=tls
        requireTLS: true,
        auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD },
      });
  return transporter;
}

const fmt = (a?: Address) => (a?.email ? (a.name ? { address: a.email, name: a.name } : a.email) : undefined);

export async function sendMail(m: { to: Address; subject: string; html: string; cc?: Address; bcc?: Address }) {
  const info = await transport().sendMail({
    from: { address: process.env.SMTP_EMAIL_FROM ?? "noreply@support.jscoretech.com", name: config.siteName },
    to: fmt(m.to),
    cc: fmt(m.cc),
    bcc: fmt(m.bcc),
    subject: m.subject,
    html: m.html,
  });
  return { dryRun: mailDryRun(), messageId: info.messageId, raw: mailDryRun() ? String(info.message) : undefined };
}
