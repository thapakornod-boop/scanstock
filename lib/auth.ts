// การล็อกอินเก็บใน localStorage (ไม่ใช้ Supabase Auth) — คีย์เดิมจากเวอร์ชันก่อน

export type Employee = { id: string; name: string }

export function getEmployee(): Employee | null {
  try {
    const id = localStorage.getItem('rsm_employee_id')
    if (!id || !localStorage.getItem('rsm_logged_in')) return null
    return { id, name: localStorage.getItem('rsm_employee_name') || id }
  } catch {
    return null
  }
}

export function saveEmployee(e: Employee) {
  localStorage.setItem('rsm_employee_id', e.id)
  localStorage.setItem('rsm_employee_name', e.name)
  localStorage.setItem('rsm_logged_in', '1')
}

export function clearEmployee() {
  localStorage.removeItem('rsm_employee_id')
  localStorage.removeItem('rsm_employee_name')
  localStorage.removeItem('rsm_logged_in')
}
