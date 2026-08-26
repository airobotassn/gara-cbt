// /feedback — 의견함. FAB 패널의 빨간 '의견 보내기' 가 유일한 진입점이다.
//
// ⛔ 1:1 문의(/mypage/inquiry)와 **다른 물건**이다. 문의는 로그인한 회원이 쓰고 관리자가 답변하지만,
//    의견은 **비로그인 누구나** 쓰고 답변이 안 온다. 그래서 화면도 "답변 기다리세요" 라고 말하지 않는다.
//    두 화면을 합치자는 생각이 들면 답변 경로가 있느냐부터 볼 것.
// ⚠️ 소속·이름을 계정에서 끌어오지 않는다. 로그인 안 한 검수자가 주 사용자이고, 로그인한 사람도
//    닉네임(랭킹용)과 실제 소속·이름이 다르다 — 본인이 적은 값이 이 기능의 답이다.
//    (서버는 로그인 상태면 계정 id 를 따로 기록해 둔다. 화면이 하는 일은 아니다.)
// ⚠️ '경로' 는 사람 말로 적는 칸이다(2026-08-25 결정) — 현재 주소를 자동으로 넣지 않는다.
//    의견을 쓰는 자리와 의견의 대상이 되는 화면이 대개 다르기 때문이다.
//
// ── 첨부파일(2026-08-26) ─────────────────────────────────────────────────
// ⚠️ **붙이는 순간 올린다**(제출할 때 몰아 올리지 않는다). 20MB 짜리 PPT 를 제출 버튼 뒤에 숨기면
//    사용자는 다 쓰고 나서 몇십 초를 기다리다 실패를 본다 — 그 시점엔 뭘 고쳐야 하는지도 모른다.
//    대신 붙여만 놓고 안 보낸 파일이 스토리지에 남는데, 그건 feedback_uploads 가 고아 목록으로 들고 있다.
// ⚠️ 업로드는 **서버가 발급한 서명 URL** 로만 한다. 브라우저가 Storage 에 직접 붙는 길은 없다
//    (비로그인 화면이라 그 길을 열면 가드 없는 업로드 엔드포인트가 된다 — functions/feedback 주석 참고).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { callFunction, FunctionError, supabase } from '../lib/supabase'

// ⚠️ 서버 LIMITS·DB CHECK 과 한 벌이다(supabase/functions/feedback/index.ts). 셋이 어긋나면
//    화면이 통과시킨 글이 저장에서 터지거나, 반대로 화면이 멀쩡한 글을 막는다.
const MAX = { org: 60, name: 40, path: 200, body: 4000 } as const

// 첨부 상수 — 서버 상수(functions/feedback/index.ts)·DB CHECK·버킷 file_size_limit 과 **한 벌**이다.
// 화면이 더 헐거우면 사용자는 통과한 줄 알았다가 업로드에서만 이유 없이 실패한다.
const BUCKET = 'feedback-files'
const MAX_FILES = 3
const MAX_FILE_BYTES = 20 * 1024 * 1024

// 서버 ALLOWED_EXT 와 같은 목록. 여기서 먼저 걸러야 20MB 를 다 올린 뒤에 거절당하지 않는다.
const ALLOWED_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif',
  'pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'hwp', 'hwpx', 'txt', 'csv', 'md', 'rtf',
  'mp4', 'mov', 'webm', 'zip',
])

type Field = 'org' | 'name' | 'path' | 'body'

/** 붙인 파일 한 개. `path` 는 업로드가 끝나야 생기고, 제출에는 그 값만 실어보낸다. */
interface Attach {
  key: string
  name: string
  size: number
  state: 'up' | 'ok' | 'err'
  path?: string
  /** 실패 사유는 문구가 아니라 **사전 키**로 담는다 — 언어를 바꾸면 메시지도 따라 바뀐다. */
  errKey?: string
}

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  return `${Math.max(1, Math.round(n / 1024))}KB`
}

