'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Scanner, { type CaptureFrame } from '@/components/Scanner'
import { useHardwareScanner } from '@/components/useHardwareScanner'
import { DateField, ExpiryBadge, Sheet, btnGhost, btnPrimary, inputClass } from '@/components/ui'
import { cleanCode, searchProducts, UNIT_LABEL, type Catalog, type Product, type UnitType } from '@/lib/catalog'
import { formatThaiDate, parseThaiDate } from '@/lib/dates'
import { feedback } from '@/lib/feedback'
import { readLabelImage } from '@/lib/readLabel'
import { addToPallet, removeLine, setBatchForLines, totalsOf, unitSummary, updateLine, type Batch, type Line, type Pallet } from '@/lib/round'

// หา EXP จากกล้อง: 2 ตัวอ่านทำงานสลับกันโดยไม่พัก ได้ผลใหม่เกือบทุกวินาที
const SEEK_MS = 15000
const SEEK_WORKERS = 2
const SEEK_STAGGER_MS = 700
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type ScanItem = { product: Product | null; barcode: string; unitType: UnitType }
// สินค้าใหม่ที่กำลังกรอกทีละขั้น: ① สแกนแล้ว → ② EXP → ③ ล็อต
type Pending = ScanItem & { id: number; step: 'exp' | 'lot' }
type SeekState = 'idle' | 'seeking' | 'found' | 'timeout'

type Props = {
  pallet: Pallet
  catalog: Catalog | null
  onChange: (p: Pallet) => void
  onDone: () => void
  toast: (text: string, kind?: 'ok' | 'error' | 'info') => void
}

// ล็อตที่เพิ่งใช้ จำไว้ในเครื่อง เพื่อเสนอให้แตะเลือกครั้งต่อไป
const RECENT_LOTS_KEY = 'rsm_recent_lots'
function loadRecentLots(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_LOTS_KEY) || '[]') } catch { return [] }
}
function rememberLot(lot: string) {
  const list = [lot, ...loadRecentLots().filter(l => l !== lot)].slice(0, 8)
  try { localStorage.setItem(RECENT_LOTS_KEY, JSON.stringify(list)) } catch {}
}
const byNewest = (a: Line, b: Line) => b.updatedAt - a.updatedAt

// รายการล่าสุดของสินค้านี้ในพาเลท (ใช้ EXP/ล็อตเดิมเมื่อสแกนซ้ำ)
const latestLineOf = (p: Pallet, itemCode: string) =>
  p.lines.filter(l => l.itemCode === itemCode).sort(byNewest)[0]

