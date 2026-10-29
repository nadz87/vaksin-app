// Sends the sign-in code email and the health officer invitation (Malay, then English).
// The code email matches supabase/templates/otp_code.html.
import nodemailer from 'nodemailer'
import type { Config } from './config.ts'

export type Mailer = {
  sendCode(to: string, code: string): Promise<void>
  sendInvite(to: string, link: string): Promise<void>
}

type Email = { subject: string; text: string; html: string }

export function codeEmail(code: string): Email {
  return {
    subject: 'Kod log masuk Vaksin App / Vaksin App sign-in code',
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

/** `link` comes from our own SITE_URL setting, never from the request. */
export function inviteEmail(link: string): Email {
  return {
    subject: 'Jemputan pegawai kesihatan Vaksin App / Vaksin App health officer invitation',
    text: [
      'Vaksin App',
      '',
      'Anda dijemput sebagai pegawai kesihatan dalam Vaksin App.',
      `1. Buka pautan ini: ${link}`,
      '2. Log masuk dengan alamat e-mel ini. Kami akan menghantar kod 6 digit kepada anda.',
      '3. Tetapkan aplikasi pengesah (Google Authenticator atau Microsoft Authenticator), kemudian lengkapkan profil anda dan pilih sekolah anda.',
      '',
      'You have been invited as a health officer in Vaksin App.',
      `1. Open this link: ${link}`,
      '2. Sign in with this email address. We will send you a 6-digit code.',
      '3. Set up an authenticator app (Google Authenticator or Microsoft Authenticator), then complete your profile and choose your schools.',
      '',
      'Jika anda tidak menjangka e-mel ini, abaikan sahaja. / If you did not expect this email, you can ignore it.',
    ].join('\n'),
    html: `<h2>Vaksin App</h2>
<p>Anda dijemput sebagai pegawai kesihatan dalam Vaksin App.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2F6FED;color:#fff;border-radius:8px;text-decoration:none">Buka Vaksin App / Open Vaksin App</a></p>
<ol>
<li>Log masuk dengan alamat e-mel ini. Kami akan menghantar kod 6 digit kepada anda.</li>
<li>Tetapkan aplikasi pengesah (Google Authenticator atau Microsoft Authenticator), kemudian lengkapkan profil anda dan pilih sekolah anda.</li>
</ol>
<p>You have been invited as a health officer in Vaksin App.</p>
<ol>
<li>Sign in with this email address. We will send you a 6-digit code.</li>
<li>Set up an authenticator app (Google Authenticator or Microsoft Authenticator), then complete your profile and choose your schools.</li>
</ol>
<p style="color:#667085">Pautan / Link: ${link}</p>
<p style="color:#667085">Jika anda tidak menjangka e-mel ini, abaikan sahaja. / If you did not expect this email, you can ignore it.</p>`,
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
  const send = (to: string, email: Email) => transport.sendMail({ from: config.mailFrom, to, ...email }).then(() => {})
  return {
    sendCode: (to, code) => send(to, codeEmail(code)),
    sendInvite: (to, link) => send(to, inviteEmail(link)),
  }
}
