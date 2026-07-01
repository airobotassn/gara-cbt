// 관리자 계정 관리 (루트 전용): 목록 · 추가 · 삭제. 가입(로그인 이력) 유저만 지정 가능.
import { json } from '../../_shared/cors.ts'
import { ROOT_ADMIN } from '../constants.ts'

export async function manageAdmins(
  admin: any,
  body: any,
  action: 'admins' | 'addAdmin' | 'removeAdmin',
  currentEmail: string,
  isRoot: boolean,
) {
  if (!isRoot) return json({ error: '루트 관리자만 관리자 계정을 관리할 수 있습니다.' }, 403)

  // 가입(이메일 보유, 비익명) 유저 이메일 집합 — 관리자 지정 후보 검증용
  const registered = new Set<string>()
  try {
    const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 2000 })
    for (const u of au?.users ?? []) {
      const e = (u.email ?? '').trim().toLowerCase()
      if (e && !u.is_anonymous) registered.add(e)
    }
  } catch { /* listUsers 실패 시 후보 검증은 통과시키지 않음 */ }

  if (action === 'addAdmin') {
    const target = String(body.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) return json({ error: '올바른 이메일이 아닙니다.' }, 400)
    if (target === ROOT_ADMIN) return json({ error: '루트 관리자는 이미 최고 권한입니다.' }, 400)
    if (!registered.has(target)) {
      return json({ error: '가입한 사용자만 관리자로 지정할 수 있습니다. (해당 이메일로 로그인한 적이 있어야 함)' }, 400)
    }
    const { error } = await admin.from('admin_users').upsert(
      { email: target, added_by: currentEmail, created_at: new Date().toISOString() },
      { onConflict: 'email' },
    )
    if (error) return json({ error: error.message }, 500)
  }
  if (action === 'removeAdmin') {
    const target = String(body.email ?? '').trim().toLowerCase()
    if (target === ROOT_ADMIN) return json({ error: '루트 관리자는 삭제할 수 없습니다.' }, 400)
    const { error } = await admin.from('admin_users').delete().eq('email', target)
    if (error) return json({ error: error.message }, 500)
  }

  const { data, error } = await admin.from('admin_users').select('email, added_by, created_at').order('created_at', { ascending: true })
  if (error) return json({ error: error.message }, 500)
  const adminSet = new Set([ROOT_ADMIN, ...(data ?? []).map((r: any) => r.email)])
  const admins = [
    { email: ROOT_ADMIN, role: 'root' as const, added_by: null, created_at: null },
    ...(data ?? []).map((r: any) => ({ email: r.email, role: 'admin' as const, added_by: r.added_by, created_at: r.created_at })),
  ]
  // 아직 관리자가 아닌 가입 유저 = 추가 후보
  const candidates = [...registered].filter((e) => !adminSet.has(e)).sort()
  return json({ admins, candidates })
}
