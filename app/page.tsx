'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Image from 'next/image'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [employeeId, setEmployeeId] = useState('')
  const [idCard, setIdCard] = useState('')
  const [showIdCard, setShowIdCard] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    const trimId = employeeId.trim()
    const trimCard = idCard.trim()

    if (!trimId || !trimCard) {
      setError('กรุณากรอกรหัสพนักงานและเลขบัตรประชาชน')
      return
    }

    setLoading(true)
    setError('')

    const { data, error: dbError } = await supabase
      .from('employees')
      .select('employee_id, id_card, name')   // ← ดึง name ด้วย
      .eq('employee_id', trimId)
      .eq('id_card', trimCard)
      .maybeSingle()

    if (dbError || !data) {
      setError('รหัสพนักงานหรือเลขบัตรประชาชนไม่ถูกต้อง')
      setLoading(false)
      return
    }

    // เก็บ session ใน localStorage (ไม่ใช้ Supabase Auth)
    localStorage.setItem('rsm_employee_id', data.employee_id)
    localStorage.setItem('rsm_employee_name', data.name)
    localStorage.setItem('rsm_logged_in', '1')

    router.push('/scan')
    setLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html {
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }

        body {
          font-family: 'Sarabun', sans-serif;
          background: #080b12;
          overflow: hidden;
        }

        .login-root {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #080b12;
          overflow-y: auto;
          padding: 20px 16px;
        }

        /* Background grid */
        .login-root::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image:
            linear-gradient(rgba(56,189,248,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(56,189,248,0.04) 1px, transparent 1px);
          background-size: 48px 48px;
          pointer-events: none;
          z-index: 0;
        }

        /* Glow orbs */
        .orb {
          position: fixed;
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
          z-index: 0;
        }
        .orb-1 {
          width: 420px; height: 420px;
          background: radial-gradient(circle, rgba(14,165,233,0.18) 0%, transparent 70%);
          top: -120px; left: -100px;
        }
        .orb-2 {
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(99,102,241,0.14) 0%, transparent 70%);
          bottom: -80px; right: -60px;
        }

        /* Card */
        .card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 400px;
          background: rgba(15, 20, 35, 0.9);
          border: 1px solid rgba(56,189,248,0.12);
          border-radius: 24px;
          padding: 36px 32px 32px;
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.03),
            0 24px 64px rgba(0,0,0,0.6),
            0 0 80px rgba(14,165,233,0.06);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        /* Logo */
        .logo-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          margin-bottom: 32px;
        }
        .logo-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(14,165,233,0.08);
          border: 1px solid rgba(14,165,233,0.2);
          border-radius: 20px;
          padding: 4px 12px;
          font-size: 11px;
          font-family: 'IBM Plex Mono', monospace;
          color: #38bdf8;
          letter-spacing: 0.05em;
          margin-top: 4px;
        }
        .dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #38bdf8;
          animation: blink 2s ease-in-out infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }

        /* Heading */
        .heading { margin-bottom: 28px; }
        .heading h1 {
          font-size: 22px;
          font-weight: 700;
          color: #f1f5f9;
          letter-spacing: -0.02em;
          line-height: 1.2;
        }
        .heading p {
          font-size: 13px;
          color: #475569;
          margin-top: 4px;
        }

        /* Field */
        .field { margin-bottom: 14px; }
        .field-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
          font-family: 'IBM Plex Mono', monospace;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 7px;
        }
        .input-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 0 14px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .input-wrap:focus-within {
          border-color: rgba(56,189,248,0.5);
          box-shadow: 0 0 0 3px rgba(56,189,248,0.08);
        }
        .input-icon {
          font-size: 15px;
          flex-shrink: 0;
          opacity: 0.5;
        }
        .inp {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: #e2e8f0;
          font-size: 16px;
          font-family: 'IBM Plex Mono', monospace;
          padding: 13px 0;
          width: 100%;
          min-width: 0;
        }
        .inp::placeholder { color: #334155; font-size: 14px; }
        .inp:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 100px rgba(15,20,35,0.9) inset;
          -webkit-text-fill-color: #e2e8f0;
        }

        .eye-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #334155;
          padding: 4px;
          flex-shrink: 0;
          transition: color 0.15s;
          display: flex;
          align-items: center;
        }
        .eye-btn:hover { color: #64748b; }

        /* Error */
        .error-box {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 12px;
          padding: 10px 14px;
          margin-bottom: 16px;
          font-size: 13px;
          color: #f87171;
          line-height: 1.4;
        }

        /* Submit */
        .btn-submit {
          width: 100%;
          padding: 14px;
          font-size: 15px;
          font-weight: 700;
          font-family: 'Sarabun', sans-serif;
          color: #fff;
          background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
          border: none;
          border-radius: 14px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 4px 20px rgba(14,165,233,0.25);
          margin-top: 6px;
          -webkit-tap-highlight-color: transparent;
        }
        .btn-submit:active { transform: scale(0.98); }
        .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Spinner */
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner {
          width: 18px; height: 18px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        /* Footer */
        .footer {
          margin-top: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .divider {
          flex: 1;
          height: 1px;
          background: rgba(255,255,255,0.05);
        }
        .footer-text {
          font-size: 11px;
          color: #1e293b;
          font-family: 'IBM Plex Mono', monospace;
          white-space: nowrap;
        }

        @media (max-width: 420px) {
          .card { padding: 28px 20px 24px; border-radius: 20px; }
          .heading h1 { font-size: 20px; }
        }
      `}</style>

      <div className="login-root">
        <div className="orb orb-1" />
        <div className="orb orb-2" />

        <div className="card">

          {/* Logo */}
          <div className="logo-wrap">
            <Image
              src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png"
              alt="RSM Group"
              width={100}
              height={40}
              unoptimized
              style={{ objectFit: 'contain', filter: 'brightness(1.3)' }}
            />
            <span className="logo-badge">
              <span className="dot" />
              STOCK MANAGEMENT
            </span>
          </div>

          {/* Heading */}
          <div className="heading">
            <h1>เข้าสู่ระบบ</h1>
            <p>ใช้รหัสพนักงานและเลขบัตรประชาชนของคุณ</p>
          </div>

          {/* Employee ID */}
          <div className="field">
            <label className="field-label">รหัสพนักงาน</label>
            <div className="input-wrap">
              <span className="input-icon">🪪</span>
              <input
                className="inp"
                type="text"
               
                placeholder="เช่น SDO1004"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </div>

          {/* ID Card */}
          <div className="field">
            <label className="field-label">เลขบัตรประชาชน</label>
            <div className="input-wrap">
              <span className="input-icon">🔒</span>
              <input
                className="inp"
                type={showIdCard ? 'text' : 'password'}
                  maxLength={13}
                inputMode="numeric"
                placeholder="1-xxxx-xxxxx-xx-x"
                value={idCard}
                onChange={e => setIdCard(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="current-password"
                autoCorrect="off"
              />
              <button
                className="eye-btn"
                type="button"
                onClick={() => setShowIdCard(v => !v)}
                aria-label={showIdCard ? 'ซ่อน' : 'แสดง'}
              >
                {showIdCard ? (
                  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="error-box">
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            className="btn-submit"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <><div className="spinner" /> กำลังตรวจสอบ...</>
            ) : (
              'เข้าสู่ระบบ'
            )}
          </button>

          {/* Footer */}
          <div className="footer">
            <div className="divider" />
            <span className="footer-text">RSM GROUP · WAREHOUSE OPS</span>
            <div className="divider" />
          </div>

        </div>
      </div>
    </>
  )
}