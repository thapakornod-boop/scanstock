'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

type BarcodeType = 'piece' | 'case' | 'pack'
type TabType = 'scan' | 'history' | 'manage'

type PriceItem = {
  id: string
  item_code: string
  item_name: string
  brand: string
  barcode_piece: string
  barcode_case: string
  barcode_pack: string
  num_in_buy: number
  size: string
}

type ScanEntry = {
  priceItem: PriceItem
  barcodeType: BarcodeType
  quantity: number
  unit: string
  action: 'in' | 'out'
  note: string
}

type ScanLog = {
  id: string
  user_email: string
  barcode: string
  item_code: string
  product_name: string
  brand: string
  size: string
  action: string
  unit: string
  quantity: number
  note: string
  created_at: string
}

// ✅ ตรวจสอบว่าเป็น WebView (LINE, Facebook, etc.)
function isWebView(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  return /Line\/|FBAN|FBAV|Instagram|MicroMessenger|WebView|(iPhone|iPod|iPad)(?!.*Safari)|Android.*(wv|\.0\.0\.0)/.test(ua)
}

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)

  const [tab, setTab] = useState<TabType>('scan')
  const [scanning, setScanning] = useState(true)
  const [entries, setEntries] = useState<ScanEntry[]>([])
  const [currentEntry, setCurrentEntry] = useState<ScanEntry | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [searching, setSearching] = useState(false)
  const [lastSearched, setLastSearched] = useState('')
  const [isLineWebView, setIsLineWebView] = useState(false)

  const [logs, setLogs] = useState<ScanLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [editingLog, setEditingLog] = useState<ScanLog | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    setIsLineWebView(isWebView())
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserEmail(data.user.email || '')
    })
  }, [])

  useEffect(() => {
    if (tab === 'history' || tab === 'manage') fetchLogs()
    if (tab !== 'scan') { stopCamera(); setScanning(false) }
    if (tab === 'scan') setTimeout(() => setScanning(true), 100)
  }, [tab])

  const fetchLogs = async () => {
    setLoadingLogs(true)
    let query = supabase.from('scan_logs').select('*').order('created_at', { ascending: false }).limit(100)
    if (tab === 'history') query = query.eq('user_email', userEmail)
    const { data } = await query
    setLogs(data || [])
    setLoadingLogs(false)
  }

  const stopCamera = useCallback(() => {
    if (readerRef.current) { try { readerRef.current.reset() } catch {} readerRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null }
  }, [])

  useEffect(() => {
    if (!scanning || isLineWebView) return
    setCameraError('')
    let cancelled = false

    const startCamera = async () => {
      try {
        stopCamera()
        await new Promise(r => setTimeout(r, 300))
        if (cancelled) return

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.setAttribute('playsinline', 'true')
          videoRef.current.muted = true
          await videoRef.current.play()
        }
        if (cancelled) return

        const codeReader = new BrowserMultiFormatReader()
        readerRef.current = codeReader

        const decodeLoop = async () => {
          while (!cancelled) {
            try {
              const result = await codeReader.decodeOnceFromStream(streamRef.current!, videoRef.current!)
              if (!cancelled) {
                cancelled = true
                stopCamera()
                setScanning(false)
                fetchByBarcode(result.getText())
              }
              break
            } catch (err: any) {
              if (err instanceof NotFoundException) continue
              break
            }
          }
        }
        decodeLoop()
      } catch (err: any) {
        if (cancelled) return
        stopCamera()
        if (err.name === 'NotAllowedError') setCameraError('permission_denied')
        else if (err.name === 'NotReadableError') setCameraError('camera_busy')
        else setCameraError(`เกิดข้อผิดพลาด: ${err.name}`)
      }
    }

    startCamera()
    return () => { cancelled = true; stopCamera() }
  }, [scanning, stopCamera, isLineWebView])

  const openInBrowser = () => {
    const url = window.location.href
    // สำหรับ Android LINE → intent URL
    const intentUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`
    window.location.href = intentUrl
    // fallback
    setTimeout(() => { window.open(url, '_blank') }, 500)
  }

  const fetchByBarcode = async (barcode: string) => {
    setNotFound(false)
    setCurrentEntry(null)
    const cleaned = barcode.trim().replace(/\s/g, '')
    setLastSearched(cleaned)

    const { data } = await supabase
      .from('pricelist')
      .select('*')
      .or(`barcode_piece.eq.${cleaned},barcode_case.eq.${cleaned},barcode_pack.eq.${cleaned},item_code.eq.${cleaned}`)
      .limit(1)
      .single()

    if (!data) { setNotFound(true); return }

    let barcodeType: BarcodeType = 'piece'
    if (data.barcode_case === cleaned) barcodeType = 'case'
    else if (data.barcode_pack === cleaned) barcodeType = 'pack'

    const defaultUnit = barcodeType === 'case' ? 'ลัง' : barcodeType === 'pack' ? 'แพ็ค' : 'ชิ้น'

    setCurrentEntry({
      priceItem: data,
      barcodeType,
      quantity: 1,
      unit: defaultUnit,
      action: 'out',
      note: ''
    })
  }

  const handleManualSearch = async () => {
    const trimmed = manualBarcode.trim().replace(/\s/g, '')
    if (!trimmed) return
    setSearching(true)
    stopCamera()
    setScanning(false)
    await fetchByBarcode(trimmed)
    setSearching(false)
  }

  const handleAddEntry = () => {
    if (!currentEntry) return
    setEntries(prev => [...prev, currentEntry])
    setCurrentEntry(null)
    setNotFound(false)
    setManualBarcode('')
    setTimeout(() => setScanning(true), 300)
  }

  const handleSaveAll = async () => {
    if (entries.length === 0) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()

    const records = entries.map(e => ({
      user_id: user?.id,
      user_email: userEmail,
      barcode: e.barcodeType === 'piece' ? e.priceItem.barcode_piece
        : e.barcodeType === 'case' ? e.priceItem.barcode_case
        : e.priceItem.barcode_pack,
      item_code: e.priceItem.item_code,
      product_name: e.priceItem.item_name,
      brand: e.priceItem.brand,
      size: e.priceItem.size,
      action: e.action,
      unit: e.unit,
      quantity: e.quantity,
      note: e.note,
    }))

    await supabase.from('scan_logs').insert(records)
    setSuccessMsg(`บันทึกสำเร็จ ${records.length} รายการ`)
    setEntries([])
    setSaving(false)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const handleDeleteLog = async (id: string) => {
    if (!confirm('ลบรายการนี้?')) return
    await supabase.from('scan_logs').delete().eq('id', id)
    fetchLogs()
  }

  const handleUpdateLog = async () => {
    if (!editingLog) return
    await supabase.from('scan_logs').update({
      quantity: editingLog.quantity,
      unit: editingLog.unit,
      action: editingLog.action,
      note: editingLog.note,
    }).eq('id', editingLog.id)
    setEditingLog(null)
    fetchLogs()
  }

  const handleDownload = () => {
    let filtered = logs
    if (dateFrom) filtered = filtered.filter(l => l.created_at >= dateFrom)
    if (dateTo) filtered = filtered.filter(l => l.created_at <= dateTo + 'T23:59:59')
    const header = 'วันที่,ผู้บันทึก,รหัสสินค้า,ชื่อสินค้า,แบรนด์,ขนาด,ประเภท,จำนวน,หน่วย,หมายเหตุ\n'
    const rows = filtered.map(l =>
      `${new Date(l.created_at).toLocaleString('th-TH')},${l.user_email},${l.item_code},"${l.product_name}",${l.brand},${l.size},${l.action === 'in' ? 'รับเข้า' : 'จ่ายออก'},${l.quantity},${l.unit},${l.note}`
    ).join('\n')
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scan_logs_${dateFrom || 'all'}_to_${dateTo || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const unitOptions = ['ชิ้น', 'ลัง', 'แพ็ค']

  return (
    <div className="min-h-screen bg-gray-50 pb-24">

      {/* Header */}
      <div className="bg-white sticky top-0 z-20 border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <Image src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png" alt="RSM" width={72} height={28} unoptimized className="object-contain" />
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-xs truncate max-w-[140px]">{userEmail}</span>
          <button onClick={async () => { stopCamera(); await supabase.auth.signOut(); router.push('/') }}
            className="text-xs text-red-400 hover:text-red-600 transition px-2 py-1 rounded-lg border border-red-100 hover:border-red-300">
            ออก
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-100 flex sticky top-[57px] z-10">
        {[
          { key: 'scan', icon: '📷', label: 'สแกน' },
          { key: 'history', icon: '📋', label: 'ประวัติ' },
          { key: 'manage', icon: '⚙️', label: 'จัดการ' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as TabType)}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium transition border-b-2 ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'
            }`}>
            <span className="text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-md mx-auto px-4 pt-4 space-y-3">

        {/* ===== TAB: SCAN ===== */}
        {tab === 'scan' && (
          <>
            {/* ✅ LINE WebView Warning */}
            {isLineWebView && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 text-center space-y-3">
                <p className="text-4xl">⚠️</p>
                <p className="text-gray-700 font-semibold text-base">ไม่สามารถใช้กล้องใน LINE ได้</p>
                <p className="text-gray-500 text-sm leading-relaxed">
                  LINE browser ไม่รองรับการใช้กล้องสแกนบาร์โค้ด<br />
                  กรุณาเปิดใน Chrome เพื่อใช้งาน
                </p>
                <button onClick={openInBrowser}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition text-sm">
                  เปิดใน Chrome
                </button>
                <p className="text-gray-400 text-xs">หรือ copy ลิงค์ไปเปิดใน Chrome เอง</p>
              </div>
            )}

            {/* Camera */}
            {!isLineWebView && scanning && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {cameraError === 'permission_denied' ? (
                  <div className="p-6 text-center space-y-3">
                    <p className="text-4xl">📵</p>
                    <p className="text-gray-700 font-semibold">ไม่ได้รับอนุญาตให้ใช้กล้อง</p>
                    <p className="text-gray-400 text-sm">กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์แล้วโหลดใหม่</p>
                    <button onClick={() => window.location.reload()}
                      className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition">
                      โหลดใหม่
                    </button>
                  </div>
                ) : cameraError === 'camera_busy' ? (
                  <div className="p-6 text-center space-y-3">
                    <p className="text-4xl">📷</p>
                    <p className="text-gray-700 font-semibold">กล้องถูกใช้งานโดยแอปอื่น</p>
                    <p className="text-gray-400 text-sm">ปิดแอปอื่นที่ใช้กล้องอยู่แล้วลองใหม่</p>
                    <button onClick={() => { setCameraError(''); setScanning(false); setTimeout(() => setScanning(true), 300) }}
                      className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition">
                      ลองใหม่
                    </button>
                  </div>
                ) : cameraError ? (
                  <div className="p-6 text-center space-y-3">
                    <p className="text-4xl">❌</p>
                    <p className="text-gray-500 text-sm">{cameraError}</p>
                    <button onClick={() => { setCameraError(''); setScanning(false); setTimeout(() => setScanning(true), 300) }}
                      className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition">
                      ลองใหม่
                    </button>
                  </div>
                ) : (
                  <div className="relative bg-black">
                    <video ref={videoRef} className="w-full aspect-[4/3] object-cover" playsInline muted autoPlay />
                    {/* Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="relative w-56 h-40">
                        <div className="absolute inset-0 border-2 border-white/20 rounded-xl" />
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-blue-400 rounded-tl-xl" style={{borderWidth: '3px'}} />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-blue-400 rounded-tr-xl" style={{borderWidth: '3px'}} />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-blue-400 rounded-bl-xl" style={{borderWidth: '3px'}} />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-blue-400 rounded-br-xl" style={{borderWidth: '3px'}} />
                        <div className="absolute top-1/2 left-2 right-2 h-0.5 bg-red-400 opacity-80 animate-pulse -translate-y-1/2" />
                      </div>
                    </div>
                    <p className="absolute bottom-3 left-0 right-0 text-center text-white/70 text-xs">จ่อบาร์โค้ดให้ตรงกรอบ</p>
                  </div>
                )}

                {/* Manual Search */}
                <div className="p-3 border-t border-gray-50">
                  <div className="flex gap-2">
                    <input
                      type="text" inputMode="numeric" value={manualBarcode}
                      onChange={e => setManualBarcode(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                      placeholder="พิมพ์บาร์โค้ด / รหัสสินค้า"
                      className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
                    />
                    <button onClick={handleManualSearch} disabled={searching || !manualBarcode.trim()}
                      className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition whitespace-nowrap">
                      {searching ? '...' : 'ค้นหา'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ไม่พบสินค้า */}
            {notFound && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center space-y-2">
                <p className="text-3xl">❌</p>
                <p className="text-gray-700 font-medium text-sm">ไม่พบสินค้าในระบบ</p>
                <p className="text-xs text-gray-400 font-mono bg-gray-50 rounded-lg px-3 py-1.5 inline-block">{lastSearched}</p>
                <button onClick={() => { setNotFound(false); setManualBarcode(''); setScanning(true) }}
                  className="mt-1 bg-blue-600 text-white px-6 py-2 rounded-xl text-sm hover:bg-blue-700 transition block mx-auto">
                  สแกนใหม่
                </button>
              </div>
            )}

            {/* Form กรอกข้อมูล */}
            {currentEntry && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                {/* Product Header */}
                <div className="px-4 py-3 border-b border-gray-50 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 font-semibold text-sm leading-snug truncate">{currentEntry.priceItem.item_name}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{currentEntry.priceItem.item_code} · {currentEntry.priceItem.brand} · {currentEntry.priceItem.size || '-'}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${
                    currentEntry.barcodeType === 'piece' ? 'bg-blue-50 text-blue-600'
                    : currentEntry.barcodeType === 'case' ? 'bg-orange-50 text-orange-600'
                    : 'bg-purple-50 text-purple-600'
                  }`}>
                    {currentEntry.barcodeType === 'piece' ? 'ชิ้น' : currentEntry.barcodeType === 'case' ? 'ลัง' : 'แพ็ค'}
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  {/* in/out */}
                  <div className="flex rounded-xl overflow-hidden border border-gray-200 h-11">
                    <button onClick={() => setCurrentEntry(e => e ? { ...e, action: 'out' } : e)}
                      className={`flex-1 text-sm font-medium transition ${currentEntry.action === 'out' ? 'bg-red-500 text-white' : 'text-gray-400'}`}>
                      จ่ายออก
                    </button>
                    <button onClick={() => setCurrentEntry(e => e ? { ...e, action: 'in' } : e)}
                      className={`flex-1 text-sm font-medium transition ${currentEntry.action === 'in' ? 'bg-green-500 text-white' : 'text-gray-400'}`}>
                      รับเข้า
                    </button>
                  </div>

                  {/* Quantity + Unit */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCurrentEntry(e => e ? { ...e, quantity: Math.max(1, e.quantity - 1) } : e)}
                      className="w-11 h-11 bg-gray-100 rounded-xl text-xl font-bold hover:bg-gray-200 active:scale-95 transition flex items-center justify-center">
                      −
                    </button>
                    <input type="number" value={currentEntry.quantity} min={1}
                      onChange={ev => setCurrentEntry(e => e ? { ...e, quantity: Math.max(1, parseInt(ev.target.value) || 1) } : e)}
                      className="flex-1 text-center text-xl font-bold border border-gray-200 rounded-xl h-11 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <button onClick={() => setCurrentEntry(e => e ? { ...e, quantity: e.quantity + 1 } : e)}
                      className="w-11 h-11 bg-gray-100 rounded-xl text-xl font-bold hover:bg-gray-200 active:scale-95 transition flex items-center justify-center">
                      +
                    </button>
                    <select value={currentEntry.unit}
                      onChange={ev => setCurrentEntry(e => e ? { ...e, unit: ev.target.value } : e)}
                      className="h-11 border border-gray-200 rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                      {unitOptions.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </div>

                  {/* Note */}
                  <input type="text" placeholder="หมายเหตุ (ถ้ามี)" value={currentEntry.note}
                    onChange={ev => setCurrentEntry(e => e ? { ...e, note: ev.target.value } : e)}
                    className="w-full border border-gray-200 rounded-xl px-4 h-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />

                  {/* Buttons */}
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleAddEntry}
                      className="flex-1 bg-blue-600 text-white h-12 rounded-xl font-semibold text-sm hover:bg-blue-700 active:scale-98 transition">
                      + เพิ่มในรายการ
                    </button>
                    <button onClick={() => { setCurrentEntry(null); setNotFound(false); setManualBarcode(''); setScanning(true) }}
                      className="w-12 h-12 border border-gray-200 rounded-xl text-xl hover:bg-gray-50 transition flex items-center justify-center">
                      📷
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Pending Entries */}
            {entries.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <p className="font-semibold text-sm text-gray-700">รายการรอบันทึก</p>
                  <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{entries.length}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {entries.map((e, idx) => (
                    <div key={idx} className="px-4 py-3 flex items-center gap-3">
                      <div className={`w-1.5 h-10 rounded-full shrink-0 ${e.action === 'in' ? 'bg-green-400' : 'bg-red-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{e.priceItem.item_name}</p>
                        <p className="text-xs text-gray-400">{e.action === 'in' ? 'รับเข้า' : 'จ่ายออก'} {e.quantity} {e.unit}</p>
                      </div>
                      <button onClick={() => setEntries(prev => prev.filter((_, i) => i !== idx))}
                        className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-400 transition text-lg">
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                {successMsg && (
                  <div className="mx-4 mb-3 bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-center text-green-700 text-sm font-medium">
                    ✅ {successMsg}
                  </div>
                )}

                <div className="p-4 pt-2">
                  <button onClick={handleSaveAll} disabled={saving}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold h-12 rounded-xl transition text-sm active:scale-98">
                    {saving ? 'กำลังบันทึก...' : `💾 บันทึกทั้งหมด ${entries.length} รายการ`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== TAB: HISTORY ===== */}
        {tab === 'history' && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="font-semibold text-sm text-gray-700">ประวัติการบันทึกของฉัน</p>
              <p className="text-xs text-gray-400 mt-0.5">{userEmail}</p>
            </div>
            {loadingLogs ? (
              <p className="text-center text-gray-400 text-sm py-10">กำลังโหลด...</p>
            ) : logs.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">ยังไม่มีประวัติ</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {logs.map(l => (
                  <div key={l.id} className="px-4 py-3 flex items-start gap-3">
                    <div className={`w-1.5 h-10 rounded-full shrink-0 mt-0.5 ${l.action === 'in' ? 'bg-green-400' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{l.product_name}</p>
                      <p className="text-xs text-gray-400">{l.item_code} · {l.size}</p>
                      <p className="text-xs mt-0.5">
                        <span className={l.action === 'in' ? 'text-green-600' : 'text-red-500'}>
                          {l.action === 'in' ? 'รับเข้า' : 'จ่ายออก'}
                        </span>
                        {' '}{l.quantity} {l.unit}{l.note ? ` · ${l.note}` : ''}
                      </p>
                    </div>
                    <p className="text-xs text-gray-300 shrink-0">{new Date(l.created_at).toLocaleDateString('th-TH')}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== TAB: MANAGE ===== */}
        {tab === 'manage' && (
          <>
            {/* Download */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50">
                <p className="font-semibold text-sm text-gray-700">⬇️ Download ข้อมูล</p>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">จากวันที่</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">ถึงวันที่</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>
                <button onClick={handleDownload}
                  className="w-full bg-green-600 text-white h-11 rounded-xl font-semibold text-sm hover:bg-green-700 transition">
                  ⬇️ Download CSV
                </button>
              </div>
            </div>

            {/* All Logs */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50">
                <p className="font-semibold text-sm text-gray-700">รายการทั้งหมด</p>
              </div>
              {loadingLogs ? (
                <p className="text-center text-gray-400 text-sm py-8">กำลังโหลด...</p>
              ) : logs.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">ไม่มีข้อมูล</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {logs.map(l => (
                    <div key={l.id} className="px-4 py-3">
                      {editingLog?.id === l.id ? (
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-blue-600 truncate">{l.product_name}</p>
                          <div className="flex rounded-xl overflow-hidden border border-gray-200 h-9">
                            <button onClick={() => setEditingLog(e => e ? { ...e, action: 'out' } : e)}
                              className={`flex-1 text-xs font-medium ${editingLog.action === 'out' ? 'bg-red-500 text-white' : 'text-gray-400'}`}>จ่ายออก</button>
                            <button onClick={() => setEditingLog(e => e ? { ...e, action: 'in' } : e)}
                              className={`flex-1 text-xs font-medium ${editingLog.action === 'in' ? 'bg-green-500 text-white' : 'text-gray-400'}`}>รับเข้า</button>
                          </div>
                          <div className="flex gap-2">
                            <input type="number" value={editingLog.quantity}
                              onChange={e => setEditingLog(ev => ev ? { ...ev, quantity: parseInt(e.target.value) || 1 } : ev)}
                              className="flex-1 border border-gray-200 rounded-xl px-3 h-9 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400" />
                            <select value={editingLog.unit}
                              onChange={e => setEditingLog(ev => ev ? { ...ev, unit: e.target.value } : ev)}
                              className="border border-gray-200 rounded-xl px-3 h-9 text-sm focus:outline-none bg-white">
                              {unitOptions.map(u => <option key={u}>{u}</option>)}
                            </select>
                          </div>
                          <input type="text" placeholder="หมายเหตุ" value={editingLog.note}
                            onChange={e => setEditingLog(ev => ev ? { ...ev, note: e.target.value } : ev)}
                            className="w-full border border-gray-200 rounded-xl px-3 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                          <div className="flex gap-2">
                            <button onClick={handleUpdateLog}
                              className="flex-1 bg-blue-600 text-white h-9 rounded-xl text-sm hover:bg-blue-700 transition">บันทึก</button>
                            <button onClick={() => setEditingLog(null)}
                              className="flex-1 border border-gray-200 text-gray-500 h-9 rounded-xl text-sm hover:bg-gray-50 transition">ยกเลิก</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <div className={`w-1.5 h-10 rounded-full shrink-0 ${l.action === 'in' ? 'bg-green-400' : 'bg-red-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{l.product_name}</p>
                            <p className="text-xs text-gray-400">{l.user_email} · {new Date(l.created_at).toLocaleDateString('th-TH')}</p>
                            <p className="text-xs mt-0.5">
                              <span className={l.action === 'in' ? 'text-green-600' : 'text-red-500'}>
                                {l.action === 'in' ? 'รับเข้า' : 'จ่ายออก'}
                              </span>
                              {' '}{l.quantity} {l.unit}{l.note ? ` · ${l.note}` : ''}
                            </p>
                          </div>
                          <div className="flex gap-1 ml-1 shrink-0">
                            <button onClick={() => setEditingLog(l)}
                              className="w-8 h-8 flex items-center justify-center text-blue-300 hover:text-blue-500 transition text-sm">✏️</button>
                            <button onClick={() => handleDeleteLog(l.id)}
                              className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-400 transition text-sm">🗑</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}