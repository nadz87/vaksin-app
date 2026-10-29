// MyKid / IC number: YYMMDD-PB-###G
//   YYMMDD = date of birth, PB = place-of-birth code, G = last digit
//   (odd = male, even = female).
// The database re-checks DOB and gender against the number (register_child),
// so this file is about helping parents type less, not about security.

export type MyKidInfo = { digits: string; dob: string; gender: 'male' | 'female' }

/** Keeps digits only and formats as 150312-10-1235 while typing. */
export function formatMyKid(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 12)
  if (d.length <= 6) return d
  if (d.length <= 8) return `${d.slice(0, 6)}-${d.slice(6)}`
  return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`
}

/**
 * The MyKid only stores a 2-digit year. Decide the full year.
 * Example: yy = 15 -> 2015.
 */
export function fullYear(yy: number, today: Date): number {
  // Cut-off at this year: 26 (when it is 2026) or lower means 2000s, anything higher
  // can only be the 1900s, because a child cannot be born in the future.
  // (Schools only register children, so a 1900s result is an obvious entry error.)
  return yy <= today.getUTCFullYear() % 100 ? 2000 + yy : 1900 + yy
}

/** Returns DOB (YYYY-MM-DD) and gender, or null if the number is incomplete or impossible. */
export function parseMyKid(input: string, today: Date = new Date()): MyKidInfo | null {
  const digits = input.replace(/\D/g, '')
  if (digits.length !== 12) return null

  const yy = Number(digits.slice(0, 2))
  const mm = Number(digits.slice(2, 4))
  const dd = Number(digits.slice(4, 6))

  let year: number
  try {
    year = fullYear(yy, today)
  } catch {
    return null
  }

  // Reject impossible dates like 31 February.
  const date = new Date(Date.UTC(year, mm - 1, dd))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    return null
  }

  const gender = Number(digits[11]) % 2 === 1 ? 'male' : 'female'
  const dob = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  return { digits, dob, gender }
}
