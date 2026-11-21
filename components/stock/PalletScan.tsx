'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Scanner, { type CaptureFrame } from '@/components/Scanner'
import { useHardwareScanner } from '@/components/useHardwareScanner'
import { DateField, ExpiryBadge, Sheet, btnGhost, btnPrimary, inputClass } from '@/components/ui'
import { cleanCode, searchProducts, UNIT_LABEL, type Catalog, type Product, type UnitType } from '@/lib/catalog'
import { formatThaiDate, parseThaiDate } from '@/lib/dates'
import { feedback } from '@/lib/feedback'
import { readLabelDates, readLabelImage } from '@/lib/readLabel'
import { addToPallet, lineKey, removeLine, setBatchForLines, totalsOf, unitSummary, updateLine, type Batch, type Line, type Pallet } from '@/lib/round'

type ReadResult = 'exp' | 'partial' | 'none' | 'busy' | 'quota' | 'error'
const SEEK_MS = 20000 // หา EXP นานสุดต่อสินค้าใหม่ 1 ตัว
const SEEK_INTERVAL_MS = 1500
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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
  const [typing, setTyping] = useState(false) // กำลังพิมพ์ EXP/ล็อต: หยุดกล้องชั่วคราว
  const [renaming, setRenaming] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // อ่าน EXP/ล็อตจากกล้องตัวเดียวกับที่สแกนบาร์โค้ด
  const captureRef = useRef<CaptureFrame | null>(null)
  const [readingExp, setReadingExp] = useState(false)
  const readingRef = useRef(false)
  const [autoRead, setAutoRead] = useState(() => {
    try { return localStorage.getItem('rsm_auto_exp') !== '0' } catch { return true }
  })
  const lastKeyRef = useRef<string | null>(null)
  const readExpRef = useRef<(auto: boolean, targetKey: string | null) => Promise<ReadResult>>(async () => 'none')
  // หา EXP อัตโนมัติ: ลองอ่านจากกล้องซ้ำจนกว่าจะเจอ (ให้ผู้ใช้แค่หันกล้องไปที่วันที่)
  const seekRef = useRef<{ key: string; until: number } | null>(null)
  const seekLoopRef = useRef(false)
  const [seeking, setSeeking] = useState(false)
  const activeRef = useRef(true) // กล้องเปิดและไม่ได้เปิดหน้าต่างอื่นทับ

  // ใช้ ref เพื่อให้สแกนรัวๆ แล้วอ่านพาเลทล่าสุดเสมอ (ไม่ตกหล่นระหว่าง re-render)
  const palletRef = useRef(pallet)
  const batchRef = useRef(batch)
  useLayoutEffect(() => {
    palletRef.current = pallet
    batchRef.current = batch
    activeRef.current = cameraOn && !editing && !typing && !renaming
  }, [pallet, batch, cameraOn, editing, typing, renaming])
  useEffect(() => () => { seekRef.current = null }, [])

  const startSeek = useCallback((key: string) => {
    seekRef.current = { key, until: Date.now() + SEEK_MS }
    setSeeking(true)
    if (seekLoopRef.current) return // ลูปเดิมยังทำงานอยู่ จะหยิบเป้าหมายใหม่ไปเอง
    seekLoopRef.current = true
    const loop = async () => {
      while (seekRef.current && Date.now() < seekRef.current.until) {
        if (!activeRef.current) { await sleep(400); continue }
        const target = seekRef.current
        const r = await readExpRef.current(true, target.key)
        if (r === 'exp') {
          if (seekRef.current === target) seekRef.current = null // เจอแล้ว หยุดหา (ถ้าไม่มีสินค้าใหม่มาแทน)
          continue
        }
        if (r === 'quota') { toast('อ่าน EXP อัตโนมัติเกินโควต้า หยุดหาชั่วคราว', 'error'); break }
        const key = seekRef.current?.key
        if (!key || !palletRef.current.lines.some(l => l.key === key)) break // รายการถูกลบ/รวมไปแล้ว
        await sleep(SEEK_INTERVAL_MS)
      }
      seekRef.current = null
      seekLoopRef.current = false
      setSeeking(false)
    }
    loop()
  }, [toast])

  const add = useCallback((item: { product: Product | null; barcode: string; unitType: UnitType }, qty = 1) => {
    const before = palletRef.current
    const next = addToPallet(before, item, batchRef.current, qty)
    const line = next.lines[0]
    const isNewLine = !before.lines.some(l => l.key === line.key)
    palletRef.current = next
    onChange(next)
    setLastKey(line.key)
    lastKeyRef.current = line.key
    setPulse(n => n + 1)
    const kind = item.product ? 'ok' : 'error'
    feedback(item.product ? (isNewLine ? 'new' : 'ok') : 'error')
    setFlash(kind)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 250)
    if (!item.product) toast(`ไม่พบบาร์โค้ด ${item.barcode} ในระบบ — นับเป็น "ไม่พบในระบบ" ไว้ก่อน`, 'error')
    // เจอสินค้าใหม่ในพาเลท → เริ่มหา EXP/ล็อตจากกล้องเดียวกันเองทันที
    else if (isNewLine && autoRead) startSeek(line.key)
  }, [onChange, toast, autoRead, startSeek])

  // ส่งภาพปัจจุบันจากกล้องให้ AI อ่าน แล้วเติม EXP/ล็อตให้ชิ้นที่สแกนต่อจากนี้
  // และใส่ให้ชิ้นเป้าหมายด้วย (อัตโนมัติ: สินค้าใหม่ที่กำลังหา / กดเอง: ชิ้นล่าสุดถ้ายังไม่มี EXP)
  const readExp = useCallback(async (auto: boolean, targetKey: string | null): Promise<ReadResult> => {
    if (readingRef.current) return 'busy'
    const image = captureRef.current?.()
    if (!image) { if (!auto) toast('กล้องยังไม่พร้อม', 'error'); return 'none' }
    readingRef.current = true
    setReadingExp(true)
    try {
      const d = await readLabelImage(image)
      if (!d.exp && !d.lot) {
        if (!auto) toast('ไม่เจอวันหมดอายุในภาพ ลองหันกล้องไปที่วันที่ให้ชัดขึ้น', 'info')
        return 'none'
      }
      const b: Batch = { exp: d.exp ?? batchRef.current.exp, lot: d.lot ?? batchRef.current.lot }
      batchRef.current = b
      onBatch(b)
      const p = palletRef.current
      const key = targetKey ?? lastKeyRef.current
      const target = key ? p.lines.find(l => l.key === key) : undefined
      if (target && (auto || !target.exp)) {
        // ใส่เฉพาะค่าที่อ่านได้ ค่าที่อ่านไม่ได้คงของเดิมไว้
        const patch = { ...(d.exp ? { exp: d.exp } : {}), ...(d.lot ? { lot: d.lot } : {}) }
        const next = updateLine(p, target.key, patch)
        palletRef.current = next
        onChange(next)
        const newKey = lineKey(target.itemCode, target.unitType, { exp: patch.exp ?? target.exp, lot: patch.lot ?? target.lot })
        if (lastKeyRef.current === target.key) { setLastKey(newKey); lastKeyRef.current = newKey }
        if (seekRef.current?.key === target.key) seekRef.current.key = newKey
      }
      feedback('new')
      toast(`📅 ${auto ? 'เจอ ' : ''}${d.exp ? `EXP ${formatThaiDate(d.exp)}` : ''}${d.lot ? ` · ล็อต ${d.lot}` : ''}`, 'info')
      return d.exp ? 'exp' : 'partial'
    } catch (err) {
      const msg = (err as Error).message
      if (!auto) toast(msg, 'error')
      return /โควต้า/.test(msg) ? 'quota' : 'error'
    } finally {
      readingRef.current = false
      setReadingExp(false)
    }
  }, [onBatch, onChange, toast])
  useLayoutEffect(() => { readExpRef.current = readExp }, [readExp])

  const toggleAutoRead = () => {
    const next = !autoRead
    setAutoRead(next)
    if (!next) seekRef.current = null
    try { localStorage.setItem('rsm_auto_exp', next ? '1' : '0') } catch {}
  }

  const handleCode = useCallback((raw: string) => {
    const code = cleanCode(raw)
    if (!code) return
    const hit = catalog?.byCode.get(code)
    add(hit ? { product: hit.product, barcode: code, unitType: hit.unitType } : { product: null, barcode: code, unitType: 'piece' })
  }, [catalog, add])

  useHardwareScanner(handleCode, !editing && !renaming)

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
        {cameraOn && (
          <Scanner onDetect={handleCode} paused={!!editing || typing || renaming} flash={flash} captureRef={captureRef}
            overlay={seeking ? (
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-full bg-amber-400/95 px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg">
                <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-slate-900" />
                🔍 กำลังหา EXP… หันกล้องไปที่วันหมดอายุ
              </div>
            ) : (
              <button onClick={() => readExp(false, null)} disabled={readingExp}
                className="absolute right-3 bottom-3 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg active:scale-95 disabled:opacity-80">
                {readingExp ? '⏳ กำลังอ่าน EXP…' : '📅 อ่าน EXP'}
              </button>
            )} />
        )}

        {/* EXP / ล็อตที่กำลังนับ: แสดงตลอด แก้ได้ทันที */}
        <BatchPanel batch={batch} onBatch={onBatch} onTyping={setTyping} lineCount={pallet.lines.length}
          cameraOn={cameraOn} autoRead={autoRead} onToggleAutoRead={toggleAutoRead}
          onApplyAll={() => { onChange(setBatchForLines(pallet, () => true, batch)); toast('ใส่ EXP/ล็อตให้ทุกรายการในพาเลทแล้ว') }} />

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

      <LineSheet line={editing} onClose={() => setEditing(null)}
        onSave={patch => { if (editing) onChange(updateLine(pallet, editing.key, patch)); setEditing(null) }}
        onDelete={() => { if (editing) onChange(removeLine(pallet, editing.key)); setEditing(null) }}
        sameCount={editing ? pallet.lines.filter(l => l.itemCode === editing.itemCode).length : 0}
        onApplyProduct={patch => {
          if (!editing) return
          const updated = updateLine(pallet, editing.key, patch)
          onChange(setBatchForLines(updated, l => l.itemCode === editing.itemCode, { exp: patch.exp ?? '', lot: patch.lot ?? '' }))
          setEditing(null)
          toast('ใส่ EXP/ล็อตเดียวกันทั้งสินค้าแล้ว')
        }} />
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

