'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getEmployee, saveEmployee } from '@/lib/auth'
import { Bubbles, Logo, Wave, btnPrimary, inputClass } from '@/components/ui'

const FEATURES = [
  { icon: '📷', text: 'สแกนนับสินค้าทุกชิ้นในพาเลท ไวเหมือนปืนสแกน' },
  { icon: '🗓️', text: 'แยกล็อตและวันหมดอายุ เตือนสินค้าใกล้หมดอายุ' },
  { icon: '💬', text: 'ส่งสรุปผลการเช็คเข้า LINE ได้ทันที' },
]

export default function LoginPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [idCard, setIdCard] = useState('')
  const [showId, setShowId] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (getEmployee()) router.replace('/scan')
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    const id = idCard.replace(/\D/g, '')
    if (!c || !id) { setError('กรุณากรอกรหัสพนักงานและเลขบัตรประชาชน'); return }
    if (id.length !== 13) { setError('เลขบัตรประชาชนต้องมี 13 หลัก'); return }

    setLoading(true); setError('')
    const { data, error: dbError } = await createClient()
      .from('employees')
      .select('employee_id, name')
      .eq('employee_id', c)
      .eq('id_card', id)
      .maybeSingle()
    setLoading(false)

    if (dbError) { setError('ระบบขัดข้อง ไม่สามารถเชื่อมต่อฐานข้อมูลได้'); return }
    if (!data) { setError('รหัสพนักงานหรือเลขบัตรประชาชนไม่ถูกต้อง'); return }
    saveEmployee({ id: data.employee_id, name: data.name })
    router.replace('/scan')
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center p-0 sm:p-6">
      <Bubbles />
      <div className="relative z-10 flex min-h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl shadow-blue-900/20 sm:min-h-0 sm:max-w-5xl sm:flex-row sm:rounded-[28px]">

        {/* แผงไล่สี: บอกว่าระบบนี้คืออะไร */}
        <section className="brand-gradient relative px-7 pt-[max(env(safe-area-inset-top),28px)] pb-10 text-white sm:w-[46%] sm:px-12 sm:py-14">
          <p className="text-sm font-medium tracking-wide text-white/85">RSM GROUP</p>
          <h1 className="mt-2 text-3xl leading-tight font-semibold sm:text-[40px]">
            ระบบเช็คสต็อก<br />พาเลทสินค้า
          </h1>
          <ul className="mt-5 space-y-2.5 text-[15px] text-white/90 sm:mt-7">
            {FEATURES.map(f => (
              <li key={f.text} className="flex gap-2.5"><span>{f.icon}</span><span>{f.text}</span></li>
            ))}
          </ul>
          <div className="mt-8 hidden items-center gap-4 sm:mt-24 sm:flex">
            <Logo size={64} />
            <span className="text-white/90">Pallet Stock Check</span>
          </div>
          {/* คลื่นแนวตั้ง (จอใหญ่) */}
          <svg viewBox="0 0 24 400" preserveAspectRatio="none" className="absolute top-0 right-[-1px] hidden h-full w-6 text-white sm:block">
            <path d="M24 0 H12 Q0 25 12 50 T12 100 T12 150 T12 200 T12 250 T12 300 T12 350 T12 400 H24 Z" fill="currentColor" />
          </svg>
          {/* คลื่นแนวนอน (มือถือ) */}
          <Wave className="absolute right-0 bottom-[-1px] left-0 text-white sm:hidden" />
        </section>

        {/* ฟอร์มเข้าสู่ระบบ */}
        <section className="flex flex-1 flex-col justify-center px-7 py-8 sm:px-16 sm:py-14">
          <div className="mb-6 flex items-center gap-3 sm:hidden">
            <Logo size={44} />
            <span className="text-sm text-slate-500">Pallet Stock Check</span>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">เข้าสู่ระบบ</h2>
          <p className="mt-1 text-sm text-slate-500">กรอกข้อมูลพนักงานเพื่อเข้าใช้งาน</p>

          <form onSubmit={handleLogin} className="mt-7 space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">รหัสพนักงาน</span>
              <input className={inputClass} placeholder="เช่น SDO1234" value={code}
                onChange={e => setCode(e.target.value)} autoComplete="username" autoCapitalize="characters" autoCorrect="off" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">เลขบัตรประชาชน</span>
              <div className="relative">
                <input className={`${inputClass} pr-16`} placeholder="กรอกเลข 13 หลัก" value={idCard}
                  type={showId ? 'text' : 'password'} inputMode="numeric" maxLength={17}
                  onChange={e => setIdCard(e.target.value)} autoComplete="current-password" />
                <button type="button" onClick={() => setShowId(v => !v)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-slate-500">
                  {showId ? 'ซ่อน' : 'แสดง'}
                </button>
              </div>
            </label>

            {error && (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 ring-1 ring-red-100">
                <b className="block">เข้าสู่ระบบไม่สำเร็จ</b>{error}
              </div>
            )}

            <button type="submit" disabled={loading} className={`${btnPrimary} w-full bg-brand-400`}>
              {loading ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">© 2026 RSM Group. All rights reserved.</p>
        </section>
      </div>
    </main>
  )
}
