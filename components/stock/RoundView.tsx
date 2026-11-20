'use client'

import { useRef, useState } from 'react'
import { Sheet, btnGhost, btnLine, btnPrimary, inputClass } from '@/components/ui'
import type { Employee } from '@/lib/auth'
import { UNIT_LABEL } from '@/lib/catalog'
import { formatThaiDate } from '@/lib/dates'
import { resizeToBase64 } from '@/lib/readLabel'
import { allLines, isNearExpiry, lineSummaryText, roundCsv, saveRound, shareToLine, totalsOf, unitSummary, type Pallet, type Round } from '@/lib/round'
import { createClient } from '@/lib/supabase'

type Toast = (text: string, kind?: 'ok' | 'error' | 'info') => void

export function RoundView({ round, onChange, onOpenPallet, onAddPallet, onFinish, onExit, onDiscard, toast }: {
  round: Round
  onChange: (r: Round) => void
  onOpenPallet: (id: string) => void
  onAddPallet: () => void
  onFinish: () => void
  onExit: () => void
  onDiscard: () => void
  toast: Toast
}) {
  const [menuFor, setMenuFor] = useState<Pallet | null>(null)
  const t = totalsOf(allLines(round))

  const updatePallet = (p: Pallet) => onChange({ ...round, pallets: round.pallets.map(x => (x.id === p.id ? p : x)) })

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-slate-50">
      <header className="brand-gradient pt-safe text-white">
        <div className="flex items-center gap-3 px-4 pt-3">
          <button onClick={onExit} className="rounded-full bg-white/15 px-3 py-1.5 text-sm">‹ หน้าหลัก</button>
          <span className="ml-auto text-xs text-white/80">บันทึกร่างอัตโนมัติ ✓</span>
        </div>
        <div className="px-5 pt-3 pb-8">
          <div className="text-xs text-white/80">รอบเช็ค</div>
          <h1 className="text-2xl leading-tight font-semibold">{round.label}</h1>
          {round.location && <div className="text-sm text-white/85">📍 {round.location}</div>}
          <div className="mt-3 flex gap-2 text-sm">
            <span className="rounded-full bg-white/15 px-3 py-1">{round.pallets.length} พาเลท</span>
            <span className="rounded-full bg-white/15 px-3 py-1">{t.lines} รายการ</span>
            <span className="rounded-full bg-white/15 px-3 py-1">{unitSummary(t)}</span>
          </div>
        </div>
      </header>

      <div className="-mt-4 flex flex-1 flex-col gap-3 rounded-t-[28px] bg-slate-50 p-4 pb-40">
        <button onClick={onAddPallet} className={`${btnPrimary} w-full py-4 text-base`}>＋ เริ่มสแกนพาเลทใหม่</button>

        {round.pallets.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">ยังไม่มีพาเลท กดปุ่มด้านบนเพื่อเริ่มสแกน</p>
        )}
        {[...round.pallets].reverse().map(p => {
          const pt = totalsOf(p.lines)
          const near = p.lines.filter(isNearExpiry).length
          const unknown = p.lines.filter(l => l.unknown).length
          return (
            <div key={p.id} className="flex items-stretch overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
              <button onClick={() => onOpenPallet(p.id)} className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left active:bg-slate-50">
                {p.photoUrl
                  ? <img src={p.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" />
                  : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-2xl">📦</div>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-900">{p.label}</div>
                  <div className="text-sm text-slate-500">{pt.lines} รายการ · {unitSummary(pt)}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    {near > 0 && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-600">⚠️ ใกล้หมดอายุ {near}</span>}
                    {unknown > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">ไม่พบในระบบ {unknown}</span>}
                  </div>
                </div>
              </button>
              <button onClick={() => setMenuFor(p)} className="px-4 text-xl text-slate-400 active:bg-slate-50">⋯</button>
            </div>
          )
        })}

        <button onClick={() => { if (confirm('ยกเลิกรอบนี้? ข้อมูลที่สแกนไว้ทั้งหมดจะถูกลบ')) onDiscard() }}
          className="mt-4 self-center text-sm text-slate-400 underline">ยกเลิกรอบนี้</button>
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-slate-50 via-slate-50 to-slate-50/0 px-4 pt-6">
        <button onClick={onFinish} disabled={t.lines === 0} className={`${btnLine} w-full py-4 text-base`}>
          ✓ จบรอบ · บันทึกและส่ง LINE
        </button>
      </div>

      <PalletMenu pallet={menuFor} onClose={() => setMenuFor(null)} toast={toast}
        onSave={p => { updatePallet(p); setMenuFor(null) }}
        onDelete={() => {
          if (!menuFor) return
          onChange({ ...round, pallets: round.pallets.filter(x => x.id !== menuFor.id) })
          setMenuFor(null)
        }} />
    </div>
  )
}

function PalletMenu({ pallet, onClose, onSave, onDelete, toast }: {
  pallet: Pallet | null
  onClose: () => void
  onSave: (p: Pallet) => void
  onDelete: () => void
  toast: Toast
}) {
  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [openedFor, setOpenedFor] = useState<Pallet | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  if (pallet && openedFor !== pallet) { setOpenedFor(pallet); setLabel(pallet.label) }
  if (!pallet && openedFor) setOpenedFor(null)

  const onPhoto = async (file: File | undefined) => {
    if (!file || !pallet) return
    setUploading(true)
    try {
      const b64 = await resizeToBase64(file)
      const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob()
      const supabase = createClient()
      const name = `pallet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`
      const { data, error } = await supabase.storage.from('pallet-photos').upload(name, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      const url = supabase.storage.from('pallet-photos').getPublicUrl(data.path).data.publicUrl
      onSave({ ...pallet, label: label.trim() || pallet.label, photoUrl: url })
      toast('บันทึกรูปพาเลทแล้ว')
    } catch (err) {
      toast(`อัปโหลดรูปไม่สำเร็จ: ${(err as Error).message}`, 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Sheet open={!!pallet} onClose={onClose} title="จัดการพาเลท">
      {pallet && (
        <>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">ชื่อพาเลท</span>
          <input value={label} onChange={e => setLabel(e.target.value)} className={inputClass} />
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className={`${btnGhost} mt-3 w-full`}>
            {uploading ? '⏳ กำลังอัปโหลด…' : pallet.photoUrl ? '📷 เปลี่ยนรูปพาเลท' : '📷 ถ่ายรูปพาเลท'}
          </button>
          <div className="mt-5 mb-2 flex gap-2">
            <button onClick={() => { if (confirm(`ลบ ${pallet.label} และรายการทั้งหมดในพาเลทนี้?`)) onDelete() }}
              className={`${btnGhost} bg-red-50 text-red-600`}>ลบพาเลท</button>
            <button onClick={() => onSave({ ...pallet, label: label.trim() || pallet.label })} className={`${btnPrimary} flex-1`}>บันทึก</button>
          </div>
        </>
      )}
    </Sheet>
  )
}

// ── จบรอบ: สรุป → บันทึก → ส่ง LINE ──
export function FinishView({ round, employee, onBack, onSaved, onNewRound, toast }: {
  round: Round
  employee: Employee
  onBack: () => void
  onSaved: () => void // ล้างร่างหลังบันทึกสำเร็จ
  onNewRound: () => void
  toast: Toast
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const t = totalsOf(allLines(round))
  const near = allLines(round).filter(isNearExpiry)
  const unknown = allLines(round).filter(l => l.unknown)
  const text = lineSummaryText(round, employee)

  const save = async () => {
    setSaving(true); setSaveError('')
    try {
      const n = await saveRound(round, employee)
      setSaved(true)
      onSaved()
      toast(`บันทึกแล้ว ${n} รายการ`)
      return true
    } catch (err) {
      setSaveError((err as Error).message)
      toast('บันทึกไม่สำเร็จ ข้อมูลยังอยู่ในเครื่อง', 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveAndShare = async () => {
    if (saved || await save()) shareToLine(text)
  }

  const shareCsv = async () => {
    const file = new File([roundCsv(round, employee)], `${round.label.replace(/\s+/g, '_')}.csv`, { type: 'text/csv' })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: round.label }) } catch {}
    } else {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(file); a.download = file.name; a.click()
      URL.revokeObjectURL(a.href)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('คัดลอกข้อความแล้ว') } catch { toast('คัดลอกไม่สำเร็จ', 'error') }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-slate-50">
      <header className="brand-gradient pt-safe text-white">
        <div className="flex items-center px-4 pt-3">
          {!saved && <button onClick={onBack} className="rounded-full bg-white/15 px-3 py-1.5 text-sm">‹ กลับไปสแกนต่อ</button>}
        </div>
        <div className="px-5 pt-3 pb-8">
          <div className="text-xs text-white/80">{saved ? '✅ บันทึกเรียบร้อย' : 'สรุปก่อนบันทึก'}</div>
          <h1 className="text-2xl font-semibold">{round.label}</h1>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat n={round.pallets.filter(p => p.lines.length).length} label="พาเลท" />
            <Stat n={t.lines} label="รายการ" />
            <Stat n={t.scans} label="ชิ้น/แพ็ค/ลัง" />
          </div>
        </div>
      </header>

      <div className="-mt-4 flex flex-1 flex-col gap-3 rounded-t-[28px] bg-slate-50 p-4 pb-56">
        {near.length > 0 && <Alert tone="orange">⚠️ หมดอายุ/ใกล้หมดอายุ {near.length} รายการ</Alert>}
        {unknown.length > 0 && <Alert tone="red">❓ บาร์โค้ดไม่พบในระบบ {unknown.length} รายการ</Alert>}
        {saveError && <Alert tone="red">บันทึกไม่สำเร็จ: {saveError}</Alert>}

        {round.pallets.filter(p => p.lines.length).map(p => (
          <details key={p.id} className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200" open={round.pallets.length <= 2}>
            <summary className="flex cursor-pointer items-center gap-3 p-4">
              <span className="text-xl">📦</span>
              <div className="flex-1">
                <div className="font-semibold">{p.label}</div>
                <div className="text-sm text-slate-500">{p.lines.length} รายการ · {unitSummary(totalsOf(p.lines))}</div>
              </div>
            </summary>
            {p.lines.map(l => (
              <div key={l.key} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm ${l.unknown ? 'text-red-600' : ''}`}>{l.name}</div>
                  <div className="text-xs text-slate-500">
                    {l.exp ? `EXP ${formatThaiDate(l.exp)}` : 'ไม่ระบุ EXP'}{l.lot && ` · ล็อต ${l.lot}`}
                  </div>
                </div>
                <div className="font-semibold">{l.qty} <span className="text-xs font-normal text-slate-500">{UNIT_LABEL[l.unitType]}</span></div>
              </div>
            ))}
          </details>
        ))}
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg flex-col gap-2 bg-gradient-to-t from-slate-50 via-slate-50 to-slate-50/0 px-4 pt-6">
        {!saved ? (
          <>
            <button onClick={saveAndShare} disabled={saving} className={`${btnLine} w-full py-4 text-base`}>
              {saving ? '⏳ กำลังบันทึก…' : '💾 บันทึก และส่งเข้า LINE'}
            </button>
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className={`${btnGhost} flex-1`}>บันทึกอย่างเดียว</button>
              {saveError && <button onClick={() => shareToLine(text)} className={`${btnGhost} flex-1`}>ส่ง LINE อย่างเดียว</button>}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => shareToLine(text)} className={`${btnLine} w-full py-4 text-base`}>💬 ส่งเข้า LINE อีกครั้ง</button>
            <div className="flex gap-2">
              <button onClick={shareCsv} className={`${btnGhost} flex-1`}>📄 ไฟล์ CSV</button>
              <button onClick={copy} className={`${btnGhost} flex-1`}>📋 คัดลอก</button>
            </div>
            <button onClick={onNewRound} className={`${btnPrimary} w-full`}>เริ่มรอบเช็คใหม่</button>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white/15 py-2">
      <div className="text-2xl font-bold">{n.toLocaleString()}</div>
      <div className="text-[11px] text-white/85">{label}</div>
    </div>
  )
}

function Alert({ tone, children }: { tone: 'orange' | 'red'; children: React.ReactNode }) {
  const c = tone === 'orange' ? 'bg-orange-50 text-orange-700 ring-orange-200' : 'bg-red-50 text-red-700 ring-red-200'
  return <div className={`rounded-2xl px-4 py-3 text-sm font-medium ring-1 ${c}`}>{children}</div>
}
