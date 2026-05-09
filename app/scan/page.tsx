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
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [searching, setSearching] = useState(false)
  const [lastSearched, setLastSearched] = useState('')

  // history & manage
  const [logs, setLogs] = useState<ScanLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [editingLog, setEditingLog] = useState<ScanLog | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserName(data.user.email || '')
      setUserEmail(data.user.email || '')
    })
  }, [])

  useEffect(() => {
    if (tab === 'history' || tab === 'manage') fetchLogs()
    if (tab !== 'scan') { stopCamera(); setScanning(false) }
    if (tab === 'scan') setScanning(true)
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
    if (!scanning) return
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
        if (err.name === 'NotAllowedError') setCameraError('ไม่ได้รับอนุญาตให้ใช้กล้อง\nกรุณาอนุญาตในการตั้งค่าเบราว์เซอร์')
        else if (err.name === 'NotReadableError') setCameraError('กล้องถูกใช้งานโดยแอปอื่นอยู่\nกรุณาปิดแอปอื่นแล้วลองใหม่')
        else setCameraError(`เกิดข้อผิดพลาด: ${err.name}`)
      }
    }

    startCamera()
    return () => { cancelled = true; stopCamera() }
  }, [scanning, stopCamera])

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
    // เปิดกล้องสแกนต่อได้เลย
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
    setSuccessMsg(`✅ บันทึกสำเร็จ ${records.length} รายการ`)
    setEntries([])
    setSaving(false)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const handleDeleteEntry = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx))
  }

  const handleDeleteLog = async (id: string) => {
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
      `${new Date(l.created_at).toLocaleString('th-TH')},${l.user_email},${l.item_code},${l.product_name},${l.brand},${l.size},${l.action === 'in' ? 'รับเข้า' : 'จ่ายออก'},${l.quantity},${l.unit},${l.note}`
    ).join('\n')

    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scan_logs_${dateFrom || 'all'}_${dateTo || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const unitOptions = ['ชิ้น', 'ลัง', 'แพ็ค']

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png" alt="RSM" width={80} height={32} unoptimized className="object-contain" />
          <span className="text-gray-500 text-sm hidden sm:block">{userName}</span>
        </div>
        <button onClick={async () => { stopCamera(); await supabase.auth.signOut(); router.push('/') }}
          className="text-sm text-red-500 hover:text-red-700 transition">ออกจากระบบ</button>
      </div>

      {/* Tab */}
      <div className="bg-white border-b flex">
        {[
          { key: 'scan', label: '📷 สแกน' },
          { key: 'history', label: '📋 ประวัติฉัน' },
          { key: 'manage', label: '⚙️ จัดการ' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as TabType)}
            className={`flex-1 py-3 text-sm font-medium transition border-b-2 ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">

        {/* ===== TAB: SCAN ===== */}
        {tab === 'scan' && (
          <>
            {/* Camera */}
            {scanning && (
              <div className="bg-white rounded-2xl shadow overflow-hidden">
                <div className="bg-blue-600 px-4 py-3">
                  <h2 className="text-white font-semibold text-center">📷 สแกนบาร์โค้ด</h2>
                </div>
                {cameraError ? (
                  <div className="p-8 text-center space-y-4">
                    <p className="text-5xl">📵</p>
                    <p className="text-gray-700 whitespace-pre-line">{cameraError}</p>
                    <button onClick={() => { setCameraError(''); setScanning(false); setTimeout(() => setScanning(true), 300) }}
                      className="bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 transition">ลองใหม่</button>
                  </div>
                ) : (
                  <>
                    <div className="relative bg-black">
                      <video ref={videoRef} className="w-full aspect-video object-cover" playsInline muted autoPlay />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-3/4 h-0.5 bg-red-500 opacity-70 animate-pulse" />
                      </div>
                      <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
                      <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
                      <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
                      <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
                    </div>
                    <p className="text-center text-gray-400 text-sm py-2">จ่อบาร์โค้ดให้ตรงกรอบ</p>
                  </>
                )}
                <div className="px-4 pb-4 flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                    <input type="text" inputMode="numeric" value={manualBarcode}
                      onChange={e => setManualBarcode(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                      placeholder="พิมพ์บาร์โค้ด / รหัสสินค้า"
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <button onClick={handleManualSearch} disabled={searching || !manualBarcode.trim()}
                    className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition">
                    {searching ? '...' : 'ค้นหา'}
                  </button>
                </div>
              </div>
            )}

            {/* Not Found */}
            {notFound && (
              <div className="bg-white rounded-2xl shadow p-6 text-center space-y-2">
                <p className="text-4xl">❌</p>
                <p className="text-gray-700 font-medium">ไม่พบสินค้าในระบบ</p>
                <p className="text-gray-400 text-sm font-mono bg-gray-50 rounded-lg px-3 py-1 inline-block">{lastSearched}</p>
                <button onClick={() => { setNotFound(false); setScanning(true) }}
                  className="mt-2 bg-blue-600 text-white px-6 py-2 rounded-xl hover:bg-blue-700 transition block mx-auto">
                  สแกนใหม่
                </button>
              </div>
            )}

            {/* Current Entry Form */}
            {currentEntry && (
              <div className="bg-white rounded-2xl shadow overflow-hidden">
                <div className="bg-blue-600 px-4 py-3 flex items-center justify-between">
                  <h2 className="text-white font-semibold">กรอกข้อมูล</h2>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    currentEntry.barcodeType === 'piece' ? 'bg-blue-100 text-blue-700'
                    : currentEntry.barcodeType === 'case' ? 'bg-orange-100 text-orange-700'
                    : 'bg-purple-100 text-purple-700'
                  }`}>
                    {currentEntry.barcodeType === 'piece' ? 'บาร์ชิ้น' : currentEntry.barcodeType === 'case' ? 'บาร์ลัง' : 'บาร์แพ็ค'}
                  </span>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-blue-600 font-semibold">{currentEntry.priceItem.item_name}</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-gray-400 text-xs">รหัส</p>
                      <p className="font-medium">{currentEntry.priceItem.item_code}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-gray-400 text-xs">ขนาด</p>
                      <p className="font-medium">{currentEntry.priceItem.size || '-'}</p>
                    </div>
                  </div>

                  {/* in/out */}
                  <div className="flex rounded-xl overflow-hidden border border-gray-200">
                    <button onClick={() => setCurrentEntry(e => e ? { ...e, action: 'out' } : e)}
                      className={`flex-1 py-2 text-sm font-medium transition ${currentEntry.action === 'out' ? 'bg-red-500 text-white' : 'bg-white text-gray-500'}`}>
                      จ่ายออก
                    </button>
                    <button onClick={() => setCurrentEntry(e => e ? { ...e, action: 'in' } : e)}
                      className={`flex-1 py-2 text-sm font-medium transition ${currentEntry.action === 'in' ? 'bg-green-500 text-white' : 'bg-white text-gray-500'}`}>
                      รับเข้า
                    </button>
                  </div>

                  {/* quantity + unit */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCurrentEntry(e => e ? { ...e, quantity: Math.max(1, e.quantity - 1) } : e)}
                      className="w-11 h-11 bg-gray-100 rounded-xl text-xl font-bold hover:bg-gray-200 transition">−</button>
                    <input type="number" value={currentEntry.quantity}
                      onChange={ev => setCurrentEntry(e => e ? { ...e, quantity: Math.max(1, parseInt(ev.target.value) || 1) } : e)}
                      className="flex-1 text-center text-xl font-bold border border-gray-200 rounded-xl py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <button onClick={() => setCurrentEntry(e => e ? { ...e, quantity: e.quantity + 1 } : e)}
                      className="w-11 h-11 bg-gray-100 rounded-xl text-xl font-bold hover:bg-gray-200 transition">+</button>
                    <select value={currentEntry.unit}
                      onChange={ev => setCurrentEntry(e => e ? { ...e, unit: ev.target.value } : e)}
                      className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      {unitOptions.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </div>

                  {/* note */}
                  <input type="text" placeholder="หมายเหตุ (ถ้ามี)" value={currentEntry.note}
                    onChange={ev => setCurrentEntry(e => e ? { ...e, note: ev.target.value } : e)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />

                  <div className="flex gap-2">
                    <button onClick={handleAddEntry}
                      className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition">
                      ➕ เพิ่มในรายการ
                    </button>
                    <button onClick={() => { setCurrentEntry(null); setScanning(true) }}
                      className="flex-1 border border-gray-200 text-gray-500 py-3 rounded-xl hover:bg-gray-50 transition">
                      📷 สแกนใหม่
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Pending Entries */}
            {entries.length > 0 && (
              <div className="bg-white rounded-2xl shadow overflow-hidden">
                <div className="bg-gray-700 px-4 py-3 flex items-center justify-between">
                  <h2 className="text-white font-semibold">รายการรอบันทึก ({entries.length})</h2>
                </div>
                <div className="divide-y">
                  {entries.map((e, idx) => (
                    <div key={idx} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm text-gray-800">{e.priceItem.item_name}</p>
                        <p className="text-xs text-gray-400">{e.action === 'in' ? '🟢 รับเข้า' : '🔴 จ่ายออก'} {e.quantity} {e.unit}</p>
                      </div>
                      <button onClick={() => handleDeleteEntry(idx)} className="text-red-400 hover:text-red-600 text-lg">🗑</button>
                    </div>
                  ))}
                </div>
                {successMsg && (
                  <div className="mx-4 mb-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center text-green-700 font-medium">
                    {successMsg}
                  </div>
                )}
                <div className="p-4">
                  <button onClick={handleSaveAll} disabled={saving}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition">
                    {saving ? 'กำลังบันทึก...' : `💾 บันทึกทั้งหมด ${entries.length} รายการ`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== TAB: HISTORY ===== */}
        {tab === 'history' && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="bg-blue-600 px-4 py-3">
              <h2 className="text-white font-semibold">📋 ประวัติการบันทึกของฉัน</h2>
            </div>
            {loadingLogs ? (
              <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
            ) : logs.length === 0 ? (
              <p className="text-center text-gray-400 py-8">ยังไม่มีประวัติ</p>
            ) : (
              <div className="divide-y max-h-[60vh] overflow-y-auto">
                {logs.map(l => (
                  <div key={l.id} className="px-4 py-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm text-gray-800">{l.product_name}</p>
                        <p className="text-xs text-gray-400">{l.item_code} · {l.brand} · {l.size}</p>
                        <p className="text-xs mt-0.5">
                          <span className={`font-medium ${l.action === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                            {l.action === 'in' ? '🟢 รับเข้า' : '🔴 จ่ายออก'}
                          </span>
                          {' '}{l.quantity} {l.unit}
                          {l.note ? ` · ${l.note}` : ''}
                        </p>
                      </div>
                      <p className="text-xs text-gray-300 shrink-0 ml-2">
                        {new Date(l.created_at).toLocaleDateString('th-TH')}
                      </p>
                    </div>
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
            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="bg-gray-700 px-4 py-3">
                <h2 className="text-white font-semibold">⬇️ Download ข้อมูล</h2>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">จากวันที่</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">ถึงวันที่</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>
                <button onClick={handleDownload}
                  className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold hover:bg-green-700 transition">
                  ⬇️ Download CSV
                </button>
              </div>
            </div>

            {/* All Logs */}
            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <div className="bg-gray-700 px-4 py-3">
                <h2 className="text-white font-semibold">📝 รายการทั้งหมด</h2>
              </div>
              {loadingLogs ? (
                <p className="text-center text-gray-400 py-8">กำลังโหลด...</p>
              ) : logs.length === 0 ? (
                <p className="text-center text-gray-400 py-8">ไม่มีข้อมูล</p>
              ) : (
                <div className="divide-y max-h-[50vh] overflow-y-auto">
                  {logs.map(l => (
                    <div key={l.id} className="px-4 py-3">
                      {editingLog?.id === l.id ? (
                        <div className="space-y-2">
                          <p className="font-medium text-sm text-blue-600">{l.product_name}</p>
                          <div className="flex rounded-xl overflow-hidden border border-gray-200">
                            <button onClick={() => setEditingLog(e => e ? { ...e, action: 'out' } : e)}
                              className={`flex-1 py-1.5 text-xs font-medium ${editingLog.action === 'out' ? 'bg-red-500 text-white' : 'bg-white text-gray-500'}`}>จ่ายออก</button>
                            <button onClick={() => setEditingLog(e => e ? { ...e, action: 'in' } : e)}
                              className={`flex-1 py-1.5 text-xs font-medium ${editingLog.action === 'in' ? 'bg-green-500 text-white' : 'bg-white text-gray-500'}`}>รับเข้า</button>
                          </div>
                          <div className="flex gap-2">
                            <input type="number" value={editingLog.quantity}
                              onChange={e => setEditingLog(ev => ev ? { ...ev, quantity: parseInt(e.target.value) || 1 } : ev)}
                              className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400" />
                            <select value={editingLog.unit}
                              onChange={e => setEditingLog(ev => ev ? { ...ev, unit: e.target.value } : ev)}
                              className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none">
                              {unitOptions.map(u => <option key={u}>{u}</option>)}
                            </select>
                          </div>
                          <input type="text" placeholder="หมายเหตุ" value={editingLog.note}
                            onChange={e => setEditingLog(ev => ev ? { ...ev, note: e.target.value } : ev)}
                            className="w-full border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                          <div className="flex gap-2">
                            <button onClick={handleUpdateLog}
                              className="flex-1 bg-blue-600 text-white py-2 rounded-xl text-sm hover:bg-blue-700 transition">บันทึก</button>
                            <button onClick={() => setEditingLog(null)}
                              className="flex-1 border border-gray-200 text-gray-500 py-2 rounded-xl text-sm hover:bg-gray-50 transition">ยกเลิก</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-sm text-gray-800">{l.product_name}</p>
                            <p className="text-xs text-gray-400">{l.user_email} · {new Date(l.created_at).toLocaleDateString('th-TH')}</p>
                            <p className="text-xs mt-0.5">
                              <span className={`font-medium ${l.action === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                                {l.action === 'in' ? '🟢 รับเข้า' : '🔴 จ่ายออก'}
                              </span>
                              {' '}{l.quantity} {l.unit}
                              {l.note ? ` · ${l.note}` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2 ml-2">
                            <button onClick={() => setEditingLog(l)} className="text-blue-400 hover:text-blue-600">✏️</button>
                            <button onClick={() => handleDeleteLog(l.id)} className="text-red-400 hover:text-red-600">🗑</button>
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