'use client'

// กล้องสแกนต่อเนื่อง: ไม่หยุดหลังอ่านได้ สแกนชิ้นต่อไปได้ทันทีแบบปืนสแกน
// ใช้ BarcodeDetector ในตัวเครื่อง (Android Chrome) ถ้ามี ไม่งั้นใช้ตัว WebAssembly (iOS)

import { useEffect, useRef, useState } from 'react'
import { BarcodeDetector as Ponyfill, type BarcodeFormat } from 'barcode-detector/ponyfill'

const FORMATS: BarcodeFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']
// บาร์โค้ดใหม่นับทันที ส่วนบาร์โค้ดเดิม (ชิ้นถัดไปที่เหมือนกัน) จะนับอีกเมื่อ
// หายไปจากกล้องสักพัก (ย้ายไปชิ้นใหม่) และเว้นจากครั้งก่อนพอสมควร
// ถ้าจ่อชิ้นเดิมค้างไว้จะไม่นับซ้ำ
const SAME_CODE_GAP_MS = 450
const SAME_CODE_MIN_INTERVAL_MS = 700
const SCAN_INTERVAL_MS = 90

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

async function createDetector(): Promise<Detector> {
  const Native = (globalThis as unknown as { BarcodeDetector?: typeof Ponyfill }).BarcodeDetector
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats()
      const formats = FORMATS.filter(f => supported.includes(f))
      if (formats.length) return new Native({ formats })
    } catch {}
  }
  return new Ponyfill({ formats: FORMATS })
}

export default function Scanner({ onDetect, paused, flash }: {
  onDetect: (code: string) => void
  paused: boolean
  flash: 'ok' | 'error' | null // สีกรอบหลังสแกน
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const onDetectRef = useRef(onDetect)
  const pausedRef = useRef(paused)
  const [error, setError] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => { onDetectRef.current = onDetect }, [onDetect])
  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const last = { code: '', seenAt: 0, countedAt: 0 }

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => {})
        const track = stream.getVideoTracks()[0]
        trackRef.current = track
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean }
        setHasTorch(!!caps.torch)

        const detector = await createDetector()
        setReady(true)
        const loop = async () => {
          if (stopped) return
          if (!pausedRef.current && video.readyState >= 2) {
            try {
              const found = await detector.detect(video)
              const code = found[0]?.rawValue?.trim()
              const now = Date.now()
              if (code) {
                const isNew = code !== last.code
                const cameBack = now - last.seenAt > SAME_CODE_GAP_MS && now - last.countedAt > SAME_CODE_MIN_INTERVAL_MS
                if (isNew || cameBack) {
                  last.countedAt = now
                  onDetectRef.current(code)
                }
                last.code = code
                last.seenAt = now
              }
            } catch {}
          }
          timer = setTimeout(loop, SCAN_INTERVAL_MS)
        }
        loop()
      } catch (err) {
        const name = (err as { name?: string })?.name
        setError(
          name === 'NotAllowedError' ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง\nกรุณาอนุญาตกล้องในการตั้งค่าเบราว์เซอร์'
          : name === 'NotReadableError' ? 'กล้องถูกใช้งานโดยแอปอื่น'
          : name === 'NotFoundError' ? 'ไม่พบกล้องในอุปกรณ์นี้'
          : 'เปิดกล้องไม่สำเร็จ',
        )
      }
    }
    start()
    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
      trackRef.current = null
    }
  }, [])

  const toggleTorch = async () => {
    const next = !torchOn
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {}
  }

  if (error) {
    return (
      <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-3xl bg-slate-900 p-6 text-center text-sm whitespace-pre-line text-slate-300">
        <span className="text-4xl">📵</span>
        {error}
        <span className="text-xs text-slate-500">ยังพิมพ์บาร์โค้ด หรือใช้ปืนสแกนบลูทูธได้</span>
      </div>
    )
  }

  const ring = flash === 'ok' ? 'ring-emerald-400' : flash === 'error' ? 'ring-red-500' : 'ring-white/0'
  return (
    <div className={`relative aspect-[16/10] overflow-hidden rounded-3xl bg-black ring-4 transition-[box-shadow] duration-150 ${ring}`}>
      <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
      {/* กรอบเล็ง */}
      <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-[38%] -translate-y-1/2 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]">
        {!paused && ready && <div className="scan-beam absolute inset-x-3 h-0.5 rounded bg-brand-400 shadow-[0_0_12px_2px] shadow-brand-400" />}
      </div>
      <div className="absolute top-3 left-3 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
        {!ready ? 'กำลังเปิดกล้อง…' : paused ? '⏸ หยุดสแกน' : '● พร้อมสแกน'}
      </div>
      {hasTorch && (
        <button onClick={toggleTorch}
          className={`absolute top-3 right-3 rounded-full px-3 py-1 text-xs font-medium ${torchOn ? 'bg-amber-300 text-slate-900' : 'bg-black/50 text-white'}`}>
          🔦 {torchOn ? 'ปิดไฟ' : 'เปิดไฟ'}
        </button>
      )}
    </div>
  )
}
