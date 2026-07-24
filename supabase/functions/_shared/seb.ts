// SEB(Safe Exam Browser) 서버측 검증.
//  스펙: X-SafeExamBrowser-RequestHash = SHA256( <요청 URL> + <Browser Exam Key> ), 소문자 16진수.
//        X-SafeExamBrowser-ConfigKeyHash = SHA256( <요청 URL> + <Config Key> ).
//  활성화 조건: 시크릿 SEB_REQUIRED=true 이고 SEB_BROWSER_EXAM_KEY(또는 SEB_CONFIG_KEY)가 설정된 경우.
//   (둘 중 아무 키도 없으면 검증을 건너뛴다 — 설정 전 응시자를 잠그지 않기 위함)
//  ⚠️ 게이트웨이로 인해 함수가 보는 req.url 이 브라우저가 요청한 URL 과 다를 수 있어, 후보 URL 들로 비교한다.
//     배포 후 실제 SEB 클라이언트로 반드시 검증할 것(docs/SEB설정.md).

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function urlCandidates(req: Request): string[] {
  const set = new Set<string>()
  set.add(req.url)
  try {
    const u = new URL(req.url)
    const noQuery = `${u.origin}${u.pathname}`
    set.add(noQuery)
    set.add(noQuery.replace(/\/$/, ''))
    const base = Deno.env.get('SUPABASE_URL')
    const name = u.pathname.split('/').filter(Boolean).pop()
    if (base && name) {
      set.add(`${base}/functions/v1/${name}`)
      set.add(`${base.replace('.supabase.co', '.functions.supabase.co')}/${name}`)
    }
    // 명시 설정이 있으면 그것도 후보로(권장: 배포 후 정확한 URL 지정)
    const explicit = Deno.env.get('SEB_EXAM_URL')
    if (explicit) set.add(explicit)
  } catch {
    /* ignore */
  }
  return [...set]
}

// 통과면 null, 차단이면 사용자에게 보일 사유 문자열 반환.
export async function sebCheckFailed(req: Request): Promise<string | null> {
  const required = (Deno.env.get('SEB_REQUIRED') ?? '').toLowerCase() === 'true'
  if (!required) return null

  const bek = Deno.env.get('SEB_BROWSER_EXAM_KEY') ?? ''
  const cck = Deno.env.get('SEB_CONFIG_KEY') ?? ''
  if (!bek && !cck) return null // 키 미설정 → 잠금 방지 위해 통과

  const reqHash = (req.headers.get('X-SafeExamBrowser-RequestHash') ?? '').toLowerCase()
  const cfgHash = (req.headers.get('X-SafeExamBrowser-ConfigKeyHash') ?? '').toLowerCase()
  if (!reqHash && !cfgHash) return '보안 브라우저(SEB)로 응시해야 합니다.'

  const candidates = urlCandidates(req)
  for (const u of candidates) {
    if (bek && reqHash && (await sha256Hex(u + bek)) === reqHash) return null
    if (cck && cfgHash && (await sha256Hex(u + cck)) === cfgHash) return null
  }
  return '보안 브라우저(SEB) 검증에 실패했습니다.'
}
