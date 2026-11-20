'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Scanner from '@/components/Scanner'
import { useHardwareScanner } from '@/components/useHardwareScanner'
import { DateField, ExpiryBadge, Sheet, btnGhost, btnPrimary, inputClass } from '@/components/ui'
import { cleanCode, searchProducts, UNIT_LABEL, type Catalog, type Product, type UnitType } from '@/lib/catalog'
import { formatThaiDate, parseThaiDate } from '@/lib/dates'
import { feedback } from '@/lib/feedback'
import { readLabelDates } from '@/lib/readLabel'
import { addToPallet, removeLine, totalsOf, unitSummary, updateLine, type Batch, type Line, type Pallet } from '@/lib/round'

type Props = {
  pallet: Pallet
  catalog: Catalog | null
  batch: Batch
  onBatch: (b: Batch) => void
  onChange: (p: Pallet) => void
  onDone: () => void
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void
}

export default function PalletScan({ pallet, catalog, batch, onBatch, onChange, onDone, toast }: Props) {
  const [cameraOn, setCameraOn] = useState(true)
  const [flash, setFlash] = useState<'ok' | 'error' | null>(null)
  const [lastKey, setLastKey] = useState<string | null>(null)
  const [pulse, setPulse] = useState(0)
  const [manual, setManual] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [editing, setEditing] = useState<Line | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ใช้ ref เพื่อให้สแกนรัวๆ แล้วอ่านพาเลทล่าสุดเสมอ (ไม่ตกหล่นระหว่าง re-render)
  const palletRef = useRef(pallet)
  const batchRef = useRef(batch)
  useLayoutEffect(() => {
    palletRef.current = pallet
    batchRef.current = batch
  }, [pallet, batch])

  const add = useCallback((item: { product: Product | null; barcode: string; unitType: UnitType }, qty = 1) => {
    const before = palletRef.current
    const next = addToPallet(before, item, batchRef.current, qty)
    const line = next.lines[0]
    const isNewLine = !before.lines.some(l => l.key === line.key)
    palletRef.current = next
    onChange(next)
    setLastKey(line.key)
    setPulse(n => n + 1)
    const kind = item.product ? 'ok' : 'error'
    feedback(item.product ? (isNewLine ? 'new' : 'ok') : 'error')
    setFlash(kind)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 250)
    if (!item.product) toast(`ไม่พบบาร์โค้ด ${item.barcode} ในระบบ — นับเป็น "ไม่พบในระบบ" ไว้ก่อน`, 'error')
  }, [onChange, toast])

  const handleCode = useCallback((raw: string) => {
    const code = cleanCode(raw)
    if (!code) return
    const hit = catalog?.byCode.get(code)
    add(hit ? { product: hit.product, barcode: code, unitType: hit.unitType } : { product: null, barcode: code, unitType: 'piece' })
  }, [catalog, add])

  useHardwareScanner(handleCode, !editing && !batchOpen && !renaming)

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault()
    const q = manual.trim()
    if (!q) return
    const hit = catalog?.byCode.get(cleanCode(q))
    if (hit || /^\d{6,}$/.test(q)) { handleCode(q); setManual(''); setResults([]); return }
    // ไม่ใช่บาร์โค้ด → ค้นหาจากชื่อสินค้า
    const found = catalog ? searchProducts(catalog, q) : []
    setResults(found)
    if (!found.length) toast('ไม่พบสินค้าที่ค้นหา', 'info')
  }

  const totals = totalsOf(pallet.lines)
  const last = pallet.lines.find(l => l.key === lastKey) ?? null
  const batchText = batch.exp || batch.lot
    ? [batch.exp && `EXP ${formatThaiDate(batch.exp)}`, batch.lot && `ล็อต ${batch.lot}`].filter(Boolean).join(' · ')
    : 'ยังไม่ระบุ EXP / ล็อต'

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-slate-50">
      {/* แถบหัว */}
      <header className="brand-gradient pt-safe sticky top-0 z-30 text-white shadow-lg">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={onDone} className="rounded-full bg-white/15 px-3 py-1.5 text-sm">‹ กลับ</button>
          <button onClick={() => setRenaming(true)} className="min-w-0 flex-1 text-left">
            <div className="truncate text-lg leading-tight font-semibold">{pallet.label} ✎</div>
            <div className="text-xs text-white/80">{totals.lines} รายการ · {unitSummary(totals)}</div>
          </button>
          <button onClick={() => setCameraOn(v => !v)} className="rounded-full bg-white/15 px-3 py-1.5 text-sm">
            {cameraOn ? '📷 ปิดกล้อง' : '📷 เปิดกล้อง'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3 pb-28">
        {cameraOn && <Scanner onDetect={handleCode} paused={!!editing || batchOpen || renaming} flash={flash} />}

        {/* ล็อตที่กำลังนับ */}
        <button onClick={() => setBatchOpen(true)}
          className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left ring-1 ${batch.exp || batch.lot ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-slate-200'}`}>
          <div className="min-w-0">
            <div className="text-[11px] text-slate-500">ชิ้นที่สแกนต่อจากนี้จะเป็นล็อต</div>
            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800">
              {batchText} {batch.exp && <ExpiryBadge iso={batch.exp} />}
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">เปลี่ยน</span>
        </button>

        {/* ชิ้นล่าสุด */}
        {last && (
          <div key={pulse} className={`pop flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ${last.unknown ? 'ring-red-300' : 'ring-emerald-200'}`}>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-500">ล่าสุด</div>
              <div className={`truncate font-semibold ${last.unknown ? 'text-red-600' : 'text-slate-900'}`}>{last.name}</div>
              <div className="truncate text-xs text-slate-500">{last.unknown ? last.barcode : `${last.itemCode} · ${last.size || '-'}`}</div>
            </div>
            <button onClick={() => onChange(updateLine(pallet, last.key, { qty: last.qty - 1 }))}
              className="h-11 w-11 rounded-xl bg-slate-100 text-xl font-bold text-slate-600">−</button>
            <div className="w-14 text-center">
              <div className="text-2xl leading-none font-bold text-brand-600">{last.qty}</div>
              <div className="text-[11px] text-slate-500">{UNIT_LABEL[last.unitType]}</div>
            </div>
            <button onClick={() => onChange(updateLine(pallet, last.key, { qty: last.qty + 1 }))}
              className="h-11 w-11 rounded-xl bg-brand-50 text-xl font-bold text-brand-600">+</button>
          </div>
        )}

        {/* พิมพ์บาร์โค้ด / ค้นหาชื่อ */}
        <form onSubmit={submitManual} className="flex gap-2">
          <input value={manual} onChange={e => setManual(e.target.value)} placeholder="พิมพ์บาร์โค้ด หรือชื่อสินค้า"
            className={`${inputClass} bg-white py-2.5`} enterKeyHint="go" />
          <button className={`${btnPrimary} shrink-0 px-4 py-2.5`}>เพิ่ม</button>
        </form>
        {results.length > 0 && (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            {results.map(p => (
              <button key={p.item_code} onClick={() => { add({ product: p, barcode: p.barcode_piece || p.item_code, unitType: 'piece' }); setResults([]); setManual('') }}
                className="block w-full border-b border-slate-100 px-4 py-2.5 text-left last:border-0 active:bg-brand-50">
                <div className="text-sm font-medium">{p.item_name}</div>
                <div className="text-xs text-slate-500">{p.item_code} · {p.brand} · {p.size}</div>
              </button>
            ))}
          </div>
        )}

        {/* รายการในพาเลท */}
        <div className="flex items-center justify-between px-1 pt-1">
          <h3 className="font-semibold text-slate-800">ในพาเลทนี้ ({totals.lines})</h3>
          <span className="text-xs text-slate-500">แตะรายการเพื่อแก้ไข</span>
        </div>
        {pallet.lines.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            เริ่มสแกนได้เลย<br />สแกน 1 ครั้ง = นับ 1 ชิ้น/แพ็ค/ลัง ตามบาร์โค้ด
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            {pallet.lines.map(l => <LineRow key={l.key} line={l} highlight={l.key === lastKey} onClick={() => setEditing(l)} />)}
          </div>
        )}
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-slate-50 via-slate-50 to-slate-50/0 px-3 pt-6">
        <button onClick={onDone} className={`${btnPrimary} w-full py-4 text-base`}>✓ เสร็จพาเลทนี้</button>
      </div>

      <BatchSheet open={batchOpen} batch={batch} onClose={() => setBatchOpen(false)}
        onSave={b => { onBatch(b); setBatchOpen(false); toast(b.exp || b.lot ? 'ตั้งล็อตแล้ว สแกนต่อได้เลย' : 'ล้างล็อตแล้ว', 'info') }} />
      <LineSheet line={editing} onClose={() => setEditing(null)}
        onSave={patch => { if (editing) onChange(updateLine(pallet, editing.key, patch)); setEditing(null) }}
        onDelete={() => { if (editing) onChange(removeLine(pallet, editing.key)); setEditing(null) }} />
      <RenameSheet open={renaming} value={pallet.label} onClose={() => setRenaming(false)}
        onSave={label => { onChange({ ...pallet, label }); setRenaming(false) }} />
    </div>
  )
}

