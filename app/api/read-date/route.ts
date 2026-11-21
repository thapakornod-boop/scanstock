// อ่านวันหมดอายุจากภาพกล้อง/รูปฉลากสินค้า ด้วย Gemini
// ต้องตั้ง GEMINI_API_KEY ใน .env.local (และใน Environment Variables ตอน deploy)

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
const MAX_IMAGE_BASE64 = 4_000_000 // ~3MB หลัง decode

// อ่านเฉพาะวันหมดอายุ (lot ให้ผู้ใช้กรอกเอง) ยิ่งตอบสั้นยิ่งเร็ว
const PROMPT = `This is a camera frame of a product package. Find the EXPIRY date printed on it.
Expiry labels: EXP, BB, BBE, Best before, Use by, หมดอายุ, ควรบริโภคก่อน. Ignore manufacturing dates (MFG, MFD, ผลิต).
Rules:
- Return yyyy-mm-dd in the Gregorian calendar. Thai Buddhist years (e.g. 2568) must be converted by subtracting 543. A 2-digit year like 68 or 69 is a Buddhist year (2568/2569); 25 or 26 is Gregorian (2025/2026).
- Thai/European order is day/month/year unless the label clearly uses another order.
- If only month and year are printed, use the last day of that month.
- Use null if no expiry date is visible or readable. Do not guess.
- raw: the exact expiry text you read.`

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    exp: { type: 'STRING', nullable: true },
    raw: { type: 'STRING', nullable: true },
  },
  required: ['exp', 'raw'],
}

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return Response.json({ error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY' }, { status: 500 })

  let image: unknown
  try {
    ({ image } = await request.json())
  } catch {
    return Response.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }
  if (typeof image !== 'string' || !image || image.length > MAX_IMAGE_BASE64) {
    return Response.json({ error: 'รูปไม่ถูกต้องหรือใหญ่เกินไป' }, { status: 400 })
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } },
    }),
  })

  if (!res.ok) {
    console.error('Gemini error', res.status, await res.text())
    const msg = res.status === 429 ? 'ใช้งานเกินโควต้า ลองใหม่อีกสักครู่' : 'อ่านรูปไม่สำเร็จ'
    return Response.json({ error: msg }, { status: 502 })
  }

  const data = await res.json()
  // รวมข้อความทุก part (ข้าม part ที่เป็นความคิดของโมเดล)
  const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? []
  const text = parts.filter(p => !p.thought && p.text).map(p => p.text).join('')
  let parsed: { exp?: unknown; raw?: unknown } = {}
  try { parsed = JSON.parse(text ?? '{}') } catch {}

  return Response.json({
    exp: isIsoDate(parsed.exp) ? parsed.exp : null,
    raw: typeof parsed.raw === 'string' ? parsed.raw : null,
  })
}