export default function PalletScan({ pallet, catalog, onChange, onDone, toast }: Props) {
  const [cameraOn, setCameraOn] = useState(true)
  const [flash, setFlash] = useState<'ok' | 'error' | null>(null)
  const [lastKey, setLastKey] = useState<string | null>(null)
  const [pulse, setPulse] = useState(0)
  const [manual, setManual] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [editing, setEditing] = useState<Line | null>(null)
  const [renaming, setRenaming] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const [pending, setPending] = useState<Pending | null>(null)
  const [expText, setExpText] = useState('')
  const [lotText, setLotText] = useState('')
  const [recentLots, setRecentLots] = useState<string[]>([])
  const [seek, setSeek] = useState<SeekState>('idle')
  const [seekRaw, setSeekRaw] = useState('')
  const seekIdRef = useRef(0) // ตัวอ่านที่ id ไม่ตรงจะหยุดเอง
  const captureRef = useRef<CaptureFrame | null>(null)
  const pendingIdRef = useRef(0)

  // ใช้ ref เพื่อให้สแกนรัวๆ แล้วอ่านพาเลทล่าสุดเสมอ (ไม่ตกหล่นระหว่าง re-render)
  const palletRef = useRef(pallet)
  useEffect(() => { palletRef.current = pallet }, [pallet])
  useEffect(() => () => { seekIdRef.current = -1 }, [])

  const add = useCallback((item: ScanItem, batch: Batch) => {
    const next = addToPallet(palletRef.current, item, batch)
    const line = next.lines[0]
    palletRef.current = next
    onChange(next)
    setLastKey(line.key)
    setPulse(n => n + 1)
    feedback(item.product ? 'ok' : 'error')
    setFlash(item.product ? 'ok' : 'error')
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 250)
  }, [onChange])

  const stopSeek = () => { seekIdRef.current = 0 }

  // ② อ่าน EXP จากกล้องตัวเดียวกันเรื่อยๆ จนเจอ แล้วไปขั้นล็อตเอง
  const startSeek = useCallback((pendingId: number) => {
    const id = Date.now()
    seekIdRef.current = id
    setSeek('seeking'); setSeekRaw('')
    const until = Date.now() + SEEK_MS
    const worker = async (delay: number) => {
      await sleep(delay)
      while (seekIdRef.current === id && Date.now() < until) {
        const image = captureRef.current?.()
        if (!image) { await sleep(300); continue }
        try {
          const d = await readLabelImage(image)
          if (seekIdRef.current !== id || pendingIdRef.current !== pendingId) return
          if (d.exp) {
            seekIdRef.current = 0
            setExpText(formatThaiDate(d.exp))
            setSeekRaw(d.raw ?? '')
            setSeek('found')
            feedback('new')
            setPending(p => (p && p.id === pendingId ? { ...p, step: 'lot' } : p))
            return
          }
        } catch (err) {
          if (/โควต้า/.test((err as Error).message)) {
            if (seekIdRef.current === id) { seekIdRef.current = 0; setSeek('timeout'); toast('อ่าน EXP เกินโควต้า พิมพ์เองไปก่อน', 'error') }
            return
          }
          await sleep(500)
        }
      }
      if (seekIdRef.current === id) { seekIdRef.current = 0; setSeek('timeout') }
    }
    for (let i = 0; i < SEEK_WORKERS; i++) worker(i * SEEK_STAGGER_MS)
  }, [toast])

  // ① สแกนเจอสินค้าใหม่ (หรือกด "คนละล็อต") → เริ่มขั้น EXP
  const startWizard = useCallback((item: ScanItem) => {
    const id = ++pendingIdRef.current
    setPending({ ...item, id, step: 'exp' })
    setExpText(''); setLotText('')
    setRecentLots(loadRecentLots())
    feedback('new')
    startSeek(id)
  }, [startSeek])

  const handleCode = useCallback((raw: string) => {
    const code = cleanCode(raw)
    if (!code) return
    const hit = catalog?.byCode.get(code)
    const item: ScanItem = hit ? { product: hit.product, barcode: code, unitType: hit.unitType } : { product: null, barcode: code, unitType: 'piece' }
    const known = latestLineOf(palletRef.current, item.product?.item_code ?? code)
    // สินค้าที่มีในพาเลทแล้ว → นับ +1 เข้าล็อตล่าสุดของสินค้านั้นทันที
    if (known) add(item, { exp: known.exp, lot: known.lot })
    else startWizard(item)
  }, [catalog, add, startWizard])

  useHardwareScanner(handleCode, !pending && !editing && !renaming)

  const cancelWizard = () => { stopSeek(); setPending(null); setSeek('idle') }
  const expIso = parseThaiDate(expText)
  const expBad = expText !== '' && !expIso
  const goLot = (noExp: boolean) => {
    if (!pending) return
    stopSeek()
    if (noExp) setExpText('')
    setPending({ ...pending, step: 'lot' })
  }
  const confirmWizard = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!pending) return
    const lot = lotText.trim() // ไม่บังคับกรอก
    add(pending, { exp: expIso ?? '', lot })
    if (lot) rememberLot(lot)
    if (!pending.product) toast(`บาร์โค้ด ${pending.barcode} ไม่พบในระบบ — นับเป็น "ไม่พบในระบบ"`, 'error')
    setPending(null); setSeek('idle')
  }

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
  const pickProduct = (p: Product) => {
    setResults([]); setManual('')
    handleCode(p.barcode_piece || p.item_code)
  }

  // ตัวเลือกล็อต: ล็อตของสินค้านี้ก่อน → ล็อตอื่นในพาเลท → ล็อตที่เพิ่งใช้ในเครื่อง
  const pendingCode = pending ? (pending.product?.item_code ?? pending.barcode) : ''
  const lotSuggestions = pending
    ? [...new Set([
        ...pallet.lines.filter(l => l.itemCode === pendingCode && l.lot).sort(byNewest).map(l => l.lot),
        ...pallet.lines.filter(l => l.lot).sort(byNewest).map(l => l.lot),
        ...recentLots,
      ])].slice(0, 4)
    : []

  const totals = totalsOf(pallet.lines)
  const last = pallet.lines.find(l => l.key === lastKey) ?? null
  const newLotFor = (l: Line) =>
    startWizard({ product: catalog?.byCode.get(l.barcode)?.product ?? null, barcode: l.barcode, unitType: l.unitType })

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
        <Steps step={pending ? (pending.step === 'exp' ? 2 : 3) : 1} />
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3 pb-28">
        {cameraOn && (
          <Scanner onDetect={handleCode} paused={!!pending || !!editing || renaming} flash={flash} captureRef={captureRef}
            overlay={pending?.step === 'exp' && seek === 'seeking' && (
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-full bg-amber-400/95 px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg">
                <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-slate-900" />
                🔍 หันกล้องไปที่วันหมดอายุ…
              </div>
            )} />
        )}

        {/* ② วันหมดอายุ */}
        {pending?.step === 'exp' && (
          <div className="rounded-3xl bg-white p-4 shadow-sm ring-2 ring-amber-300">
            <WizardTitle no={2} title="วันหมดอายุ (EXP)" item={pending} />
            <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {seek === 'seeking' && '🔍 กำลังอ่าน EXP จากกล้อง… พลิกสินค้าให้กล้องเห็นวันหมดอายุ'}
              {seek === 'timeout' && (
                <span className="flex items-center justify-between gap-2">
                  ยังหาไม่เจอ — พิมพ์เอง หรือกด “ไม่มี EXP”
                  {cameraOn && (
                    <button onClick={() => startSeek(pending.id)}
                      className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-amber-300">ลองอีกครั้ง</button>
                  )}
                </span>
              )}
              {seek === 'idle' && 'พิมพ์วันหมดอายุ หรือกด “ไม่มี EXP”'}
              {seek === 'found' && `✅ อ่านได้ “${seekRaw}”`}
            </div>
            <div className="mt-3">
              <DateField value={expText} onChange={setExpText} placeholder="EXP วว/ดด/ปปปป"
                onFocus={() => { stopSeek(); setSeek('idle') }} />
              <div className="mt-1 min-h-5 text-sm">
                {expBad ? <span className="text-red-600">วันที่ยังไม่ครบหรือไม่ถูกต้อง</span> : <ExpiryBadge iso={expIso} />}
              </div>
            </div>
            <div className="mt-1 flex gap-2">
              <button onClick={() => goLot(true)} className={`${btnGhost} flex-1`}>ไม่มี EXP</button>
              <button onClick={() => goLot(false)} disabled={!expIso} className={`${btnPrimary} flex-[2]`}>ถัดไป ›</button>
            </div>
            <button onClick={cancelWizard} className="mt-3 w-full text-center text-sm text-slate-400 underline">ยกเลิก (ไม่นับชิ้นนี้)</button>
          </div>
        )}

        {/* ③ ล็อต (ไม่บังคับ) */}
        {pending?.step === 'lot' && (
          <form onSubmit={confirmWizard} className="rounded-3xl bg-white p-4 shadow-sm ring-2 ring-brand-400">
            <WizardTitle no={3} title="ล็อต / Lot no. (ถ้ามี)" item={pending} />
            <button type="button" onClick={() => setPending({ ...pending, step: 'exp' })}
              className="mt-3 flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-left text-sm">
              <span>EXP: <b>{expIso ? formatThaiDate(expIso) : 'ไม่มี EXP'}</b> {expIso && <ExpiryBadge iso={expIso} />}</span>
              <span className="text-xs text-brand-600">แก้</span>
            </button>
            {/* ล็อตที่เคยใช้: แตะเพื่อเติมให้เลย */}
            {lotSuggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {lotSuggestions.map((lot, i) => (
                  <button key={lot} type="button" onClick={() => setLotText(lot)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${lotText.trim() === lot
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : 'bg-brand-50 text-brand-700 ring-brand-100'}`}>
                    {i === 0 ? `ใช้ล็อตเดิม: ${lot}` : lot}
                  </button>
                ))}
              </div>
            )}
            <input value={lotText} onChange={e => setLotText(e.target.value)} placeholder="กรอกเลขล็อต (ไม่บังคับ)"
              enterKeyHint="done" autoCapitalize="characters" className={`${inputClass} mt-3 text-lg`} />
            <button type="submit" className={`${btnPrimary} mt-3 w-full py-4 text-base`}>
              ✓ บันทึก แล้วสแกนต่อ
            </button>
            <button type="button" onClick={cancelWizard} className="mt-3 w-full text-center text-sm text-slate-400 underline">ยกเลิก (ไม่นับชิ้นนี้)</button>
          </form>
        )}

        {/* ① สแกน: ชิ้นล่าสุด + พิมพ์บาร์โค้ด */}
        {!pending && (
          <>
            {last && (
              <div key={pulse} className={`pop rounded-2xl bg-white p-3 shadow-sm ring-1 ${last.unknown ? 'ring-red-300' : 'ring-emerald-200'}`}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-slate-500">ล่าสุด</div>
                    <div className={`truncate font-semibold ${last.unknown ? 'text-red-600' : 'text-slate-900'}`}>{last.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {last.exp ? `EXP ${formatThaiDate(last.exp)}` : 'ไม่มี EXP'} · ล็อต {last.lot || '-'}
                    </div>
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
                <button onClick={() => newLotFor(last)}
                  className="mt-2 w-full rounded-xl bg-amber-50 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                  + สินค้านี้แต่คนละล็อต / EXP
                </button>
              </div>
            )}

            <form onSubmit={submitManual} className="flex gap-2">
              <input value={manual} onChange={e => setManual(e.target.value)} placeholder="พิมพ์บาร์โค้ด หรือชื่อสินค้า"
                className={`${inputClass} bg-white py-2.5`} enterKeyHint="go" />
              <button className={`${btnPrimary} shrink-0 px-4 py-2.5`}>เพิ่ม</button>
            </form>
            {results.length > 0 && (
              <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                {results.map(p => (
                  <button key={p.item_code} onClick={() => pickProduct(p)}
                    className="block w-full border-b border-slate-100 px-4 py-2.5 text-left last:border-0 active:bg-brand-50">
                    <div className="text-sm font-medium">{p.item_name}</div>
                    <div className="text-xs text-slate-500">{p.item_code} · {p.brand} · {p.size}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* รายการในพาเลท */}
        <div className="flex items-center justify-between px-1 pt-1">
          <h3 className="font-semibold text-slate-800">ในพาเลทนี้ ({totals.lines})</h3>
          <span className="text-xs text-slate-500">แตะรายการเพื่อแก้ไข</span>
        </div>
        {pallet.lines.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            เริ่มสแกนได้เลย<br />สินค้าใหม่: สแกน → EXP → ล็อต (ถ้ามี) · สแกนซ้ำ = นับ +1
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            {pallet.lines.map(l => <LineRow key={l.key} line={l} highlight={l.key === lastKey} onClick={() => setEditing(l)} />)}
          </div>
        )}
      </div>

      {!pending && (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-slate-50 via-slate-50 to-slate-50/0 px-3 pt-6">
          <button onClick={onDone} className={`${btnPrimary} w-full py-4 text-base`}>✓ เสร็จพาเลทนี้</button>
        </div>
      )}

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

const STEP_LABELS = ['สแกนบาร์โค้ด', 'วันหมดอายุ', 'ล็อต']

function Steps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex gap-1.5 px-4 pb-3">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'now' : 'next'
        return (
          <div key={label} className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1 text-xs ${
            state === 'now' ? 'bg-white font-semibold text-brand-700' : state === 'done' ? 'bg-white/25 text-white' : 'bg-white/10 text-white/60'}`}>
            <span>{state === 'done' ? '✓' : n}</span>{label}
          </div>
        )
      })}
    </div>
  )
}

function WizardTitle({ no, title, item }: { no: number; title: string; item: ScanItem }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{no}</span>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      </div>
      <div className={`mt-2 truncate font-medium ${item.product ? 'text-slate-800' : 'text-red-600'}`}>
        {item.product?.item_name ?? `ไม่พบในระบบ (${item.barcode})`}
      </div>
      <div className="text-xs text-slate-500">{item.product?.item_code ?? item.barcode} · {UNIT_LABEL[item.unitType]}</div>
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
