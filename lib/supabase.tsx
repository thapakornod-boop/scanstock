import { createBrowserClient } from '@supabase/ssr'

export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

/**
 * ใช้ฟังก์ชันนี้ครอบทุก supabase call ที่ต้องการ auth
 * ถ้า token หมดอายุ / invalid → sign out แล้ว redirect หน้า login
 */
export async function safeQuery<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  onAuthError?: () => void
): Promise<{ data: T | null; error: any }> {
  const result = await fn()

  if (
    result.error &&
    (result.error.message?.includes('Refresh Token Not Found') ||
      result.error.message?.includes('Invalid Refresh Token') ||
      result.error?.status === 401)
  ) {
    const supabase = createClient()
    await supabase.auth.signOut()
    if (onAuthError) onAuthError()
    else window.location.href = '/'
  }

  return result
}