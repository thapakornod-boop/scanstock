'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Image from 'next/image'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) {
      setError('กรุณากรอกอีเมลและรหัสผ่าน')
      return
    }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
    } else {
      router.push('/scan')
    }
    setLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    /*
     * KEY FIX: ใช้ fixed + inset-0 แทน min-h-screen
     * การใช้ position: fixed ทำให้ layout ไม่ขยับเมื่อ keyboard ขึ้น
     * overflow-y-auto บน card ทำให้ scroll ได้ถ้าจอเล็กมาก
     */
    <div className="fixed inset-0 flex bg-slate-50">

      {/* ── Left panel (desktop only) ── */}
      <div className="hidden lg:flex w-[45%] bg-white flex-col items-center justify-center gap-6 border-r border-slate-100">
        {/* subtle grid pattern */}
        <div
          className="absolute inset-0 hidden lg:block pointer-events-none opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            width: '45%',
          }}
        />
        <div className="relative flex flex-col items-center gap-4 z-10">
          <Image
            src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png"
            alt="RSM Group Logo"
            width={160}
            height={64}
            className="object-contain"
            unoptimized
          />
          <div className="flex flex-col items-center gap-1">
            <p className="text-slate-800 font-semibold tracking-tight text-base">Stock Management System</p>
            <p className="text-slate-400 text-xs">RSM Group · Warehouse Operations</p>
          </div>

          {/* mini feature badges */}
          <div className="flex flex-col gap-2 mt-6 w-64">
            {[
              { icon: '⚡', label: 'Real-time inventory tracking' },
              { icon: '📦', label: 'Barcode & QR scan support' },
              { icon: '📊', label: 'Live stock reports' },
            ].map((f) => (
              <div
                key={f.label}
                className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5 text-sm text-slate-600"
              >
                <span>{f.icon}</span>
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex items-center justify-center p-5 bg-blue-600 relative overflow-hidden">

        {/* decorative rings — pointer-events-none ไม่กวน input */}
        <span className="absolute -bottom-16 -right-16 w-72 h-72 rounded-full border border-blue-500/30 pointer-events-none" />
        <span className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] rounded-full border border-blue-500/20 pointer-events-none" />
        <span className="absolute -top-20 -left-20 w-64 h-64 rounded-full border border-blue-500/20 pointer-events-none" />

        {/*
         * Card: ใช้ max-h + overflow-y-auto
         * ทำให้ถ้าจอสั้นมาก (เช่น iPhone SE + keyboard) scroll ได้
         * แทนที่จะถูกตัดออกนอกจอ
         */}
        <div className="relative z-10 bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-y-auto"
          style={{ maxHeight: 'calc(100dvh - 2.5rem)' }}
        >
          <div className="p-8">

            {/* Logo — mobile only */}
            <div className="flex justify-center mb-6 lg:hidden">
              <Image
                src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png"
                alt="RSM Group Logo"
                width={110}
                height={44}
                className="object-contain"
                unoptimized
              />
            </div>

            {/* Heading */}
            <div className="mb-7">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back</h1>
              <p className="text-slate-400 text-sm mt-0.5">Sign in to your account to continue</p>
            </div>

            {/* ── Email ── */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-0.5">
                Email address
              </label>
              <div className="flex items-center border border-slate-200 rounded-2xl px-3.5 py-2.5 gap-2.5
                              focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all bg-white">
                <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoComplete="email"
                  className="w-full outline-none text-slate-700 placeholder-slate-300 text-sm bg-transparent"
                />
              </div>
            </div>

            {/* ── Password ── */}
            <div className="mb-5">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-slate-500 ml-0.5">Password</label>
                <button
                  type="button"
                  className="text-xs text-blue-500 hover:text-blue-700 transition-colors font-medium"
                >
                  Forgot password?
                </button>
              </div>
              <div className="flex items-center border border-slate-200 rounded-2xl px-3.5 py-2.5 gap-2.5
                              focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all bg-white">
                <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoComplete="current-password"
                  className="w-full outline-none text-slate-700 placeholder-slate-300 text-sm bg-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-300 hover:text-slate-500 transition-colors shrink-0"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* ── Error ── */}
            {error && (
              <div className="mb-4 flex items-center gap-2.5 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
                <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-red-500 text-sm">{error}</p>
              </div>
            )}

            {/* ── Login button ── */}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50
                         disabled:cursor-not-allowed text-white font-semibold py-3 rounded-2xl
                         transition-all duration-150 text-sm shadow-sm shadow-blue-200"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  กำลังเข้าสู่ระบบ...
                </span>
              ) : (
                'Sign in'
              )}
            </button>

            {/* Footer note */}
            <p className="text-center text-slate-300 text-xs mt-6">
              RSM Group · Stock Management System
            </p>

          </div>
        </div>
      </div>
    </div>
  )
}