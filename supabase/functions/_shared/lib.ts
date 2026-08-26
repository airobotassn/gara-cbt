// Edge Functions 공용 모듈 (Deno). 인증·서비스롤 클라 + 다국어 투영(pick/proj*) 헬퍼.
// ⚠️ 옛 CARIS ARENA의 레벨/6축·티어 채점은 제거됨(CBT 채점은 submit-exam 의 맞힌수 집계뿐).
import {
  createClient,
  type SupabaseClient,
  type User,
} from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ----- 다국어 지원 언어 -----
export const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi'] as const
export const DEFAULT_LANG = 'ko'

// ----- 다국어 투영 -----
export function pickLang(lang: unknown): string {
  return typeof lang === 'string' && (SUPPORTED_LANGS as readonly string[]).includes(lang)
    ? lang
    : DEFAULT_LANG
}
export function projText(i18n: unknown, lang: string): string {
  if (i18n && typeof i18n === 'object') {
    const o = i18n as Record<string, unknown>
    const v = o[lang] ?? o[DEFAULT_LANG]
    if (typeof v === 'string') return v
  }
  return ''
}
export function projOptions(i18n: unknown, lang: string): string[] {
  if (i18n && typeof i18n === 'object') {
    const o = i18n as Record<string, unknown>
    const v = (o[lang] ?? o[DEFAULT_LANG]) as unknown
    if (Array.isArray(v)) return v.map((x) => String(x))
  }
  return []
}

// ----- CARIS 문항 다국어 투영 (레벨테스트와 담는 모양이 다르다) -----
// 레벨테스트(test_questions)는 prompt_i18n 안에 ko 까지 담지만, CARIS(questions)는
// **한국어가 원본 컬럼(prompt·choices)에 있고 *_i18n 에는 번역본만** 있다.
// 이유는 마이그레이션 20260825190000 주석 참고(관리자 화면 열 곳이 원본 컬럼을 읽는다).
//   · ko 요청        → 원본 그대로
//   · 번역 있음      → 번역본
//   · 번역 없음      → 원본(한국어). 미번역 문항은 그 문항만 한국어로 뜬다 — 빈 화면보다 낫다.
export function projKoText(base: unknown, i18n: unknown, lang: string): string {
  const src = typeof base === 'string' ? base : ''
  if (lang === DEFAULT_LANG) return src
  const v = (i18n as Record<string, unknown> | null)?.[lang]
  return typeof v === 'string' && v.trim() ? v : src
}
export function projKoOptions(base: unknown, i18n: unknown, lang: string): string[] {
  const src = Array.isArray(base) ? base.map((x) => String(x ?? '')) : []
  if (lang === DEFAULT_LANG) return src
  const v = (i18n as Record<string, unknown> | null)?.[lang]
  // ⚠️ 개수가 어긋난 번역본은 버리고 원본을 쓴다. 보기 순서가 곧 정답 번호(correct_index)라
  //    개수가 다르면 정답이 다른 보기를 가리켜 **아무도 못 맞히는 문항**이 된다.
  //    저장 경로에서도 막지만(admin questionTransSave), 서빙에서 한 번 더 본다.
  if (Array.isArray(v) && v.length === src.length && v.every((x) => String(x ?? '').trim())) {
    return v.map((x) => String(x))
  }
  return src
}
// 그 문항이 이 언어로 번역돼 있나 — 관리자 '미번역' 표시·완료율의 단일 판정.
// ⚠️ 지문만 있고 보기가 없으면 미번역으로 친다(객관식은 둘 다 있어야 응시가 성립한다).
// ⚠️ **주관식은 모범답안 번역까지 있어야 완료다.** 지문만 번역하면 외국어 응시자는 문제를 자기
//    언어로 읽고 답도 자기 언어로 쓰는데, 허용답안이 한국어뿐이라 자동채점이 통째로 안 돈다.
//    이 한 줄이 곧 백필 스위치이기도 하다 — 이미 지문이 번역된 옛 주관식 문항들이 여기서
//    '미번역'으로 다시 떠서, 관리자가 기존 「🌐 미번역 번역」 버튼 한 번으로 답까지 채운다.
//    호출부는 answer_key·answer_key_i18n 을 같이 select 해야 한다(안 하면 늘 미번역으로 보인다).
export function questionTranslated(
  row: {
    prompt_i18n?: unknown
    choices_i18n?: unknown
    choices?: unknown
    answer_key?: unknown
    answer_key_i18n?: unknown
  },
  lang: string,
): boolean {
  if (lang === DEFAULT_LANG) return true
  const p = (row.prompt_i18n as Record<string, unknown> | null)?.[lang]
  if (typeof p !== 'string' || !p.trim()) return false
  const srcLen = Array.isArray(row.choices) ? row.choices.length : 0
  if (srcLen === 0) {
    // 주관식 — 보기가 없으므로 지문 + 모범답안을 본다.
    // 모범답안이 비어 있는 문항은 원래 자동채점 대상이 아니라(수동검수 폴백) 번역할 것도 없다.
    const ko = String(row.answer_key ?? '').trim()
    if (!ko) return true
    const a = (row.answer_key_i18n as Record<string, unknown> | null)?.[lang]
    return Array.isArray(a) && a.length > 0 && a.some((x) => String(x ?? '').trim())
  }
  const o = (row.choices_i18n as Record<string, unknown> | null)?.[lang]
  return Array.isArray(o) && o.length === srcLen && o.every((x) => String(x ?? '').trim())
}

// ----- 클라이언트 -----
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

export async function getUser(req: Request): Promise<User | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const {
    data: { user },
  } = await client.auth.getUser()
  return user
}

// 활성 시즌 id 조회 — activity_ledger.season_id 귀속용 경량 조회(코스메틱/랭킹 엣지fn 공용).
//  ranking_season.status='active' 는 부분 유니크 인덱스로 최대 1행(STAGE1c) — 없으면 null(시즌 미개시, 호출부가 스킵 가드).
export async function getActiveSeasonId(admin: SupabaseClient): Promise<number | null> {
  const { data } = await admin
    .from('ranking_season')
    .select('id')
    .eq('status', 'active')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as number) ?? null
}
