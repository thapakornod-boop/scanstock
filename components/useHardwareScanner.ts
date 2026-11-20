'use client'

// รองรับปืนสแกนบลูทูธ/USB (โหมดคีย์บอร์ด): ปืนพิมพ์ตัวอักษรรัวมากแล้วกด Enter
// แยกจากคนพิมพ์ด้วยความเร็วระหว่างตัวอักษร ถ้าโฟกัสอยู่ในช่องพิมพ์จะไม่ดักจับ

import { useEffect, useRef } from 'react'

const MAX_GAP_MS = 60

export function useHardwareScanner(onScan: (code: string) => void, enabled: boolean) {
  const cb = useRef(onScan)
  useEffect(() => { cb.current = onScan }, [onScan])

  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let lastAt = 0
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const now = Date.now()
      if (now - lastAt > MAX_GAP_MS) buf = ''
      lastAt = now
      if (e.key === 'Enter') {
        if (buf.length >= 4) { cb.current(buf); e.preventDefault() }
        buf = ''
      } else if (e.key.length === 1) {
        buf += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
