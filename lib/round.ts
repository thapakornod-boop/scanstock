// รอบเช็ค → หลายพาเลท → รายการสินค้า (แยกบรรทัดตามสินค้า + หน่วย + EXP + ล็อต)
// ร่างที่ยังไม่บันทึกเก็บใน localStorage กันข้อมูลหายตอนปิดแอปหรือเน็ตหลุด

import type { Employee } from './auth'
import { UNIT_LABEL, type Product, type UnitType } from './catalog'
import { daysLeft, EXPIRY_WARN_DAYS, formatThaiDate, formatThaiDateShort } from './dates'
import { createClient } from './supabase'

export type Line = {
  key: string
  itemCode: string
  barcode: string
  name: string
  brand: string
  size: string
  unitType: UnitType
  numInBuy: number | null
  qty: number
  exp: string // ISO หรือ ''
  lot: string
  unknown: boolean // บาร์โค้ดที่ไม่มีในระบบ
  updatedAt: number
}

export type Pallet = { id: string; no: number; label: string; photoUrl: string | null; lines: Line[]; startedAt: number }

export type Round = { id: string; label: string; location: string; startedAt: number; pallets: Pallet[] }

export type Batch = { exp: string; lot: string } // ล็อตที่กำลังนับอยู่ ใช้กับทุกชิ้นที่สแกนต่อจากนี้

const DRAFT_KEY = 'rsm_round_draft_v1'
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export const lineKey = (itemCode: string, unitType: UnitType, b: Batch) => `${itemCode}|${unitType}|${b.exp}|${b.lot.trim()}`

export function newRound(label: string, location: string): Round {
  return { id: uid(), label, location, startedAt: Date.now(), pallets: [] }
}

export function newPallet(round: Round, label?: string): Pallet {
  const no = round.pallets.reduce((m, p) => Math.max(m, p.no), 0) + 1
  return { id: uid(), no, label: label?.trim() || `พาเลท ${no}`, photoUrl: null, lines: [], startedAt: Date.now() }
}

// สแกน 1 ครั้ง = +qty ให้บรรทัดเดิม (ย้ายขึ้นบนสุด) หรือสร้างบรรทัดใหม่
export function addToPallet(
  pallet: Pallet,
  item: { product: Product | null; barcode: string; unitType: UnitType },
  batch: Batch,
  qty = 1,
): Pallet {
  const itemCode = item.product?.item_code ?? item.barcode
  const key = lineKey(itemCode, item.unitType, batch)
  const existing = pallet.lines.find(l => l.key === key)
  const line: Line = existing
    ? { ...existing, qty: existing.qty + qty, updatedAt: Date.now() }
    : {
        key, itemCode, barcode: item.barcode,
        name: item.product?.item_name ?? 'ไม่พบในระบบ',
        brand: item.product?.brand ?? '',
        size: item.product?.size ?? '',
        unitType: item.unitType,
        numInBuy: item.product?.num_in_buy ?? null,
        qty, exp: batch.exp, lot: batch.lot.trim(),
        unknown: !item.product, updatedAt: Date.now(),
      }
  return { ...pallet, lines: [line, ...pallet.lines.filter(l => l.key !== key)] }
}

// แก้บรรทัด ถ้าเปลี่ยน หน่วย/EXP/ล็อต แล้วชนกับบรรทัดอื่น ให้รวมจำนวนเข้าด้วยกัน
export function updateLine(pallet: Pallet, key: string, patch: Partial<Pick<Line, 'qty' | 'unitType' | 'exp' | 'lot'>>): Pallet {
  const old = pallet.lines.find(l => l.key === key)
  if (!old) return pallet
  const merged = { ...old, ...patch, updatedAt: Date.now() }
  merged.key = lineKey(merged.itemCode, merged.unitType, { exp: merged.exp, lot: merged.lot })
  if (merged.qty <= 0) return { ...pallet, lines: pallet.lines.filter(l => l.key !== key) }
  const other = merged.key !== key ? pallet.lines.find(l => l.key === merged.key) : undefined
  const lines = pallet.lines
    .filter(l => l.key !== key && l.key !== other?.key)
  const final = other ? { ...merged, qty: merged.qty + other.qty } : merged
  const idx = pallet.lines.findIndex(l => l.key === key)
  lines.splice(Math.min(idx, lines.length), 0, final)
  return { ...pallet, lines }
}

export function removeLine(pallet: Pallet, key: string): Pallet {
  return { ...pallet, lines: pallet.lines.filter(l => l.key !== key) }
}

// ── ยอดรวม ──
export type Totals = { lines: number; byUnit: Record<UnitType, number>; scans: number }

export function totalsOf(lines: Line[]): Totals {
  const byUnit: Record<UnitType, number> = { piece: 0, pack: 0, case: 0 }
  for (const l of lines) byUnit[l.unitType] += l.qty
  return { lines: lines.length, byUnit, scans: byUnit.piece + byUnit.pack + byUnit.case }
}

