import { supabase } from './supabase'

// 학교 자동완성 검색 — 공개 read(schools_select_all). active=true 만 노출.
// 빈 질의는 네트워크 호출 없이 즉시 빈 배열.
export async function searchSchools(q: string, limit = 10): Promise<{ id: string; name: string }[]> {
  const term = q.trim()
  if (!term) return []
  const { data } = await supabase
    .from('schools')
    .select('id,name')
    .eq('active', true)
    .ilike('name', '%' + term + '%')
    .limit(limit)
  return data ?? []
}
