import HomeLink from '../components/HomeLink'

// 공지사항 — 현재는 정적. 추후 관리자 등록(DB)로 확장 가능.
const NOTICES = [
  {
    date: '2026. 06. 25',
    title: 'GARA 자격검정 정식 오픈 안내',
    body: 'AI 활용 능력을 평가하는 GARA 자격검정이 정식 오픈되었습니다. PC에서 보안 브라우저(SEB)로 응시할 수 있습니다.',
  },
  {
    date: '2026. 06. 25',
    title: '보안 브라우저(SEB) 응시 안내',
    body: '본 시험은 화면 캡처·복사·이탈을 차단하는 Safe Exam Browser에서만 응시할 수 있습니다. 응시 전 「시험환경 테스트」에서 설치·환경을 미리 점검해 주세요.',
  },
  {
    date: '2026. 06. 25',
    title: '부정행위 예방 안내',
    body: '시험 중 화면 캡처·복사·다른 창 이탈은 차단·기록됩니다. 부정행위가 확인되면 응시가 무효 처리될 수 있으니 유의해 주세요.',
  },
]

export default function Notice() {
  return (
    <div className="wrap page">
      <HomeLink />
      <h1 className="page-title">공지사항</h1>
      <div className="notice-list">
        {NOTICES.map((n) => (
          <div key={n.title} className="notice-item">
            <div className="notice-top">
              <b className="notice-title">{n.title}</b>
              <span className="notice-date">{n.date}</span>
            </div>
            <p className="notice-body">{n.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
