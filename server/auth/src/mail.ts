// Sends the sign-in code email, the health officer invitation and the "appointment cancelled"
// notice to parents (Malay, then English).
// The code email matches supabase/templates/otp_code.html.
import nodemailer from 'nodemailer'
import type { Config } from './config.ts'

export type Mailer = {
  sendCode(to: string, code: string): Promise<void>
  sendInvite(to: string, link: string): Promise<void>
  sendCancelled(to: string, notice: CancelNotice, link: string): Promise<void>
}

/** Queued by public.cancel_appointments_internal (notify.email_outbox payload). */
export type CancelNotice = {
  child: string
  type_ms: string
  type_en: string
  starts_at: string
  location: string
  reason: string | null
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
      '3. Lengkapkan profil anda (nama dan jawatan), kemudian anda boleh terus membuka slot temujanji.',
      '',
      'You have been invited as a health officer in Vaksin App.',
      `1. Open this link: ${link}`,
      '2. Sign in with this email address. We will send you a 6-digit code.',
      '3. Complete your profile (name and job title), then you can open appointment slots straight away.',
      '',
      'Jika anda tidak menjangka e-mel ini, abaikan sahaja. / If you did not expect this email, you can ignore it.',
    ].join('\n'),
    html: `<h2>Vaksin App</h2>
<p>Anda dijemput sebagai pegawai kesihatan dalam Vaksin App.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2F6FED;color:#fff;border-radius:8px;text-decoration:none">Buka Vaksin App / Open Vaksin App</a></p>
<ol>
<li>Log masuk dengan alamat e-mel ini. Kami akan menghantar kod 6 digit kepada anda.</li>
<li>Lengkapkan profil anda (nama dan jawatan), kemudian anda boleh terus membuka slot temujanji.</li>
</ol>
<p>You have been invited as a health officer in Vaksin App.</p>
<ol>
<li>Sign in with this email address. We will send you a 6-digit code.</li>
<li>Complete your profile (name and job title), then you can open appointment slots straight away.</li>
</ol>
<p style="color:#667085">Pautan / Link: ${link}</p>
<p style="color:#667085">Jika anda tidak menjangka e-mel ini, abaikan sahaja. / If you did not expect this email, you can ignore it.</p>`,
  }
}

// Names come from parents and officers: escape them before they go into HTML.
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function when(iso: string, locale: 'ms-MY' | 'en-GB') {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)
  const hm = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`
  const pm = parts.find((p) => p.type === 'dayPeriod')!.value.toLowerCase().startsWith('p')
  // Same as the website: 9:30 PG / 2:00 PTG in Malay, 9:30 AM / 2:00 PM in English.
  return `${day}, ${hm} ${locale === 'ms-MY' ? (pm ? 'PTG' : 'PG') : pm ? 'PM' : 'AM'}`
}

/** `link` is the booking page from our own SITE_URL setting. */
export function cancelEmail(n: CancelNotice, link: string): Email {
  const ms = `Temujanji ${n.type_ms} untuk ${n.child} pada ${when(n.starts_at, 'ms-MY')} di ${n.location} telah dibatalkan oleh pegawai kesihatan.`
  const en = `The ${n.type_en} appointment for ${n.child} on ${when(n.starts_at, 'en-GB')} at ${n.location} was cancelled by the health officer.`
  return {
    subject: `Temujanji dibatalkan / Appointment cancelled: ${n.child}`,
    text: [
      'Vaksin App',
      '',
      ms,
      ...(n.reason ? [`Sebab: ${n.reason}`] : []),
      `Sila pilih temujanji baharu: ${link}`,
      '',
      en,
      `Please choose a new appointment: ${link}`,
    ].join('\n'),
    html: `<h2>Vaksin App</h2>
<p>${esc(ms)}</p>
${n.reason ? `<p>Sebab: ${esc(n.reason)}</p>` : ''}
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2F6FED;color:#fff;border-radius:8px;text-decoration:none">Pilih temujanji baharu / Choose a new appointment</a></p>
<p>${esc(en)}</p>
<p style="color:#667085">Pautan / Link: ${link}</p>`,
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
    sendCancelled: (to, notice, link) => send(to, cancelEmail(notice, link)),
  }
}
