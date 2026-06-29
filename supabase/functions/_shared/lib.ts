// Edge Functions 공용 모듈 (Deno).
// 문항 분류(LEVEL_AXES)·다국어 투영(pick/proj*)은 admin 패널이 사용한다.
// ⚠️ 옛 레벨테스트의 티어/EWMA·등급변동 채점은 제거됨(CBT 채점은 submit-exam 의 맞힌수 집계뿐).
import {
  createClient,
  type SupabaseClient,
  type User,
} from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ----- 공통 상수 -----
export const MAX_LEVEL = 7

export const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi'] as const
export const DEFAULT_LANG = 'ko'

// ----- 레벨별 6축 코드 (문항 분류/검증용) -----
export const LEVEL_AXES: Record<number, string[]> = {
  1: ['l1_principle', 'l1_security', 'l1_ethics', 'l1_responsibility', 'l1_llm_eco', 'l1_prompt'],
  2: ['l2_genai', 'l2_api', 'l2_algo', 'l2_sensor', 'l2_block', 'l2_python'],
  3: ['l3_rag', 'l3_llm_ctrl', 'l3_vision_eval', 'l3_vision_data', 'l3_c_basic', 'l3_c_adv'],
  4: ['l4_preproc', 'l4_stm32', 'l4_ros2', 'l4_plc', 'l4_sim', 'l4_smartfactory'],
  5: ['l5_reasoning', 'l5_edge', 'l5_iiot', 'l5_dtwin', 'l5_sysopt', 'l5_ros2'],
  // L6·L7 = 임시(더미).
  6: ['l6_swarm', 'l6_hrc', 'l6_dtwin', 'l6_orchestration', 'l6_process_opt', 'l6_robosec'],
  7: ['l7_standard', 'l7_arch', 'l7_phyfusion', 'l7_faulttol', 'l7_governance', 'l7_ethics'],
}
export function axisKeysForLevel(level: number): string[] {
  return LEVEL_AXES[level] ?? []
}

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

// 레벨별 노출 선택지 수 상한. 레벨1만 4지선다(5번째 선택지 숨김), 그 외는 제한 없음.
// ⚠️ 정답이 잘리면 안 됨 → 레벨1은 정답=5번(correct_index 4) 문항을 비활성화해 둠.
//    (이 표시 컷은 채점에 영향 없음: 채점은 correct_index 로만 함)
export const VISIBLE_OPTIONS_BY_LEVEL: Record<number, number> = { 1: 4 }
export function projOptionsForLevel(i18n: unknown, lang: string, level: number): string[] {
  const opts = projOptions(i18n, lang)
  const cap = VISIBLE_OPTIONS_BY_LEVEL[level]
  return typeof cap === 'number' ? opts.slice(0, cap) : opts
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
