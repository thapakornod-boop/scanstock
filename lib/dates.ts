// วันที่ในแอปเก็บเป็น ISO 'yyyy-mm-dd' และแสดงผลเป็น 'วว/ดด/ปปปป' (พ.ศ.)

export const EXPIRY_WARN_DAYS = 30
export const EXPIRY_WATCH_DAYS = 90

// 'วว/ดด/ปปปป' (ปี พ.ศ. หรือ ค.ศ.) → 'yyyy-mm-dd' หรือ null ถ้าไม่ใช่วันที่จริง
export function parseThaiDate(s: string | null | undefined): string | null {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const d = +m[1], mo = +m[2]
  let y = +m[3]
  if (y > 2400) y -= 543
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

// 'yyyy-mm-dd' → 'วว/ดด/ปปปป' (พ.ศ.)
export function formatThaiDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${+y + 543}`
}

// 'yyyy-mm-dd' → 'วว/ดด/ปป' (พ.ศ. 2 หลัก) ใช้ในข้อความ LINE ให้สั้น
export function formatThaiDateShort(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${String(+y + 543).slice(2)}`
}

export function addDaysIso(iso: string, days: number) {
  const dt = new Date(iso + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export function daysLeft(iso: string) {
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.parse(iso + 'T00:00:00Z') - today) / 86400000)
}

export type ExpiryTone = 'expired' | 'warn' | 'watch' | 'ok'

export function expiryStatus(days: number): { label: string; tone: ExpiryTone } {
  if (days < 0) return { label: `หมดอายุแล้ว ${-days} วัน`, tone: 'expired' }
  if (days === 0) return { label: 'หมดอายุวันนี้', tone: 'expired' }
  if (days <= EXPIRY_WARN_DAYS) return { label: `เหลือ ${days} วัน`, tone: 'warn' }
  if (days <= EXPIRY_WATCH_DAYS) return { label: `เหลือ ${days} วัน`, tone: 'watch' }
  return { label: `เหลือ ${days} วัน`, tone: 'ok' }
}

// จัดรูปตัวเลขที่พิมพ์ให้เป็น วว/ดด/ปปปป ระหว่างพิมพ์
export function formatDateDigits(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2)
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4)
}

export function todayLabel() {
  return new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}