function LineRow({ line, highlight, onClick }: { line: Line; highlight: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 active:bg-slate-50 ${highlight ? 'bg-brand-50/60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${line.unknown ? 'text-red-600' : 'text-slate-900'}`}>{line.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span>{line.unknown ? line.barcode : line.itemCode}</span>
          {line.exp && <span>· EXP {formatThaiDate(line.exp)}</span>}
          {line.lot && <span>· ล็อต {line.lot}</span>}
          <ExpiryBadge iso={line.exp} />
        </div>
      </div>
      <div className="text-right">
        <div className="text-xl leading-none font-bold text-slate-900">{line.qty}</div>
        <div className="text-[11px] text-slate-500">
          {UNIT_LABEL[line.unitType]}{line.unitType === 'case' && line.numInBuy ? ` (×${line.numInBuy})` : ''}
        </div>
      </div>
    </button>
  )
}

// ตั้ง EXP / ล็อต ที่จะใช้กับชิ้นที่สแกนต่อจากนี้ (พิมพ์ หรือถ่ายรูปฉลาก)
function BatchSheet({ open, batch, onClose, onSave }: { open: boolean; batch: Batch; onClose: () => void; onSave: (b: Batch) => void }) {
  const [exp, setExp] = useState('')
  const [lot, setLot] = useState('')
  const [reading, setReading] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [openedFor, setOpenedFor] = useState<Batch | null>(null)

  // เปิดใหม่ทุกครั้ง ให้ค่าเริ่มต้นเป็นล็อตปัจจุบัน
  if (open && openedFor !== batch) {
    setOpenedFor(batch)
    setExp(batch.exp ? formatThaiDate(batch.exp) : '')
    setLot(batch.lot)
    setMsg('')
  }
  if (!open && openedFor) setOpenedFor(null)

  const iso = parseThaiDate(exp)
  const bad = exp !== '' && !iso

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    setReading(true); setMsg('')
    try {
      const d = await readLabelDates(file)
      if (d.exp) { setExp(formatThaiDate(d.exp)); setMsg(`✅ อ่านได้: "${d.raw ?? ''}" ตรวจสอบก่อนกดใช้`) }
      else if (d.mfg) setMsg(`⚠️ เจอแค่วันผลิต ${formatThaiDate(d.mfg)} ไม่เจอวันหมดอายุ`)
      else setMsg('⚠️ หาวันที่ไม่เจอ ลองถ่ายใหม่ให้ชัดขึ้น หรือพิมพ์เอง')
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`)
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="ตั้ง EXP / ล็อตที่กำลังนับ">
      <p className="mb-4 text-sm text-slate-500">ทุกชิ้นที่สแกนหลังจากนี้จะถูกนับเป็นล็อตนี้ จนกว่าจะเปลี่ยนอีกครั้ง</p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => onPhoto(e.target.files?.[0])} />
      <button onClick={() => fileRef.current?.click()} disabled={reading} className={`${btnPrimary} mb-2 w-full`}>
        {reading ? '⏳ กำลังอ่านวันที่…' : '📷 ถ่ายรูปฉลาก อ่าน EXP อัตโนมัติ'}
      </button>
      {msg && <p className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{msg}</p>}
      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">วันหมดอายุ (EXP)</span>
        <DateField value={exp} onChange={setExp} placeholder="วว/ดด/ปปปป เช่น 01/06/2570" />
      </label>
      <div className="mt-1.5 min-h-5 text-sm">
        {bad ? <span className="text-red-600">วันที่ยังไม่ครบหรือไม่ถูกต้อง</span> : <ExpiryBadge iso={iso} />}
      </div>
      <label className="mt-2 block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">ล็อต / Lot no. (ถ้ามี)</span>
        <input value={lot} onChange={e => setLot(e.target.value)} className={inputClass} placeholder="เช่น L2405A" />
      </label>
      <div className="mt-5 mb-2 flex gap-2">
        <button onClick={() => onSave({ exp: '', lot: '' })} className={`${btnGhost} flex-1`}>ไม่ระบุ</button>
        <button onClick={() => onSave({ exp: iso ?? '', lot: lot.trim() })} disabled={bad} className={`${btnPrimary} flex-[2]`}>ใช้ล็อตนี้</button>
      </div>
    </Sheet>
  )
}

function LineSheet({ line, onClose, onSave, onDelete }: {
  line: Line | null
  onClose: () => void
  onSave: (patch: Partial<Pick<Line, 'qty' | 'unitType' | 'exp' | 'lot'>>) => void
  onDelete: () => void
}) {
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState<UnitType>('piece')
  const [exp, setExp] = useState('')
  const [lot, setLot] = useState('')
  const [openedFor, setOpenedFor] = useState<Line | null>(null)

  if (line && openedFor !== line) {
    setOpenedFor(line)
    setQty(String(line.qty)); setUnit(line.unitType)
    setExp(line.exp ? formatThaiDate(line.exp) : ''); setLot(line.lot)
  }
  if (!line && openedFor) setOpenedFor(null)

  const iso = parseThaiDate(exp)
  const bad = exp !== '' && !iso
  const n = parseInt(qty) || 0
  const units = useMemo(() => ['piece', 'pack', 'case'] as UnitType[], [])

  return (
    <Sheet open={!!line} onClose={onClose} title="แก้ไขรายการ">
      {line && (
        <>
          <p className={`font-semibold ${line.unknown ? 'text-red-600' : 'text-slate-900'}`}>{line.name}</p>
          <p className="mb-4 text-xs text-slate-500">{line.itemCode} · {line.barcode} {line.size && `· ${line.size}`}</p>

          <span className="mb-1.5 block text-sm font-medium text-slate-700">จำนวน</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setQty(String(Math.max(0, n - 1)))} className="h-14 w-14 rounded-2xl bg-slate-100 text-2xl font-bold">−</button>
            <input value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              className="h-14 min-w-0 flex-1 rounded-2xl border border-slate-200 text-center text-2xl font-bold text-brand-600 outline-none focus:border-brand-500" />
            <button onClick={() => setQty(String(n + 1))} className="h-14 w-14 rounded-2xl bg-brand-50 text-2xl font-bold text-brand-600">+</button>
          </div>

          <span className="mt-4 mb-1.5 block text-sm font-medium text-slate-700">หน่วย</span>
          <div className="flex gap-2">
            {units.map(u => (
              <button key={u} onClick={() => setUnit(u)}
                className={`flex-1 rounded-2xl py-2.5 font-medium ${unit === u ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {UNIT_LABEL[u]}
              </button>
            ))}
          </div>

          <span className="mt-4 mb-1.5 block text-sm font-medium text-slate-700">วันหมดอายุ (EXP)</span>
          <DateField value={exp} onChange={setExp} />
          <div className="mt-1 min-h-5 text-sm">{bad ? <span className="text-red-600">วันที่ไม่ถูกต้อง</span> : <ExpiryBadge iso={iso} />}</div>

          <span className="mt-2 mb-1.5 block text-sm font-medium text-slate-700">ล็อต</span>
          <input value={lot} onChange={e => setLot(e.target.value)} className={inputClass} placeholder="ไม่ระบุ" />

          <div className="mt-5 mb-2 flex gap-2">
            <button onClick={() => { if (confirm('ลบรายการนี้?')) onDelete() }} className={`${btnGhost} bg-red-50 text-red-600`}>ลบ</button>
            <button disabled={bad} onClick={() => onSave({ qty: n, unitType: unit, exp: iso ?? '', lot: lot.trim() })} className={`${btnPrimary} flex-1`}>
              บันทึก
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}

function RenameSheet({ open, value, onClose, onSave }: { open: boolean; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  const [openedWith, setOpenedWith] = useState<string | null>(null)
  if (open && openedWith === null) { setOpenedWith(value); setText(value) }
  if (!open && openedWith !== null) setOpenedWith(null)
  return (
    <Sheet open={open} onClose={onClose} title="ชื่อพาเลท">
      <input value={text} onChange={e => setText(e.target.value)} className={inputClass} placeholder="เช่น A-01 หรือ ชั้น 2 ช่อง 5" autoFocus />
      <button onClick={() => text.trim() && onSave(text.trim())} className={`${btnPrimary} mt-4 mb-2 w-full`}>บันทึกชื่อ</button>
    </Sheet>
  )
}
