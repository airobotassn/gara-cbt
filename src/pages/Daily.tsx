// /daily — 오늘의 학습(데일리 콘텐츠).
//   [확정] '하루 완료 = 오늘의 콘텐츠 소비' — 정답/풀이 무관, 소비 기준(docs/제품구상.md §6-4).
//   그래서 이 화면엔 채점·점수·오답노트가 없다. 그건 Level Test(/test/*) 몫이고 두 축은 독립.
//
// ⚠️ 지금은 콘텐츠 파이프라인이 없다(테이블·타입별 소비 판정 미구현).
//    콘텐츠 슬롯은 자리표시자이고, 완료 트리거는 임시 버튼이다. 콘텐츠가 붙으면
//    <DailySlot> 자리에 문제형/수동 소비형 렌더러가 들어가고, 완료 판정이
//    '끝까지 봄(수동) · 열람·시도(문제형)'로 바뀐다. 적립 자체는 서버가 이미 권위.
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import '../styles/daily.css'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT, localeOf } from '../lib/i18n'
import { dailyTerm, dailyChoices, termTheory, TERMS } from '../lib/terms'
import DailyVisual from '../components/DailyVisual'
import StarField from '../components/StarField'

// ⚠️ 서버(complete-daily)의 DAILY_POINTS 와 같은 값이어야 한다. 적립 권위는 서버, 여기는 예고 표시용.
const DAILY_POINTS = 10

// ⚠️ 이 화면에는 스탬프 표시가 없다(2026-08-26 제거). 서버는 여전히 스탬프를 적립하지만
//    자동 출석이 늘 먼저 찍어서 '오늘의 학습'으로는 한 번도 들어오지 않는다 — 화면에 '스탬프 +1'
//    예고와 7칸 판을 두면 매일 거짓말을 한다. 스탬프를 보는 자리는 허브 도크 하나뿐이다.

// get-hub 응답 중 이 화면이 쓰는 것만. (전체 형태는 Hub.tsx 참고)
//   ⚠️ 이 화면의 완료 판정은 learnDone(=daily_activity.did_learn) 이다. dailyDone(출석)이나 행 존재로
//      판정하면 레벨테스트·미니게임만 해도 오늘의 문제가 잠긴다(2026-07-27 버그).
interface HubState { authed: boolean; points?: number; learnDone?: boolean }
// complete-daily 응답. first = 이번 호출로 재화(코인·스탬프)가 실제 지급됐는지(출석·학습 통틀어 하루 1회).
// bonus = 7일 스탬프를 채운 날 붙는 완주 보너스 코인(0 이면 없음). 금액 권위는 서버다.
interface DailyResp { ok: boolean; day: string; first: boolean; bonus?: number }

