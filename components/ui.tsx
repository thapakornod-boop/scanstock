'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { daysLeft, expiryStatus, formatDateDigits, type ExpiryTone } from '@/lib/dates'

export function Logo({ size = 48 }: { size?: number }) {
  return (
    <div className="relative flex shrink-0 items-center justify-center rounded-full bg-brand-500 text-white ring-4 ring-white shadow-lg"
      style={{ width: size, height: size }}>
      <span className="font-semibold tracking-tight" style={{ fontSize: size * 0.32 }}>RSM</span>
      <span className="absolute font-medium" style={{ fontSize: size * 0.09, right: size * 0.1, writingMode: 'vertical-rl' }}>GROUP</span>
    </div>
  )
}

export function Bubbles() {
  return (
    <>
      <div className="bubble bubble-float bg-white/45" style={{ width: 160, height: 160, top: '8%', left: '-40px' }} />
      <div className="bubble bg-blue-500/25" style={{ width: 60, height: 60, top: '52%', left: '6%' }} />
      <div className="bubble bubble-float bg-blue-500/35" style={{ width: 260, height: 260, top: '-80px', right: '-90px', animationDelay: '-3s' }} />
      <div className="bubble bg-white/40" style={{ width: 70, height: 70, top: '42%', right: '8%' }} />
      <div className="bubble bubble-float bg-white/30" style={{ width: 200, height: 200, bottom: '-60px', right: '10%', animationDelay: '-5s' }} />
    </>
  )
}

// ขอบหยักแบบคลื่นใต้แถบไล่สี
export function Wave({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 24" preserveAspectRatio="none" className={`block h-6 w-full ${className}`}>
      <path d="M0 24 V12 Q25 0 50 12 T100 12 T150 12 T200 12 T250 12 T300 12 T350 12 T400 12 V24 Z" fill="currentColor" />
    </svg>
  )
}

export function Sheet({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={onClose}>
      <div className="sheet-in pb-safe max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white px-5 pt-3 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">ปิด</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export type ToastKind = 'ok' | 'error' | 'info'
export function useToast() {
  const [toast, setToast] = useState<{ text: string; kind: ToastKind; id: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = useCallback((text: string, kind: ToastKind = 'ok', ms = 2200) => {
    clearTimeout(timer.current)
    setToast({ text, kind, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), ms)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const node = toast && (
    <div key={toast.id}
      className={`toast-in fixed bottom-[calc(max(env(safe-area-inset-bottom),12px)+84px)] left-1/2 z-[60] w-[calc(100%-32px)] max-w-md -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-sm font-medium text-white shadow-xl ${
        toast.kind === 'ok' ? 'bg-emerald-500' : toast.kind === 'error' ? 'bg-red-500' : 'bg-slate-800'}`}>
      {toast.text}
    </div>
  )
  return { show, node }
}

const TONE_CLASS: Record<ExpiryTone, string> = {
  expired: 'bg-red-50 text-red-600 ring-red-200',
  warn: 'bg-orange-50 text-orange-600 ring-orange-200',
  watch: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  ok: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
}

export function ExpiryBadge({ iso }: { iso: string | null | undefined }) {
  if (!iso) return null
  const s = expiryStatus(daysLeft(iso))
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${TONE_CLASS[s.tone]}`}>{s.label}</span>
}

// ช่องวันที่ วว/ดด/ปปปป ใส่ / ให้เองระหว่างพิมพ์
export function DateField({ value, onChange, placeholder, onFocus, onBlur }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onFocus?: () => void
  onBlur?: () => void
}) {
  return (
    <input type="text" inputMode="numeric" value={value} maxLength={10} onFocus={onFocus} onBlur={onBlur}
      placeholder={placeholder ?? 'วว/ดด/ปปปป'}
      onChange={e => onChange(formatDateDigits(e.target.value))}
      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 tracking-wider outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
  )
}

export const inputClass =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100'

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3.5 font-semibold text-white shadow-lg shadow-brand-600/25 transition active:scale-[0.98] disabled:opacity-50'

export const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 font-medium text-slate-700 transition active:scale-[0.98] disabled:opacity-50'

export const btnLine =
  'inline-flex items-center justify-center gap-2 rounded-2xl bg-line px-5 py-3.5 font-semibold text-white shadow-lg shadow-green-600/25 transition active:scale-[0.98] disabled:opacity-50'
