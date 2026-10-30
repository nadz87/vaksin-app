// Builds the officer's Excel file in the browser (the library loads only when
// an officer presses Download). The data itself comes from export_* database
// functions, which check the officer's access and write the audit log.
import { displayMyPhone } from './phone'
import { dayKey, TZ } from './time'

export type StudentRow = {
  student_no: string
  full_name: string
  mykid: string | null
  date_of_birth: string
  gender: string
  class_name: string
  school_name: string
  blood_group: string | null
  height_cm: number | null
  weight_kg: number | null
  allergies: string | null
  conditions: string | null
  medications: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  parent1_name: string | null
  parent1_relationship: string | null
  parent1_phone: string | null
  parent1_email: string | null
  parent1_address: string | null
  parent2_name: string | null
  parent2_relationship: string | null
  parent2_phone: string | null
  registered_at: string
}

export type AppointmentRow = {
  starts_at: string
  location_name: string
  school_name: string
  student_no: string
  student_name: string
  class_name: string
  type_ms: string
  type_en: string
  status: string
  note: string | null
  cancel_reason: string | null
  cancelled_by_officer: boolean
  parent_name: string | null
  parent_phone: string | null
  booked_at: string
}

type Lang = 'ms' | 'en'
type Col = { key: string; ms: string; en: string; width: number; fmt?: string }

const KL_OFFSET_MS = 8 * 60 * 60 * 1000

/** Excel has no time zones: shift so the cell shows Malaysia clock time. */
const klWallClock = (iso: string) => new Date(Date.parse(iso) + KL_OFFSET_MS)
const dateOnly = (key: string) => new Date(`${key}T00:00:00Z`)
const time24 = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

const REL = { mother: { ms: 'Ibu', en: 'Mother' }, father: { ms: 'Bapa', en: 'Father' }, guardian: { ms: 'Penjaga', en: 'Guardian' } } as const
const STATUS = {
  booked: { ms: 'Ditempah', en: 'Booked' },
  cancelled: { ms: 'Dibatalkan', en: 'Cancelled' },
  completed: { ms: 'Selesai', en: 'Completed' },
  no_show: { ms: 'Tidak hadir', en: 'No-show' },
} as const

const relation = (r: string | null, lang: Lang) => (r && r in REL ? REL[r as keyof typeof REL][lang] : (r ?? ''))
const phone = (p: string | null) => (p ? displayMyPhone(p) : '')

const STUDENT_COLS: Col[] = [
  { key: 'student_no', ms: 'ID murid', en: 'Child ID', width: 15 },
  { key: 'full_name', ms: 'Nama', en: 'Name', width: 28 },
  { key: 'mykid', ms: 'No. MyKid', en: 'MyKid no.', width: 16 },
  { key: 'dob', ms: 'Tarikh lahir', en: 'Date of birth', width: 13, fmt: 'dd/mm/yyyy' },
  { key: 'gender', ms: 'Jantina', en: 'Gender', width: 11 },
  { key: 'class_name', ms: 'Kelas', en: 'Class', width: 12 },
  { key: 'school_name', ms: 'Sekolah', en: 'School', width: 28 },
  { key: 'blood_group', ms: 'Kumpulan darah', en: 'Blood group', width: 10 },
  { key: 'height_cm', ms: 'Tinggi (cm)', en: 'Height (cm)', width: 11, fmt: '0.0' },
  { key: 'weight_kg', ms: 'Berat (kg)', en: 'Weight (kg)', width: 11, fmt: '0.0' },
  { key: 'allergies', ms: 'Alahan', en: 'Allergies', width: 26 },
  { key: 'conditions', ms: 'Keadaan kesihatan', en: 'Health conditions', width: 26 },
  { key: 'medications', ms: 'Ubat', en: 'Medicines', width: 22 },
  { key: 'em_name', ms: 'Kecemasan: nama', en: 'Emergency: name', width: 20 },
  { key: 'em_phone', ms: 'Kecemasan: telefon', en: 'Emergency: phone', width: 16 },
  { key: 'p1_name', ms: 'Ibu bapa 1: nama', en: 'Parent 1: name', width: 24 },
  { key: 'p1_rel', ms: 'Ibu bapa 1: hubungan', en: 'Parent 1: relationship', width: 14 },
  { key: 'p1_phone', ms: 'Ibu bapa 1: telefon', en: 'Parent 1: phone', width: 16 },
  { key: 'p1_email', ms: 'Ibu bapa 1: e-mel', en: 'Parent 1: email', width: 28 },
  { key: 'p1_address', ms: 'Ibu bapa 1: alamat', en: 'Parent 1: address', width: 44 },
  { key: 'p2_name', ms: 'Ibu bapa 2: nama', en: 'Parent 2: name', width: 24 },
  { key: 'p2_rel', ms: 'Ibu bapa 2: hubungan', en: 'Parent 2: relationship', width: 14 },
  { key: 'p2_phone', ms: 'Ibu bapa 2: telefon', en: 'Parent 2: phone', width: 16 },
  { key: 'registered', ms: 'Didaftarkan pada', en: 'Registered at', width: 18, fmt: 'dd/mm/yyyy hh:mm' },
]

