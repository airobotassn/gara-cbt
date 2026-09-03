// 미니게임 플레이 화면 — 자립형 게임 HTML(public/games/*.html)을 iframe 으로 임베드.
//   상단 얇은 바에 '미니게임' 뒤로가기 + 게임명. 없는 id 도 /games 로.
//   (진입 경로가 /arena 런처 → /games 목록 → 이 화면이라, 뒤로는 한 단계 위인 목록이다)
//   게임 본체가 화면 하단 선택지/HUD 를 꽉 채워 FAB 과 겹치므로, /games/* 에선 Layout 이 FAB 을 숨긴다.
//   ⚠️ 플레이는 로그인(정식 회원) 전용 — 목록(/games)은 누구나 보되 실행 직전에 게이트(허브와 동일 정책).
//   ⚠️ 게임 ↔ 앱 통신은 postMessage 계약(아래 GAME_MSG). 게임 HTML 은 자립형이라 세션도 supabase 클라도
//     없다 → 점수 제출과 랭킹 조회는 전부 이 부모가 대신한다. 게임은 "점수 났다 / 랭킹 열어달라"만 알린다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { findMiniGame, guestPlayable, GUEST_GAME_ID, isTermGame } from '../lib/minigames'
import { fetchTermPool, type TermPoolItem, type TermTarget } from '../lib/termPool'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'
import MiniGameRankModal from '../components/MiniGameRankModal'
import StarField from '../components/StarField'
import { rememberPostLogin } from '../lib/postLogin'
import '../styles/minigame.css'

/** #rrggbb 의 밝기로 글자색을 정한다 — 프레임 색을 게임마다 바꿔도 상단 바가 알아서 반전된다. */
function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5
}

/** 게임 HTML → 앱 메시지 계약. 게임 쪽 구현은 public/games/*.html 하단의 '앱 브리지' 블록. */
type GameMsg =
  | { t: 'mg:rank' } // 인트로/아웃트로 우상단 '랭킹' 버튼
  | { t: 'mg:score'; score: number; tieMs?: number } // 게임오버 / 레벨 클리어

