'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

type Product = {
  id: string
  item_code: string
  item_name: string
  barcode: string
  brand: string
  uom: number
  stock_value: number
  on_hand: number
  in_stock_cases: number
  in_stock_pieces: number
}

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const [scanning, setScanning] = useState(true)
  const [product, setProduct] = useState<Product | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [action, setAction] = useState<'in' | 'out'>('out')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [userName, setUserName] = useState('')
  const [cameraError, setCameraError] = useState('')
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
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

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

        // version 0.23.0 ใช้ decodeFromStream
        const decodeLoop = async () => {
          while (!cancelled) {
            try {
              const result = await codeReader.decodeOnceFromStream(
                streamRef.current!,
                videoRef.current!
              )
              if (!cancelled) {
                cancelled = true
                stopCamera()
                setScanning(false)
                fetchProduct(result.getText())
              }
              break
            } catch (err: any) {
              if (err instanceof NotFoundException) {
                // ยังไม่เจอบาร์โค้ด — loop ต่อ
                continue
              }
              if (!cancelled) {
                console.error('Decode error:', err)
              }
              break
            }
          }
        }

        decodeLoop()

      } catch (err: any) {
        if (cancelled) return
        console.error('Camera error:', err)
        stopCamera()

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError('ไม่ได้รับอนุญาตให้ใช้กล้อง\nกรุณาอนุญาตในการตั้งค่าเบราว์เซอร์แล้วโหลดหน้าใหม่')
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setCameraError('กล้องถูกใช้งานโดยแอปอื่นอยู่\nกรุณาปิดแอปอื่น (เช่น กล้อง, LINE) แล้วลองใหม่')
        } else if (err.name === 'NotFoundError') {
          setCameraError('ไม่พบกล้องในอุปกรณ์นี้')
        } else {
          setCameraError(`เกิดข้อผิดพลาด: ${err.name}\nกรุณาลองใหม่อีกครั้ง`)
        }
      }
    }

    startCamera()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [scanning, stopCamera])

  const fetchProduct = async (barcode: string) => {
    setNotFound(false)
    setProduct(null)
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', barcode)
      .single()

    if (data) {
      setProduct(data)
      setQuantity(1)
    } else {
      setNotFound(true)
    }
  }

  const handleSave = async () => {
    if (!product) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('scan_logs').insert({
      user_id: user?.id,
      barcode: product.barcode,
      product_name: product.item_name,
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

    setProduct(prev => prev ? { ...prev, on_hand: newStock } : null)
    setSuccessMsg(`✅ ${action === 'in' ? 'รับเข้า' : 'จ่ายออก'} ${quantity} ชิ้น เรียบร้อย`)
    setSaving(false)
    setTimeout(() => setSuccessMsg(''), 2500)
  }

  const handleReset = () => {
    stopCamera()
    setProduct(null)
    setNotFound(false)
    setSuccessMsg('')
    setCameraError('')
    setQuantity(1)
    setTimeout(() => setScanning(true), 300)
  }

  const handleRetryCamera = () => {
    stopCamera()
    setCameraError('')
    setScanning(false)
    setTimeout(() => setScanning(true), 300)
  }

  const handleLogout = async () => {
    stopCamera()
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image
            src="https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png"
            alt="RSM"
            width={80}
            height={32}
            unoptimized
            className="object-contain"
          />
          <span className="text-gray-500 text-sm hidden sm:block">{userName}</span>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-red-500 hover:text-red-700 transition"
        >
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
                <p className="text-gray-700 font-medium leading-relaxed whitespace-pre-line">
                  {cameraError}
                </p>
                <button
                  onClick={handleRetryCamera}
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 transition font-medium"
                >
                  ลองใหม่อีกครั้ง
                </button>
              </div>
            ) : (
              <>
                <div className="relative bg-black">
                  <video
                    ref={videoRef}
                    className="w-full aspect-video object-cover"
                    playsInline
                    muted
                    autoPlay
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-3/4 h-0.5 bg-red-500 opacity-70 animate-pulse" />
                  </div>
                  <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
                  <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
                  <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
                  <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
                </div>
                <p className="text-center text-gray-400 text-sm py-3">
                  จ่อบาร์โค้ดให้ตรงกรอบ
                </p>
              </>
            )}
          </div>
        )}

        {/* Not Found */}
        {notFound && (
          <div className="bg-white rounded-2xl shadow p-6 text-center">
            <p className="text-4xl mb-2">❌</p>
            <p className="text-gray-700 font-medium">ไม่พบสินค้านี้ในระบบ</p>
            <button
              onClick={handleReset}
              className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-xl hover:bg-blue-700 transition"
            >
              สแกนใหม่
            </button>
          </div>
        )}

        {/* Product Info */}
        {product && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="bg-blue-600 px-4 py-3">
              <h2 className="text-white font-semibold">ข้อมูลสินค้า</h2>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-blue-600 font-semibold text-lg leading-tight">{product.item_name}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">รหัส</p>
                  <p className="font-medium">{product.item_code}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">บาร์โค้ด</p>
                  <p className="font-medium">{product.barcode}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">ราคา</p>
                  <p className="font-medium">฿{product.stock_value.toLocaleString()}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">คงเหลือ</p>
                  <p className={`font-bold text-lg ${product.on_hand <= 10 ? 'text-red-500' : 'text-green-600'}`}>
                    {product.on_hand} ชิ้น
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">หน่วย/ลัง</p>
                  <p className="font-medium">{product.uom} ชิ้น</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-xs">แบรนด์</p>
                  <p className="font-medium">{product.brand}</p>
                </div>
              </div>
            </div>

            <div className="px-4 pb-4 space-y-3">
              <div className="flex rounded-xl overflow-hidden border border-gray-200">
                <button
                  onClick={() => setAction('out')}
                  className={`flex-1 py-2 text-sm font-medium transition ${
                    action === 'out' ? 'bg-red-500 text-white' : 'bg-white text-gray-500'
                  }`}
                >
                  จ่ายออก
                </button>
                <button
                  onClick={() => setAction('in')}
                  className={`flex-1 py-2 text-sm font-medium transition ${
                    action === 'in' ? 'bg-green-500 text-white' : 'bg-white text-gray-500'
                  }`}
                >
                  รับเข้า
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="w-12 h-12 bg-gray-100 rounded-xl text-xl font-bold hover:bg-gray-200 transition"
                >
                  −
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 text-center text-xl font-bold border border-gray-200 rounded-xl py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  onClick={() => setQuantity(q => q + 1)}
                  className="w-12 h-12 bg-gray-100 rounded-xl text-xl font-bold hover:bg-gray-200 transition"
                >
                  +
                </button>
              </div>

              {successMsg && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center text-green-700 font-medium">
                  {successMsg}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition"
              >
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>

              <button
                onClick={handleReset}
                className="w-full border border-gray-200 text-gray-500 py-3 rounded-xl hover:bg-gray-50 transition"
              >
                สแกนใหม่
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}