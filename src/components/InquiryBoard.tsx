// 1:1 문의(Q&A) — 사용자가 문의를 쓰고 답변을 보는 화면. 마이페이지 탭으로 붙는다.
//
// ⚠️ **비공개**다. 쓴 사람과 관리자만 본다(RLS: 본인 행만 select/insert).
//    공개 게시판으로 두면 응시·결제 문의에 섞인 개인정보가 그대로 노출되고 시험 내용이 올라온다.
// ⚠️ 답변 작성은 여기 없다 — 관리자 화면(게시판 관리 > 고객센터 > Q&A) 소관이고, 서버가 service role 로만 쓴다.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'

interface Row {
  id: string
  category: string
  title: string
  body: string
  status: string
  answer: string | null
  answered_at: string | null
  created_at: string
}

const CATS: [string, string][] = [
  ['exam', '응시·시험'], ['payment', '결제·환불'], ['account', '계정'],
  ['arena', 'WORLD ARENA'], ['etc', '기타'],
]
const catLabel = (k: string) => CATS.find(([c]) => c === k)?.[1] ?? k
const fmt = (iso?: string | null) =>
  !iso ? '-' : new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })

export default function InquiryBoard() {
  const { isFullUser } = useAuth()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [cat, setCat] = useState('etc')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('inquiries')
      .select('id, category, title, body, status, answer, answered_at, created_at')
      .order('created_at', { ascending: false })
    if (error) { setErr(error.message); setRows([]); return }
    setRows((data ?? []) as Row[])
  }, [])
  useEffect(() => { if (isFullUser) load() }, [isFullUser, load])

  async function submit() {
    if (!title.trim() || !body.trim()) { setErr('제목과 내용을 모두 입력해 주세요.'); return }
    setBusy(true); setErr('')
    // RLS 가 본인 행만 넣게 막는다 — user_id 는 세션에서 채운다.
    const { data: u } = await supabase.auth.getUser()
    const uid = u.user?.id
    if (!uid) { setErr('로그인이 필요합니다.'); setBusy(false); return }
    const { error } = await supabase.from('inquiries').insert({ user_id: uid, category: cat, title, body })
    if (error) setErr(error.message)
    else { setWriting(false); setTitle(''); setBody(''); setCat('etc'); await load() }
    setBusy(false)
  }

  if (!isFullUser) {
    return <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">로그인 후 이용할 수 있습니다.</div>
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="font-body-md text-body-md text-on-surface-variant break-keep">
          문의하시면 확인 후 답변드립니다. <b>작성자 본인과 운영자만</b> 볼 수 있습니다.
        </p>
        <button
          onClick={() => setWriting((v) => !v)}
          className="bg-primary-container text-on-primary font-label-md font-bold px-5 py-2.5 rounded-xl hover:bg-primary transition-colors ambient-shadow shrink-0"
        >
          {writing ? '취소' : '문의하기'}
        </button>
      </div>

      {err && <div className="bg-error-container/10 border border-error-container rounded-xl p-4 font-body-md text-error">{err}</div>}

      {writing && (
        <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 flex flex-col gap-4">
          <div className="flex gap-3 flex-wrap">
            {CATS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setCat(k)}
                className={`px-4 py-2 rounded-xl font-label-md text-[15px] border transition-colors ${
                  cat === k ? 'bg-primary-container text-on-primary border-transparent' : 'border-outline-variant text-on-surface-variant hover:border-primary'
                }`}
              >{label}</button>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목"
            className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/50 text-on-surface font-body-lg"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="문의 내용을 적어주세요. 응시·결제 문의는 회차와 급수를 같이 적어주시면 빠릅니다."
            rows={7}
            className="w-full px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/50 text-on-surface font-body-lg leading-relaxed"
          />
          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={busy}
              className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-50"
            >{busy ? '보내는 중…' : '문의 등록'}</button>
          </div>
        </div>
      )}

      {rows === null ? (
        <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">아직 문의가 없습니다.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r) => {
            const opened = open === r.id
            return (
              <article key={r.id} className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 overflow-hidden">
                <button onClick={() => setOpen(opened ? null : r.id)} className="w-full text-left p-6 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-label-sm text-[11px] font-bold uppercase tracking-wider">
                        {catLabel(r.category)}
                      </span>
                      {r.status === 'open'
                        ? <span className="px-3 py-1 rounded-full bg-outline/10 text-outline border border-outline/20 font-label-sm text-[11px] font-bold">답변 대기</span>
                        : <span className="px-3 py-1 rounded-full bg-primary-container/15 text-primary-container border border-primary-container/30 font-label-sm text-[11px] font-bold">답변 완료</span>}
                    </div>
                    <h3 className="font-title-md text-lg font-bold text-on-surface break-keep">{r.title}</h3>
                    <p className="font-body-md text-body-md text-on-surface-variant mt-1">{fmt(r.created_at)}</p>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant shrink-0">{opened ? 'expand_less' : 'expand_more'}</span>
                </button>
                {opened && (
                  <div className="px-6 pb-6 flex flex-col gap-4">
                    <div className="p-4 rounded-xl bg-surface-container-low font-body-lg leading-relaxed whitespace-pre-wrap break-keep">{r.body}</div>
                    {r.answer ? (
                      <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                        <div className="font-label-md text-[14px] font-bold text-primary mb-2">답변 · {fmt(r.answered_at)}</div>
                        <div className="font-body-lg leading-relaxed whitespace-pre-wrap break-keep text-on-surface">{r.answer}</div>
                      </div>
                    ) : (
                      <p className="font-body-md text-body-md text-outline">아직 답변이 등록되지 않았습니다.</p>
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
