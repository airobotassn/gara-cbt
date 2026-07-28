// 미니게임 플레이 화면 — 자립형 게임 HTML(public/games/*.html)을 iframe 으로 임베드.
//   상단 얇은 바에 '아레나로' 뒤로가기 + 게임명. 없는 id 도 /arena 로.
//   (미니게임 진입점이 /arena 하단 런처라 돌아갈 곳도 아레나)
//   게임 본체가 화면 하단 선택지/HUD 를 꽉 채워 FAB 과 겹치므로, /games/* 에선 Layout 이 FAB 을 숨긴다.
//   ⚠️ 플레이는 로그인(정식 회원) 전용 — 목록(/games)은 누구나 보되 실행 직전에 게이트(허브와 동일 정책).
import { Link, useNavigate, useParams } from 'react-router-dom'
import { findMiniGame } from '../lib/minigames'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import '../styles/minigame.css'

/** #rrggbb 의 밝기로 글자색을 정한다 — 프레임 색을 게임마다 바꿔도 상단 바가 알아서 반전된다. */
function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5
}

export default function MiniGame() {
  const navigate = useNavigate()
  const { gameId } = useParams<{ gameId: string }>()
  const game = findMiniGame(gameId)
  const { isFullUser, loading, loginWithGoogle } = useAuth()
  const { t } = useT()

  if (!game) {
    return (
      <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', gap: 12 }}>
        <p style={{ fontWeight: 800, color: '#28324c' }}>준비 중인 미니게임이에요.</p>
        <button
          onClick={() => navigate('/arena')}
          style={{ padding: '10px 20px', borderRadius: 999, border: 0, cursor: 'pointer', background: '#004ac6', color: '#fff', fontWeight: 800 }}
        >
          아레나로 돌아가기
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

  // 로그인 게이트 — 게스트/익명은 플레이 불가. 로그인 후 이 게임으로 복귀.
  if (!isFullUser) {
    return (
      <div className="mgp">
        <div className="mgp-in">
          <Link className="mgp-back" to="/games" aria-label="미니게임">
            <span>‹</span> 미니게임
          </Link>
          <div className="mg-gate">
            <img className="mg-gate-art" src={game.art} alt="" />
            <h2 className="mg-gate-title">{game.title}</h2>
            <p className="mg-gate-sub">미니게임은 로그인 후 플레이할 수 있어요.</p>
            <button
              className="mg-gate-btn"
              onClick={() => {
                // 복귀 경로는 sessionStorage 로 넘긴다 — Supabase 가 redirect_to 의 query 를 유실시킨다(AuthCallback 참고).
                try { sessionStorage.setItem('postLoginRedirect', `/games/${game.id}`) } catch { /* 무시 */ }
                void loginWithGoogle(`${window.location.origin}/auth/callback`)
              }}
            >
              {t('common.login_google')}
            </button>
          </div>
        </div>
      </div>
    )
  }

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
          onClick={() => navigate('/arena')}
          aria-label="아레나로"
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
          <span style={{ fontSize: 15, lineHeight: 1 }}>‹</span> 아레나
        </button>
        <strong style={{ fontSize: 15, color: dark ? '#fff' : '#28324c', letterSpacing: '-.01em' }}>{game.title}</strong>
        <span style={{ fontSize: 11.5, color: dark ? 'rgba(255,255,255,.6)' : '#7c869e', fontWeight: 700 }}>{game.tagline}</span>
      </header>
      <iframe
        src={game.src}
        title={game.title}
        style={{ flex: 1, width: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}
