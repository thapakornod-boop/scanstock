// ถ่ายรูปฉลาก → ส่งให้ /api/read-date (Gemini) อ่านวันผลิต/วันหมดอายุ

// ย่อรูปให้ด้านยาวสุดไม่เกิน 1280px แล้วคืนค่า base64 (jpeg, ไม่มี prefix)
function resizeToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')) }
    img.src = url
  })
}

export type LabelDates = { exp: string | null; raw: string | null }

export async function readLabelDates(file: File): Promise<LabelDates> {
  return readLabelImage(await resizeToBase64(file))
}

// อ่านจากภาพ base64 (jpeg) เช่นเฟรมจากกล้องที่ใช้สแกนบาร์โค้ด
export async function readLabelImage(image: string): Promise<LabelDates> {
  const res = await fetch('/api/read-date', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'อ่านรูปไม่สำเร็จ')
  return data
}

export { resizeToBase64 }
