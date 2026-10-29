// Malaysian mobile numbers: 01X-XXX XXXX (10 or 11 digits locally).
// Stored as +601XXXXXXXX(X), matching the profiles_phone_format check.

/** Returns +601... or null if it is not a valid Malaysian mobile number. */
export function normalizeMyPhone(input: string): string | null {
  let d = input.replace(/\D/g, '')
  if (d.startsWith('60')) d = d.slice(1) // +60 12... -> 012...
  if (!/^01\d{8,9}$/.test(d)) return null
  return `+6${d}`
}

/** +60123456789 -> 012-345 6789, for showing back to people. */
export function displayMyPhone(e164: string): string {
  const d = e164.replace(/^\+6/, '')
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)} ${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)} ${d.slice(6)}`
}
