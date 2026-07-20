// verify-cert: QR 진위확인 — 공개(로그인 불필요). body { token } → 자격증 원본 조회.
//   토큰(verify_token)으로 exam_attempts 를 찾아 발급여부·만료를 서버가 판정.
//   공개 안전 필드만 반환(이름 마스킹, 점수/정답/PII 미노출). 진위 판정의 단일 소스.
//   무효/에러도 HTTP 200 + { valid:false } 로 반환(프론트가 valid 만 보게).
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/lib.ts'
import { gradeOfTitle, expiryMonths, maskName } from '../_shared/cert.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { token } = await req.json().catch(() => ({}))
    if (!token || typeof token !== 'string') return json({ valid: false, reason: 'not_found' })

    const admin = adminClient()
    const { data: a } = await admin
      .from('exam_attempts')
      .select('id, user_id, exam_id, cert_issued_at, cert_no')
      .eq('verify_token', token)
      .maybeSingle()

    // 미발급(cert_issued_at 없음)이거나 없는 토큰 = 무효
    if (!a || !a.cert_issued_at) return json({ valid: false, reason: 'not_found' })

    // 시험명(급수) — 트랙·만료 규칙 산정에 사용
    let title: string | null = null
    if (a.exam_id) {
      const { data: ex } = await admin.from('exams').select('title').eq('id', a.exam_id).maybeSingle()
      title = (ex as { title?: string } | null)?.title ?? null
    }

    const grade = gradeOfTitle(title)
    const months = expiryMonths(grade)
    const issuedAt = a.cert_issued_at as string
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
      certNo: a.cert_no ?? '',
      issuedAt,
      expiresAt,
    })
  } catch (e) {
    return json({ valid: false, reason: 'error', message: e instanceof Error ? e.message : 'error' })
  }
})
