// set-nickname: 닉네임 최초 설정(가입 직후) + 그 뒤 1회 변경. 지역(set-region)과 같은 잠금 모델.
//  - 상태: profiles.nickname_set_at(최초) / nickname_changed_at(변경권 소진).
//    set_at null      → 최초 설정(변경권 그대로 남음)
//    set_at 有·changed null → 변경 1회 소진
//    둘 다 有          → 409 locked (이후 변경은 어드민 CS = admin_set_nickname RPC)
//  - display_name 은 authenticated 에게 UPDATE 권한이 없다(컬럼 GRANT 회수) → 이 함수가 유일한 쓰기 경로.
//  - 중복 금지: lower(공백제거) 정규화 키. 최종 방어는 부분 유니크 인덱스(profiles_nickname_key_uniq).
//  - 문자 규칙: 6개국어 서비스라 한글/영문만으로 못 막는다 → 유니코드 글자·숫자·밑줄만 허용(\p{L}\p{N}_).
// ⚠️ _shared 를 import 하므로 CLI/Management API 배포 전용.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/scoring.ts'

const MIN = 2
const MAX = 12
// 공백·특수문자·이모지 차단. 글자(모든 언어)·숫자·밑줄만.
const SHAPE = /^[\p{L}\p{N}_]+$/u
// 운영자 사칭 차단 — 정규화 키(소문자·공백제거) 기준 완전일치.
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'staff', 'support', 'help', 'official',
  'gara', 'caris', 'worldarena', 'moderator', 'mod',
  '관리자', '운영자', '운영팀', '고객센터', '협회', '공식',
])

// 정규화 키 = 소문자 + 모든 공백 제거. DB 유니크 인덱스와 같은 규칙이어야 한다.
function key(s: string) {
  return s.toLowerCase().replace(/\s+/g, '')
}

// 길이는 코드포인트 기준(이모지는 어차피 SHAPE 에서 걸리고, CJK 1자 = 1자로 센다).
function len(s: string) {
  return [...s].length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    const body = (await req.json().catch(() => ({}))) as { nickname?: unknown }
    const raw = typeof body.nickname === 'string' ? body.nickname.trim() : ''
    if (len(raw) < MIN || len(raw) > MAX) return json({ error: 'length' }, 400)
    if (!SHAPE.test(raw)) return json({ error: 'shape' }, 400)
    const k = key(raw)
    if (RESERVED.has(k)) return json({ error: 'reserved' }, 400)

    const admin = adminClient()

    // 현재 상태 — 최초인지 변경인지, 변경권이 남았는지.
    const { data: me, error: meErr } = await admin
      .from('profiles')
      .select('display_name, nickname_set_at, nickname_changed_at')
      .eq('id', user.id)
      .maybeSingle()
    if (meErr) return json({ error: 'server' }, 500)
    if (!me) return json({ error: 'no_profile' }, 404)

    const first = !me.nickname_set_at
    if (!first && me.nickname_changed_at) return json({ error: 'locked' }, 409)
    // 같은 이름으로 다시 저장 = 변경권 소모 없이 통과(오작동으로 권리를 잃지 않게).
    if (!first && key((me.display_name as string) ?? '') === k) {
      return json({ ok: true, displayName: me.display_name, canChange: true, unchanged: true })
    }

    // 중복 — 대소문자 무시 비교. 경쟁 상태는 유니크 인덱스가 최종적으로 막는다.
    // ⚠️ ilike 는 '_' 를 한 글자 와일드카드로 읽는다(닉네임에 허용된 문자) → 반드시 이스케이프.
    const pattern = raw.replace(/[\\%_]/g, (c) => `\\${c}`)
    const { data: dup } = await admin
      .from('profiles')
      .select('id')
      .neq('id', user.id)
      .not('nickname_set_at', 'is', null)
      .is('deactivated_at', null)
      .ilike('display_name', pattern)
      .limit(1)
    if (dup && dup.length > 0) return json({ error: 'taken' }, 409)

    const now = new Date().toISOString()
    const patch: Record<string, string> = { display_name: raw }
    if (first) patch.nickname_set_at = now
    else patch.nickname_changed_at = now

    const q = admin.from('profiles').update(patch).eq('id', user.id)
    // 동시 요청으로 변경권이 두 번 소모되지 않게 조건을 건다.
    const { data, error } = first
      ? await q.is('nickname_set_at', null).select('display_name')
      : await q.is('nickname_changed_at', null).select('display_name')

    if (error) {
      // 유니크 인덱스 위반 = 그사이 누가 선점
      if ((error as { code?: string }).code === '23505') return json({ error: 'taken' }, 409)
      return json({ error: 'server' }, 500)
    }
    if (!data || data.length === 0) return json({ error: 'locked' }, 409)

    return json({ ok: true, displayName: raw, canChange: first })
  } catch {
    return json({ error: 'server' }, 500)
  }
})
