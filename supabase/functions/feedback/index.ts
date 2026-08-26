// feedback: 의견함 접수 — FAB 의 빨간 '의견 보내기' → /feedback 페이지가 부르는 유일한 경로.
//
//  ⚠️ **로그인이 필요 없다.** callFunction 이 세션이 없으면 Authorization 에 anon 키를 실으므로
//     verify_jwt 는 통과하고, getUser() 가 null 을 준다. 그래서 이 함수는 `--no-verify-jwt` 로
//     배포하면 안 된다 — 지금 그대로(플래그 없이) 올리는 게 맞다.
//  ⚠️ 로그인 상태면 계정도 같이 적는다. 다만 소속·이름은 **계정에서 끌어오지 않는다** —
//     본인이 적은 값이 이 기능의 답이다(닉네임과 실제 소속·이름은 다른 물건이다).
//  ⚠️ 가드(도배·중복)는 전부 feedback_post RPC 안에 있다. 여기서 세지 말 것 — 동시 요청에서 샌다.
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
//
//  ── 첨부파일(2026-08-26) ────────────────────────────────────────────────
//  액션이 둘이다: `action:'upload-url'`(서명 업로드 URL 발급) · 그 외(= 기존 접수).
//  ⛔ **브라우저가 Storage 에 바로 올리게 하지 않는다.** 그러려면 anon insert 정책이 필요한데
//     비로그인이 쓰는 화면이라 그 순간 가드 없는 무제한 업로드 엔드포인트가 된다. 여기서 경로를
//     정하고 그 경로 하나만 여는 서명 URL 을 발급한다 — 버킷에는 정책이 0개다.
//  ⛔ **발급도 세야 한다.** 발급 자체는 로그인 없이 부를 수 있으므로 feedback_upload_claim RPC 가
//     advisory lock 안에서 건수·용량 바닥선을 본다(여기서 세면 동시 요청에서 샌다).
//  ⛔ **확장자 화이트리스트가 진짜 관문이다.** 브라우저가 보내는 content-type 은 클라가 정하는 값이라
//     믿을 수 없다(버킷의 mime 제한을 일부러 비워 둔 이유이기도 하다).
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { resolveIpHash } from '../_shared/chat.ts'

// DB CHECK 과 같은 값이다 — 한쪽만 고치면 화면은 통과시킨 글이 저장에서 터진다.
const LIMITS = { org: 60, name: 40, path: 200, body: 4000 } as const

// 첨부 상수 — 화면(src/pages/Feedback.tsx)·DB(feedbacks_files_shape · feedback_uploads_size_chk)·
// 버킷(storage-buckets.sql 의 file_size_limit)과 **한 벌**이다. 넷이 어긋나면 화면이 받아준 파일이
// 업로드에서만 조용히 실패하고 사용자는 이유를 못 듣는다.
const BUCKET = 'feedback-files'
const MAX_FILES = 3
const MAX_FILE_BYTES = 20 * 1024 * 1024

// ⛔ 확장자 화이트리스트. **svg·html 을 넣지 말 것** — 둘 다 스크립트를 품을 수 있어서, 관리자가
//    서명 URL 을 새 탭에서 열면 스토리지 오리진에서 그대로 실행된다. 실행파일 계열도 같은 이유로 없다.
const ALLOWED_EXT = new Set([
  // 캡처·사진
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif',
  // 문서 — PPT·PDF 로 정리해 보내는 사람이 이 기능의 출발점이다
  'pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'hwp', 'hwpx', 'txt', 'csv', 'md', 'rtf',
  // 화면 녹화 · 묶음
  'mp4', 'mov', 'webm', 'zip',
])

/** 한 줄 입력값 정리 — 줄바꿈까지 포함한 모든 공백을 한 칸으로 접고 앞뒤를 턴다.
 *  (한 줄 칸에 여러 줄이 붙어 오면 관리자 표에서 행 높이가 통째로 무너진다.) */
function oneLine(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

/** 파일 이름에서 확장자만 소문자로. 점이 없으면 빈 문자열(= 화이트리스트에 안 걸려 거절된다). */
function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

/** 스토리지 경로에 쓸 이름으로 턴다.
 *  ⛔ **키는 ASCII 만 받는다.** Supabase Storage 의 키 검사가 `\w`(= `[A-Za-z0-9_]`) 기준이라
 *     한글·가나·한자 파일명을 그대로 쓰면 업로드가 `InvalidKey` 로 **400** 이다(실제로 겪었다).
 *     서명 URL 발급은 멀쩡히 성공하고 올릴 때만 터져서, 안 겪어보면 못 찾는 자리다.
 *  ⚠️ 그래서 **이름이 뭉개져도 괜찮다** — 사람에게 보여줄 원본 이름은 DB(`feedback_uploads.name`)에
 *     그대로 남고, 앞에 uuid 폴더가 있어 겹칠 일도 없다. 여기서 정하는 건 **키**뿐이다.
 *  ⚠️ 경로 구분자·제어문자를 반드시 없앤다 — 남기면 클라가 보낸 이름만으로 다른 폴더를 가리킬 수 있다.
 *  ⚠️ 제어문자는 **정규식 리터럴로 쓰지 않는다** — 소스에 그 바이트가 그대로 박혀 파일이 바이너리가 된다.
 *     코드포인트로 걸러야 편집기·grep 이 계속 텍스트로 읽는다. */
function safeKeyName(name: string): string {
  const noCtrl = Array.from(name)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0
      return c >= 0x20 && c !== 0x7f
    })
    .join('')
  // ⚠️ **확장자를 먼저 떼어낸다.** 뭉갠 뒤에 떼면 앞자리 정리(`^[._-]+`)가 확장자 앞의 점까지
  //    먹어서 `스모크.png` 가 `png` 라는 이름이 된다(실제로 그랬다).
  const ext = extOf(noCtrl)
  const rawBase = ext ? noCtrl.slice(0, noCtrl.length - ext.length - 1) : noCtrl
  // 너무 길면 키가 통째로 길어져 서명 URL 이 지저분해진다. 확장자는 살리고 앞을 자른다.
  // 한글만으로 된 이름은 여기서 밑줄만 남는다 — 그럴 땐 'file' 로 둔다(`_.png` 보다 낫다).
  const base = rawBase
    .replace(/[^A-Za-z0-9._-]+/g, '_')  // ASCII 화이트리스트 — 경로 구분자도 여기서 같이 걷힌다
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60) || 'file'
  return ext ? `${base}.${ext}` : base
}

