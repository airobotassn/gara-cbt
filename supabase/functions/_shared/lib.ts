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
