// Small crypto helpers. Everything uses Node's built-in crypto; nothing here is hand-made
// cryptography, only the standard building blocks put together.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

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

// Authenticator-app secrets: AES-256-GCM, stored as iv (12) | tag (16) | ciphertext.
export function encryptSecret(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

export function decryptSecret(key: Buffer, stored: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, stored.subarray(0, 12))
  decipher.setAuthTag(stored.subarray(12, 28))
  return Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()]).toString('utf8')
}
