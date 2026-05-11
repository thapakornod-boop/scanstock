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
  unit: string
  quantity: number
  note: string
  created_at: string
}

// Fix: PostgrestError does not have .status, use .code instead
function isAuthError(error: any): boolean {
  if (!error) return false
  return (
    error.message?.includes('JWT') ||
    error.message?.includes('401') ||
    error.code === 'PGRST301' ||
    error.code === '401'
  )
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
  const [savingNow, setSavingNow] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [searching, setSearching] = useState(false)
  const [lastSearched, setLastSearched] = useState('')

  const [logs, setLogs] = useState<ScanLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [editingLog, setEditingLog] = useState<ScanLog | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const router = useRouter()
  const supabase = createClient()

  const stopCamera = useCallback(() => {
    if (readerRef.current) {
      try { readerRef.current.reset() } catch {}
      readerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }
  }, [])

  const handleAuthError = useCallback(async () => {
    stopCamera()
    await supabase.auth.signOut()
    router.push('/')
  }, [router, stopCamera])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') handleAuthError()
    })
    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) { handleAuthError(); return }
      setUserName(data.user.email || '')
      setUserEmail(data.user.email || '')
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (tab === 'history' || tab === 'manage') fetchLogs()
    if (tab !== 'scan') { stopCamera(); setScanning(false) }
    if (tab === 'scan') { setScanning(true) }
  }, [tab])

  const fetchLogs = async () => {
    setLoadingLogs(true)
    let query = supabase
      .from('scan_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (tab === 'history') query = query.eq('user_email', userEmail)
    const { data, error } = await query
    if (isAuthError(error)) { handleAuthError(); return }
    setLogs(data || [])
    setLoadingLogs(false)
  }

  // ── Camera: use getUserMedia directly for max iOS/Android compat ──
  useEffect(() => {
    if (!scanning) return
    setCameraError('')
    let cancelled = false

    const startCamera = async () => {
      try {
        stopCamera()
        await new Promise(r => setTimeout(r, 400))
        if (cancelled) return

        // Try environment camera first, fallback to any camera
        let stream: MediaStream | null = null
        const constraints = [
          { video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: true, audio: false },
        ]

        for (const c of constraints) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(c)
            break
          } catch {}
        }

        if (!stream) throw new Error('NoCameraFound')
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.setAttribute('playsinline', 'true')
          videoRef.current.setAttribute('webkit-playsinline', 'true')
          videoRef.current.muted = true
          videoRef.current.autoplay = true
          await videoRef.current.play().catch(() => {})
        }

        if (cancelled) return

        const codeReader = new BrowserMultiFormatReader()
        readerRef.current = codeReader

        const decodeLoop = async () => {
          while (!cancelled && streamRef.current && videoRef.current) {
            try {
              const result = await codeReader.decodeOnceFromStream(streamRef.current, videoRef.current)
              if (!cancelled) {
                cancelled = true
                stopCamera()
                setScanning(false)
                fetchByBarcode(result.getText())
              }
              break
            } catch (err: any) {
              if (err instanceof NotFoundException) { await new Promise(r => setTimeout(r, 100)); continue }
              break
            }
          }
        }
        decodeLoop()
      } catch (err: any) {
        if (cancelled) return
        stopCamera()
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError('ไม่ได้รับอนุญาตให้ใช้กล้อง\nกรุณาอนุญาตในการตั้งค่าเบราว์เซอร์')
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setCameraError('กล้องถูกใช้งานโดยแอปอื่นอยู่\nกรุณาปิดแอปอื่นแล้วลองใหม่')
        } else if (err.name === 'NotFoundError' || err.message === 'NoCameraFound') {
          setCameraError('ไม่พบกล้องในอุปกรณ์นี้')
        } else {
          setCameraError(`เกิดข้อผิดพลาด: ${err.name || err.message}`)
        }
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

    const { data, error } = await supabase
      .from('pricelist')
      .select('*')
      .or(`barcode_piece.eq.${cleaned},barcode_case.eq.${cleaned},barcode_pack.eq.${cleaned},item_code.eq.${cleaned}`)
      .limit(1)
      .single()

    if (isAuthError(error)) { handleAuthError(); return }
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

  // บันทึกทันที
  const handleSaveNow = async () => {
    if (!currentEntry) return
    setSavingNow(true)
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) { handleAuthError(); return }

    const record = buildRecord(currentEntry, user.id)
    const { error } = await supabase.from('scan_logs').insert([record])
    if (isAuthError(error)) { handleAuthError(); return }

    setSavingNow(false)
    setCurrentEntry(null)
    setNotFound(false)
    setManualBarcode('')
    setSuccessMsg('✅ บันทึกสำเร็จ 1 รายการ')
    setTimeout(() => {
      setSuccessMsg('')
      setScanning(true)
    }, 1800)
  }

  // เก็บในรายการ แล้วสแกนต่อ
  const handleAddEntry = () => {
    if (!currentEntry) return
    setEntries(prev => [...prev, currentEntry])
    setCurrentEntry(null)
    setNotFound(false)
    setManualBarcode('')
    setTimeout(() => setScanning(true), 300)
  }

  // บันทึกทั้งหมดที่เก็บไว้
  const handleSaveAll = async () => {
    if (entries.length === 0) return
    setSaving(true)
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) { handleAuthError(); return }

    const records = entries.map(e => buildRecord(e, user.id))
    const { error } = await supabase.from('scan_logs').insert(records)
    if (isAuthError(error)) { handleAuthError(); return }

    setSuccessMsg(`✅ บันทึกสำเร็จ ${records.length} รายการ`)
    setEntries([])
    setSaving(false)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const buildRecord = (e: ScanEntry, userId: string) => ({
    user_id: userId,
    user_email: userEmail,
    barcode: e.barcodeType === 'piece' ? e.priceItem.barcode_piece
      : e.barcodeType === 'case' ? e.priceItem.barcode_case
      : e.priceItem.barcode_pack,
    item_code: e.priceItem.item_code,
    product_name: e.priceItem.item_name,
    brand: e.priceItem.brand,
    size: e.priceItem.size,
    unit: e.unit,
    quantity: e.quantity,
    note: e.note,
  })

  const handleDeleteEntry = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx))
  }

  const handleDeleteLog = async (id: string) => {
    const { error } = await supabase.from('scan_logs').delete().eq('id', id)
    if (isAuthError(error)) { handleAuthError(); return }
    fetchLogs()
  }

  const handleUpdateLog = async () => {
    if (!editingLog) return
    const { error } = await supabase.from('scan_logs').update({
      quantity: editingLog.quantity,
      unit: editingLog.unit,
      note: editingLog.note,
    }).eq('id', editingLog.id)
    if (isAuthError(error)) { handleAuthError(); return }
    setEditingLog(null)
    fetchLogs()
  }

  const handleDownload = () => {
    let filtered = logs
    if (dateFrom) filtered = filtered.filter(l => l.created_at >= dateFrom)
    if (dateTo) filtered = filtered.filter(l => l.created_at <= dateTo + 'T23:59:59')

    const header = 'วันที่,ผู้บันทึก,รหัสสินค้า,ชื่อสินค้า,แบรนด์,ขนาด,จำนวน,หน่วย,หมายเหตุ\n'
    const rows = filtered.map(l =>
      `${new Date(l.created_at).toLocaleString('th-TH')},${l.user_email},${l.item_code},${l.product_name},${l.brand},${l.size},${l.quantity},${l.unit},${l.note}`
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

  const barcodeBadge = (type: BarcodeType) => {
    const map = {
      piece: { label: 'บาร์ชิ้น', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
      case: { label: 'บาร์ลัง', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
      pack: { label: 'บาร์แพ็ค', cls: 'bg-violet-100 text-violet-700 border-violet-200' },
    }
    return map[type]
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

        * { box-sizing: border-box; }

        body {
          font-family: 'Sarabun', sans-serif;
          background: #0f1117;
          color: #e2e8f0;
        }

        .scan-root {
          min-height: 100dvh;
          background: #0f1117;
          font-family: 'Sarabun', sans-serif;
        }

        /* Header */
        .hdr {
          background: #1a1d27;
          border-bottom: 1px solid #2a2d3a;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 50;
        }
        .hdr-logo { display: flex; align-items: center; gap: 12px; }
        .hdr-user {
          font-size: 12px;
          color: #64748b;
          font-family: 'IBM Plex Mono', monospace;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .btn-logout {
          font-size: 12px;
          color: #f87171;
          background: rgba(248,113,113,0.08);
          border: 1px solid rgba(248,113,113,0.2);
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s;
          font-family: 'Sarabun', sans-serif;
        }
        .btn-logout:hover { background: rgba(248,113,113,0.15); }

        /* Tabs */
        .tabs {
          background: #1a1d27;
          border-bottom: 1px solid #2a2d3a;
          display: flex;
        }
        .tab-btn {
          flex: 1;
          padding: 14px 8px;
          font-size: 13px;
          font-weight: 500;
          color: #475569;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          transition: all 0.2s;
          font-family: 'Sarabun', sans-serif;
        }
        .tab-btn.active {
          color: #38bdf8;
          border-bottom-color: #38bdf8;
          background: rgba(56,189,248,0.04);
        }

        /* Main container */
        .main {
          max-width: 520px;
          margin: 0 auto;
          padding: 16px;
          padding-bottom: 32px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        /* Card */
        .card {
          background: #1a1d27;
          border: 1px solid #2a2d3a;
          border-radius: 16px;
          overflow: hidden;
        }
        .card-header {
          padding: 14px 18px;
          border-bottom: 1px solid #2a2d3a;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .card-header h2 {
          font-size: 14px;
          font-weight: 600;
          color: #e2e8f0;
          margin: 0;
        }
        .card-header.accent { background: linear-gradient(135deg, #0f4c75 0%, #1b6ca8 100%); }
        .card-body { padding: 18px; }

        /* Camera */
        .camera-wrap {
          position: relative;
          background: #000;
          aspect-ratio: 4/3;
        }
        .camera-wrap video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .scan-line {
          position: absolute;
          left: 12%;
          right: 12%;
          top: 50%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #38bdf8, transparent);
          animation: scanPulse 1.8s ease-in-out infinite;
        }
        @keyframes scanPulse {
          0%, 100% { opacity: 0.4; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-2px); }
        }
        .corner {
          position: absolute;
          width: 24px;
          height: 24px;
          border-color: #38bdf8;
          border-style: solid;
        }
        .corner-tl { top: 16px; left: 16px; border-width: 3px 0 0 3px; border-radius: 4px 0 0 0; }
        .corner-tr { top: 16px; right: 16px; border-width: 3px 3px 0 0; border-radius: 0 4px 0 0; }
        .corner-bl { bottom: 16px; left: 16px; border-width: 0 0 3px 3px; border-radius: 0 0 0 4px; }
        .corner-br { bottom: 16px; right: 16px; border-width: 0 3px 3px 0; border-radius: 0 0 4px 0; }
        .camera-hint {
          text-align: center;
          font-size: 12px;
          color: #475569;
          padding: 10px;
        }

        /* Camera error */
        .cam-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 32px 20px;
          text-align: center;
        }
        .cam-error .icon { font-size: 48px; }
        .cam-error p { color: #94a3b8; font-size: 14px; white-space: pre-line; margin: 0; }

        /* Manual search */
        .manual-row {
          display: flex;
          gap: 8px;
          padding: 12px 14px 14px;
        }
        .input-wrap {
          flex: 1;
          position: relative;
        }
        .input-icon {
          position: absolute;
          left: 11px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 14px;
          pointer-events: none;
        }
        .inp {
          width: 100%;
          background: #0f1117;
          border: 1px solid #2a2d3a;
          border-radius: 10px;
          color: #e2e8f0;
          font-size: 14px;
          font-family: 'Sarabun', sans-serif;
          padding: 10px 12px 10px 34px;
          outline: none;
          transition: border-color 0.15s;
        }
        .inp:focus { border-color: #38bdf8; }
        .inp::placeholder { color: #475569; }

        /* Buttons */
        .btn {
          border: none;
          border-radius: 10px;
          font-family: 'Sarabun', sans-serif;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-sm { font-size: 13px; padding: 8px 16px; }
        .btn-md { font-size: 14px; padding: 11px 18px; }
        .btn-lg { font-size: 15px; padding: 14px 20px; width: 100%; }

        .btn-primary { background: #0ea5e9; color: #fff; }
        .btn-primary:hover:not(:disabled) { background: #38bdf8; }

        .btn-success { background: #10b981; color: #fff; }
        .btn-success:hover:not(:disabled) { background: #34d399; }

        .btn-danger-soft { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
        .btn-danger-soft:hover:not(:disabled) { background: rgba(239,68,68,0.18); }

        .btn-ghost { background: rgba(255,255,255,0.04); color: #94a3b8; border: 1px solid #2a2d3a; }
        .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.08); }

        .btn-out { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }
        .btn-out.active { background: #ef4444; color: #fff; border-color: #ef4444; }
        .btn-in { background: rgba(16,185,129,0.1); color: #34d399; border: 1px solid rgba(16,185,129,0.25); }
        .btn-in.active { background: #10b981; color: #fff; border-color: #10b981; }

        /* Toggle group */
        .toggle-group {
          display: flex;
          gap: 8px;
        }
        .toggle-group button { flex: 1; padding: 10px; font-size: 14px; font-weight: 600; border-radius: 10px; border: none; cursor: pointer; transition: all 0.15s; font-family: 'Sarabun', sans-serif; }

        /* Qty row */
        .qty-row { display: flex; align-items: center; gap: 8px; }
        .qty-btn {
          width: 44px;
          height: 44px;
          background: #0f1117;
          border: 1px solid #2a2d3a;
          border-radius: 10px;
          color: #e2e8f0;
          font-size: 22px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
        }
        .qty-btn:hover { background: #1e2130; }
        .qty-input {
          flex: 1;
          text-align: center;
          font-size: 20px;
          font-weight: 700;
          background: #0f1117;
          border: 1px solid #2a2d3a;
          border-radius: 10px;
          color: #e2e8f0;
          padding: 8px;
          outline: none;
          font-family: 'IBM Plex Mono', monospace;
        }
        .qty-input:focus { border-color: #38bdf8; }
        .unit-select {
          background: #0f1117;
          border: 1px solid #2a2d3a;
          border-radius: 10px;
          color: #e2e8f0;
          padding: 10px 12px;
          font-size: 13px;
          font-family: 'Sarabun', sans-serif;
          outline: none;
          cursor: pointer;
        }
        .unit-select:focus { border-color: #38bdf8; }

        /* Product info */
        .product-title { font-size: 15px; font-weight: 600; color: #38bdf8; margin: 0 0 10px; }
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
        .meta-box { background: #0f1117; border: 1px solid #2a2d3a; border-radius: 10px; padding: 10px 12px; }
        .meta-label { font-size: 11px; color: #475569; font-family: 'IBM Plex Mono', monospace; margin-bottom: 2px; }
        .meta-value { font-size: 13px; font-weight: 600; color: #cbd5e1; }

        /* Badge */
        .badge {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 20px;
          border: 1px solid;
          font-family: 'IBM Plex Mono', monospace;
        }

        /* Divider buttons */
        .action-buttons {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }

        /* Not found */
        .not-found {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 32px 20px;
          text-align: center;
        }
        .not-found .icon { font-size: 44px; }
        .not-found p { margin: 0; }
        .barcode-mono {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          background: #0f1117;
          border: 1px solid #2a2d3a;
          padding: 4px 12px;
          border-radius: 6px;
          color: #64748b;
        }

        /* Success */
        .success-bar {
          background: rgba(16,185,129,0.1);
          border: 1px solid rgba(16,185,129,0.25);
          border-radius: 12px;
          padding: 14px 18px;
          text-align: center;
          color: #34d399;
          font-weight: 600;
          font-size: 15px;
        }

        /* Entries list */
        .entry-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 18px;
          border-bottom: 1px solid #2a2d3a;
        }
        .entry-item:last-child { border-bottom: none; }
        .entry-name { font-size: 14px; font-weight: 500; color: #e2e8f0; }
        .entry-meta { font-size: 12px; color: #64748b; margin-top: 2px; }

        /* Log item */
        .log-item {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 12px 18px;
          border-bottom: 1px solid #1e2130;
          gap: 10px;
        }
        .log-item:last-child { border-bottom: none; }
        .log-name { font-size: 13px; font-weight: 500; color: #e2e8f0; }
        .log-meta { font-size: 11px; color: #475569; font-family: 'IBM Plex Mono', monospace; margin-top: 2px; }
        .log-action { font-size: 12px; font-weight: 600; margin-top: 4px; }
        .log-action.in { color: #34d399; }
        .log-action.out { color: #f87171; }
        .log-date { font-size: 11px; color: #334155; white-space: nowrap; font-family: 'IBM Plex Mono', monospace; }

        /* Date inputs */
        .date-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .date-label { font-size: 11px; color: #475569; margin-bottom: 5px; font-family: 'IBM Plex Mono', monospace; }
        .date-inp {
          width: 100%;
          background: #0f1117;
          border: 1px solid #2a2d3a;
          border-radius: 10px;
          color: #e2e8f0;
          font-size: 13px;
          padding: 9px 12px;
          outline: none;
          font-family: 'Sarabun', sans-serif;
        }
        .date-inp:focus { border-color: #38bdf8; }

        /* Scrollable */
        .scroll-area { max-height: 55vh; overflow-y: auto; }
        .scroll-area::-webkit-scrollbar { width: 4px; }
        .scroll-area::-webkit-scrollbar-thumb { background: #2a2d3a; border-radius: 4px; }

        /* Edit form */
        .edit-form { padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; background: #0f1117; }
        .edit-form .inp { padding-left: 12px; }

        /* Responsive */
        @media (max-width: 400px) {
          .main { padding: 12px; gap: 12px; }
          .hdr { padding: 10px 14px; }
          .tab-btn { font-size: 12px; padding: 12px 4px; }
        }
      `}</style>

      <div className="scan-root">
        {/* Header */}
        <div className="hdr">
          <div className="hdr-logo">
            <Image
              src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png"
              alt="RSM"
              width={72}
              height={28}
              unoptimized
              style={{ objectFit: 'contain', filter: 'brightness(1.2)' }}
            />
            <span className="hdr-user">{userName}</span>
          </div>
          <button
            className="btn-logout"
            onClick={async () => { stopCamera(); await supabase.auth.signOut(); router.push('/') }}
          >
            ออกจากระบบ
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs">
          {[
            { key: 'scan', label: '📷 สแกน' },
            { key: 'history', label: '📋 ประวัติฉัน' },
            { key: 'manage', label: '⚙️ จัดการ' },
          ].map(t => (
            <button
              key={t.key}
              className={`tab-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key as TabType)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="main">

          {/* ===== TAB: SCAN ===== */}
          {tab === 'scan' && (
            <>
              {successMsg && !entries.length && (
                <div className="success-bar">{successMsg}</div>
              )}

              {/* Camera Card */}
              {scanning && (
                <div className="card">
                  <div className="card-header accent">
                    <h2>📷 สแกนบาร์โค้ด</h2>
                  </div>

                  {cameraError ? (
                    <div className="cam-error">
                      <span className="icon">📵</span>
                      <p>{cameraError}</p>
                      <button
                        className="btn btn-primary btn-md"
                        onClick={() => { setCameraError(''); setScanning(false); setTimeout(() => setScanning(true), 400) }}
                      >
                        ลองใหม่
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="camera-wrap">
                        {/* CRITICAL for iOS: playsinline + muted + autoPlay */}
                        <video
                          ref={videoRef}
                          playsInline
                          muted
                          autoPlay
                          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <div className="scan-line" />
                        <div className="corner corner-tl" />
                        <div className="corner corner-tr" />
                        <div className="corner corner-bl" />
                        <div className="corner corner-br" />
                      </div>
                      <p className="camera-hint">จ่อบาร์โค้ดให้ตรงกรอบเพื่อสแกนอัตโนมัติ</p>
                    </>
                  )}

                  {/* Manual search */}
                  <div className="manual-row">
                    <div className="input-wrap">
                      <span className="input-icon">🔍</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="inp"
                        value={manualBarcode}
                        onChange={e => setManualBarcode(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                        placeholder="พิมพ์บาร์โค้ด / รหัสสินค้า"
                      />
                    </div>
                    <button
                      className="btn btn-primary btn-md"
                      onClick={handleManualSearch}
                      disabled={searching || !manualBarcode.trim()}
                    >
                      {searching ? '...' : 'ค้นหา'}
                    </button>
                  </div>
                </div>
              )}

              {/* Not Found */}
              {notFound && (
                <div className="card">
                  <div className="not-found">
                    <span className="icon">❌</span>
                    <p style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 15 }}>ไม่พบสินค้าในระบบ</p>
                    <span className="barcode-mono">{lastSearched}</span>
                    <button
                      className="btn btn-primary btn-md"
                      style={{ marginTop: 6 }}
                      onClick={() => { setNotFound(false); setScanning(true) }}
                    >
                      📷 สแกนใหม่
                    </button>
                  </div>
                </div>
              )}

              {/* Current Entry Form */}
              {currentEntry && (
                <div className="card">
                  <div className="card-header">
                    <h2>กรอกข้อมูลสินค้า</h2>
                    {(() => {
                      const b = barcodeBadge(currentEntry.barcodeType)
                      return <span className="badge" style={{ background: 'none' }} >{b.label}</span>
                    })()}
                  </div>
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <p className="product-title">{currentEntry.priceItem.item_name}</p>

                    <div className="meta-grid">
                      <div className="meta-box">
                        <div className="meta-label">รหัสสินค้า</div>
                        <div className="meta-value">{currentEntry.priceItem.item_code}</div>
                      </div>
                      <div className="meta-box">
                        <div className="meta-label">ขนาด</div>
                        <div className="meta-value">{currentEntry.priceItem.size || '—'}</div>
                      </div>
                      <div className="meta-box">
                        <div className="meta-label">แบรนด์</div>
                        <div className="meta-value">{currentEntry.priceItem.brand || '—'}</div>
                      </div>
                      <div className="meta-box">
                        <div className="meta-label">ประเภทบาร์</div>
                        <div className="meta-value">{barcodeBadge(currentEntry.barcodeType).label}</div>
                      </div>
                    </div>

                    {/* Qty */}
                    <div className="qty-row">
                      <button
                        className="qty-btn"
                        onClick={() => setCurrentEntry(e => e ? { ...e, quantity: Math.max(1, e.quantity - 1) } : e)}
                      >−</button>
                      <input
                        type="number"
                        className="qty-input"
                        value={currentEntry.quantity}
                        onChange={ev => setCurrentEntry(e => e ? { ...e, quantity: Math.max(1, parseInt(ev.target.value) || 1) } : e)}
                      />
                      <button
                        className="qty-btn"
                        onClick={() => setCurrentEntry(e => e ? { ...e, quantity: e.quantity + 1 } : e)}
                      >+</button>
                      <select
                        className="unit-select"
                        value={currentEntry.unit}
                        onChange={ev => setCurrentEntry(e => e ? { ...e, unit: ev.target.value } : e)}
                      >
                        {unitOptions.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>

                    {/* Note */}
                    <input
                      type="text"
                      className="inp"
                      style={{ paddingLeft: 12 }}
                      placeholder="หมายเหตุ (ถ้ามี)"
                      value={currentEntry.note}
                      onChange={ev => setCurrentEntry(e => e ? { ...e, note: ev.target.value } : e)}
                    />

                    {/* Save NOW */}
                    <button
                      className="btn btn-success btn-lg"
                      onClick={handleSaveNow}
                      disabled={savingNow}
                    >
                      {savingNow ? 'กำลังบันทึก...' : '💾 บันทึกทันที'}
                    </button>

                    <div style={{ display: 'flex', gap: 8 }}>
                      {/* Queue */}
                      <button
                        className="btn btn-primary btn-md"
                        style={{ flex: 1 }}
                        onClick={handleAddEntry}
                      >
                        ➕ เก็บในรายการ
                      </button>
                      {/* Rescan */}
                      <button
                        className="btn btn-ghost btn-md"
                        style={{ flex: 1 }}
                        onClick={() => { setCurrentEntry(null); setManualBarcode(''); setScanning(true) }}
                      >
                        📷 สแกนใหม่
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Pending Entries */}
              {entries.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h2>📦 รายการรอบันทึก</h2>
                    <span className="badge" style={{ background: '#1e40af', color: '#93c5fd', borderColor: '#1e40af' }}>
                      {entries.length} รายการ
                    </span>
                  </div>
                  <div className="scroll-area">
                    {entries.map((e, idx) => (
                      <div key={idx} className="entry-item">
                        <div>
                          <div className="entry-name">{e.priceItem.item_name}</div>
                          <div className="entry-meta">
                            {e.quantity} {e.unit}
                            {e.note ? ` · ${e.note}` : ''}
                          </div>
                        </div>
                        <button
                          className="btn btn-danger-soft btn-sm"
                          onClick={() => handleDeleteEntry(idx)}
                        >🗑</button>
                      </div>
                    ))}
                  </div>
                  {successMsg && <div className="success-bar" style={{ margin: '0 16px 12px' }}>{successMsg}</div>}
                  <div style={{ padding: 16 }}>
                    <button
                      className="btn btn-success btn-lg"
                      onClick={handleSaveAll}
                      disabled={saving}
                    >
                      {saving ? 'กำลังบันทึก...' : `💾 บันทึกทั้งหมด ${entries.length} รายการ`}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ===== TAB: HISTORY ===== */}
          {tab === 'history' && (
            <div className="card">
              <div className="card-header accent">
                <h2>📋 ประวัติการบันทึกของฉัน</h2>
              </div>
              {loadingLogs ? (
                <p style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>กำลังโหลด...</p>
              ) : logs.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>ยังไม่มีประวัติ</p>
              ) : (
                <div className="scroll-area">
                  {logs.map(l => (
                    <div key={l.id} className="log-item">
                      <div style={{ flex: 1 }}>
                        <div className="log-name">{l.product_name}</div>
                        <div className="log-meta">{l.item_code} · {l.brand} · {l.size}</div>
                        <div className="log-action">
                          {l.quantity} {l.unit}
                          {l.note ? ` · ${l.note}` : ''}
                        </div>
                      </div>
                      <div className="log-date">
                        {new Date(l.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })}
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
              <div className="card">
                <div className="card-header">
                  <h2>⬇️ ดาวน์โหลดข้อมูล CSV</h2>
                </div>
                <div className="card-body">
                  <div className="date-grid">
                    <div>
                      <div className="date-label">จากวันที่</div>
                      <input type="date" className="date-inp" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                    </div>
                    <div>
                      <div className="date-label">ถึงวันที่</div>
                      <input type="date" className="date-inp" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                    </div>
                  </div>
                  <button className="btn btn-success btn-lg" onClick={handleDownload}>
                    ⬇️ Download CSV
                  </button>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h2>📝 รายการทั้งหมด</h2>
                  {!loadingLogs && logs.length > 0 && (
                    <span className="badge" style={{ background: '#1e293b', color: '#64748b', borderColor: '#334155' }}>
                      {logs.length}
                    </span>
                  )}
                </div>
                {loadingLogs ? (
                  <p style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>กำลังโหลด...</p>
                ) : logs.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>ไม่มีข้อมูล</p>
                ) : (
                  <div className="scroll-area">
                    {logs.map(l => (
                      <div key={l.id}>
                        {editingLog?.id === l.id ? (
                          <div className="edit-form">
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#38bdf8' }}>{l.product_name}</p>
                            <div className="qty-row">
                              <input
                                type="number"
                                className="qty-input"
                                style={{ fontSize: 15 }}
                                value={editingLog.quantity}
                                onChange={e => setEditingLog(ev => ev ? { ...ev, quantity: parseInt(e.target.value) || 1 } : ev)}
                              />
                              <select
                                className="unit-select"
                                value={editingLog.unit}
                                onChange={e => setEditingLog(ev => ev ? { ...ev, unit: e.target.value } : ev)}
                              >
                                {unitOptions.map(u => <option key={u}>{u}</option>)}
                              </select>
                            </div>
                            <input
                              type="text"
                              className="inp"
                              style={{ paddingLeft: 12 }}
                              placeholder="หมายเหตุ"
                              value={editingLog.note}
                              onChange={e => setEditingLog(ev => ev ? { ...ev, note: e.target.value } : ev)}
                            />
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button className="btn btn-primary btn-md" style={{ flex: 1 }} onClick={handleUpdateLog}>บันทึก</button>
                              <button className="btn btn-ghost btn-md" style={{ flex: 1 }} onClick={() => setEditingLog(null)}>ยกเลิก</button>
                            </div>
                          </div>
                        ) : (
                          <div className="log-item">
                            <div style={{ flex: 1 }}>
                              <div className="log-name">{l.product_name}</div>
                              <div className="log-meta">{l.user_email} · {new Date(l.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>
                              <div className="log-action">
                                {l.quantity} {l.unit}
                                {l.note ? ` · ${l.note}` : ''}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditingLog(l)}>✏️</button>
                              <button className="btn btn-danger-soft btn-sm" onClick={() => handleDeleteLog(l.id)}>🗑</button>
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
    </>
  )
}