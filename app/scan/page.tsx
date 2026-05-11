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
  employee_id: string
  employee_name: string
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
  const [employeeId, setEmployeeId] = useState('')
  const [employeeName, setEmployeeName] = useState('')
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

  // ── Auth: ใช้ localStorage แทน Supabase Auth ──
  useEffect(() => {
    const empId = localStorage.getItem('rsm_employee_id')
    const empName = localStorage.getItem('rsm_employee_name')
    const loggedIn = localStorage.getItem('rsm_logged_in')
    if (!empId || !loggedIn) {
      router.push('/')
      return
    }
    setEmployeeId(empId)
    setEmployeeName(empName || empId)
  }, [router])

  const handleLogout = useCallback(() => {
    stopCamera()
    localStorage.removeItem('rsm_employee_id')
    localStorage.removeItem('rsm_employee_name')
    localStorage.removeItem('rsm_logged_in')
    router.push('/')
  }, [router])

  // ── Camera ──
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
    if (tab === 'history') {
      const empId = localStorage.getItem('rsm_employee_id')
      if (empId) query = query.eq('employee_id', empId)
    }
    const { data } = await query
    setLogs(data || [])
    setLoadingLogs(false)
  }

  // ── Camera useEffect ──
  useEffect(() => {
    if (!scanning) return
    setCameraError('')
    let cancelled = false

    const startCamera = async () => {
      try {
        stopCamera()
        await new Promise(r => setTimeout(r, 400))
        if (cancelled) return

        let stream: MediaStream | null = null
        const constraints = [
          { video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: true, audio: false },
        ]

        for (const c of constraints) {
          try { stream = await navigator.mediaDevices.getUserMedia(c); break } catch {}
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

  // ── Barcode lookup ──
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

  // ── Build record (ใช้ employee_id จาก localStorage) ──
  const buildRecord = (e: ScanEntry) => ({
    employee_id: employeeId,
    employee_name: employeeName,
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

  // ── บันทึกทันที ──
  const handleSaveNow = async () => {
    if (!currentEntry || !employeeId) return
    setSavingNow(true)
    const { error } = await supabase.from('scan_logs').insert([buildRecord(currentEntry)])
    if (error) { console.error(error); setSavingNow(false); return }
    setSavingNow(false)
    setCurrentEntry(null)
    setNotFound(false)
    setManualBarcode('')
    setSuccessMsg('✅ บันทึกสำเร็จ 1 รายการ')
    setTimeout(() => { setSuccessMsg(''); setScanning(true) }, 1800)
  }

  // ── เก็บในรายการ แล้วสแกนต่อ ──
  const handleAddEntry = () => {
    if (!currentEntry) return
    setEntries(prev => [...prev, currentEntry])
    setCurrentEntry(null)
    setNotFound(false)
    setManualBarcode('')
    setTimeout(() => setScanning(true), 300)
  }

  // ── บันทึกทั้งหมด ──
  const handleSaveAll = async () => {
    if (entries.length === 0 || !employeeId) return
    setSaving(true)
    const records = entries.map(e => buildRecord(e))
    const { error } = await supabase.from('scan_logs').insert(records)
    if (error) { console.error(error); setSaving(false); return }
    setSuccessMsg(`✅ บันทึกสำเร็จ ${records.length} รายการ`)
    setEntries([])
    setSaving(false)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const handleDeleteEntry = (idx: number) => setEntries(prev => prev.filter((_, i) => i !== idx))

  const handleDeleteLog = async (id: string) => {
    await supabase.from('scan_logs').delete().eq('id', id)
    fetchLogs()
  }

  const handleUpdateLog = async () => {
    if (!editingLog) return
    await supabase.from('scan_logs').update({
      quantity: editingLog.quantity,
      unit: editingLog.unit,
      note: editingLog.note,
    }).eq('id', editingLog.id)
    setEditingLog(null)
    fetchLogs()
  }

  const handleDownload = () => {
    let filtered = logs
    if (dateFrom) filtered = filtered.filter(l => l.created_at >= dateFrom)
    if (dateTo) filtered = filtered.filter(l => l.created_at <= dateTo + 'T23:59:59')

    const header = 'วันที่,รหัสพนักงาน,ชื่อพนักงาน,รหัสสินค้า,ชื่อสินค้า,แบรนด์,ขนาด,จำนวน,หน่วย,หมายเหตุ\n'
    const rows = filtered.map(l =>
      `${new Date(l.created_at).toLocaleString('th-TH')},${l.employee_id},${l.employee_name},${l.item_code},${l.product_name},${l.brand},${l.size},${l.quantity},${l.unit},${l.note}`
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
      piece: { label: 'บาร์ชิ้น', color: '#0ea5e9' },
      case:  { label: 'บาร์ลัง',  color: '#f59e0b' },
      pack:  { label: 'บาร์แพ็ค', color: '#8b5cf6' },
    }
    return map[type]
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
        html, body { overflow-x: hidden; width: 100%; }
        body {
          font-family: 'Sarabun', sans-serif;
          background: #0a0d14;
          color: #e2e8f0;
        }

        .scan-root {
          min-height: 100dvh;
          width: 100%;
          background: #0a0d14;
        }

        /* ── Header ── */
        .hdr {
          background: rgba(16, 20, 32, 0.95);
          border-bottom: 1px solid #1e2235;
          padding: 11px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 100;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .hdr-left { display: flex; align-items: center; gap: 12px; }
        .hdr-user-info { display: flex; flex-direction: column; gap: 1px; }
        .hdr-name {
          font-size: 13px;
          font-weight: 600;
          color: #cbd5e1;
          line-height: 1.2;
        }
        .hdr-id {
          font-size: 11px;
          color: #38bdf8;
          font-family: 'IBM Plex Mono', monospace;
          letter-spacing: 0.04em;
        }
        .btn-logout {
          font-size: 12px;
          font-weight: 600;
          color: #f87171;
          background: rgba(248,113,113,0.08);
          border: 1px solid rgba(248,113,113,0.18);
          padding: 7px 14px;
          border-radius: 9px;
          cursor: pointer;
          transition: all 0.15s;
          font-family: 'Sarabun', sans-serif;
          white-space: nowrap;
        }
        .btn-logout:hover { background: rgba(248,113,113,0.16); }

        /* ── Tabs ── */
        .tabs {
          background: rgba(16, 20, 32, 0.95);
          border-bottom: 1px solid #1e2235;
          display: flex;
          backdrop-filter: blur(12px);
        }
        .tab-btn {
          flex: 1;
          padding: 13px 6px;
          font-size: 13px;
          font-weight: 500;
          color: #475569;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          transition: all 0.2s;
          font-family: 'Sarabun', sans-serif;
          letter-spacing: 0.01em;
        }
        .tab-btn.active {
          color: #38bdf8;
          border-bottom-color: #38bdf8;
          background: rgba(56,189,248,0.04);
        }

        /* ── Main ── */
        .main {
          max-width: 520px;
          margin: 0 auto;
          padding: 14px 14px 40px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        /* ── Card ── */
        .card {
          background: #121623;
          border: 1px solid #1e2235;
          border-radius: 16px;
          overflow: hidden;
          width: 100%;
        }
        .card-header {
          padding: 13px 16px;
          border-bottom: 1px solid #1e2235;
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
        .card-header.accent {
          background: linear-gradient(135deg, #0c3a5c 0%, #0f4c75 100%);
          border-bottom-color: rgba(56,189,248,0.15);
        }
        .card-body { padding: 16px; }

        /* ── Camera ── */
        .camera-wrap {
          position: relative;
          background: #000;
          aspect-ratio: 4/3;
          overflow: hidden;
        }
        .camera-wrap video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .scan-line {
          position: absolute;
          left: 10%;
          right: 10%;
          top: 50%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #38bdf8 20%, #38bdf8 80%, transparent);
          animation: scanMove 2s ease-in-out infinite;
        }
        @keyframes scanMove {
          0%, 100% { top: 35%; opacity: 0.5; }
          50% { top: 65%; opacity: 1; }
        }
        .corner {
          position: absolute;
          width: 22px;
          height: 22px;
          border-color: #38bdf8;
          border-style: solid;
          opacity: 0.9;
        }
        .corner-tl { top: 14px; left: 14px; border-width: 3px 0 0 3px; border-radius: 3px 0 0 0; }
        .corner-tr { top: 14px; right: 14px; border-width: 3px 3px 0 0; border-radius: 0 3px 0 0; }
        .corner-bl { bottom: 14px; left: 14px; border-width: 0 0 3px 3px; border-radius: 0 0 0 3px; }
        .corner-br { bottom: 14px; right: 14px; border-width: 0 3px 3px 0; border-radius: 0 0 3px 0; }
        .camera-hint {
          text-align: center;
          font-size: 12px;
          color: #475569;
          padding: 9px 12px;
        }

        /* ── Camera error ── */
        .cam-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 30px 20px;
          text-align: center;
        }
        .cam-error .icon { font-size: 44px; }
        .cam-error p { color: #94a3b8; font-size: 13px; white-space: pre-line; margin: 0; line-height: 1.6; }

        /* ── Manual row ── */
        .manual-row {
          display: flex;
          gap: 8px;
          padding: 10px 12px 12px;
          border-top: 1px solid #1e2235;
        }
        .input-rel { position: relative; flex: 1; }
        .input-icon-abs {
          position: absolute;
          left: 11px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 14px;
          pointer-events: none;
          opacity: 0.6;
        }

        /* ── Inputs ── */
        .inp {
          width: 100%;
          background: #0a0d14;
          border: 1px solid #1e2235;
          border-radius: 10px;
          color: #e2e8f0;
          font-size: 15px;
          font-family: 'Sarabun', sans-serif;
          padding: 10px 12px 10px 34px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .inp:focus { border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,0.08); }
        .inp::placeholder { color: #334155; }
        .inp-bare {
          background: #0a0d14;
          border: 1px solid #1e2235;
          border-radius: 10px;
          color: #e2e8f0;
          font-size: 15px;
          font-family: 'Sarabun', sans-serif;
          padding: 10px 12px;
          outline: none;
          transition: border-color 0.15s;
          width: 100%;
        }
        .inp-bare:focus { border-color: #38bdf8; }
        .inp-bare::placeholder { color: #334155; }

        /* ── Buttons ── */
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
          -webkit-tap-highlight-color: transparent;
        }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn:active:not(:disabled) { transform: scale(0.97); }

        .btn-sm  { font-size: 13px; padding: 7px 14px; }
        .btn-md  { font-size: 14px; padding: 10px 16px; }
        .btn-lg  { font-size: 15px; padding: 13px 20px; width: 100%; }

        .btn-primary { background: #0ea5e9; color: #fff; }
        .btn-primary:hover:not(:disabled) { background: #38bdf8; }

        .btn-success { background: #10b981; color: #fff; }
        .btn-success:hover:not(:disabled) { background: #34d399; }

        .btn-ghost { background: rgba(255,255,255,0.04); color: #94a3b8; border: 1px solid #1e2235; }
        .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.08); }

        .btn-danger { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
        .btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.18); }

        /* ── Qty row ── */
        .qty-row { display: flex; align-items: center; gap: 8px; }
        .qty-btn {
          width: 44px; height: 44px;
          flex-shrink: 0;
          background: #0a0d14;
          border: 1px solid #1e2235;
          border-radius: 10px;
          color: #e2e8f0;
          font-size: 22px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
          -webkit-tap-highlight-color: transparent;
        }
        .qty-btn:hover { background: #1a1d2a; }
        .qty-btn:active { transform: scale(0.93); }
        .qty-input {
          flex: 1;
          min-width: 0;
          text-align: center;
          font-size: 22px;
          font-weight: 700;
          background: #0a0d14;
          border: 1px solid #1e2235;
          border-radius: 10px;
          color: #38bdf8;
          padding: 8px;
          outline: none;
          font-family: 'IBM Plex Mono', monospace;
        }
        .qty-input:focus { border-color: #38bdf8; }

        /* ── Unit buttons ── */
        .unit-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .unit-btn {
          flex: 1;
          min-width: 60px;
          padding: 9px 6px;
          font-size: 14px;
          font-weight: 600;
          font-family: 'Sarabun', sans-serif;
          border-radius: 10px;
          border: 1px solid #1e2235;
          background: #0a0d14;
          color: #475569;
          cursor: pointer;
          transition: all 0.15s;
          text-align: center;
          -webkit-tap-highlight-color: transparent;
        }
        .unit-btn.active { background: #0ea5e9; border-color: #0ea5e9; color: #fff; }
        .unit-btn:hover:not(.active) { border-color: #38bdf8; color: #38bdf8; }

        /* ── Product meta ── */
        .product-title {
          font-size: 15px;
          font-weight: 700;
          color: #38bdf8;
          margin: 0 0 12px;
          line-height: 1.4;
        }
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
        .meta-box {
          background: #0a0d14;
          border: 1px solid #1e2235;
          border-radius: 10px;
          padding: 9px 12px;
        }
        .meta-label { font-size: 10px; color: #334155; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 3px; }
        .meta-value { font-size: 13px; font-weight: 600; color: #cbd5e1; }

        /* ── Badge ── */
        .badge {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 20px;
          border: 1px solid;
          font-family: 'IBM Plex Mono', monospace;
        }

        /* ── Not found ── */
        .not-found {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 30px 20px;
          text-align: center;
        }
        .not-found .icon { font-size: 42px; }
        .barcode-mono {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          background: #0a0d14;
          border: 1px solid #1e2235;
          padding: 4px 12px;
          border-radius: 6px;
          color: #475569;
        }

        /* ── Success bar ── */
        .success-bar {
          background: rgba(16,185,129,0.08);
          border: 1px solid rgba(16,185,129,0.22);
          border-radius: 12px;
          padding: 13px 18px;
          text-align: center;
          color: #34d399;
          font-weight: 600;
          font-size: 15px;
        }

        /* ── Entry list ── */
        .entry-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 11px 16px;
          border-bottom: 1px solid #1a1d2a;
          gap: 10px;
        }
        .entry-item:last-child { border-bottom: none; }
        .entry-name { font-size: 14px; font-weight: 500; color: #e2e8f0; }
        .entry-meta { font-size: 12px; color: #475569; margin-top: 2px; }

        /* ── Log list ── */
        .log-item {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 11px 16px;
          border-bottom: 1px solid #161924;
          gap: 10px;
        }
        .log-item:last-child { border-bottom: none; }
        .log-name { font-size: 13px; font-weight: 500; color: #e2e8f0; }
        .log-meta { font-size: 11px; color: #334155; font-family: 'IBM Plex Mono', monospace; margin-top: 2px; }
        .log-qty { font-size: 13px; font-weight: 600; color: #94a3b8; margin-top: 3px; }
        .log-date { font-size: 11px; color: #2a3044; white-space: nowrap; font-family: 'IBM Plex Mono', monospace; }

        /* ── Date filter ── */
        .date-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .date-label { font-size: 11px; color: #475569; margin-bottom: 5px; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.04em; }
        .date-inp {
          width: 100%;
          background: #0a0d14;
          border: 1px solid #1e2235;
          border-radius: 10px;
          color: #e2e8f0;
          font-size: 13px;
          padding: 9px 12px;
          outline: none;
          font-family: 'Sarabun', sans-serif;
          transition: border-color 0.15s;
        }
        .date-inp:focus { border-color: #38bdf8; }

        /* ── Edit form ── */
        .edit-form {
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: #0d1018;
          border-bottom: 1px solid #1e2235;
        }
        .edit-title { font-size: 13px; font-weight: 600; color: #38bdf8; margin: 0; }

        /* ── Scroll ── */
        .scroll-area { max-height: 55vh; overflow-y: auto; }
        .scroll-area::-webkit-scrollbar { width: 3px; }
        .scroll-area::-webkit-scrollbar-thumb { background: #1e2235; border-radius: 3px; }

        /* ── Section label ── */
        .section-label {
          font-size: 11px;
          font-weight: 600;
          color: #334155;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-family: 'IBM Plex Mono', monospace;
          padding: 2px 0 6px;
        }

        @media (max-width: 400px) {
          .main { padding: 10px 10px 36px; gap: 10px; }
          .hdr { padding: 10px 12px; }
          .tab-btn { font-size: 12px; padding: 11px 4px; }
        }
      `}</style>

      <div className="scan-root">

        {/* ── Header ── */}
        <div className="hdr">
          <div className="hdr-left">
            <Image
              src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png"
              alt="RSM"
              width={68}
              height={26}
              unoptimized
              style={{ objectFit: 'contain', filter: 'brightness(1.2)', flexShrink: 0 }}
            />
            {employeeName && (
              <div className="hdr-user-info">
                <span className="hdr-name">{employeeName}</span>
                <span className="hdr-id">#{employeeId}</span>
              </div>
            )}
          </div>
          <button className="btn-logout" onClick={handleLogout}>ออกจากระบบ</button>
        </div>

        {/* ── Tabs ── */}
        <div className="tabs">
          {[
            { key: 'scan',    label: '📷 สแกน' },
            { key: 'history', label: '📋 ประวัติฉัน' },
            { key: 'manage',  label: '⚙️ จัดการ' },
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

          {/* ══════════ TAB: SCAN ══════════ */}
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
                      >ลองใหม่</button>
                    </div>
                  ) : (
                    <>
                      <div className="camera-wrap">
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
                    <div className="input-rel">
                      <span className="input-icon-abs">🔍</span>
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
                    <p style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 15, margin: 0 }}>ไม่พบสินค้าในระบบ</p>
                    <span className="barcode-mono">{lastSearched}</span>
                    <button
                      className="btn btn-primary btn-md"
                      style={{ marginTop: 6 }}
                      onClick={() => { setNotFound(false); setManualBarcode(''); setScanning(true) }}
                    >📷 สแกนใหม่</button>
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
                      return (
                        <span className="badge" style={{ color: b.color, borderColor: b.color + '44', background: b.color + '14' }}>
                          {b.label}
                        </span>
                      )
                    })()}
                  </div>
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
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
                        <div className="meta-value" style={{ color: barcodeBadge(currentEntry.barcodeType).color }}>
                          {barcodeBadge(currentEntry.barcodeType).label}
                        </div>
                      </div>
                    </div>

                    {/* Qty */}
                    <div>
                      <div className="section-label">จำนวน</div>
                      <div className="qty-row">
                        <button className="qty-btn" onClick={() => setCurrentEntry(e => e ? { ...e, quantity: Math.max(1, e.quantity - 1) } : e)}>−</button>
                        <input
                          type="number"
                          className="qty-input"
                          value={currentEntry.quantity}
                          onChange={ev => setCurrentEntry(e => e ? { ...e, quantity: Math.max(1, parseInt(ev.target.value) || 1) } : e)}
                        />
                        <button className="qty-btn" onClick={() => setCurrentEntry(e => e ? { ...e, quantity: e.quantity + 1 } : e)}>+</button>
                      </div>
                    </div>

                    {/* Unit */}
                    <div>
                      <div className="section-label">หน่วย</div>
                      <div className="unit-group">
                        {unitOptions.map(u => (
                          <button
                            key={u}
                            className={`unit-btn ${currentEntry.unit === u ? 'active' : ''}`}
                            onClick={() => setCurrentEntry(e => e ? { ...e, unit: u } : e)}
                          >{u}</button>
                        ))}
                      </div>
                    </div>

                    {/* Note */}
                    <input
                      type="text"
                      className="inp-bare"
                      placeholder="หมายเหตุ (ถ้ามี)"
                      value={currentEntry.note}
                      onChange={ev => setCurrentEntry(e => e ? { ...e, note: ev.target.value } : e)}
                    />

                    {/* Save now */}
                    <button className="btn btn-success btn-lg" onClick={handleSaveNow} disabled={savingNow}>
                      {savingNow ? 'กำลังบันทึก...' : '💾 บันทึกทันที'}
                    </button>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary btn-md" style={{ flex: 1 }} onClick={handleAddEntry}>
                        ➕ เก็บในรายการ
                      </button>
                      <button
                        className="btn btn-ghost btn-md" style={{ flex: 1 }}
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
                    <span className="badge" style={{ color: '#93c5fd', borderColor: '#1e3a8a', background: '#1e3a8a55' }}>
                      {entries.length} รายการ
                    </span>
                  </div>
                  <div className="scroll-area">
                    {entries.map((e, idx) => (
                      <div key={idx} className="entry-item">
                        <div style={{ flex: 1 }}>
                          <div className="entry-name">{e.priceItem.item_name}</div>
                          <div className="entry-meta">
                            {e.quantity} {e.unit}
                            {e.note ? ` · ${e.note}` : ''}
                          </div>
                        </div>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteEntry(idx)}>🗑</button>
                      </div>
                    ))}
                  </div>
                  {successMsg && <div className="success-bar" style={{ margin: '0 14px 12px' }}>{successMsg}</div>}
                  <div style={{ padding: '0 14px 14px' }}>
                    <button className="btn btn-success btn-lg" onClick={handleSaveAll} disabled={saving}>
                      {saving ? 'กำลังบันทึก...' : `💾 บันทึกทั้งหมด ${entries.length} รายการ`}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══════════ TAB: HISTORY ══════════ */}
          {tab === 'history' && (
            <div className="card">
              <div className="card-header accent">
                <h2>📋 ประวัติการบันทึกของฉัน</h2>
                {!loadingLogs && logs.length > 0 && (
                  <span className="badge" style={{ color: '#7dd3fc', borderColor: '#0c4a6e', background: '#0c4a6e55' }}>
                    {logs.length}
                  </span>
                )}
              </div>
              {loadingLogs ? (
                <p style={{ textAlign: 'center', color: '#334155', padding: '32px 0', fontSize: 14 }}>กำลังโหลด...</p>
              ) : logs.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#334155', padding: '32px 0', fontSize: 14 }}>ยังไม่มีประวัติ</p>
              ) : (
                <div className="scroll-area">
                  {logs.map(l => (
                    <div key={l.id} className="log-item">
                      <div style={{ flex: 1 }}>
                        <div className="log-name">{l.product_name}</div>
                        <div className="log-meta">{l.item_code} · {l.brand} · {l.size}</div>
                        <div className="log-qty">{l.quantity} {l.unit}{l.note ? ` · ${l.note}` : ''}</div>
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

          {/* ══════════ TAB: MANAGE ══════════ */}
          {tab === 'manage' && (
            <>
              {/* Download CSV */}
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

              {/* All logs */}
              <div className="card">
                <div className="card-header">
                  <h2>📝 รายการทั้งหมด</h2>
                  {!loadingLogs && logs.length > 0 && (
                    <span className="badge" style={{ color: '#475569', borderColor: '#1e2235', background: 'transparent' }}>
                      {logs.length}
                    </span>
                  )}
                </div>
                {loadingLogs ? (
                  <p style={{ textAlign: 'center', color: '#334155', padding: '32px 0', fontSize: 14 }}>กำลังโหลด...</p>
                ) : logs.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#334155', padding: '32px 0', fontSize: 14 }}>ไม่มีข้อมูล</p>
                ) : (
                  <div className="scroll-area">
                    {logs.map(l => (
                      <div key={l.id}>
                        {editingLog?.id === l.id ? (
                          <div className="edit-form">
                            <p className="edit-title">{l.product_name}</p>
                            <div className="qty-row">
                              <input
                                type="number"
                                className="qty-input"
                                style={{ fontSize: 16 }}
                                value={editingLog.quantity}
                                onChange={e => setEditingLog(ev => ev ? { ...ev, quantity: parseInt(e.target.value) || 1 } : ev)}
                              />
                            </div>
                            <div className="unit-group">
                              {unitOptions.map(u => (
                                <button
                                  key={u}
                                  className={`unit-btn ${editingLog.unit === u ? 'active' : ''}`}
                                  onClick={() => setEditingLog(ev => ev ? { ...ev, unit: u } : ev)}
                                >{u}</button>
                              ))}
                            </div>
                            <input
                              type="text"
                              className="inp-bare"
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
                              <div className="log-meta">
                                #{l.employee_id} {l.employee_name} · {new Date(l.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                              </div>
                              <div className="log-qty">{l.quantity} {l.unit}{l.note ? ` · ${l.note}` : ''}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditingLog(l)}>✏️</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleDeleteLog(l.id)}>🗑</button>
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