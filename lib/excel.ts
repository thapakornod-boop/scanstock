// สร้างไฟล์ Excel รายงานเช็คสต็อก (ตกแต่งให้อ่านง่าย) แล้วแชร์เข้า LINE
// exceljs ไฟล์ใหญ่ จึงโหลดเฉพาะตอนสร้างไฟล์ (dynamic import)

import type { Borders, Cell, Fill, Font, Row, Worksheet } from 'exceljs'
import type { Employee } from './auth'
import { UNIT_LABEL } from './catalog'
import { daysLeft, expiryStatus, formatThaiDate, type ExpiryTone } from './dates'
import { allLines, totalsOf, type Line, type Round } from './round'

const FONT = 'Tahoma' // มีภาษาไทยทั้งบน Windows, Mac และมือถือ
const C = {
  brand: 'FF2563EB',
  brandDark: 'FF1E3A8A',
  brandSoft: 'FFE8F1FE',
  head: 'FF1E4FC2',
  zebra: 'FFF6F9FE',
  border: 'FFD6E2F3',
  muted: 'FF64748B',
  red: 'FFDC2626',
  white: 'FFFFFFFF',
}
const TONE_FILL: Record<ExpiryTone, string> = { expired: 'FFFEE2E2', warn: 'FFFFEDD5', watch: 'FFFEF9C3', ok: 'FFDCFCE7' }
const TONE_FONT: Record<ExpiryTone, string> = { expired: 'FFB91C1C', warn: 'FFC2410C', watch: 'FFA16207', ok: 'FF15803D' }

const fill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const font = (o: Partial<Font> = {}): Partial<Font> => ({ name: FONT, size: 11, ...o })
const thin = { style: 'thin' as const, color: { argb: C.border } }
const BOX: Partial<Borders> = { top: thin, left: thin, bottom: thin, right: thin }

function title(ws: Worksheet, text: string, sub: string, cols: number) {
  ws.mergeCells(1, 1, 1, cols)
  const t = ws.getCell(1, 1)
  t.value = text
  t.font = font({ size: 16, bold: true, color: { argb: C.white } })
  t.fill = fill(C.brand)
  t.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(1).height = 34
  ws.mergeCells(2, 1, 2, cols)
  const s = ws.getCell(2, 1)
  s.value = sub
  s.font = font({ size: 10, color: { argb: C.white } })
  s.fill = fill(C.brandDark)
  s.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(2).height = 20
}

function header(row: Row) {
  row.height = 24
  row.eachCell(c => {
    c.font = font({ bold: true, color: { argb: C.white } })
    c.fill = fill(C.head)
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = BOX
  })
}

function body(row: Row, zebra: boolean, cols: number) {
  for (let i = 1; i <= cols; i++) {
    const c = row.getCell(i)
    c.font = font(c.font ?? {})
    c.border = BOX
    c.alignment = { vertical: 'middle', ...(c.alignment ?? {}) }
    if (zebra && !c.fill) c.fill = fill(C.zebra)
  }
}

const statusOf = (l: Line) => (l.exp ? expiryStatus(daysLeft(l.exp)) : null)

function paintStatus(cell: Cell, l: Line) {
  const s = statusOf(l)
  if (!s) { cell.value = '-'; cell.font = font({ color: { argb: C.muted } }); return }
  cell.value = s.label
  cell.fill = fill(TONE_FILL[s.tone])
  cell.font = font({ bold: true, color: { argb: TONE_FONT[s.tone] } })
}

