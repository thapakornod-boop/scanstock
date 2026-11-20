// เสียงปี๊บ + สั่น ตอนสแกน ให้รู้ผลทันทีโดยไม่ต้องมองจอ
// iOS ต้องสร้าง AudioContext หลังผู้ใช้แตะจอ จึงเรียก unlockAudio() จากปุ่มก่อนเริ่มสแกน
// (iOS Safari ไม่รองรับการสั่น จึงมีแค่เสียง)

let ctx: AudioContext | null = null

export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
  } catch {}
}

function tone(freq: number, ms: number, delay = 0) {
  if (!ctx) return
  const t = ctx.currentTime + delay / 1000
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.08, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + ms / 1000)
}

export function feedback(kind: 'ok' | 'new' | 'error') {
  try {
    if (kind === 'ok') { tone(1760, 70); navigator.vibrate?.(40) }
    else if (kind === 'new') { tone(1320, 60); tone(1760, 70, 80); navigator.vibrate?.([30, 40, 30]) }
    else { tone(220, 260); navigator.vibrate?.([120, 60, 120]) }
  } catch {}
}
