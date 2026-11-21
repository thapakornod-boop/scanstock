'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bubbles, useToast } from '@/components/ui'
import Home from '@/components/stock/Home'
import History from '@/components/stock/History'
import Expiry from '@/components/stock/Expiry'
import PalletScan from '@/components/stock/PalletScan'
import { FinishView, RoundView } from '@/components/stock/RoundView'
import { clearEmployee, getEmployee, type Employee } from '@/lib/auth'
import { loadCatalog, type Catalog } from '@/lib/catalog'
import { unlockAudio } from '@/lib/feedback'
import { loadDraft, newPallet, newRound, saveDraft, type Pallet, type Round } from '@/lib/round'

type View = 'home' | 'history' | 'expiry' | 'round' | 'pallet' | 'finish'

const TABS: { view: View; icon: string; label: string }[] = [
  { view: 'home', icon: '🏠', label: 'หน้าหลัก' },
  { view: 'history', icon: '📋', label: 'ประวัติ' },
  { view: 'expiry', icon: '⏰', label: 'หมดอายุ' },
]

export default function StockApp() {
  const router = useRouter()
  const toast = useToast()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [view, setView] = useState<View>('home')
  const [round, setRound] = useState<Round | null>(null)
  const [roundSaved, setRoundSaved] = useState(false) // บันทึกลง DB แล้ว ไม่ต้องเก็บร่าง
  const [palletId, setPalletId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [reloading, setReloading] = useState(false)

  const fetchCatalog = useCallback(async (force: boolean) => {
    setReloading(true); setCatalogError('')
    try {
      setCatalog(await loadCatalog(force))
    } catch (err) {
      setCatalogError(`โหลดฐานข้อมูลสินค้าไม่สำเร็จ: ${(err as Error).message}`)
    } finally {
      setReloading(false)
    }
  }, [])

  useEffect(() => {
    const e = getEmployee()
    if (!e) { router.replace('/'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- อ่านค่าจาก localStorage ได้หลัง mount เท่านั้น
    setEmployee(e)
    setRound(loadDraft())
    fetchCatalog(false)
  }, [router, fetchCatalog])

  // เก็บร่างทุกครั้งที่ข้อมูลเปลี่ยน
  useEffect(() => {
    if (!roundSaved) saveDraft(round)
  }, [round, roundSaved])

  // ปุ่มย้อนกลับของมือถือ: ถอยทีละหน้าแทนการออกจากแอป
  // เก็บหน้าปัจจุบันไว้ใน #hash (ไม่ใส่ state เองเพราะจะชนกับ router ของ Next แล้วหน้ารีโหลด)
  useEffect(() => {
    if (location.hash) history.replaceState(null, '', location.pathname)
    const onHash = () => {
      const v = location.hash.slice(1) as View
      setView(['history', 'expiry', 'round', 'pallet', 'finish'].includes(v) ? v : 'home')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (v: View) => {
    history.pushState(null, '', `#${v}`)
    setView(v)
    window.scrollTo(0, 0)
  }
  const back = () => history.back()

  const startRound = (label: string, location: string) => {
    unlockAudio()
    const r = newRound(label, location)
    const p = newPallet(r)
    setRound({ ...r, pallets: [p] })
    setRoundSaved(false)
    setPalletId(p.id)
    go('round')
    go('pallet')
  }

  const addPallet = () => {
    if (!round) return
    unlockAudio()
    const p = newPallet(round)
    setRound({ ...round, pallets: [...round.pallets, p] })
    setPalletId(p.id)
    go('pallet')
  }

  const openPallet = (id: string) => {
    unlockAudio()
    setPalletId(id)
    go('pallet')
  }

  const updatePallet = useCallback((p: Pallet) => {
    setRound(r => (r ? { ...r, pallets: r.pallets.map(x => (x.id === p.id ? p : x)) } : r))
  }, [])

  const logout = () => {
    if (!confirm('ออกจากระบบ?')) return
    clearEmployee()
    router.replace('/')
  }

  if (!employee) return null

  const pallet = round?.pallets.find(p => p.id === palletId) ?? null
  const showTabs = view === 'home' || view === 'history' || view === 'expiry'

  return (
    <main className="relative min-h-dvh">
      {showTabs && <Bubbles />}
      {toast.node}

      <div className="relative z-10">
        {view === 'home' && (
          <Home employee={employee} draft={roundSaved ? null : round} catalog={catalog} catalogError={catalogError}
            reloading={reloading} onReloadCatalog={() => fetchCatalog(true)}
            onStart={startRound} onResume={() => go('round')} onLogout={logout} />
        )}
        {view === 'history' && <History employee={employee} toast={toast.show} />}
        {view === 'expiry' && <Expiry toast={toast.show} />}

        {view === 'round' && round && !roundSaved && (
          <RoundView round={round} onChange={setRound} toast={toast.show}
            onOpenPallet={openPallet} onAddPallet={addPallet} onFinish={() => go('finish')} onExit={back}
            onDiscard={() => { setRound(null); history.go(-1) }} />
        )}
        {view === 'pallet' && pallet && (
          <PalletScan pallet={pallet} catalog={catalog}
            onChange={updatePallet} onDone={back} toast={toast.show} />
        )}
        {view === 'finish' && round && (
          <FinishView round={round} employee={employee} toast={toast.show} onBack={back}
            onSaved={() => { setRoundSaved(true); saveDraft(null) }}
            onNewRound={() => { setRound(null); setRoundSaved(false); history.go(-2) }} />
        )}
        {/* ถ้าหน้าที่ต้องใช้ข้อมูลหายไป (เช่นรีเฟรช) ให้กลับหน้าหลัก */}
        {((view === 'round' && (!round || roundSaved)) || (view === 'pallet' && !pallet) || (view === 'finish' && !round)) && (
          <div className="p-10 text-center">
            <button onClick={() => setView('home')} className="rounded-2xl bg-white px-5 py-3 font-medium">กลับหน้าหลัก</button>
          </div>
        )}
      </div>

      {showTabs && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-lg">
            {TABS.map(t => (
              <button key={t.view} onClick={() => { if (view !== t.view) { setView(t.view); history.replaceState(null, '', t.view === 'home' ? location.pathname : `#${t.view}`) } }}
                className={`flex flex-1 flex-col items-center gap-0.5 pt-2 text-xs ${view === t.view ? 'font-semibold text-brand-600' : 'text-slate-500'}`}>
                <span className="text-xl">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </main>
  )
}