function addSummarySheet(wb: import('exceljs').Workbook, round: Round, employee: Employee, when: string) {
  const ws = wb.addWorksheet('สรุป', { views: [{ showGridLines: false }] })
  ws.columns = [{ width: 8 }, { width: 28 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 16 }, { width: 16 }]
  title(ws, 'รายงานเช็คสต็อกพาเลท', 'RSM GROUP · Pallet Stock Check', 8)

  const lines = allLines(round)
  const t = totalsOf(lines)
  const near = lines.filter(l => l.exp && daysLeft(l.exp) <= 30).length
  const unknown = lines.filter(l => l.unknown).length
  const pallets = round.pallets.filter(p => p.lines.length)

  const info: [string, string][] = [
    ['หัวข้อ', round.label],
    ['สถานที่ / โซน', round.location || '-'],
    ['ผู้ตรวจนับ', `${employee.name} (${employee.id})`],
    ['วันเวลา', when],
  ]
  let r = 4
  for (const [k, v] of info) {
    ws.mergeCells(r, 3, r, 8)
    const kc = ws.getCell(r, 1)
    ws.mergeCells(r, 1, r, 2)
    kc.value = k
    kc.font = font({ bold: true, color: { argb: C.brandDark } })
    kc.fill = fill(C.brandSoft)
    kc.border = BOX
    const vc = ws.getCell(r, 3)
    vc.value = v
    vc.font = font()
    vc.border = BOX
    ws.getRow(r).height = 22
    r++
  }

  // กล่องตัวเลขรวม
  r++
  const stats: [string, number, string?][] = [
    ['พาเลท', pallets.length], ['รายการ', t.lines], ['ลัง', t.byUnit.case], ['แพ็ค', t.byUnit.pack], ['ชิ้น', t.byUnit.piece],
    ['ใกล้หมดอายุ/หมดแล้ว', near, near ? C.red : undefined], ['ไม่พบในระบบ', unknown, unknown ? C.red : undefined],
  ]
  stats.forEach(([label, n, color], i) => {
    const col = i + 2
    const lc = ws.getCell(r, col)
    lc.value = label
    lc.font = font({ size: 9, color: { argb: C.muted } })
    lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    lc.fill = fill(C.brandSoft)
    lc.border = BOX
    const nc = ws.getCell(r + 1, col)
    nc.value = n
    nc.font = font({ size: 18, bold: true, color: { argb: color ?? C.brand } })
    nc.alignment = { horizontal: 'center', vertical: 'middle' }
    nc.border = BOX
  })
  ws.getRow(r).height = 30
  ws.getRow(r + 1).height = 34
  r += 3

  // ตารางสรุปรายพาเลท
  const sec = ws.getCell(r, 1)
  sec.value = 'สรุปรายพาเลท'
  sec.font = font({ size: 13, bold: true, color: { argb: C.brandDark } })
  r++
  ws.getRow(r).values = ['ลำดับ', 'พาเลท', 'รายการ', 'ลัง', 'แพ็ค', 'ชิ้น', 'ใกล้หมดอายุ', 'ไม่พบในระบบ']
  header(ws.getRow(r))
  r++
  pallets.forEach((p, i) => {
    const pt = totalsOf(p.lines)
    const row = ws.getRow(r++)
    row.values = [i + 1, p.label, pt.lines, pt.byUnit.case || '', pt.byUnit.pack || '', pt.byUnit.piece || '',
      p.lines.filter(l => l.exp && daysLeft(l.exp) <= 30).length || '', p.lines.filter(l => l.unknown).length || '']
    row.height = 22
    body(row, i % 2 === 1, 8)
    ;[1, 3, 4, 5, 6, 7, 8].forEach(c => { row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' } })
    ;[7, 8].forEach(c => { if (row.getCell(c).value) row.getCell(c).font = font({ bold: true, color: { argb: C.red } }) })
  })
  const tot = ws.getRow(r)
  tot.values = ['', 'รวม', t.lines, t.byUnit.case, t.byUnit.pack, t.byUnit.piece, near, unknown]
  tot.height = 24
  for (let c = 1; c <= 8; c++) {
    const cell = tot.getCell(c)
    cell.font = font({ bold: true, color: { argb: C.brandDark } })
    cell.fill = fill(C.brandSoft)
    cell.border = { ...BOX, top: { style: 'medium', color: { argb: C.brand } } }
    cell.alignment = { horizontal: c === 2 ? 'left' : 'center', vertical: 'middle' }
  }
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
}

const DETAIL_COLS = [
  { h: 'พาเลท', w: 14 }, { h: 'รหัสสินค้า', w: 16 }, { h: 'ชื่อสินค้า', w: 42 }, { h: 'แบรนด์', w: 13 }, { h: 'ขนาด', w: 10 },
  { h: 'จำนวน', w: 9 }, { h: 'หน่วย', w: 8 }, { h: 'วันหมดอายุ', w: 13 }, { h: 'สถานะ', w: 18 }, { h: 'ล็อต', w: 12 }, { h: 'บาร์โค้ด', w: 17 },
]

function addDetailSheet(wb: import('exceljs').Workbook, round: Round, when: string) {
  const n = DETAIL_COLS.length
  const ws = wb.addWorksheet('รายละเอียด', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] })
  ws.columns = DETAIL_COLS.map(c => ({ width: c.w }))
  title(ws, `รายละเอียดสินค้า · ${round.label}`, when, n)
  const hr = ws.getRow(3)
  hr.values = DETAIL_COLS.map(c => c.h)
  header(hr)

  let r = 4
  for (const p of round.pallets.filter(p => p.lines.length)) {
    const pt = totalsOf(p.lines)
    // แถวหัวพาเลท
    ws.mergeCells(r, 1, r, n)
    const sec = ws.getCell(r, 1)
    const parts = [pt.byUnit.case && `${pt.byUnit.case} ลัง`, pt.byUnit.pack && `${pt.byUnit.pack} แพ็ค`, pt.byUnit.piece && `${pt.byUnit.piece} ชิ้น`].filter(Boolean).join(' · ')
    sec.value = `📦 ${p.label}   —   ${pt.lines} รายการ  (${parts})`
    sec.font = font({ bold: true, size: 12, color: { argb: C.brandDark } })
    sec.fill = fill(C.brandSoft)
    sec.border = { ...BOX, top: { style: 'medium', color: { argb: C.brand } } }
    sec.alignment = { vertical: 'middle', indent: 1 }
    ws.getRow(r).height = 24
    r++

    const sorted = [...p.lines].sort((a, b) => a.name.localeCompare(b.name, 'th') || a.exp.localeCompare(b.exp))
    sorted.forEach((l, i) => {
      const row = ws.getRow(r++)
      row.values = [
        p.label, l.itemCode, l.name, l.brand, l.size, l.qty,
        UNIT_LABEL[l.unitType] + (l.unitType === 'case' && l.numInBuy ? ` (×${l.numInBuy})` : ''),
        l.exp ? formatThaiDate(l.exp) : '-', '', l.lot || '-', l.barcode,
      ]
      row.height = 21
      body(row, i % 2 === 1, n)
      row.getCell(3).alignment = { vertical: 'middle', wrapText: true }
      row.getCell(6).font = font({ bold: true, size: 12 })
      ;[6, 7, 8, 10].forEach(c => { row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' } })
      row.getCell(11).alignment = { horizontal: 'left', vertical: 'middle' }
      row.getCell(11).numFmt = '@'
      paintStatus(row.getCell(9), l)
      row.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' }
      if (l.unknown) [2, 3].forEach(c => { row.getCell(c).font = font({ bold: true, color: { argb: C.red } }) })
      row.getCell(1).font = font({ color: { argb: C.muted }, size: 10 })
    })
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: '3:3' }
}

function addExpirySheet(wb: import('exceljs').Workbook, round: Round) {
  const rows = round.pallets.flatMap(p => p.lines.filter(l => l.exp && daysLeft(l.exp) <= 90).map(l => ({ p, l })))
  if (!rows.length) return
  rows.sort((a, b) => a.l.exp.localeCompare(b.l.exp))
  const cols = [{ h: 'สถานะ', w: 18 }, { h: 'วันหมดอายุ', w: 13 }, { h: 'ชื่อสินค้า', w: 42 }, { h: 'จำนวน', w: 9 }, { h: 'หน่วย', w: 8 }, { h: 'พาเลท', w: 14 }, { h: 'ล็อต', w: 12 }]
  const ws = wb.addWorksheet('ใกล้หมดอายุ', { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] })
  ws.columns = cols.map(c => ({ width: c.w }))
  title(ws, 'สินค้าหมดอายุ / ใกล้หมดอายุ (≤ 90 วัน)', 'เรียงจากหมดอายุก่อน', cols.length)
  const hr = ws.getRow(3)
  hr.values = cols.map(c => c.h)
  header(hr)
  rows.forEach(({ p, l }, i) => {
    const row = ws.getRow(4 + i)
    row.values = ['', formatThaiDate(l.exp), l.name, l.qty, UNIT_LABEL[l.unitType], p.label, l.lot || '-']
    row.height = 21
    body(row, i % 2 === 1, cols.length)
    paintStatus(row.getCell(1), l)
    ;[1, 2, 4, 5, 7].forEach(c => { row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' } })
    row.getCell(4).font = font({ bold: true })
  })
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: '3:3' }
}

export async function buildRoundExcel(round: Round, employee: Employee, savedAt = Date.now()): Promise<File> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = `${employee.name} (${employee.id})`
  wb.created = new Date(savedAt)
  const when = new Date(savedAt).toLocaleString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' น.'
  addSummarySheet(wb, round, employee, when)
  addDetailSheet(wb, round, when)
  addExpirySheet(wb, round)
  const buf = await wb.xlsx.writeBuffer()
  const d = new Date(savedAt)
  const stamp = `${d.getFullYear() + 543}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  const safe = round.label.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 40)
  const base = /สต็อก/.test(safe) ? safe : `เช็คสต็อก_${safe}`
  return new File([buf], `${base}_${stamp}.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// แชร์ไฟล์ผ่านเมนูแชร์ของมือถือ (เลือก LINE ได้) ถ้าเครื่องไม่รองรับ (เช่นคอม) จะดาวน์โหลดแทน
// ต้องเรียกทันทีจากการกดปุ่ม (ห้ามรอโหลดอะไรก่อน) ไม่งั้น iOS จะไม่ยอมเปิดเมนูแชร์
export async function shareFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled'
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return 'downloaded'
}
