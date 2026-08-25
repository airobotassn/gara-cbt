// 1:1 문의(Q&A) — 사용자가 문의를 쓰고 답변을 보는 화면. 마이페이지 탭으로 붙는다.
//
// ⚠️ **비공개**다. 쓴 사람과 관리자만 본다(RLS: 본인 행만 select/insert).
//    공개 게시판으로 두면 응시·결제 문의에 섞인 개인정보가 그대로 노출되고 시험 내용이 올라온다.
// ⚠️ 답변 작성은 여기 없다 — 관리자 화면(게시판 관리 > 고객센터 > Q&A) 소관이고, 서버가 service role 로만 쓴다.
// ⚠️ 문구는 전부 `inq.*` 사전이다(2026-08-24). 이 화면만 한국어가 박혀 있어서 다른 언어로 보면 마이페이지 한 탭만
//    통째로 한국어였다. 분류는 DB 에 코드만 들어 있으므로 라벨은 `inq.cat.<코드>` 로 키를 조립한다.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT, localeOf, hasKey, type Lang } from '../lib/i18n'
import { markInquirySeen, refreshInquiryAlert } from '../lib/inquiryAlert'

interface Row {
  id: string
  category: string
  title: string
  body: string
  status: string
  answer: string | null
  answered_at: string | null
  answer_seen_at: string | null
  created_at: string
}

const CATS = ['exam', 'payment', 'account', 'arena', 'etc'] as const
// 관리자가 옛 코드를 남겨두거나 새 분류를 넣었을 때를 대비해 사전에 없으면 코드를 그대로 보여준다.
const catKey = (k: string) => (hasKey(`inq.cat.${k}`) ? `inq.cat.${k}` : '')
// 시각은 화면 언어로 쓰되 표준시는 KST 고정 — 회차·응시 일정이 전부 KST 기준이다.
const fmt = (lang: Lang, iso?: string | null) =>
  !iso ? '-' : new Date(iso).toLocaleString(localeOf(lang), { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })

