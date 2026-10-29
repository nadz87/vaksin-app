// Sends the sign-in code email. The text matches supabase/templates/otp_code.html.
import nodemailer from 'nodemailer'
import type { Config } from './config.ts'

export type Mailer = { sendCode(to: string, code: string): Promise<void> }

const SUBJECT = 'Kod log masuk Vaksin App / Vaksin App sign-in code'

export function codeEmail(code: string): { subject: string; text: string; html: string } {
  return {
    subject: SUBJECT,
    text: [
      'Vaksin App',
      '',
      `Kod log masuk anda / Your sign-in code: ${code}`,
      '',
      'Kod ini sah selama 10 minit. Jika anda tidak meminta kod ini, abaikan e-mel ini.',
      'This code is valid for 10 minutes. If you did not ask for it, ignore this email.',
    ].join('\n'),
    html: `<h2>Vaksin App</h2>
<p>Kod log masuk anda / Your sign-in code:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
<p>Kod ini sah selama 10 minit. Jika anda tidak meminta kod ini, abaikan e-mel ini.</p>
<p>This code is valid for 10 minutes. If you did not ask for it, ignore this email.</p>`,
  }
}

export function smtpMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: config.smtp.requireTls && config.smtp.port !== 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  })
  return {
    async sendCode(to, code) {
      await transport.sendMail({ from: config.mailFrom, to, ...codeEmail(code) })
    },
  }
}
