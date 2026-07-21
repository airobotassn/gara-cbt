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

// ⚠️ 서버(complete-daily)의 DAILY_POINTS 와 같은 값이어야 한다. 적립 권위는 서버, 여기는 예고 표시용.
const DAILY_POINTS = 10
const STAMP_GOAL = 7 // 허브 도크의 7일 스탬프판과 동일

// get-hub 응답 중 이 화면이 쓰는 것만. (전체 형태는 Hub.tsx 참고)
interface HubState { authed: boolean; points?: number; stamps?: number; dailyDone?: boolean }

const IK = '#33323f'
const ICONS: Record<string, ReactNode> = {
  sun: (<><circle cx="12" cy="12" r="5" fill="#f2c65e" stroke={IK} strokeWidth="2" /><g stroke={IK} strokeWidth="2" strokeLinecap="round"><path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" /></g></>),
  coin: (<><circle cx="12" cy="12" r="8.6" fill="#f2c65e" stroke={IK} strokeWidth="2" /><circle cx="12" cy="12" r="5.4" fill="none" stroke={IK} strokeWidth="1.4" opacity=".55" /><path d="M12 8.6v6.8M10.2 10.4h3.2a1.6 1.6 0 0 1 0 3.2h-2.8" stroke={IK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>),
  stamp: (<><circle cx="12" cy="12" r="8.6" fill="#74c6bf" stroke={IK} strokeWidth="2" /><path d="M8.2 12.3l2.6 2.6 5-5.2" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>),
  lock: (<><rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.4" fill="#fff" stroke={IK} strokeWidth="2" /><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" fill="none" stroke={IK} strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="15.4" r="1.5" fill={IK} /></>),
}
function Ic({ n, s = 24 }: { n: string; s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">{ICONS[n]}</svg>
}

export default function Daily() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const [authed, setAuthed] = useState(false)
  const [points, setPoints] = useState(0)
  const [stamps, setStamps] = useState(0)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [celebrate, setCelebrate] = useState(false) // 완료 직후 보상 연출(재방문 시엔 안 뜬다)

  function applyHub(h: HubState) {
    setAuthed(!!h.authed)
    setPoints(h.points ?? 0)
    setStamps(h.stamps ?? 0)
    setDone(!!h.dailyDone)
  }

  // 마운트 하이드레이트. setState 는 프라미스 콜백에서만(허브와 동일 규칙).
  useEffect(() => {
    let alive = true
    callFunction<HubState>('get-hub', {})
      .then((h) => { if (alive) { applyHub(h); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // 완료 → complete-daily(1일 1회 서버 강제·멱등). 성공 후 get-hub 로 재화/스탬프 재동기화.
  // 콘텐츠가 붙기 전까지는 이 버튼이 곧 '소비 완료' 신호다.
  async function complete() {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (done || busy) return
    setBusy(true)
    setErr('')
    try {
      await callFunction('complete-daily', {})
      const h = await callFunction<HubState>('get-hub', {})
      applyHub(h)
      setCelebrate(true)
    } catch {
      setErr('완료 처리에 실패했어요. 잠시 후 다시 시도해주세요')
    } finally {
      setBusy(false)
    }
  }

  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })

  return (
    <div className="dy-page">
      <div className="dy-wrap">
      <div className="dy-top">
        {/* 뒤로 = 아레나. 아레나 하단 런처가 허브·레벨테스트·데일리·미니게임의 관문이라 그게 이 화면의 부모다.
            (완료 팝업의 '허브로'는 뒤로가기가 아니라 보상 확인용 전진 동선이라 목적지가 다르다.) */}
        <button className="dy-back" onClick={() => navigate('/arena')} aria-label="아레나로">‹</button>
        <div className="dy-head">
          <b>오늘의 학습</b>
          <i>{today}</i>
        </div>
        <span className="dy-coin"><Ic n="coin" s={20} />{points.toLocaleString()}</span>
      </div>

      {!loading && !authed && (
        <div className="dy-banner">
          <span>로그인해야 학습 완료가 기록돼요</span>
          <button className="dy-btn dy-btn-sm" onClick={() => loginWithGoogle()}>구글로 로그인</button>
        </div>
      )}

      {/* 2단: 콘텐츠(주) + 보상 레일(부). 880px 이하에서 1열로 스택된다. */}
      <div className="dy-grid">
      <main className="dy-main">
      {/* 콘텐츠 슬롯 — 문제형/수동 소비형 렌더러가 들어올 자리. 지금은 자리표시자. */}
      <div className="dy-slot">
        <span className="dy-slot-ic"><Ic n="lock" s={38} /></span>
        <b className="dy-slot-title">오늘의 콘텐츠 준비 중</b>
        <p className="dy-slot-desc">
          문제 하나이거나, 짧은 글·영상일 수 있어요.<br />
          <b>맞히는 게 아니라 보는 것</b>만으로 완료돼요.
        </p>
      </div>
      </main>

      <aside className="dy-rail">
      {/* 보상 예고 — 완료하면 뭘 받는지 미리. */}
      <div className="dy-reward">
        <div className="dy-rw-top">완료하면</div>
        <div className="dy-rw-row">
          <span className="dy-rw-item"><Ic n="coin" s={26} /><b>+{DAILY_POINTS}P</b></span>
          <span className="dy-rw-item"><Ic n="stamp" s={26} /><b>스탬프 +1</b></span>
        </div>
        <div className="dy-streak" aria-label={`스탬프 ${stamps} / ${STAMP_GOAL}`}>
          {Array.from({ length: STAMP_GOAL }, (_, i) => i + 1).map((d) => (
            <span key={d} className={`dy-day ${d <= stamps ? 'on' : ''}`}>{d <= stamps ? '✓' : d}</span>
          ))}
        </div>
      </div>

      {err && <p className="dy-err">{err}</p>}

      <button className="dy-cta" onClick={complete} disabled={done || busy}>
        <span className="dy-cta-ic"><Ic n="sun" s={24} /></span>
        {done ? '오늘 학습 완료 ✓' : busy ? '기록하는 중…' : '오늘 학습 완료하기'}
      </button>
      <p className="dy-note">
        {done
          ? '내일 새 학습이 열려요. 오늘 것은 다시 볼 수 있어요(보상은 하루 1회).'
          : '하루 1회만 적립돼요. 며칠 놓쳐도 스탬프는 사라지지 않아요.'}
      </p>
      </aside>
      </div>
      </div>

      {/* 완료 연출 — 보상을 허브까지 미루지 않고 여기서 끝낸다(설계 합의). */}
      {celebrate && (
        <div className="dy-pop-bd" onClick={() => setCelebrate(false)}>
          <div className="dy-pop" onClick={(e) => e.stopPropagation()}>
            <div className="dy-pop-burst"><Ic n="stamp" s={64} /></div>
            <b className="dy-pop-title">오늘 학습 완료!</b>
            <div className="dy-pop-gain">
              <span><Ic n="coin" s={22} />+{DAILY_POINTS}P</span>
              <span><Ic n="stamp" s={22} />스탬프 {stamps} / {STAMP_GOAL}</span>
            </div>
            <p className="dy-pop-msg">캐릭터가 오늘도 한 뼘 자랐어요.</p>
            <div className="dy-pop-btns">
              <button className="dy-btn dy-ghost" onClick={() => setCelebrate(false)}>닫기</button>
              <button className="dy-btn" onClick={() => navigate('/hub')}>허브로</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