export default function InquiryBoard() {
  const { isFullUser } = useAuth()
  const { t, lang } = useT()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [cat, setCat] = useState('etc')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  // ⚠️ 오류는 문구가 아니라 **사전 키**로 담는다 — 그래야 화면 언어를 바꿨을 때 이미 뜬 메시지도 같이 바뀐다.
  //    (서버 오류만 원문 그대로 — 번역할 대상이 아니다.)
  const [err, setErr] = useState('')
  const [errKey, setErrKey] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('inquiries')
      .select('id, category, title, body, status, answer, answered_at, answer_seen_at, created_at')
      .order('created_at', { ascending: false })
    if (error) { setErrKey(''); setErr(error.message); setRows([]); return }
    setRows((data ?? []) as Row[])
    // 목록을 받은 김에 알림 점 개수도 맞춘다 — 다른 기기에서 이미 읽었으면 여기서 꺼진다.
    refreshInquiryAlert(true)
  }, [])
  useEffect(() => { if (isFullUser) load() }, [isFullUser, load])

  // 펼치는 순간이 곧 '읽음'이다 — 탭에 들어온 것만으로 끄면 목록만 스쳐본 사람의 답변이 조용히 사라진다.
  //   ⚠️ 낙관적으로 화면부터 끄고 서버를 부른다. 실패해도 다음 조회에서 점이 되살아날 뿐 잃는 게 없다.
  function toggle(r: Row) {
    if (open === r.id) { setOpen(null); return }
    setOpen(r.id)
    if (r.status === 'answered' && !r.answer_seen_at) {
      const now = new Date().toISOString()
      setRows((prev) => (prev ?? []).map((x) => (x.id === r.id ? { ...x, answer_seen_at: now } : x)))
      markInquirySeen(r.id)
    }
  }

  async function submit() {
    if (!title.trim() || !body.trim()) { setErr(''); setErrKey('inq.err_fields'); return }
    setBusy(true); setErr(''); setErrKey('')
    // RLS 가 본인 행만 넣게 막는다 — user_id 는 세션에서 채운다.
    const { data: u } = await supabase.auth.getUser()
    const uid = u.user?.id
    if (!uid) { setErrKey('inq.err_login'); setBusy(false); return }
    const { error } = await supabase.from('inquiries').insert({ user_id: uid, category: cat, title, body })
    if (error) setErr(error.message)
    else { setWriting(false); setTitle(''); setBody(''); setCat('etc'); await load() }
    setBusy(false)
  }

  if (!isFullUser) {
    return <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('inq.login_required')}</div>
  }

  const errText = errKey ? t(errKey) : err

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* ⚠️ 두 문장을 쪼개 인라인 <b> 를 끼우지 않는다 — 어순이 언어마다 달라 번역이 불가능해진다.
            강조는 '본인·운영자만 본다' 문장을 통째로 굵게. */}
        <p className="font-body-md text-body-md text-on-surface-variant break-keep">
          {t('inq.intro')} <b>{t('inq.private')}</b>
        </p>
        <button
          onClick={() => setWriting((v) => !v)}
          className="bg-primary-container text-on-primary font-label-md font-bold px-5 py-2.5 rounded-xl hover:bg-primary transition-colors ambient-shadow shrink-0"
        >
          {writing ? t('common.cancel') : t('inq.write')}
        </button>
      </div>

      {errText && <div className="bg-error-container/10 border border-error-container rounded-xl p-4 font-body-md text-error">{errText}</div>}

      {writing && (
        <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 flex flex-col gap-4">
          <div className="flex gap-3 flex-wrap">
            {CATS.map((k) => (
              <button
                key={k}
                onClick={() => setCat(k)}
                className={`px-4 py-2 rounded-xl font-label-md text-[15px] border transition-colors ${
                  cat === k ? 'bg-primary-container text-on-primary border-transparent' : 'border-outline-variant text-on-surface-variant hover:border-primary'
                }`}
              >{t(`inq.cat.${k}`)}</button>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('inq.ph_title')}
            className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/50 text-on-surface font-body-lg"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('inq.ph_body')}
            rows={7}
            className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/50 text-on-surface font-body-lg leading-relaxed"
          />
          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={busy}
              className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-50"
            >{busy ? t('inq.sending') : t('inq.submit')}</button>
          </div>
        </div>
      )}

      {rows === null ? (
        <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('inq.empty')}</div>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r) => {
            const opened = open === r.id
            const ck = catKey(r.category)
            return (
              <article key={r.id} className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 overflow-hidden">
                <button onClick={() => toggle(r)} className="w-full text-left p-6 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-label-sm text-[11px] font-bold uppercase tracking-wider">
                        {ck ? t(ck) : r.category}
                      </span>
                      {r.status === 'open'
                        ? <span className="px-3 py-1 rounded-full bg-outline/10 text-outline border border-outline/20 font-label-sm text-[11px] font-bold">{t('inq.status_open')}</span>
                        : <span className="px-3 py-1 rounded-full bg-primary-container/15 text-primary-container border border-primary-container/30 font-label-sm text-[11px] font-bold">{t('inq.status_answered')}</span>}
                      {/* 아직 안 펼쳐본 답변 — '답변 완료'만으로는 새로 온 건지 예전에 읽은 건지 구분이 안 된다.
                          여기 점이 FAB·탭의 점과 같은 것이고, 펼치는 순간 셋이 같이 꺼진다. */}
                      {r.status === 'answered' && !r.answer_seen_at ? (
                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-error/10 text-error border border-error/25 font-label-sm text-[11px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-error" aria-hidden="true" />
                          {t('inq.new_answer')}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="font-title-md text-lg font-bold text-on-surface break-keep">{r.title}</h3>
                    <p className="font-body-md text-body-md text-on-surface-variant mt-1">{fmt(lang, r.created_at)}</p>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant shrink-0">{opened ? 'expand_less' : 'expand_more'}</span>
                </button>
                {opened && (
                  <div className="px-6 pb-6 flex flex-col gap-4">
                    <div className="p-4 rounded-xl bg-surface-container-low font-body-lg leading-relaxed whitespace-pre-wrap break-keep">{r.body}</div>
                    {r.answer ? (
                      <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                        <div className="font-label-md text-[14px] font-bold text-primary mb-2">{t('inq.answer_at', { d: fmt(lang, r.answered_at) })}</div>
                        <div className="font-body-lg leading-relaxed whitespace-pre-wrap break-keep text-on-surface">{r.answer}</div>
                      </div>
                    ) : (
                      <p className="font-body-md text-body-md text-outline">{t('inq.no_answer')}</p>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
