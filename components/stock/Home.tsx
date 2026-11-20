'use client'

import { useState } from 'react'
import { Logo, Wave, btnGhost, btnPrimary, inputClass } from '@/components/ui'
import type { Employee } from '@/lib/auth'
import type { Catalog } from '@/lib/catalog'
import { todayLabel } from '@/lib/dates'
import { allLines, totalsOf, unitSummary, type Round } from '@/lib/round'

export default function Home({ employee, draft, catalog, catalogError, reloading, onReloadCatalog, onStart, onResume, onLogout }: {
  employee: Employee
  draft: Round | null
  catalog: Catalog | null
  catalogError: string
  reloading: boolean
  onReloadCatalog: () => void
  onStart: (label: string, location: string) => void
  onResume: () => void
  onLogout: () => void
}) {
  const [label, setLabel] = useState(`เช็คสต็อก ${todayLabel()}`)
  const [location, setLocation] = useState('')
  const draftTotals = draft ? totalsOf(allLines(draft)) : null

  return (
    <div className="min-h-dvh bg-slate-50 pb-28">
      <header className="brand-gradient pt-safe relative text-white">
        <div className="flex items-center gap-3 px-5 pt-4">
          <Logo size={44} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-white/80">สวัสดี</div>
            <div className="truncate font-semibold">{employee.name}</div>
          </div>
          <button onClick={onLogout} className="rounded-full bg-white/15 px-3 py-1.5 text-xs">ออกจากระบบ</button>
        </div>
        <div className="px-5 pt-5 pb-10">
          <h1 className="text-2xl leading-tight font-semibold">เช็คสต็อกพาเลท</h1>
          <p className="text-sm text-white/85">สแกนนับทุกชิ้น แยกล็อต/EXP แล้วส่งสรุปเข้า LINE</p>
        </div>
        <Wave className="absolute right-0 bottom-[-1px] left-0 text-slate-50" />
      </header>

      <div className="mx-auto flex max-w-lg flex-col gap-4 bg-slate-50 px-4 pt-2">
        {draft && draftTotals && (
          <div className="rounded-3xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <div className="text-xs font-medium text-amber-700">มีรอบที่ยังไม่จบ</div>
            <div className="text-lg font-semibold text-slate-900">{draft.label}</div>
            <div className="text-sm text-slate-600">{draft.pallets.length} พาเลท · {draftTotals.lines} รายการ · {unitSummary(draftTotals)}</div>
            <button onClick={onResume} className={`${btnPrimary} mt-3 w-full`}>ทำต่อ ›</button>
          </div>
        )}

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold">เริ่มรอบเช็คใหม่</h2>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">ชื่อรอบ</span>
            <input value={label} onChange={e => setLabel(e.target.value)} className={inputClass} />
          </label>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">สถานที่ / โซน (ไม่บังคับ)</span>
            <input value={location} onChange={e => setLocation(e.target.value)} className={inputClass} placeholder="เช่น คลัง A โซน 3" />
          </label>
          <button disabled={!label.trim()}
            onClick={() => { if (!draft || confirm('มีรอบที่ยังไม่จบอยู่ เริ่มรอบใหม่จะลบรอบเดิมที่ยังไม่บันทึก ยืนยัน?')) onStart(label.trim(), location.trim()) }}
            className={`${btnPrimary} mt-4 w-full py-4 text-base`}>
            📷 เริ่มสแกน
          </button>
        </div>

        <div className="rounded-3xl bg-white p-4 text-sm ring-1 ring-slate-200">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-800">ฐานข้อมูลสินค้าในเครื่อง</div>
              <div className="text-xs text-slate-500">
                {catalog
                  ? `${catalog.products.length.toLocaleString()} รายการ · อัปเดต ${new Date(catalog.loadedAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : catalogError ? <span className="text-red-600">{catalogError}</span> : 'กำลังโหลด…'}
              </div>
            </div>
            <button onClick={onReloadCatalog} disabled={reloading} className={`${btnGhost} px-3 py-2 text-xs`}>
              {reloading ? '⏳' : '🔄 โหลดใหม่'}
            </button>
          </div>
          <p className="mt-3 rounded-2xl bg-brand-50 px-3 py-2 text-xs leading-relaxed text-brand-900">
            💡 ใช้ปืนสแกนบลูทูธได้: จับคู่ปืนกับมือถือ (โหมดคีย์บอร์ด) แล้วยิงได้เลยในหน้าสแกน
          </p>
        </div>
      </div>
    </div>
  )
}