// EXP / ล็อต ที่จะใช้กับชิ้นที่สแกนต่อจากนี้ (พิมพ์ หรือถ่ายรูปฉลาก) มีผลทันทีที่วันที่ครบ
function BatchPanel({ batch, onBatch, onTyping, lineCount, onApplyAll, cameraOn, autoRead, onToggleAutoRead }: {
  batch: Batch
  onBatch: (b: Batch) => void
  onTyping: (typing: boolean) => void
  lineCount: number
  onApplyAll: () => void
  cameraOn: boolean
  autoRead: boolean
  onToggleAutoRead: () => void
}) {
  const [expText, setExpText] = useState(batch.exp ? formatThaiDate(batch.exp) : '')
  const [syncedExp, setSyncedExp] = useState(batch.exp)
  const [reading, setReading] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // ถ้า EXP ถูกตั้งจากที่อื่น ให้ช่องแสดงตาม
  if (batch.exp !== syncedExp) {
    setSyncedExp(batch.exp)
    if (batch.exp) setExpText(formatThaiDate(batch.exp))
  }

  const changeExp = (v: string) => {
    setExpText(v)
    onBatch({ exp: parseThaiDate(v) ?? '', lot: batch.lot })
  }
  const bad = expText !== '' && !parseThaiDate(expText)
  const active = !!(batch.exp || batch.lot.trim())

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    setReading(true); setMsg('')
    try {
      const d = await readLabelDates(file)
      if (d.exp || d.lot) {
        if (d.exp) setExpText(formatThaiDate(d.exp))
        onBatch({ exp: d.exp ?? batch.exp, lot: d.lot ?? batch.lot })
        setMsg(`✅ อ่านได้: "${d.raw ?? ''}" ตรวจสอบด้วย`)
      }
      else if (d.mfg) setMsg(`⚠️ เจอแค่วันผลิต ${formatThaiDate(d.mfg)} ไม่เจอวันหมดอายุ`)
      else setMsg('⚠️ หาวันที่ไม่เจอ ลองถ่ายใหม่ให้ชัดขึ้น หรือพิมพ์เอง')
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`)
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const focus = { onFocus: () => onTyping(true), onBlur: () => onTyping(false) }

  return (
    <div className={`rounded-2xl p-3 ring-1 ${active ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">EXP / ล็อต ของชิ้นที่สแกนต่อจากนี้</span>
        {bad ? <span className="text-xs font-semibold text-red-600">วันที่ยังไม่ครบ</span> : <ExpiryBadge iso={batch.exp} />}
      </div>
      <div className="mt-2 flex gap-2">
        <div className="min-w-0 flex-[3]">
          <DateField value={expText} onChange={changeExp} placeholder="EXP วว/ดด/ปปปป" {...focus} />
        </div>
        <input value={batch.lot} onChange={e => onBatch({ exp: batch.exp, lot: e.target.value })} placeholder="ล็อต"
          className={`${inputClass} min-w-0 flex-[2]`} {...focus} />
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
      <div className="mt-2 flex gap-2">
        {cameraOn ? (
          <button onClick={onToggleAutoRead} role="switch" aria-checked={autoRead}
            className={`flex flex-1 items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs ring-1 ${autoRead ? 'bg-brand-50 text-brand-900 ring-brand-100' : 'bg-white text-slate-500 ring-slate-200'}`}>
            <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${autoRead ? 'bg-brand-600' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoRead ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            <span>หา EXP/ล็อตอัตโนมัติจากกล้อง<br />เมื่อสแกนเจอสินค้าใหม่ (ไม่ต้องกด)</span>
          </button>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={reading} className={`${btnPrimary} flex-1 py-2.5 text-sm`}>
            {reading ? '⏳ กำลังอ่าน…' : '📷 ถ่ายรูปฉลาก อ่าน EXP'}
          </button>
        )}
        {(active || expText) && (
          <button onClick={() => { setExpText(''); setMsg(''); onBatch({ exp: '', lot: '' }) }} className={`${btnGhost} px-4 py-2.5 text-sm`}>ล้าง</button>
        )}
      </div>
      {msg && <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-700">{msg}</p>}
      {active && lineCount > 0 && (
        <button onClick={() => { if (confirm(`ใส่ EXP/ล็อตนี้ให้ทุกรายการที่สแกนแล้วในพาเลทนี้ (${lineCount} รายการ)?
รายการสินค้าเดียวกันจะถูกรวมจำนวน`)) onApplyAll() }}
          className="mt-2 w-full rounded-xl bg-white/70 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
          ↺ ใส่ EXP/ล็อตนี้ให้ทุกรายการในพาเลท ({lineCount})
        </button>
      )}
    </div>
  )
}

function LineSheet({ line, onClose, onSave, onDelete, sameCount, onApplyProduct }: {
  line: Line | null
  onClose: () => void
  onSave: (patch: Partial<Pick<Line, 'qty' | 'unitType' | 'exp' | 'lot'>>) => void
  onDelete: () => void
  sameCount: number // จำนวนรายการของสินค้าเดียวกันในพาเลท
  onApplyProduct: (patch: Partial<Pick<Line, 'qty' | 'unitType' | 'exp' | 'lot'>>) => void
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
          {sameCount > 1 && (
            <button disabled={bad} onClick={() => onApplyProduct({ qty: n, unitType: unit, exp: iso ?? '', lot: lot.trim() })}
              className="mb-2 w-full rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 disabled:opacity-50">
              ↺ ล็อตเดียวกันทั้งสินค้า: ใช้ EXP/ล็อตนี้กับสินค้านี้ทุกรายการในพาเลท ({sameCount})
            </button>
          )}
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
