'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

type BarcodeType = 'piece' | 'case' | 'pack'

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

type Product = {
  id: string
  item_code: string
  item_name: string
  barcode: string
  on_hand: number
  stock_value: number
  uom: number
}

type ScanResult = {
  priceItem: PriceItem
  barcodeType: BarcodeType
  product: Product | null  // มีเฉพาะ barcode_piece
}

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const [scanning, setScanning] = useState(true)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [action, setAction] = useState<'in' | 'out'>('out')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [userName, setUserName] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [searching, setSearching] = useState(false)
  const [lastSearched, setLastSearched] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserName(data.user.email || '')
    })
  }, [])

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
        if (err.name === 'NotAllowedError') {
          setCameraError('ไม่ได้รับอนุญาตให้ใช้กล้อง\nกรุณาอนุญาตในการตั้งค่าเบราว์เซอร์')
        } else if (err.name === 'NotReadableError') {
          setCameraError('กล้องถูกใช้งานโดยแอปอื่นอยู่\nกรุณาปิดแอปอื่นแล้วลองใหม่')
        } else {
          setCameraError(`เกิดข้อผิดพลาด: ${err.name}`)
        }
      }
    }

    startCamera()
    return () => { cancelled = true; stopCamera() }
  }, [scanning, stopCamera])

  // ✅ ค้นหาจาก pricelist ก่อน แล้วค่อย join products
  const fetchByBarcode = async (barcode: string) => {
    setNotFound(false)
    setScanResult(null)
    const cleaned = barcode.trim().replace(/\s/g, '')
    setLastSearched(cleaned)

    // ค้นหาใน pricelist ทั้ง 3 column
    const { data } = await supabase
      .from('pricelist')
      .select('*')
      .or(`barcode_piece.eq.${cleaned},barcode_case.eq.${cleaned},barcode_pack.eq.${cleaned}`)
      .limit(1)
      .single()

    if (!data) {
      setNotFound(true)
      return
    }

    // ระบุว่าสแกนได้ barcode ประเภทไหน
    let barcodeType: BarcodeType = 'piece'
    if (data.barcode_case === cleaned) barcodeType = 'case'
    else if (data.barcode_pack === cleaned) barcodeType = 'pack'

    // ถ้าเป็น piece → ดึง stock จาก products
    let product: Product | null = null
    if (barcodeType === 'piece') {
      const { data: prod } = await supabase
        .from('products')
        .select('id, item_code, item_name, barcode, on_hand, stock_value, uom')
        .eq('barcode', cleaned)
        .single()
      product = prod
    }

    setScanResult({ priceItem: data, barcodeType, product })
    setQuantity(1)
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

  const handleSave = async () => {
    if (!scanResult?.product) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { product, priceItem } = scanResult

    await supabase.from('scan_logs').insert({
      user_id: user?.id,
      barcode: product.barcode,
      product_name: priceItem.item_name,
      action,
      quantity,
    })

    const newStock = action === 'in'
      ? product.on_hand + quantity
      : Math.max(0, product.on_hand - quantity)

    await supabase
      .from('products')
      .update({ on_hand: newStock, updated_at: new Date().toISOString() })
      .eq('id', product.id)

    setScanResult(prev => prev ? {
      ...prev,
      product: prev.product ? { ...prev.product, on_hand: newStock } : null
    } : null)

    setSuccessMsg(`✅ ${action === 'in' ? 'รับเข้า' : 'จ่ายออก'} ${quantity} ชิ้น เรียบร้อย`)
    setSaving(false)
    setTimeout(() => setSuccessMsg(''), 2500)
  }

  const handleReset = () => {
    stopCamera()
    setScanResult(null)
    setNotFound(false)
    setSuccessMsg('')
    setCameraError('')
    setManualBarcode('')
    setLastSearched('')
    setQuantity(1)
    setTimeout(() => setScanning(true), 300)
  }

  const handleLogout = async () => {
    stopCamera()
    await supabase.auth.signOut()
    router.push('/')
  }

  const barcodeTypeLabel = (type: BarcodeType) => {
    if (type === 'piece') return { label: 'บาร์โค้ดชิ้น', color: 'bg-blue-100 text-blue-700' }
    if (type === 'case') return { label: 'บาร์โค้ดลัง', color: 'bg-orange-100 text-orange-700' }
    return { label: 'บาร์โค้ดแพ็ค', color: 'bg-purple-100 text-purple-700' }
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png" alt="RSM" width={80} height={32} unoptimized className="object-contain" />
          <span className="text-gray-500 text-sm hidden sm:block">{userName}</span>
        </div>
        <button onClick={handleLogout} className="text-sm text-red-500 hover:text-red-700 transition">
          ออกจากระบบ
        </button>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">

        {/* Camera */}
        {scanning && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="bg-blue-600 px-4 py-3">
              <h2 className="text-white font-semibold text-center">📷 สแกนบาร์โค้ด</h2>
            </div>
            {cameraError ? (
              <div className="p-8 text-center space-y-4">
                <p className="text-5xl">📵</p>
                <p className="text-gray-700 font-medium leading-relaxed whitespace-pre-line">{cameraError}</p>
                <button onClick={() => { setCameraError(''); setScanning(false); setTimeout(() => setScanning(true), 300) }}
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 transition font-medium">
                  ลองใหม่อีกครั้ง
                </button>
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
                <p className="text-center text-gray-400 text-sm py-3">จ่อบาร์โค้ดให้ตรงกรอบ</p>
              </>
            )}
            <div className="px-4 pb-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                  <input
                    type="text" inputMode="numeric" value={manualBarcode}
                    onChange={e => setManualBarcode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                    placeholder="พิมพ์บาร์โค้ดแล้วกด Enter"
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <button onClick={handleManualSearch} disabled={searching || !manualBarcode.trim()}
                  className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition">
                  {searching ? '...' : 'ค้นหา'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Not Found */}
        {notFound && (
          <div className="bg-white rounded-2xl shadow p-6 text-center space-y-2">
            <p className="text-4xl">❌</p>
            <p className="text-gray-700 font-medium">ไม่พบสินค้าในระบบ</p>
            <p className="text-gray-400 text-sm font-mono bg-gray-50 rounded-lg px-3 py-1 inline-block">{lastSearched}</p>
            <div className="pt-2">
              <button onClick={handleReset} className="bg-blue-600 text-white px-6 py-2 rounded-xl hover:bg-blue-700 transition">
                สแกนใหม่
              </button>
            </div>
          </div>
        )}

        {/* Scan Result */}
        {scanResult && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="bg-blue-600 px-4 py-3 flex items-center justify-between">
              <h2 className="text-white font-semibold">ข้อมูลสินค้า</h2>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${barcodeTypeLabel(scanResult.barcodeType).color}`}>
                {barcodeTypeLabel(scanResult.barcodeType).label}
              </span>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-blue-600 font-semibold text-lg leading-tight">{scanResult.priceItem.item_name}</p>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">รหัสสินค้า</p>
                  <p className="font-medium">{scanResult.priceItem.item_code}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">แบรนด์</p>
                  <p className="font-medium">{scanResult.priceItem.brand}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">ขนาด</p>
                  <p className="font-medium">{scanResult.priceItem.size || '-'}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">หน่วย/ลัง</p>
                  <p className="font-medium">{scanResult.priceItem.num_in_buy} ชิ้น</p>
                </div>
              </div>

              {/* ถ้าเป็น barcode ชิ้น → แสดง stock + บันทึกได้ */}
              {scanResult.barcodeType === 'piece' && scanResult.product && (
                <>
                  <div className="bg-blue-50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-xs">สินค้าคงเหลือปัจจุบัน</p>
                      <p className={`font-bold text-2xl ${scanResult.product.on_hand <= 10 ? 'text-red-500' : 'text-green-600'}`}>
                        {scanResult.product.on_hand} ชิ้น
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-400 text-xs">ราคา</p>
                      <p className="font-semibold text-gray-700">฿{scanResult.product.stock_value.toLocaleString()}</p>
                    </div>
                  </div>

                  {/* in/out toggle */}
                  <div className="flex rounded-xl overflow-hidden border border-gray-200">
                    <button onClick={() => setAction('out')}
                      className={`flex-1 py-2 text-sm font-medium transition ${action === 'out' ? 'bg-red-500 text-white' : 'bg-white text-gray-500'}`}>
                      จ่ายออก
                    </button>
                    <button onClick={() => setAction('in')}
                      className={`flex-1 py-2 text-sm font-medium transition ${action === 'in' ? 'bg-green-500 text-white' : 'bg-white text-gray-500'}`}>
                      รับเข้า
                    </button>
                  </div>

                  {/* quantity */}
                  <div className="flex items-center gap-3">
                    <button onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      className="w-12 h-12 bg-gray-100 rounded-xl text-xl font-bold hover:bg-gray-200 transition">−</button>
                    <input type="number" value={quantity}
                      onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="flex-1 text-center text-xl font-bold border border-gray-200 rounded-xl py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <button onClick={() => setQuantity(q => q + 1)}
                      className="w-12 h-12 bg-gray-100 rounded-xl text-xl font-bold hover:bg-gray-200 transition">+</button>
                  </div>

                  {successMsg && (
                    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center text-green-700 font-medium">
                      {successMsg}
                    </div>
                  )}

                  <button onClick={handleSave} disabled={saving}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition">
                    {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                  </button>
                </>
              )}

              {/* ถ้าเป็น case/pack → แสดงข้อมูลอย่างเดียว ไม่มีปุ่มบันทึก */}
              {(scanResult.barcodeType === 'case' || scanResult.barcodeType === 'pack') && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
                  <p className="text-orange-600 text-sm font-medium">
                    {scanResult.barcodeType === 'case' ? '📦 บาร์โค้ดลัง' : '🗂 บาร์โค้ดแพ็ค'}
                  </p>
                  <p className="text-orange-500 text-xs mt-1">สแกนบาร์โค้ดชิ้นเพื่อแก้ไข stock</p>
                </div>
              )}

              <button onClick={handleReset}
                className="w-full border border-gray-200 text-gray-500 py-3 rounded-xl hover:bg-gray-50 transition">
                สแกนใหม่
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}