// Small crypto helpers. Everything uses Node's built-in crypto; nothing here is hand-made
// cryptography, only the standard building blocks put together.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/** A 6-digit sign-in code, uniformly random. */
export function newEmailCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/** Codes are stored only as a keyed hash, so a database dump does not reveal them. */
export function hashEmailCode(pepper: string, email: string, code: string): string {
  return createHmac('sha256', pepper).update(`${email}:${code}`).digest('hex')
}

/** Refresh tokens: 32 random bytes for the browser, a SHA-256 hash for the database. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Compares two strings without leaking, through timing, how much of them matched. */
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
