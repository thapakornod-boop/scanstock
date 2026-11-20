// โหลดรายการสินค้า (pricelist) ทั้งหมดมาเก็บในเครื่อง
// เพื่อให้สแกนแล้วหาสินค้าได้ทันทีโดยไม่ต้องรอเน็ต แบบปืนสแกน

import { createClient } from './supabase'

export type UnitType = 'piece' | 'pack' | 'case'

export type Product = {
  item_code: string
  item_name: string
  brand: string | null
  size: string | null
  barcode_piece: string | null
  barcode_pack: string | null
  barcode_case: string | null
  num_in_buy: number | null
  shelf_life_days: number | null
}

export type CatalogHit = { product: Product; unitType: UnitType }
export type Catalog = { products: Product[]; byCode: Map<string, CatalogHit>; loadedAt: number }

export const UNIT_LABEL: Record<UnitType, string> = { piece: 'ชิ้น', pack: 'แพ็ค', case: 'ลัง' }

const CACHE_KEY = 'rsm_catalog_v2'
const MAX_AGE_MS = 12 * 60 * 60 * 1000 // โหลดใหม่ทุก 12 ชม.
const COLUMNS = 'item_code,item_name,brand,size,barcode_piece,barcode_pack,barcode_case,num_in_buy,shelf_life_days'

export const cleanCode = (s: string) => s.trim().replace(/\s/g, '')

function buildIndex(products: Product[]): Map<string, CatalogHit> {
  const byCode = new Map<string, CatalogHit>()
  // item_code ก่อน แล้วให้บาร์โค้ดจริงทับ เผื่อรหัสซ้ำกับบาร์โค้ด
  for (const p of products) if (p.item_code) byCode.set(cleanCode(p.item_code), { product: p, unitType: 'piece' })
  for (const p of products) {
    if (p.barcode_piece) byCode.set(cleanCode(p.barcode_piece), { product: p, unitType: 'piece' })
    if (p.barcode_pack) byCode.set(cleanCode(p.barcode_pack), { product: p, unitType: 'pack' })
    if (p.barcode_case) byCode.set(cleanCode(p.barcode_case), { product: p, unitType: 'case' })
  }
  return byCode
}

function readCache(): { products: Product[]; loadedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function fetchAll(): Promise<Product[]> {
  const supabase = createClient()
  const all: Product[] = []
  // Supabase คืนได้ครั้งละไม่เกิน 1000 แถว
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('pricelist').select(COLUMNS).order('item_code').range(from, from + 999)
    if (error) throw error
    all.push(...((data as Product[]) ?? []))
    if (!data || data.length < 1000) break
  }
  return all
}

// ใช้ cache ในเครื่องก่อนถ้ายังไม่เก่า แล้วค่อยโหลดใหม่เมื่อ force หรือหมดอายุ
export async function loadCatalog(force = false): Promise<Catalog> {
  const cached = readCache()
  if (cached && !force && Date.now() - cached.loadedAt < MAX_AGE_MS) {
    return { ...cached, byCode: buildIndex(cached.products) }
  }
  try {
    const products = await fetchAll()
    const loadedAt = Date.now()
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ products, loadedAt })) } catch {}
    return { products, loadedAt, byCode: buildIndex(products) }
  } catch (err) {
    // ออฟไลน์หรือ DB ล่ม: ใช้ของเก่าในเครื่องไปก่อน
    if (cached) return { ...cached, byCode: buildIndex(cached.products) }
    throw err
  }
}

export function searchProducts(catalog: Catalog, q: string, limit = 20): Product[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return catalog.products
    .filter(p => p.item_name?.toLowerCase().includes(s) || p.item_code?.toLowerCase().includes(s) || p.brand?.toLowerCase().includes(s))
    .slice(0, limit)
}
