// 미니게임 플레이 화면 — 자립형 게임 HTML(public/games/*.html)을 iframe 으로 임베드.
//   상단 얇은 바에 '아레나로' 뒤로가기 + 게임명. 없는 id 도 /arena 로.
//   (미니게임 진입점이 /arena 하단 런처라 돌아갈 곳도 아레나)
//   게임 본체가 화면 하단 선택지/HUD 를 꽉 채워 FAB 과 겹치므로, /games/* 에선 Layout 이 FAB 을 숨긴다.
import { useNavigate, useParams } from 'react-router-dom'
import { findMiniGame } from '../lib/minigames'

export default function MiniGame() {
  const navigate = useNavigate()
  const { gameId } = useParams<{ gameId: string }>()
  const game = findMiniGame(gameId)

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#e3ebf7' }}>
      <header
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: 'linear-gradient(#ffffff,#f4f6fb)',
          borderBottom: '1px solid #e6e9f3',
          boxShadow: '0 2px 8px rgba(80,100,150,.08)',
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
            border: '1px solid #d9e0f0',
            background: '#fff',
            color: '#28324c',
            fontWeight: 800,
            fontSize: 13.5,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>‹</span> 아레나
        </button>
        <strong style={{ fontSize: 15, color: '#28324c', letterSpacing: '-.01em' }}>{game.title}</strong>
        <span style={{ fontSize: 11.5, color: '#7c869e', fontWeight: 700 }}>{game.tagline}</span>
      </header>
      <iframe
        src={game.src}
        title={game.title}
        style={{ flex: 1, width: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}
