'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExpiryBadge, btnGhost, btnLine } from '@/components/ui'
import type { Employee } from '@/lib/auth'
import { UNIT_LABEL, type UnitType } from '@/lib/catalog'
import { formatThaiDate, parseThaiDate } from '@/lib/dates'
import { lineSummaryText, shareToLine, totalsOf, unitSummary, type Line, type Round } from '@/lib/round'
import { createClient } from '@/lib/supabase'
import { buildRoundExcel, shareFile } from '@/lib/excel'

type LogRow = {
  id: string
  employee_id: string
  barcode: string
  item_code: string
  product_name: string
  brand: string | null
  size: string | null
  unit: string
  quantity: number
  note: string | null
  session_label: string | null
  location?: string | null
  pallet_label?: string | null
  pallet_image_url: string | null
  case_number: number | null
  lot?: string | null
  exp_date: string | null
  exp_at: string | null
  created_at: string
}

type SavedRound = { key: string; createdAt: string; ids: string[]; round: Round }

const UNIT_FROM_LABEL: Record<string, UnitType> = { 'ชิ้น': 'piece', 'แพ็ค': 'pack', 'ลัง': 'case' }

// แปลงแถวใน scan_logs กลับเป็นรอบ → พาเลท → รายการ (แถวที่บันทึกพร้อมกันมี created_at เดียวกัน)
function toRounds(rows: LogRow[]): SavedRound[] {
  const map = new Map<string, SavedRound>()
  for (const r of rows) {
    const label = r.session_label || '(ไม่มีหัวข้อ)'
    const key = `${label}|${r.created_at}`
    let g = map.get(key)
    if (!g) {
      g = { key, createdAt: r.created_at, ids: [], round: { id: key, label, location: r.location ?? '', startedAt: Date.parse(r.created_at), pallets: [] } }
      map.set(key, g)
    }
    g.ids.push(r.id)
    const no = r.case_number ?? 1
    let p = g.round.pallets.find(x => x.no === no)
    if (!p) {
      p = { id: `${key}|${no}`, no, label: r.pallet_label || `พาเลท ${no}`, photoUrl: r.pallet_image_url, lines: [], startedAt: 0 }
      g.round.pallets.push(p)
    }
    const line: Line = {
      key: r.id, itemCode: r.item_code, barcode: r.barcode, name: r.product_name, brand: r.brand ?? '', size: r.size ?? '',
      unitType: UNIT_FROM_LABEL[r.unit] ?? 'piece', numInBuy: null, qty: r.quantity,
      exp: r.exp_at ?? parseThaiDate(r.exp_date) ?? '', lot: r.lot ?? '', unknown: r.note === 'ไม่พบในระบบ', updatedAt: 0,
    }
    p.lines.push(line)
  }
  for (const g of map.values()) g.round.pallets.sort((a, b) => a.no - b.no)
  return Array.from(map.values())
}