const IK = '#33323f'
const ICONS: Record<string, ReactNode> = {
  sun: (<><circle cx="12" cy="12" r="5" fill="#f2c65e" stroke={IK} strokeWidth="2" /><g stroke={IK} strokeWidth="2" strokeLinecap="round"><path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" /></g></>),
  coin: (<><circle cx="12" cy="12" r="8.6" fill="#f2c65e" stroke={IK} strokeWidth="2" /><circle cx="12" cy="12" r="5.4" fill="none" stroke={IK} strokeWidth="1.4" opacity=".55" /><path d="M12 8.6v6.8M10.2 10.4h3.2a1.6 1.6 0 0 1 0 3.2h-2.8" stroke={IK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>),
  lock: (<><rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.4" fill="#fff" stroke={IK} strokeWidth="2" /><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" fill="none" stroke={IK} strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="15.4" r="1.5" fill={IK} /></>),
}
function Ic({ n, s = 24 }: { n: string; s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">{ICONS[n]}</svg>
}

export default function Daily() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const { t, lang } = useT()
  const [authed, setAuthed] = useState(false)
  const [points, setPoints] = useState(0)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [celebrate, setCelebrate] = useState(false) // 완료 직후 보상 연출(재방문 시엔 안 뜬다)
  const [rewarded, setRewarded] = useState(true) // 이번 완료로 재화가 실제 지급됐는지(서버 응답 first)
  const [bonus, setBonus] = useState(0) // 7일 완주 보너스 코인(서버 응답 bonus)
  // 오늘의 문제 — 미니게임과 같은 용어 풀(lib/terms)에서 날짜별로 하나씩 순환. 마운트 시 1회 고정.
  // ⚠️ `?term=N` 은 **개발 서버에서만** 도는 미리보기다(해설·그림을 하루씩 기다리며 확인할 수 없어서).
  //    import.meta.env.DEV 가 false 인 빌드에서는 분기 자체가 트리셰이킹으로 사라진다.
  const [term] = useState(() => {
    if (import.meta.env.DEV) {
      const n = Number(new URLSearchParams(window.location.search).get('term'))
      if (Number.isInteger(n) && n >= 0) return TERMS[n % TERMS.length]
    }
    return dailyTerm()
  })
  const [choices] = useState(() =>
    term === dailyTerm() ? dailyChoices() : [term.answer, ...term.distractors],
  ) // 보기 4개(정답+오답3), 날짜 시드로 섞임
  const [picked, setPicked] = useState<string | null>(null) // 이번 방문에 고른 보기
  // 정답 공개 조건 = 이번에 골랐거나 / 서버가 이미 오늘 완료로 기록(재방문)한 경우.
  const answered = picked !== null || done
  // 풀고 나서 읽는 해설. 아직 안 쓴 용어면 null 이고, 그날은 해설 블록이 아예 안 나온다.
  const theory = termTheory(term)

  function applyHub(h: HubState) {
    setAuthed(!!h.authed)
    setPoints(h.points ?? 0)
    setDone(!!h.learnDone)
  }

  // 마운트 하이드레이트. setState 는 프라미스 콜백에서만(허브와 동일 규칙).
  useEffect(() => {
    let alive = true
    callFunction<HubState>('get-hub', {})
      .then((h) => { if (alive) { applyHub(h); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // 완료 → complete-daily(1일 1회 서버 강제·멱등). 성공 후 get-hub 로 재화 재동기화.
  // 완료 트리거 = 오늘의 문제 '시도'(onPick). 설계상 맞히는 게 아니라 시도하면 완료다.
  async function complete() {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (done || busy) return
    setBusy(true)
    setErr('')
    try {
      // kind 를 안 보내면 서버 기본값이 '출석'이라 학습이 출석으로 적립된다(did_learn 이 영영 안 찍힘).
      const r = await callFunction<DailyResp>('complete-daily', { kind: 'daily_learn' })
      const h = await callFunction<HubState>('get-hub', {})
      applyHub(h)
      setRewarded(!!r.first) // 오늘 출석으로 이미 재화를 받았으면 false — 보상 문구를 거짓말하지 않는다.
      setBonus(r.bonus ?? 0)
      setCelebrate(true)
    } catch {
      setErr('완료 처리에 실패했어요. 잠시 후 다시 시도해주세요')
    } finally {
      setBusy(false)
    }
  }

  // 보기 선택 = 오늘 학습 '시도'. 정답 공개는 로그인과 무관(누구나 학습), 적립만 로그인 필요
  //   → complete() 안에서 비로그인이면 로그인 유도. 맞히든 틀리든 한 번 고르면 완료로 간다.
  function onPick(opt: string) {
    if (answered || busy) return
    setPicked(opt)
    void complete()
  }

  // ⚠️ 로케일을 'ko-KR' 로 박아두면 화면 언어를 바꿔도 이 날짜만 한국어로 남는다(2026-08-07 수정).
  const today = new Date().toLocaleDateString(localeOf(lang), { month: 'long', day: 'numeric', weekday: 'short' })

  return (
    <div className="dy-page">
      {/* 밤하늘 — /arena 와 같은 별(다크에서만). 내용은 .dy-wrap 이 z-index:1 로 그 위에 선다. */}
      <StarField />
      <div className="dy-wrap">
      <div className="dy-top">
        {/* 뒤로 = 아레나. 아레나 하단 런처가 허브·레벨테스트·데일리·미니게임의 관문이라 그게 이 화면의 부모다. */}
        <button className="dy-back" onClick={() => navigate('/arena')} aria-label="WORLD ARENA">
          <span className="material-symbols-outlined">arrow_back</span> WORLD ARENA
        </button>
        <div className="dy-head">
          <b>{t('daily.title')}</b>
          <i>{today}</i>
        </div>
        <span className="dy-coin"><Ic n="coin" s={20} />{points.toLocaleString()}</span>
      </div>

      {!loading && !authed && (
        <div className="dy-banner">
          <span>{t('daily.login_note')}</span>
          <button className="dy-btn dy-btn-sm" onClick={() => loginWithGoogle()}>{t('common.login_google')}</button>
        </div>
      )}

      {/* 2단: 콘텐츠(주) + 보상 레일(부). 880px 이하에서 1열로 스택된다. */}
      <div className="dy-grid">
      <main className="dy-main">
      {/* 콘텐츠 슬롯 — 오늘의 용어 4지선다. 미니게임과 같은 풀에서 날짜별로 하나. */}
      <div className="dy-quiz">
        <div className="dy-q-head">
          <span className="dy-q-badge">{term.field}</span>
          <span className="dy-q-label">{t('daily.term_label')}</span>
        </div>
        <p className="dy-q-desc">{term.desc}</p>
        <div className="dy-q-opts">
          {choices.map((opt) => {
            const isAnswer = opt === term.answer
            const isPicked = opt === picked
            const cls = answered && isAnswer ? 'dy-q-opt correct'
              : answered && isPicked ? 'dy-q-opt wrong'
              : 'dy-q-opt'
            return (
              <button key={opt} className={cls} onClick={() => onPick(opt)} disabled={answered || busy}>
                <span className="dy-q-mark">{answered && isAnswer ? '✓' : answered && isPicked ? '✕' : ''}</span>
                <span className="dy-q-txt">{opt}</span>
              </button>
            )
          })}
        </div>
        {answered && (
          <p className={`dy-q-result ${picked === term.answer ? 'ok' : picked ? 'no' : 'seen'}`}>
            {picked === term.answer
              ? t('daily.correct')
              : picked
              ? t('daily.wrong', { answer: term.answer })
              : t('daily.already', { answer: term.answer })}
          </p>
        )}
      </div>

      {/* 해설 — 문제를 덮지 않고 카드 아래로 펼친다(내가 뭘 골랐는지 보면서 읽을 수 있게).
          ⚠️ answered 로 조건부 마운트하면 펼침 연출이 안 돈다(0 높이에서 시작할 프레임이 없다).
             항상 붙여 두고 .open 클래스만 토글해 grid-template-rows 0fr→1fr 로 늘린다. */}
      {theory && (
        <section className={`dy-theory${answered ? ' open' : ''}`} aria-hidden={!answered}>
          <div className="dy-th-clip">
            <div className="dy-th-card">
              <div className="dy-th-head">
                <span className="dy-th-badge">{t('daily.theory')}</span>
                <b>{term.answer}</b>
              </div>
              {/* 그림이 먼저다 — 2초에 읽히는 건 이쪽이고, 아래 한 줄은 그 캡션이다. */}
              <DailyVisual name={theory.visual} />
              <p className="dy-th-point">{theory.point}</p>
              {theory.why && theory.why.length > 0 && (
                <ul className="dy-th-why">
                  {theory.why.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              {theory.compare && (
                <p className="dy-th-cmp">
                  <span>{t('daily.hint_lead')}</span>
                  {theory.compare}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
      </main>

      <aside className="dy-rail">
      {/* 보상 예고 — 완료하면 뭘 받는지 미리. */}
      <div className="dy-reward">
        <div className="dy-rw-top">{t('daily.reward_head')}</div>
        <div className="dy-rw-row">
          <span className="dy-rw-item"><Ic n="coin" s={26} /><b>+{DAILY_POINTS}P</b></span>
        </div>
      </div>

      {err && <p className="dy-err">{err}</p>}

      {/* 완료 트리거는 문제 시도(왼쪽 카드)로 옮겨졌다. 여기는 상태 안내만. */}
      <p className="dy-note">
        {done
          ? t('daily.done_note')
          : busy
          ? t('daily.saving')
          : t('daily.pick_note')}
      </p>
      </aside>
      </div>
      </div>

      {/* 완료 연출 — 보상을 허브까지 미루지 않고 여기서 끝낸다(설계 합의). */}
      {celebrate && (
        <div className="dy-pop-bd" onClick={() => setCelebrate(false)}>
          <div className="dy-pop" onClick={(e) => e.stopPropagation()}>
            <div className="dy-pop-burst"><Ic n="sun" s={64} /></div>
            <b className="dy-pop-title">{t('daily.pop_title')}</b>
            {/* ⚠️ 받은 게 없으면 이 줄을 아예 안 그린다 — 스탬프 칸이 빠지면서 둘 다 거짓인 날
                (자동 출석이 먼저 받아간 날 = 사실상 매일)은 빈 띠만 남는다. */}
            {(rewarded || bonus > 0) && (
              <div className="dy-pop-gain">
                {rewarded && <span><Ic n="coin" s={22} />+{DAILY_POINTS}P</span>}
                {bonus > 0 && <span><Ic n="coin" s={22} />{t('daily.pop_bonus', { b: bonus })}</span>}
              </div>
            )}
            <p className="dy-pop-msg">
              {t(rewarded ? 'daily.pop_grew' : 'daily.pop_already')}
            </p>
            {/* 버튼은 '닫기' 하나 — 완료 보상이 이 화면에서 끝나므로 허브로 보낼 이유가 없다. */}
            <div className="dy-pop-btns">
              <button className="dy-btn" onClick={() => setCelebrate(false)}>{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
