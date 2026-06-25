import HomeLink from '../components/HomeLink'

const FAQ = [
  { q: '모바일이나 태블릿으로 응시할 수 있나요?', a: '아니요. GARA 자격검정은 PC(데스크톱·노트북) 전용입니다. 모바일·태블릿에서는 응시할 수 없습니다.' },
  { q: '보안 브라우저(SEB)가 무엇인가요?', a: '시험 중 화면 캡처·복사·다른 프로그램 전환을 차단하는 공식 시험 보안 프로그램입니다. 응시 시작 시 안내에 따라 한 번 설치하면 됩니다.' },
  { q: '시험 결과는 언제 나오나요?', a: '제출 후 1주일 뒤 마이페이지 「성적 확인」에서 합격 여부와 점수를 확인할 수 있습니다.' },
  { q: '합격 기준은 어떻게 되나요?', a: '전체 문항의 60% 이상을 맞히면 합격입니다.' },
  { q: '재응시할 수 있나요?', a: '자격검정은 1회만 응시할 수 있습니다. 제출 후에는 다시 응시할 수 없습니다.' },
  { q: '자격증은 어떻게 받나요?', a: '합격하면 마이페이지 「자격증 발급 현황」 또는 성적 확인 화면에서 자격증을 PDF로 발급·출력할 수 있습니다.' },
  { q: '시험 중 안 푼 문항이 있으면 어떻게 되나요?', a: '안 푼 문항이 있으면 제출되지 않으며, 경고 후 미응답 문항으로 이동합니다. 제한시간이 끝나면 자동으로 제출됩니다.' },
]

export default function Faq() {
  return (
    <div className="wrap page">
      <HomeLink />
      <h1 className="page-title">자주 하는 질문</h1>
      <div className="faq-list">
        {FAQ.map((f) => (
          <details key={f.q} className="faq-item">
            <summary>
              <span className="faq-q">Q. {f.q}</span>
            </summary>
            <p className="faq-a">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  )
}