export const allLines = (round: Round) => round.pallets.flatMap(p => p.lines)

export function unitSummary(t: Totals) {
  const parts = (['case', 'pack', 'piece'] as UnitType[]).filter(u => t.byUnit[u] > 0).map(u => `${t.byUnit[u].toLocaleString()} ${UNIT_LABEL[u]}`)
  return parts.length ? parts.join(' · ') : '0 ชิ้น'
}

export const isNearExpiry = (l: Line) => !!l.exp && daysLeft(l.exp) <= EXPIRY_WARN_DAYS

// ── ร่างในเครื่อง ──
export function loadDraft(): Round | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveDraft(round: Round | null) {
  try {
    if (round) localStorage.setItem(DRAFT_KEY, JSON.stringify(round))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {}
}

// ── ข้อความสรุปสำหรับ LINE ──
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function lineSummaryText(round: Round, employee: Employee, savedAt = Date.now()) {
  const when = new Date(savedAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  const out: string[] = [
    `📦 เช็คสต็อก: ${round.label}`,
    ...(round.location ? [`📍 ${round.location}`] : []),
    `👤 ${employee.name} (${employee.id})`,
    `🕒 ${when}`,
  ]
  const pallets = round.pallets.filter(p => p.lines.length > 0)
  for (const p of pallets) {
    const t = totalsOf(p.lines)
    out.push('', `🟦 ${p.label} — ${t.lines} รายการ (${unitSummary(t)})`)
    // เรียงตามชื่อสินค้า แล้ว EXP เพื่ออ่านง่าย
    const sorted = [...p.lines].sort((a, b) => a.name.localeCompare(b.name, 'th') || a.exp.localeCompare(b.exp))
    for (const l of sorted) {
      const exp = l.exp ? ` EXP ${formatThaiDateShort(l.exp)}${isNearExpiry(l) ? '⚠️' : ''}` : ''
      const lot = l.lot ? ` L:${l.lot}` : ''
      out.push(`• ${clip(l.name, 38)} ×${l.qty} ${UNIT_LABEL[l.unitType]}${exp}${lot}${l.unknown ? ` [${l.barcode}]` : ''}`)
    }
  }
  const t = totalsOf(allLines(round))
  const near = allLines(round).filter(isNearExpiry).length
  out.push('', `รวม ${pallets.length} พาเลท · ${t.lines} รายการ`, `รวม ${unitSummary(t)}`)
  if (near) out.push(`⚠️ หมดอายุ/ใกล้หมด (≤${EXPIRY_WARN_DAYS} วัน) ${near} รายการ`)
  return out.join('\n')
}

// ── CSV ──
const csvCell = (v: string | number | null | undefined) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function roundCsv(round: Round, employee: Employee) {
  const header = ['หัวข้อ', 'สถานที่', 'พาเลท', 'รหัสสินค้า', 'บาร์โค้ด', 'ชื่อสินค้า', 'แบรนด์', 'ขนาด', 'จำนวน', 'หน่วย', 'วันหมดอายุ', 'ล็อต', 'พนักงาน']
  const rows = round.pallets.flatMap(p => p.lines.map(l => [
    round.label, round.location, p.label, l.itemCode, l.barcode, l.name, l.brand, l.size, l.qty, UNIT_LABEL[l.unitType],
    l.exp ? formatThaiDate(l.exp) : '', l.lot, `${employee.name} (${employee.id})`,
  ]))
  return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n')
}

// ── บันทึกลง Supabase (ตาราง scan_logs เดิม + คอลัมน์ pallet_label, lot, location) ──
export async function saveRound(round: Round, employee: Employee) {
  const pallets = round.pallets.filter(p => p.lines.length > 0)
  const records = pallets.flatMap(p => p.lines.map(l => ({
    employee_id: employee.id,
    employee_name: employee.name,
    barcode: l.barcode,
    item_code: l.itemCode,
    product_name: l.name,
    brand: l.brand,
    size: l.size,
    unit: UNIT_LABEL[l.unitType],
    quantity: l.qty,
    note: l.unknown ? 'ไม่พบในระบบ' : '',
    session_label: round.label,
    location: round.location || null,
    pallet_label: p.label,
    pallet_image_url: p.photoUrl,
    case_number: p.no,
    total_cases: pallets.length,
    lot: l.lot || null,
    mfg_date: null,
    exp_date: l.exp ? formatThaiDate(l.exp) : null,
    exp_at: l.exp || null,
  })))
  const { error } = await createClient().from('scan_logs').insert(records)
  if (error) throw error
  return records.length
}

// เปิด LINE ให้เลือกแชทเอง (ทั้ง iOS และ Android)
export function shareToLine(text: string) {
  window.location.href = `https://line.me/R/share?text=${encodeURIComponent(text)}`
}