const APPT_COLS: Col[] = [
  { key: 'date', ms: 'Tarikh', en: 'Date', width: 12, fmt: 'dd/mm/yyyy' },
  { key: 'time', ms: 'Masa', en: 'Time', width: 8 },
  { key: 'location', ms: 'Lokasi', en: 'Location', width: 28 },
  { key: 'student_no', ms: 'ID murid', en: 'Child ID', width: 15 },
  { key: 'student', ms: 'Nama murid', en: 'Child name', width: 28 },
  { key: 'class_name', ms: 'Kelas', en: 'Class', width: 12 },
  { key: 'school', ms: 'Sekolah', en: 'School', width: 28 },
  { key: 'type', ms: 'Jenis temujanji', en: 'Appointment type', width: 20 },
  { key: 'status', ms: 'Status', en: 'Status', width: 13 },
  { key: 'note', ms: 'Catatan ibu bapa', en: 'Parent note', width: 30 },
  { key: 'cancel_reason', ms: 'Sebab pembatalan', en: 'Cancel reason', width: 28 },
  { key: 'cancelled_by', ms: 'Dibatalkan oleh', en: 'Cancelled by', width: 16 },
  { key: 'parent', ms: 'Ibu bapa', en: 'Parent', width: 24 },
  { key: 'parent_phone', ms: 'Telefon ibu bapa', en: 'Parent phone', width: 16 },
  { key: 'booked_at', ms: 'Ditempah pada', en: 'Booked at', width: 18, fmt: 'dd/mm/yyyy hh:mm' },
]

type Sheet = import('exceljs').Worksheet

function setupSheet(ws: Sheet, cols: Col[], lang: Lang) {
  ws.columns = cols.map((c) => ({ header: c[lang], key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }))
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6FED' } }
  head.alignment = { vertical: 'middle', wrapText: true }
  head.height = 32
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
}

export async function buildWorkbook(o: {
  lang: Lang
  students?: StudentRow[]
  appointments?: AppointmentRow[]
  includeMykid: boolean
}): Promise<Blob> {
  const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default
  const { lang } = o
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Vaksin App'
  wb.created = new Date()

  if (o.students) {
    const ws = wb.addWorksheet(lang === 'ms' ? 'Murid' : 'Students')
    // The MyKid column only exists when the officer chose to include it.
    setupSheet(ws, o.includeMykid ? STUDENT_COLS : STUDENT_COLS.filter((c) => c.key !== 'mykid'), lang)
    for (const s of o.students) {
      ws.addRow({
        student_no: s.student_no,
        full_name: s.full_name,
        mykid: s.mykid ?? '',
        dob: dateOnly(s.date_of_birth),
        gender: s.gender === 'male' ? (lang === 'ms' ? 'Lelaki' : 'Male') : lang === 'ms' ? 'Perempuan' : 'Female',
        class_name: s.class_name,
        school_name: s.school_name,
        blood_group: s.blood_group ?? '',
        height_cm: s.height_cm,
        weight_kg: s.weight_kg,
        allergies: s.allergies ?? '',
        conditions: s.conditions ?? '',
        medications: s.medications ?? '',
        em_name: s.emergency_contact_name ?? '',
        em_phone: phone(s.emergency_contact_phone),
        p1_name: s.parent1_name ?? '',
        p1_rel: relation(s.parent1_relationship, lang),
        p1_phone: phone(s.parent1_phone),
        p1_email: s.parent1_email ?? '',
        p1_address: s.parent1_address ?? '',
        p2_name: s.parent2_name ?? '',
        p2_rel: relation(s.parent2_relationship, lang),
        p2_phone: phone(s.parent2_phone),
        registered: klWallClock(s.registered_at),
      })
    }
  }

  if (o.appointments) {
    const ws = wb.addWorksheet(lang === 'ms' ? 'Temujanji' : 'Appointments')
    setupSheet(ws, APPT_COLS, lang)
    for (const a of o.appointments) {
      ws.addRow({
        date: dateOnly(dayKey(a.starts_at)),
        time: time24(a.starts_at),
        location: a.location_name,
        student_no: a.student_no,
        student: a.student_name,
        class_name: a.class_name,
        school: a.school_name,
        type: lang === 'ms' ? a.type_ms : a.type_en,
        status: a.status in STATUS ? STATUS[a.status as keyof typeof STATUS][lang] : a.status,
        note: a.note ?? '',
        cancel_reason: a.cancel_reason ?? '',
        cancelled_by: a.status !== 'cancelled' ? '' : a.cancelled_by_officer ? (lang === 'ms' ? 'Pegawai kesihatan' : 'Health officer') : lang === 'ms' ? 'Ibu bapa' : 'Parent',
        parent: a.parent_name ?? '',
        parent_phone: phone(a.parent_phone),
        booked_at: klWallClock(a.booked_at),
      })
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** Saves a blob as a file through a temporary link. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
