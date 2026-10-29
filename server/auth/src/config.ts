// Settings come only from environment variables. The service refuses to start when a
// secret is missing or too short, instead of falling back to a default.

export type Config = {
  databaseUrl: string
  jwtSecret: Uint8Array
  otpPepper: string
  totpKey: Buffer
  smtp: { host: string; port: number; user?: string; pass?: string; requireTls: boolean }
  mailFrom: string
  port: number
  accessTtlSeconds: number
  parentSessionSeconds: number
  staffSessionSeconds: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = []
  function need(name: string, minLength = 1): string {
    const value = env[name]?.trim() ?? ''
    if (value.length < minLength) problems.push(`${name} is missing${minLength > 1 ? ` or shorter than ${minLength}` : ''}`)
    return value
  }

  const databaseUrl = need('DATABASE_URL')
  const jwtSecret = need('JWT_SECRET', 32)
  const otpPepper = need('OTP_PEPPER', 32)
  const totpHex = need('TOTP_ENC_KEY', 64)
  const smtpHost = need('SMTP_HOST')
  const mailFrom = need('MAIL_FROM')
  if (totpHex && !/^[0-9a-f]{64}/i.test(totpHex)) problems.push('TOTP_ENC_KEY must be 64 hex characters (32 bytes)')
  if (problems.length) throw new Error(`Sign-in service cannot start:\n- ${problems.join('\n- ')}`)

  return {
    databaseUrl,
    jwtSecret: new TextEncoder().encode(jwtSecret),
    otpPepper,
    totpKey: Buffer.from(totpHex.slice(0, 64), 'hex'),
    smtp: {
      host: smtpHost,
      port: Number(env.SMTP_PORT ?? 587),
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
      // Brevo and other real providers: STARTTLS on 587 is required. Local Mailpit has none.
      requireTls: env.SMTP_REQUIRE_TLS !== '0',
    },
    mailFrom,
    port: Number(env.PORT ?? 8080),
    accessTtlSeconds: 15 * 60,
    parentSessionSeconds: 30 * 24 * 3600,
    staffSessionSeconds: 12 * 3600,
  }
}
