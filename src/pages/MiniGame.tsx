// 미니게임 플레이 화면 — 자립형 게임 HTML(public/games/*.html)을 iframe 으로 임베드.
//   상단 얇은 바에 '미니게임' 뒤로가기 + 게임명. 없는 id 도 /games 로.
//   (진입 경로가 /arena 런처 → /games 목록 → 이 화면이라, 뒤로는 한 단계 위인 목록이다)
//   게임 본체가 화면 하단 선택지/HUD 를 꽉 채워 FAB 과 겹치므로, /games/* 에선 Layout 이 FAB 을 숨긴다.
//   ⚠️ 플레이는 로그인(정식 회원) 전용 — 목록(/games)은 누구나 보되 실행 직전에 게이트(허브와 동일 정책).
//   ⚠️ 게임 ↔ 앱 통신은 postMessage 계약(아래 GAME_MSG). 게임 HTML 은 자립형이라 세션도 supabase 클라도
//     없다 → 점수 제출과 랭킹 조회는 전부 이 부모가 대신한다. 게임은 "점수 났다 / 랭킹 열어달라"만 알린다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { findMiniGame } from '../lib/minigames'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'
import MiniGameRankModal from '../components/MiniGameRankModal'
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
  useEffect(() => {
    if (!playable || !game) return
    if (isFullUser) void fetchTicket(game.id)
    else void ensureAnonymous().catch(() => { /* 익명 세션 실패해도 플레이는 막지 않는다 */ })
  }, [playable, game, isFullUser, fetchTicket, ensureAnonymous])

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

  // 옛 로그인 게이트(게스트 플레이 불가)는 2026-08-06 제거했다 — 게스트도 바로 플레이한다.
  // 대신 상단 바에 '기록이 안 남는다'는 한 줄을 달아, 로그인하면 뭐가 달라지는지 플레이 전에 알린다.
  // ⚠️ 플레이를 막지 말 것. 미니게임은 서비스를 처음 만난 사람이 제일 먼저 눌러보는 곳이다.

  // 상단 바는 게임 프레임 색(= 게임 body 배경)을 그대로 입는다 — 흰 바가 남으면 게임 위에 이색 띠로 뜬다.
  const dark = isDark(game.frame)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: game.frame }}>
      <header
        style={{
          flex: '0 0 auto',
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
            display: 'inline-flex',
            alignItems: 'center',
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
        <strong style={{ fontSize: 15, color: dark ? '#fff' : '#28324c', letterSpacing: '-.01em' }}>{t(`mg.${game.id}.title`)}</strong>
        <span style={{ fontSize: 11.5, color: dark ? 'rgba(255,255,255,.6)' : '#7c869e', fontWeight: 700 }}>{t(`mg.${game.id}.tagline`)}</span>
        {/* 게스트 안내 — 태그라인 자리를 뺏지 않게 오른쪽 끝으로 민다. 플레이를 막지 않으므로 배너가 아니라 칩이다. */}
        {!isFullUser && (
          <button
            onClick={() => {
              // 복귀 경로는 sessionStorage 로 넘긴다 — Supabase 가 redirect_to 의 query 를 유실시킨다(AuthCallback 참고).
              try { sessionStorage.setItem('postLoginRedirect', `/games/${game.id}`) } catch { /* 무시 */ }
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
           ⚠️ 문항(POOL)은 여기 해당 없음 — 그건 아직 한국어이고 콘텐츠 파이프라인 몫이다. */
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
                // 복귀 경로는 sessionStorage 로 넘긴다 — Supabase 가 redirect_to 의 query 를 유실시킨다(AuthCallback 참고).
                try { sessionStorage.setItem('postLoginRedirect', `/games/${game.id}`) } catch { /* 무시 */ }
                void loginWithGoogle(`${window.location.origin}/auth/callback`)
              }}
              style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: 0, background: '#004ac6', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
            >
              {t('common.login_google')}
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
