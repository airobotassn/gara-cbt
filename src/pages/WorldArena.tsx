// WORLD ARENA — 글로벌 응시 현황 지도(자체 완결 HTML)를 앱 내부 라우트로 임베드.
//   iframe이지만 SPA 라우트(/arena) 안이라 CARIS FAB가 그대로 뜨고 전체 새로고침 없이 전환된다.
//   ?embed=1 로 지도 HTML의 dev 배지/푸터를 숨겨 앱 화면처럼 보이게 한다.
export default function WorldArena() {
  return (
    <div style={{ width: '100%', height: '100dvh', background: '#f4efe4' }}>
      <iframe
        src="/world-arena.html?embed=1"
        title="WORLD ARENA"
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}
