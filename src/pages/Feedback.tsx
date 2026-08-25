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
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { callFunction, FunctionError } from '../lib/supabase'

// ⚠️ 서버 LIMITS·DB CHECK 과 한 벌이다(supabase/functions/feedback/index.ts). 셋이 어긋나면
//    화면이 통과시킨 글이 저장에서 터지거나, 반대로 화면이 멀쩡한 글을 막는다.
const MAX = { org: 60, name: 40, path: 200, body: 4000 } as const

type Field = 'org' | 'name' | 'path' | 'body'

export default function Feedback() {
  const { t } = useT()
  const [form, setForm] = useState<Record<Field, string>>({ org: '', name: '', path: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  // 실패 사유는 **문구가 아니라 사전 키**로 담는다 — 언어를 바꿔도 메시지가 따라 바뀌고,
  // 이펙트가 t 를 의존하지 않게 된다(허브 i18n 이관 때 배운 것).
  const [errKey, setErrKey] = useState('')

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const filled = (Object.keys(MAX) as Field[]).every((k) => form[k].trim())

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !filled) return
    setBusy(true)
    setErrKey('')
    try {
      await callFunction('feedback', form)
      setDone(true)
    } catch (err) {
      // 서버가 주는 기계 코드는 셋뿐이다(empty·too_long·too_many). 그 외는 통짜 실패 문구.
      const code = err instanceof FunctionError ? String((err.body as { error?: string })?.error ?? '') : ''
      setErrKey(code === 'too_many' ? 'feedback.err_too_many' : code === 'too_long' ? 'feedback.err_too_long' : 'feedback.err_fail')
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
        <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed mb-8">
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
                onClick={() => { setForm((f) => ({ ...f, path: '', body: '' })); setDone(false) }}
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
                disabled={busy || !filled}
                className="bg-primary-container text-on-primary font-label-md font-bold px-8 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-50"
              >
                {busy ? t('common.loading') : t('feedback.submit')}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
