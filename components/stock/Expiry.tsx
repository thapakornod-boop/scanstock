'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExpiryBadge, btnGhost } from '@/components/ui'
import { daysLeft, EXPIRY_WARN_DAYS, EXPIRY_WATCH_DAYS, formatThaiDate } from '@/lib/dates'
import { createClient } from '@/lib/supabase'

type Row = { item_code: string; product_name: string; unit: string; exp_at: string; qty: number }
type Filter = 'all' | 'expired' | '30' | '90'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'expired', label: 'หมดแล้ว' },
  { key: '30', label: `≤ ${EXPIRY_WARN_DAYS} วัน` },
  { key: '90', label: `≤ ${EXPIRY_WATCH_DAYS} วัน` },
]

const inFilter = (d: number, f: Filter) =>
  f === 'all' ? true : f === 'expired' ? d < 0 : f === '30' ? d >= 0 && d <= EXPIRY_WARN_DAYS : d >= 0 && d <= EXPIRY_WATCH_DAYS

export default function Expiry({ toast }: { toast: (t: string, k?: 'ok' | 'error' | 'info') => void }) {
  const [rows, setRows] = useState<(Row & { days: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('30')

  const fetchRows = useCallback(async () => {
    const { data, error } = await createClient().from('expiry_watch').select('*').order('exp_at').limit(500)
    if (error) toast(`โหลดไม่สำเร็จ: ${error.message}`, 'error')
    return ((data as Row[]) ?? []).map(r => ({ ...r, days: daysLeft(r.exp_at) }))
  }, [toast])

  const apply = (list: (Row & { days: number })[]) => { setRows(list); setLoading(false) }
  const load = () => { setLoading(true); fetchRows().then(apply) }

  useEffect(() => {
    let alive = true
    fetchRows().then(list => { if (alive) apply(list) })
    return () => { alive = false }
  }, [fetchRows])

  const shown = rows.filter(r => inFilter(r.days, filter))

  return (
    <div className="mx-auto max-w-lg px-4 pt-safe pb-28">
      <div className="flex items-center justify-between pt-5 pb-1">
        <h1 className="text-2xl font-semibold text-slate-900">สินค้าใกล้หมดอายุ</h1>
        <button onClick={load} className={`${btnGhost} bg-white/70 px-3 py-2 text-xs`}>🔄</button>
      </div>
      <p className="pb-3 text-sm text-slate-700">จากทุกรอบที่บันทึกของทุกคน</p>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${filter === f.key ? 'bg-brand-600 text-white' : 'bg-white/80 text-slate-700'}`}>
            {f.label} ({rows.filter(r => inFilter(r.days, f.key)).length})
          </button>
        ))}
      </div>
      {loading ? <p className="py-10 text-center text-slate-500">กำลังโหลด…</p>
        : shown.length === 0 ? <p className="py-10 text-center text-slate-500">ไม่มีรายการ</p>
        : (
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
            {shown.map(r => (
              <div key={`${r.item_code}|${r.unit}|${r.exp_at}`} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.product_name}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {r.item_code} · EXP {formatThaiDate(r.exp_at)} <ExpiryBadge iso={r.exp_at} />
                  </div>
                </div>
                <div className="font-semibold">{r.qty} <span className="text-xs font-normal text-slate-500">{r.unit}</span></div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