export default function History({ employee, toast }: { employee: Employee; toast: (t: string, k?: 'ok' | 'error' | 'info') => void }) {
  const [rounds, setRounds] = useState<SavedRound[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  const fetchRounds = useCallback(async () => {
    const { data, error } = await createClient().from('scan_logs').select('*')
      .eq('employee_id', employee.id).order('created_at', { ascending: false }).limit(1000)
    if (error) toast(`โหลดประวัติไม่สำเร็จ: ${error.message}`, 'error')
    return toRounds((data as LogRow[]) ?? [])
  }, [employee.id, toast])

  const apply = (list: SavedRound[]) => {
    setRounds(list)
    setOpen(o => o ?? list[0]?.key ?? null)
    setLoading(false)
  }
  const load = () => { setLoading(true); fetchRounds().then(apply) }

  useEffect(() => {
    let alive = true
    fetchRounds().then(list => { if (alive) apply(list) })
    return () => { alive = false }
  }, [fetchRounds])

  const remove = async (g: SavedRound) => {
    if (!confirm(`ลบรอบ "${g.round.label}" ทั้งหมด?`)) return
    const { error } = await createClient().from('scan_logs').delete().in('id', g.ids)
    if (error) { toast(`ลบไม่สำเร็จ: ${error.message}`, 'error'); return }
    toast('ลบแล้ว')
    load()
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-safe pb-28">
      <div className="flex items-center justify-between pt-5 pb-3">
        <h1 className="text-2xl font-semibold text-slate-900">ประวัติการเช็ค</h1>
        <button onClick={load} className={`${btnGhost} bg-white/70 px-3 py-2 text-xs`}>🔄</button>
      </div>
      {loading ? <p className="py-10 text-center text-slate-500">กำลังโหลด…</p>
        : rounds.length === 0 ? <p className="py-10 text-center text-slate-500">ยังไม่มีประวัติ</p>
        : (
          <div className="flex flex-col gap-3">
            {rounds.map(g => {
              const lines = g.round.pallets.flatMap(p => p.lines)
              const t = totalsOf(lines)
              const isOpen = open === g.key
              return (
                <div key={g.key} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
                  <button onClick={() => setOpen(isOpen ? null : g.key)} className="flex w-full items-center gap-3 p-4 text-left">
                    <span className="text-brand-600">{isOpen ? '▾' : '▸'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{g.round.label}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(g.createdAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {g.round.location && ` · 📍 ${g.round.location}`}
                      </div>
                      <div className="text-sm text-slate-600">{g.round.pallets.length} พาเลท · {t.lines} รายการ · {unitSummary(t)}</div>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100">
                      {g.round.pallets.map(p => (
                        <div key={p.id}>
                          <div className="flex items-center gap-2 bg-brand-50/60 px-4 py-2 text-sm font-semibold text-brand-900">
                            📦 {p.label} <span className="font-normal text-slate-500">· {unitSummary(totalsOf(p.lines))}</span>
                            {p.photoUrl && <a href={p.photoUrl} target="_blank" className="ml-auto text-xs font-normal text-brand-600 underline">ดูรูป</a>}
                          </div>
                          {p.lines.map(l => (
                            <div key={l.key} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5">
                              <div className="min-w-0 flex-1">
                                <div className={`truncate text-sm ${l.unknown ? 'text-red-600' : ''}`}>{l.name}</div>
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                  {l.exp ? `EXP ${formatThaiDate(l.exp)}` : 'ไม่ระบุ EXP'}{l.lot && ` · ล็อต ${l.lot}`}
                                  <ExpiryBadge iso={l.exp} />
                                </div>
                              </div>
                              <div className="font-semibold">{l.qty} <span className="text-xs font-normal text-slate-500">{UNIT_LABEL[l.unitType]}</span></div>
                            </div>
                          ))}
                        </div>
                      ))}
                      <div className="flex gap-2 p-3">
                        <button onClick={() => remove(g)} className={`${btnGhost} bg-red-50 text-red-600`}>ลบ</button>
                        <button onClick={() => shareToLine(lineSummaryText(g.round, employee, Date.parse(g.createdAt)))} className={`${btnGhost} flex-1`}>
                          💬 ข้อความ
                        </button>
                        <ExcelButton round={g.round} employee={employee} savedAt={Date.parse(g.createdAt)} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

// สร้างไฟล์รอไว้ตอนเปิดรอบ แล้วกดแชร์ได้ทันที
function ExcelButton({ round, employee, savedAt }: { round: Round; employee: Employee; savedAt: number }) {
  const [file, setFile] = useState<File | null>(null)
  useEffect(() => {
    let alive = true
    buildRoundExcel(round, employee, savedAt).then(f => { if (alive) setFile(f) }).catch(() => {})
    return () => { alive = false }
  }, [round, employee, savedAt])
  return (
    <button onClick={() => file && shareFile(file)} disabled={!file} className={`${btnLine} flex-[2] py-3`}>
      {file ? '📊 ส่ง Excel' : '⏳ เตรียมไฟล์…'}
    </button>
  )
}
