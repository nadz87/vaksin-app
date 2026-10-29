// All appointment times are shown in Malaysia time, whatever the phone's setting.
export const TZ = 'Asia/Kuala_Lumpur'

/** '2026-11-02' (Malaysia date) for a timestamp. */
export function dayKey(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  )
}

export function todayKey(): string {
  return dayKey(new Date())
}

function locale(lang: string) {
  return lang === 'en' ? 'en-MY' : 'ms-MY'
}

/** '10:45 PG' / '10:45 AM' */
export function formatTime(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/** 'Isnin, 2 November 2026' */
export function formatDate(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
}

/** Day tiles for a month (YYYY-MM), from today onwards. Noon UTC avoids date shifts. */
export function monthDays(month: string, fromKey: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const days: string[] = []
  for (let d = 1; d <= last; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`
    if (key >= fromKey) days.push(key)
  }
  return days
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function formatMonth(month: string, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-15T12:00:00Z`),
  )
}

/** Tile labels for a YYYY-MM-DD key: short weekday + day number. */
export function tileLabel(key: string, lang: string): { weekday: string; day: string } {
  const d = new Date(`${key}T12:00:00Z`)
  return {
    weekday: new Intl.DateTimeFormat(locale(lang), { weekday: 'short', timeZone: 'UTC' }).format(d),
    day: String(d.getUTCDate()).padStart(2, '0'),
  }
}

/** A .ics file so the phone's own calendar also reminds the parent. */
export function icsFile(o: { title: string; start: string; end: string; location: string; uid: string }): Blob {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vaksin App//MS',
    'BEGIN:VEVENT',
    `UID:${o.uid}@vaksin-app`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(o.start)}`,
    `DTEND:${stamp(o.end)}`,
    `SUMMARY:${o.title}`,
    `LOCATION:${o.location}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${o.title}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  return new Blob([body], { type: 'text/calendar' })
}

/** Add days to a YYYY-MM-DD key. */
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Monday of the week containing the key. */
export function weekStart(key: string): string {
  const d = new Date(`${key}T12:00:00Z`)
  return addDays(key, -((d.getUTCDay() + 6) % 7))
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a key. */
export function isoWeekday(key: string): number {
  const d = new Date(`${key}T12:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/** 'Isnin' / 'Monday' for an ISO weekday number. */
export function weekdayName(isodow: number, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, isodow)))
}

/** '5 Nov' style label for a key. */
export function shortDate(key: string, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`))
}