export default function Feedback() {
  const { t } = useT()
  const [form, setForm] = useState<Record<Field, string>>({ org: '', name: '', path: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  // 실패 사유는 **문구가 아니라 사전 키**로 담는다 — 언어를 바꿔도 메시지가 따라 바뀌고,
  // 이펙트가 t 를 의존하지 않게 된다(허브 i18n 이관 때 배운 것).
  const [errKey, setErrKey] = useState('')
  const [files, setFiles] = useState<Attach[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // ⚠️ 개수 판정에 쓰는 거울. setFiles 의 갱신 함수 **안에서 setErrKey 를 부르면 안 되므로**
  //    (렌더 중 다른 상태를 건드리는 것이다) 지금 개수를 동기로 읽을 자리가 하나 필요하다.
  const filesRef = useRef<Attach[]>([])

  /** files 를 바꾸는 유일한 통로. 거울에서 계산해 거울과 상태를 **같은 순간에** 맞춘다 —
   *  setFiles 의 갱신 함수에 맡기면 한 tick 안에 두 번 부를 때(파일 여러 개를 연달아 붙일 때)
   *  둘 다 옛 개수를 보고 상한을 넘긴다. */
  const putFiles = useCallback((make: (prev: Attach[]) => Attach[]) => {
    const next = make(filesRef.current)
    filesRef.current = next
    setFiles(next)
  }, [])

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const filled = (Object.keys(MAX) as Field[]).every((k) => form[k].trim())
  // 올리는 중에는 보내지 않는다 — 보내버리면 그 파일만 빠진 채로 접수된다.
  const uploading = files.some((f) => f.state === 'up')

  /** 파일 한 개를 서명 URL 로 올린다. 실패해도 그 칩에만 표시하고 폼 전체를 막지 않는다. */
  const upload = useCallback(async (key: string, file: File) => {
    try {
      const { path, token } = await callFunction<{ path: string; token: string }>('feedback', {
        action: 'upload-url',
        name: file.name,
        size: file.size,
      })
      const { error } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type || undefined })
      if (error) throw error
      putFiles((prev) => prev.map((f) => (f.key === key ? { ...f, state: 'ok', path } : f)))
    } catch (err) {
      const code = err instanceof FunctionError ? String((err.body as { error?: string })?.error ?? '') : ''
      const k =
        code === 'bad_type' ? 'feedback.err_file_type'
        : code === 'too_large' ? 'feedback.err_file_size'
        : code === 'too_many' || code === 'too_big' ? 'feedback.err_file_quota'
        : 'feedback.err_file_fail'
      putFiles((prev) => prev.map((f) => (f.key === key ? { ...f, state: 'err', errKey: k } : f)))
    }
  }, [putFiles])

  /** 고르기·끌어놓기·붙여넣기가 전부 여기로 모인다. */
  const addFiles = useCallback((picked: File[]) => {
    if (!picked.length) return
    const room = MAX_FILES - filesRef.current.length
    if (room <= 0) { setErrKey('feedback.err_file_many'); return }
    setErrKey(picked.length > room ? 'feedback.err_file_many' : '')

    const next: Attach[] = []
    for (const file of picked.slice(0, room)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // 형식·용량은 올리기 **전에** 본다. 20MB 를 다 보낸 뒤 거절하면 사용자 시간만 버린다.
      if (!ALLOWED_EXT.has(extOf(file.name))) {
        next.push({ key, name: file.name, size: file.size, state: 'err', errKey: 'feedback.err_file_type' })
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        next.push({ key, name: file.name, size: file.size, state: 'err', errKey: 'feedback.err_file_size' })
        continue
      }
      next.push({ key, name: file.name, size: file.size, state: 'up' })
      void upload(key, file)
    }
    putFiles((prev) => [...prev, ...next])
  }, [upload, putFiles])

  // 캡처는 대개 클립보드에 있다 — 파일로 저장했다가 다시 고르게 만들지 않는다.
  // ⚠️ 글자 붙여넣기는 건드리지 않는다(파일이 실려 있을 때만 가로챈다).
  useEffect(() => {
    if (done) return
    function onPaste(e: ClipboardEvent) {
      const list = Array.from(e.clipboardData?.files ?? [])
      if (!list.length) return
      e.preventDefault()
      // 클립보드 이미지는 이름이 없거나 전부 'image.png' 라 관리자 목록에서 구분이 안 된다.
      const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
      addFiles(list.map((f, i) =>
        /^image\.\w+$/i.test(f.name) || !f.name
          ? new File([f], `screenshot-${stamp}${list.length > 1 ? `-${i + 1}` : ''}.${extOf(f.name) || 'png'}`, { type: f.type })
          : f))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles, done])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || uploading || !filled) return
    setBusy(true)
    setErrKey('')
    try {
      // 올라간 것만 보낸다 — 실패한 칩은 사용자가 이미 붉게 보고 있다.
      await callFunction('feedback', { ...form, files: files.flatMap((f) => (f.path ? [f.path] : [])) })
      setDone(true)
    } catch (err) {
      // 서버가 주는 기계 코드는 넷뿐이다(empty·too_long·too_many·too_many_files). 그 외는 통짜 실패 문구.
      const code = err instanceof FunctionError ? String((err.body as { error?: string })?.error ?? '') : ''
      setErrKey(
        code === 'too_many' ? 'feedback.err_too_many'
        : code === 'too_long' ? 'feedback.err_too_long'
        : code === 'too_many_files' ? 'feedback.err_file_many'
        : 'feedback.err_fail',
      )
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/50 text-on-surface font-body-lg'

  return (
    <div className="bg-background text-on-surface min-h-screen relative overflow-x-hidden flex flex-col">
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
        <div className="ambient-mesh bg-surface-mesh-blue top-[-20%] left-[-10%]"></div>
        <div className="ambient-mesh bg-surface-mesh-cyan bottom-[-20%] right-[-10%]"></div>
      </div>

      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop max-w-[720px] mx-auto w-full">
        <Link to="/" className="gd-back mb-6">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          {t('common.home')}
        </Link>

        <h1 className="font-headline-lg text-2xl md:text-headline-lg font-bold break-keep mb-2">{t('feedback.title')}</h1>
        {/* ⚠️ whitespace-pre-line 이 있어야 사전의 줄바꿈(\n)이 살아난다 — 빼면 세 문장이 한 덩어리로 붙는다. */}
        <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed mb-8 whitespace-pre-line">
          {t('feedback.sub')}
        </p>

        {done ? (
          /* 보낸 뒤 폼을 그대로 두면 '한 번 더 눌러야 하나' 로 읽힌다 — 완료 화면으로 갈아끼운다.
             '하나 더 쓰기' 로 폼을 비워 다시 연다(검수자는 대개 연달아 여러 건을 적는다). */
          <div className="bg-surface-container-lowest rounded-2xl p-10 border border-outline-variant/30 text-center flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-[44px] text-primary">check_circle</span>
            <h2 className="font-title-md text-lg font-bold">{t('feedback.done_title')}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">
              {t('feedback.done_body')}
            </p>
            <div className="flex gap-3 flex-wrap justify-center mt-3">
              <button
                type="button"
                className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow"
                onClick={() => { setForm((f) => ({ ...f, path: '', body: '' })); putFiles(() => []); setDone(false) }}
              >
                {t('feedback.again')}
              </button>
              <Link
                to="/"
                className="border border-outline-variant/50 text-on-surface-variant font-label-md font-bold px-6 py-3 rounded-xl"
              >
                {t('common.home')}
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 flex flex-col gap-5">
            {errKey ? (
              <div className="bg-error-container/10 border border-error-container rounded-xl p-4 font-body-md text-error">
                {t(errKey)}
              </div>
            ) : null}

            {/* 소속·이름은 짧은 칸이라 넓은 화면에서 한 줄에 둘을 세운다. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <label className="flex flex-col gap-2">
                <span className="font-label-md font-bold">{t('feedback.f_org')}</span>
                <input className={inputCls} value={form.org} onChange={set('org')} maxLength={MAX.org} placeholder={t('feedback.ph_org')} />
              </label>
              <label className="flex flex-col gap-2">
                <span className="font-label-md font-bold">{t('feedback.f_name')}</span>
                <input className={inputCls} value={form.name} onChange={set('name')} maxLength={MAX.name} placeholder={t('feedback.ph_name')} />
              </label>
            </div>

            <label className="flex flex-col gap-2">
              <span className="font-label-md font-bold">{t('feedback.f_path')}</span>
              <input className={inputCls} value={form.path} onChange={set('path')} maxLength={MAX.path} placeholder={t('feedback.ph_path')} />
              <span className="font-body-md text-[13px] text-on-surface-variant">{t('feedback.hint_path')}</span>
            </label>

            {/* ── 첨부 ──
                ⚠️ **내용 칸보다 위다**(2026-08-26 지시). 아래에 두면 세로로 긴 textarea 에 밀려
                   첫 화면에서 잘려서, 첨부를 붙일 수 있다는 걸 스크롤하기 전엔 모른다.
                ⚠️ <label> 로 감싸지 않는다 — 안에 삭제 버튼이 있어서, label 이면 그 버튼을 눌러도
                   파일 선택창이 같이 열린다. */}
            <div className="flex flex-col gap-2">
              <span className="font-label-md font-bold">
                {t('feedback.f_files')}
                <span className="font-body-md text-on-surface-variant ml-2">{files.length} / {MAX_FILES}</span>
              </span>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)) }}
                className={`rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
                  dragOver ? 'border-primary bg-primary-container/10' : 'border-outline-variant/50 bg-surface-container-low'
                }`}
              >
                <span className="material-symbols-outlined text-[28px] text-on-surface-variant">upload_file</span>
                <p className="font-body-md text-body-md text-on-surface-variant break-keep mt-1">{t('feedback.files_drop')}</p>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={files.length >= MAX_FILES}
                  className="mt-3 border border-outline-variant/50 text-on-surface font-label-md font-bold px-5 py-2 rounded-xl disabled:opacity-50"
                >
                  {t('feedback.files_pick')}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []))
                    // 같은 파일을 다시 고를 수 있게 비운다(안 비우면 두 번째 선택이 조용히 무시된다).
                    e.target.value = ''
                  }}
                />
              </div>
              <span className="font-body-md text-[13px] text-on-surface-variant break-keep">{t('feedback.files_hint')}</span>

              {files.length ? (
                <ul className="flex flex-col gap-2 mt-1">
                  {files.map((f) => (
                    <li
                      key={f.key}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                        f.state === 'err' ? 'border-error-container bg-error-container/10' : 'border-outline-variant/50 bg-surface-container-low'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[20px] ${f.state === 'up' ? 'animate-spin' : ''} ${f.state === 'err' ? 'text-error' : 'text-on-surface-variant'}`}>
                        {f.state === 'up' ? 'progress_activity' : f.state === 'err' ? 'error' : 'check_circle'}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-body-md text-body-md truncate">{f.name}</span>
                        <span className={`block font-body-md text-[13px] ${f.state === 'err' ? 'text-error' : 'text-on-surface-variant'}`}>
                          {f.state === 'err' ? t(f.errKey ?? 'feedback.err_file_fail') : f.state === 'up' ? t('feedback.files_up') : fmtSize(f.size)}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={t('feedback.files_remove')}
                        onClick={() => putFiles((prev) => prev.filter((x) => x.key !== f.key))}
                        className="material-symbols-outlined text-[20px] text-on-surface-variant shrink-0"
                      >
                        close
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <label className="flex flex-col gap-2">
              <span className="font-label-md font-bold">{t('feedback.f_body')}</span>
              <textarea
                className={`${inputCls} leading-relaxed`}
                rows={9}
                value={form.body}
                onChange={set('body')}
                maxLength={MAX.body}
                placeholder={t('feedback.ph_body')}
              />
              <span className="font-body-md text-[13px] text-on-surface-variant text-right">{form.body.length} / {MAX.body}</span>
            </label>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy || uploading || !filled}
                className="bg-primary-container text-on-primary font-label-md font-bold px-8 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-50"
              >
                {busy || uploading ? t('common.loading') : t('feedback.submit')}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