/** 서명 업로드 URL 발급 — 브라우저는 이 토큰으로만 올릴 수 있다. */
async function issueUploadUrl(req: Request, raw: Record<string, unknown>) {
  const name = oneLine(raw?.name)
  const size = Number(raw?.size ?? 0)

  if (!name || name.length > 200) return json({ error: 'bad_name' }, 400)
  if (!Number.isFinite(size) || size <= 0) return json({ error: 'bad_size' }, 400)
  if (size > MAX_FILE_BYTES) return json({ error: 'too_large', max: MAX_FILE_BYTES }, 400)

  const ext = extOf(name)
  if (!ALLOWED_EXT.has(ext)) return json({ error: 'bad_type', ext }, 400)

  // 경로는 **서버가 정한다**. uuid 폴더를 앞에 두어 같은 이름이 서로 덮어쓰지 않게 한다.
  const path = `${crypto.randomUUID()}/${safeKeyName(name)}`
  const ipHash = await resolveIpHash(req)

  const admin = adminClient()
  // 자리부터 잡는다 — URL 을 먼저 발급하고 세면 바닥선을 넘긴 요청도 이미 올릴 수 있게 된다.
  const { error: claimErr } = await admin.rpc('feedback_upload_claim', {
    p_ip_hash: ipHash,
    p_path: path,
    p_name: name,
    p_size: size,
  })
  if (claimErr) {
    const msg = String(claimErr.message ?? '')
    if (msg.includes('too_many')) return json({ error: 'too_many' }, 429)
    if (msg.includes('too_big')) return json({ error: 'too_big' }, 429)
    return json({ error: claimErr.message }, 500)
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return json({ error: error?.message ?? 'sign_failed' }, 500)
  // 브라우저는 supabase-js 의 uploadToSignedUrl(path, token, file) 로 올린다.
  return json({ path: data.path ?? path, token: data.token })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const raw = await req.json().catch(() => ({}))

    if (String(raw?.action ?? '') === 'upload-url') return await issueUploadUrl(req, raw)

    const org = oneLine(raw?.org)
    const name = oneLine(raw?.name)
    const path = oneLine(raw?.path)
    // 내용만 줄바꿈을 살린다(문단으로 적는 칸이라).
    const body = String(raw?.body ?? '').replace(/\r\n/g, '\n').trim()

    // 빈 칸·길이는 사유를 갈라서 준다 — 어느 칸이 문제인지 화면이 짚어줘야 한다.
    for (const [k, v] of [['org', org], ['name', name], ['path', path], ['body', body]] as const) {
      if (!v) return json({ error: 'empty', field: k }, 400)
      if (v.length > LIMITS[k]) return json({ error: 'too_long', field: k, max: LIMITS[k] }, 400)
    }

    // 첨부는 **경로만** 받는다. 이름·크기는 RPC 가 발급 원장에서 다시 읽는다 —
    // 클라가 보낸 메타를 믿으면 '3KB 캡처' 라고 적힌 200MB 파일이 관리자 목록에 뜬다.
    const files = Array.isArray(raw?.files)
      ? (raw.files as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, MAX_FILES)
      : []

    // 익명 세션(게스트)은 계정으로 치지 않는다 — 지우면 새로 생기는 값이라 작성자 근거가 못 된다.
    const user = await getUser(req)
    const userId = user && !user.is_anonymous ? user.id : null

    const admin = adminClient()
    const { data, error } = await admin.rpc('feedback_post', {
      p_user: userId,
      p_ip_hash: await resolveIpHash(req),
      p_org: org,
      p_name: name,
      p_path: path,
      p_body: body,
      p_files: files,
    })
    if (error) {
      // RPC 가 던지는 사유는 둘이다(도배·첨부 초과). 나머지는 진짜 장애다.
      const msg = String(error.message ?? '')
      if (msg.includes('too_many_files')) return json({ error: 'too_many_files' }, 400)
      if (msg.includes('too_many')) return json({ error: 'too_many' }, 429)
      return json({ error: error.message }, 500)
    }
    return json({ ok: true, id: data })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500)
  }
})
