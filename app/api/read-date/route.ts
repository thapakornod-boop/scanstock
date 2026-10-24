// อ่านวันผลิต / วันหมดอายุจากรูปฉลากสินค้า ด้วย Gemini
// ต้องตั้ง GEMINI_API_KEY ใน .env.local (และใน Environment Variables ตอน deploy)

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
const MAX_IMAGE_BASE64 = 4_000_000 // ~3MB หลัง decode

const PROMPT = `This is a photo of a product label or package. Find the manufacturing date and the expiry date printed on it.
Labels may say MFG, MFD, PROD, ผลิต, วันผลิต (manufacturing) and EXP, BB, BBE, Best before, Use by, หมดอายุ, ควรบริโภคก่อน (expiry).
Rules:
- Return dates as yyyy-mm-dd in the Gregorian calendar. Thai Buddhist years (e.g. 2568) must be converted by subtracting 543. A 2-digit year like 68 or 69 is a Buddhist year (2568/2569); 25 or 26 is Gregorian (2025/2026).
- Thai/European order is day/month/year unless the label clearly uses another order.
- If only month and year are printed: use the first day of the month for the manufacturing date and the last day of the month for the expiry date.
- Use null for any date that is not visible or not readable. Do not guess.
- raw: the exact date text you read from the label.`

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    mfg: { type: 'STRING', nullable: true },
    exp: { type: 'STRING', nullable: true },
    raw: { type: 'STRING', nullable: true },
  },
  required: ['mfg', 'exp', 'raw'],
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
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
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
  let parsed: { mfg?: unknown; exp?: unknown; raw?: unknown } = {}
  try { parsed = JSON.parse(text ?? '{}') } catch {}

  return Response.json({
    mfg: isIsoDate(parsed.mfg) ? parsed.mfg : null,
    exp: isIsoDate(parsed.exp) ? parsed.exp : null,
    raw: typeof parsed.raw === 'string' ? parsed.raw : null,
  })
}
