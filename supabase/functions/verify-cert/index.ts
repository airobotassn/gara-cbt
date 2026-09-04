// verify-cert: QR 진위확인 — 공개(로그인 불필요). body { token } → 인증서 원본 조회.
//   토큰(verify_token)으로 exam_attempts 를 찾아 발급여부·만료를 서버가 판정.
//   공개 안전 필드만 반환(이름 마스킹, 점수/정답/PII 미노출). 진위 판정의 단일 소스.
//   무효/에러도 HTTP 200 + { valid:false } 로 반환(프론트가 valid 만 보게).
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/lib.ts'
import { gradeOfTitle, expiryMonths, maskName, parseLevelCertToken, levelCertNo } from '../_shared/cert.ts'
import { MAX_LEVEL, promoteCut } from '../_shared/scoring.ts'

// ── 레벨테스트(무료) 인증서 판정 ───────────────────────────────────────────
// CBT 와 달리 발급 기록이 없다 — 토큰이 가리키는 사람의 **현재 등급**이 곧 증서 내용이다.
// ⚠️ 취득 레벨 = rank − 1(천장 통과만 예외). list-attempts 와 **같은 규칙**이라 한쪽만 고치면
//    인증서에 찍힌 레벨과 진위확인 결과가 어긋난다. 만료는 없다(expiresAt = null).
async function verifyLevelCert(admin: ReturnType<typeof adminClient>, userId: string) {
  const [{ data: prog }, { data: rows }, { data: prof }] = await Promise.all([
    admin.from('user_progress').select('rank').eq('user_id', userId).maybeSingle(),
    admin
      .from('test_attempts')
      .select('level, total_correct, total_questions, rank_after, rank_dir, submitted_at')
      .eq('user_id', userId)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: false }),
    admin.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
  ])

  const milestones: Record<number, string> = {}
  let clearedTop7 = false
  for (const a of rows ?? []) {
    if (!a.submitted_at) continue
    if (a.rank_dir === 'up' && a.rank_after) {
      const got = (a.rank_after as number) - 1
      if (got >= 1) milestones[got] = a.submitted_at as string
    } else if (
      a.level === MAX_LEVEL &&
      a.rank_after === MAX_LEVEL &&
      ((a.total_correct as number | null) ?? 0) >=
        promoteCut(a.level as number, (a.total_questions as number | null) ?? undefined)
    ) {
      milestones[MAX_LEVEL] = a.submitted_at as string
      clearedTop7 = true
    }
  }
  const level = Math.max(((prog?.rank as number | null) ?? 1) - 1, clearedTop7 ? MAX_LEVEL : 0)
  // 한 레벨도 못 깼으면 인증서가 존재하지 않는다(= 무효). 인증서 발급 조건과 같은 판정.
  if (level < 1) return { valid: false, reason: 'not_found' }

  const issuedAt = milestones[level] ?? null
  const holder = ((prof?.display_name as string | null) ?? '').trim()
  return {
    valid: true,
    status: 'valid',
    name: holder ? maskName(holder) : '',
    grade: `WORLD ARENA LEVEL ${level}`,
    certNo: levelCertNo(userId, level, issuedAt),
    issuedAt,
    expiresAt: null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { token } = await req.json().catch(() => ({}))
    if (!token || typeof token !== 'string') return json({ valid: false, reason: 'not_found' })

    const admin = adminClient()

    // 레벨테스트 인증서 토큰(lv-…)이면 여기서 끝난다 — exam_attempts 에는 이 토큰이 없다.
    const levelUser = parseLevelCertToken(token)
    if (levelUser) return json(await verifyLevelCert(admin, levelUser))

    // 자격증은 2026-09-04 부터 별 표다(exam_certificates) — 줄이 있으면 곧 발급된 것이다.
    //   ⚠️ 옛 구조에선 응시 기록의 verify_token 으로 찾고 cert_issued_at 이 비었는지 한 번 더 봤다.
    //      지금은 발급되지 않은 응시에는 줄 자체가 없어서 그 검사가 필요 없다.
    //   ⛔ 만료 계산은 **first_issued_at** 을 쓴다 — 재발급으로 유효기간이 연장되면 안 된다.
    const { data: c } = await admin
      .from('exam_certificates')
      .select('cert_no, first_issued_at, exam_attempts(id, user_id, exam_id)')
      .eq('verify_token', token)
      .maybeSingle()
    const embA = (c as { exam_attempts?: unknown } | null)?.exam_attempts
    const a = (Array.isArray(embA) ? embA[0] : embA) as
      | { id: string; user_id: string; exam_id: string | null }
      | null
      | undefined

    // 없는 토큰 = 무효
    if (!c || !a) return json({ valid: false, reason: 'not_found' })

    // 시험명(급수) — 트랙·만료 규칙 산정에 사용
    let title: string | null = null
    if (a.exam_id) {
      const { data: ex } = await admin.from('exams').select('title').eq('id', a.exam_id).maybeSingle()
      title = (ex as { title?: string } | null)?.title ?? null
    }

    const grade = gradeOfTitle(title)
    const months = expiryMonths(grade)
    const issuedAt = c.first_issued_at as string
    let expiresAt: string | null = null
    if (months != null) {
      const d = new Date(issuedAt)
      d.setMonth(d.getMonth() + months)
      expiresAt = d.toISOString()
    }
    const expired = expiresAt != null && Date.now() > new Date(expiresAt).getTime()

    // 소지자 이름(마스킹) — auth 메타데이터에서
    let holder = ''
    const { data: u } = await admin.auth.admin.getUserById(a.user_id)
    const m = (u?.user?.user_metadata ?? {}) as Record<string, unknown>
    holder = (m.full_name as string) || (m.name as string) || u?.user?.email?.split('@')[0] || ''

    return json({
      valid: true,
      status: expired ? 'expired' : 'valid',
      name: holder ? maskName(holder) : '',
      grade: title ?? 'CARIS',
      certNo: c.cert_no ?? '',
      issuedAt,
      expiresAt,
    })
  } catch (e) {
    return json({ valid: false, reason: 'error', message: e instanceof Error ? e.message : 'error' })
  }
})