export default function MiniGame() {
  const navigate = useNavigate()
  const { gameId } = useParams<{ gameId: string }>()
  const game = findMiniGame(gameId)
  const { isFullUser, loading, loginWithGoogle, ensureAnonymous } = useAuth()
  const { t, lang } = useT()
  const [rankOpen, setRankOpen] = useState(false)
  // 게스트가 한 판 끝냈을 때 뜨는 잠금 안내. 한 번 닫으면 그 세션에선 다시 띄우지 않는다
  // — 판마다 막아서면 플레이를 방해한다(레벨테스트는 결과가 화면 하나라 그럴 일이 없다).
  const [guestScored, setGuestScored] = useState(false)
  const guestNoticeDone = useRef(false)
  // 제출 티켓 — 화면 진입 시 한 번 받아 이 세션 내내 재사용한다(서버가 서명·나이를 검증).
  //   ⚠️ 제출마다 새로 받으면 안 된다: 서버의 "플레이 시간 대비 점수 상한"이 티켓 나이 기준이라,
  //     티켓을 리셋하면 레벨형 게임의 2번째 이후 클리어가 정상 기록인데도 깎인다(레벨 3 → 2).
  //   실패해도 게임 진행은 막지 않는다(랭킹만 못 올라감).
  const ticketRef = useRef<string | null>(null)

  // 용어 문항(DB) — 게임 HTML 안에 박힌 POOL 을 이걸로 갈아끼운다.
  //   ⚠️ 문항을 못 받아도 게임은 그대로 돌아간다(게임 쪽 POOL 이 폴백). 그래서 로딩을 기다리지 않는다.
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const poolRef = useRef<TermPoolItem[] | null>(null)

  /** 게임 프레임에 문항을 보낸다. iframe 로드 완료와 문항 도착 중 **나중 것**이 이걸 부른다. */
  const sendPool = useCallback(() => {
    const items = poolRef.current
    const win = frameRef.current?.contentWindow
    if (!items || !items.length || !win) return
    win.postMessage({ t: 'mg:pool', items }, window.location.origin)
  }, [])

  const fetchTicket = useCallback(async (id: string) => {
    try {
      const r = await callFunction<{ ticket?: string }>('submit-minigame', { action: 'start', gameId: id })
      ticketRef.current = r.ticket ?? null
    } catch {
      ticketRef.current = null
    }
  }, [])

  // 게스트(익명) 플레이 허용(2026-08-06 부활) — 레벨테스트와 같은 규칙이다: 플레이는 되고 기록은 안 남는다.
  //   · 세션이 없으면 익명 세션을 만든다(게임 iframe 자체는 세션이 필요 없지만, 로그인 후 이어서 하는
  //     흐름과 레벨테스트 쪽 동작을 맞추기 위해 동일하게 잡는다).
  //   · 티켓은 정식 회원만 받는다 — submit-minigame 이 익명을 401 로 막으므로 받아봐야 실패한다.
  //     티켓이 없으면 아래 mg:score 핸들러가 조용히 넘겨서 랭킹에 안 올라간다(= 기록 미저장).
  const playable = !!game && !loading

  // ⛔ **이 화면에서는 문서 스크롤을 잠근다(2026-09-03 지적: "새로고침하면 위 헤더가 사라진다").**
  //    화면 틀은 `height: 100dvh` 라 스크롤이 필요 없는데, 폰에서는 주소창이 접혔다 펴지는 사이
  //    문서(접힌 기준으로 계산된 높이)가 뷰포트보다 잠깐 커진다 → 그때 게임 위에서 손가락을 움직이면
  //    (인트로 캐러셀을 좌우로 넘길 때가 그렇다) 페이지가 헤더 높이만큼 밀려 올라가고, 주소창이
  //    다시 접혀도 **스크롤 위치는 그대로 남아** 뒤로가기 줄이 화면 밖에 머문다.
  //    /games/* 는 Layout 이 FAB 도 숨기는 화면이라 그 줄이 사라지면 **나갈 문이 하나도 없다.**
  //    ⚠️ 원래 값으로 되돌려야 한다 — 다른 화면은 굴러야 한다.
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => { html.style.overflow = prev }
  }, [])

  useEffect(() => {
    if (!playable || !game) return
    if (isFullUser) void fetchTicket(game.id)
    else void ensureAnonymous().catch(() => { /* 익명 세션 실패해도 플레이는 막지 않는다 */ })
  }, [playable, game, isFullUser, fetchTicket, ensureAnonymous])

  // 문항 받아오기 — 용어 퀴즈 3종만 해당(퍼즐형은 문제 은행을 안 쓴다).
  //   화면 언어로 투영된 문항이 오므로 게임은 받은 걸 그대로 그리면 된다.
  useEffect(() => {
    if (!playable || !game || !isTermGame(game.id)) return
    let alive = true
    void fetchTermPool(game.id as TermTarget, lang).then((items) => {
      if (!alive) return
      poolRef.current = items
      sendPool() // 프레임이 이미 떠 있으면 지금 보낸다. 아직이면 onLoad 가 다시 부른다.
    })
    return () => { alive = false }
  }, [playable, game, lang, sendPool])

  // 게임(iframe) → 앱 메시지 수신. 같은 오리진에서 서비스되므로 오리진 검사로 외부 프레임을 배제한다.
  useEffect(() => {
    if (!playable || !game) return
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      const m = e.data as GameMsg
      if (!m || typeof m !== 'object') return
      if (m.t === 'mg:rank') {
        setRankOpen(true)
        return
      }
      if (m.t === 'mg:score' && typeof m.score === 'number' && isFinite(m.score)) {
        // 게스트 — 여기서 조용히 넘기면 게임 자체 결과창이 평소처럼 떠서 "기록됐다"로 읽힌다.
        // 레벨테스트 결과창(LockedPanel)과 같은 규칙으로, 저장 안 됐음을 알리고 로그인 경로를 준다.
        if (!isFullUser) {
          if (!guestNoticeDone.current) setGuestScored(true)
          return
        }
        const ticket = ticketRef.current
        if (!ticket) return // 티켓 없으면 조용히 넘긴다(플레이는 계속)
        void callFunction('submit-minigame', {
          gameId: game.id,
          rawScore: m.score,
          tieMs: typeof m.tieMs === 'number' ? m.tieMs : undefined,
          ticket,
        }).catch(() => { /* 적립 실패는 게임 흐름을 막지 않는다 */ })
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [playable, game, isFullUser, fetchTicket])

  if (!game) {
    return (
      <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', gap: 12 }}>
        <p style={{ fontWeight: 800, color: '#28324c' }}>{t('mg.preparing')}</p>
        <button
          onClick={() => navigate('/games')}
          style={{ padding: '10px 20px', borderRadius: 999, border: 0, cursor: 'pointer', background: '#004ac6', color: '#fff', fontWeight: 800 }}
        >
          {t('mg.to_list')}
        </button>
      </div>
    )
  }

  // 세션 판정 전에 iframe 을 붙이면 게임이 한 프레임 떴다가 게이트로 바뀐다 → 알 때까지 대기.
  if (loading) {
    return (
      <div className="mgp">
        <div className="mgp-in" style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 800 }}>
          {t('common.loading')}
        </div>
      </div>
    )
  }

  // 게스트에게 열린 건 GUEST_GAME_ID 한 판뿐이다(2026-08-24). 나머지는 여기서 막는다 —
  //   ⚠️ 목록의 회색 PLAY 만으로는 아무것도 못 막는다. 주소를 직접 치면 그대로 들어온다.
  //   ⚠️ 판정은 `guestPlayable` 하나를 목록과 같이 쓴다. 여기서 따로 쓰면 두 화면이 다른 말을 한다.
  if (!isFullUser && !guestPlayable(game.id)) {
    return (
      <div className="mgp">
        <StarField />
        <div className="mgp-in">
          <button className="mgp-back" onClick={() => navigate('/games')} aria-label={t('mg.title')}>
            <span className="material-symbols-outlined">arrow_back</span> {t('mg.title')}
          </button>
          <div className="mg-gate">
            <img className="mg-gate-art" src={game.art} alt="" />
            <h1 className="mg-gate-title">{t('mg.locked_title')}</h1>
            <p className="mg-gate-sub">{t('mg.locked_body', { game: t(`mg.${GUEST_GAME_ID}.title`) })}</p>
            <button
              className="mg-gate-btn"
              onClick={() => {
                rememberPostLogin(`/games/${game.id}`)
                void loginWithGoogle(`${window.location.origin}/auth/callback`)
              }}
            >
              {t('common.login')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 게스트에게 열린 게임은 그대로 플레이한다 — 기록만 안 남는다.
  // 대신 상단 바에 '기록이 안 남는다'는 한 줄을 달아, 로그인하면 뭐가 달라지는지 플레이 전에 알린다.

  // 상단 바는 게임 프레임 색(= 게임 body 배경)을 그대로 입는다 — 흰 바가 남으면 게임 위에 이색 띠로 뜬다.
  const dark = isDark(game.frame)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: game.frame }}>
      {/* 상단 바는 게임 스테이지와 같은 폭으로 좁혀 가운데 세운다(2026-08-25) — 게임은 iframe 안에서
          가운데 정렬된 좁은 판(460/520px)이라, 바가 화면 전체 폭이면 넓은 화면에서 '‹미니게임'·제목만
          저 멀리 왼쪽 끝에 떨어져 게임과 남남으로 보인다. 폭의 출처는 minigames.ts 의 stage 하나. */}
      <header
        style={{
          flex: '0 0 auto',
          width: `min(${game.stage}px, 100vw)`,
          margin: '0 auto', // flex column 의 교차축 가운데 정렬 = 게임 스테이지와 같은 선
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: dark ? game.frame : 'linear-gradient(#ffffff,#f4f6fb)',
          borderBottom: `1px solid ${dark ? 'rgba(255,255,255,.10)' : '#e6e9f3'}`,
          boxShadow: dark ? '0 2px 10px rgba(0,0,0,.35)' : '0 2px 8px rgba(80,100,150,.08)',
          zIndex: 2,
        }}
      >
        <button
          onClick={() => navigate('/games')}
          aria-label={t('mg.title')}
          style={{
            flex: '0 0 auto',
            display: 'inline-flex',
            alignItems: 'center',
            whiteSpace: 'nowrap',
            gap: 6,
            padding: '7px 13px 7px 10px',
            borderRadius: 999,
            border: `1px solid ${dark ? 'rgba(255,255,255,.24)' : '#d9e0f0'}`,
            background: dark ? 'rgba(255,255,255,.12)' : '#fff',
            color: dark ? '#fff' : '#28324c',
            fontWeight: 800,
            fontSize: 13.5,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>‹</span> {t('mg.title')}
        </button>
        {/* 게임명은 줄바꿈 금지 — 바가 게임 폭(460px)이라 게스트 칩까지 서면 '버텨라 / CARI' 로 접혀 바가 2단이 된다. */}
        <strong style={{ flex: '0 0 auto', whiteSpace: 'nowrap', fontSize: 15, color: dark ? '#fff' : '#28324c', letterSpacing: '-.01em' }}>{t(`mg.${game.id}.title`)}</strong>
        {/* 바가 게임 폭으로 좁아져서(460px) 게스트 칩까지 서면 빠듯하다 — 밀려나는 건 태그라인 하나뿐이다. */}
        <span style={{ fontSize: 11.5, color: dark ? 'rgba(255,255,255,.6)' : '#7c869e', fontWeight: 700, flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`mg.${game.id}.tagline`)}</span>
        {/* 게스트 안내 — 태그라인 자리를 뺏지 않게 오른쪽 끝으로 민다. 플레이를 막지 않으므로 배너가 아니라 칩이다. */}
        {!isFullUser && (
          <button
            onClick={() => {
              rememberPostLogin(`/games/${game.id}`)
              void loginWithGoogle(`${window.location.origin}/auth/callback`)
            }}
            style={{
              marginLeft: 'auto',
              flex: '0 0 auto',
              padding: '6px 12px',
              borderRadius: 999,
              border: `1px solid ${dark ? 'rgba(255,255,255,.24)' : '#d9e0f0'}`,
              background: dark ? 'rgba(255,255,255,.12)' : '#fff',
              color: dark ? '#fff' : '#28324c',
              fontWeight: 800,
              fontSize: 11.5,
              cursor: 'pointer',
            }}
          >
            {t('mg.guest_hint')}
          </button>
        )}
      </header>
      <iframe
        /* 게임은 자립형 HTML(iframe)이라 앱 사전을 못 쓴다 → 화면 언어를 쿼리로 넘긴다.
           게임 쪽은 public/games/i18n.js 가 ?lang= 를 읽어 인트로·아웃트로 문구를 갈아끼운다.
           문항(POOL)은 쿼리가 아니라 postMessage 로 내려보낸다(아래 sendPool) — 50문항을 URL 에 담을 수 없다. */
        ref={frameRef}
        onLoad={sendPool}
        src={`${game.src}?lang=${lang}`}
        title={t(`mg.${game.id}.title`)}
        style={{ flex: 1, width: '100%', border: 0, display: 'block' }}
      />
      {rankOpen && (
        <MiniGameRankModal gameId={game.id} title={t(`mg.${game.id}.title`)} onClose={() => setRankOpen(false)} />
      )}

      {/* 게스트 한 판 종료 — 게임 자체 결과창 위에 얹는다. 레벨테스트의 LockedPanel 과 같은 구성
          (자물쇠 → 무엇이 잠겼는지 → 로그인 CTA). 점수는 적지 않는다 — 게임마다 지표가 달라서
          (점수/도달 레벨) 여기서 다시 쓰면 게임 결과창과 표기가 어긋난다. */}
      {guestScored && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(10,12,20,.72)', display: 'grid', placeItems: 'center', padding: 20 }}
          onClick={() => { guestNoticeDone.current = true; setGuestScored(false) }}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 360, background: '#fff', borderRadius: 18, padding: '26px 22px', textAlign: 'center', boxShadow: '0 18px 50px rgba(0,0,0,.35)' }}
          >
            <div style={{ fontSize: 34, lineHeight: 1 }}>🔒</div>
            <h3 style={{ margin: '12px 0 6px', fontSize: 17, fontWeight: 900, color: '#28324c' }}>
              {t('mg.not_saved')}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, fontWeight: 600, lineHeight: 1.6, color: '#6b7488' }}>
              {t('mg.not_saved_body')}
            </p>
            <button
              onClick={() => {
                rememberPostLogin(`/games/${game.id}`)
                void loginWithGoogle(`${window.location.origin}/auth/callback`)
              }}
              style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: 0, background: '#004ac6', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
            >
              {t('common.login')}
            </button>
            <button
              onClick={() => { guestNoticeDone.current = true; setGuestScored(false) }}
              style={{ marginTop: 8, width: '100%', padding: '10px 16px', borderRadius: 12, border: '1px solid #d9e0f0', background: '#fff', color: '#6b7488', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
            >
              {t('mg.keep_playing')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
