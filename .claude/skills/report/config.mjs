// 변경 리포트 설정 — "보고할 화면" 만 나열한다. 단순하게.
// report 스킬이 매 호출마다 SCREENS 를 이번에 보고할 화면들로 교체한 뒤 generate.mjs 를 돌린다.
//
// 한 화면 =
//   title  : 제목
//   desc   : 무엇이 바뀌었는지 한 줄 설명
//   path   : 라우트 (예: '/', '/result/demo')
//   lang   : 'ko'|'en'|'ja'|'zh'|'hi'|'vi'  (생략 시 ko)
//   theme  : 'light'|'dark'                  (생략 시 light)
//   device : 'desktop'|'mobile'              (생략 시 desktop)
//   authed : true → 가짜 세션 + 함수 목킹(결과·대시보드 등 데이터 화면, lib.mjs)
//   steps  : async (page) => {…}  진입 후 클릭 흐름(예: 시험 시작 게이트 통과)
//
// ⚠️ authed 데이터 화면은 lib.mjs 의 목 응답 형태가 현재 API 와 맞아야 한다(안 맞으면 빈 화면).

export const URLS = {
  local: 'http://localhost:5173',
}

export const META = {
  project: 'GARA · SEMI-CARIS',
  title: '변경사항 리포트 — 가독성·문구·관리자 UX + 메인 검색 추천 개편',
}

// ※ 점수·경고는 특정 상태가 필요해 화면은 목(mock) 데이터로 렌더(lib.mjs).
export const SCREENS = [
  {
    title: '레벨 선택 — 제목 변경 + 글자 대비(라이트)',
    desc: '① 화면 제목을 "레벨테스트" → "AI · Robot 레벨 테스트"로 변경. ② 라이트모드에서 회색이던 보조 글자(레벨 설명·규칙 안내)를 더 진하게 해 또렷하게.',
    path: '/test/select',
    authed: false,
    theme: 'light',
  },
  {
    title: '레벨 선택 — 글자 대비(다크)',
    desc: '다크모드에서 회색이던 보조 글자를 더 하얗게 해 가독성을 높였습니다. 본문/제목 위계는 유지. 전역 색이라 결과·랭킹·대시보드 등 모든 화면에 동일 적용.',
    path: '/test/select',
    authed: false,
    theme: 'dark',
  },
  {
    title: '관리자 · 문항 수정 — 바깥 클릭으로 꺼짐 방지',
    desc: '관리자 문항 수정 팝업에서 실수로 팝업 바깥을 눌러도 더 이상 닫히지 않습니다(입력 유실 방지). 닫으려면 ✕ 버튼이나 저장만. ※ "안 닫히는" 동작이라 화면으로는 그 팝업만 보여드립니다.',
    path: '/admin',
    authed: true,
    // 관리자 진입 → '문항 목록' 탭 → 첫 문항 '수정' → 팝업 노출
    steps: async (page) => {
      await page.getByRole('button', { name: '문항 목록' }).click()
      await page.waitForSelector('.admin-table', { timeout: 8000 })
      await page.locator('button:has-text("수정")').first().click()
      await page.waitForSelector('.admin-modal-box', { timeout: 8000 })
      await page.waitForTimeout(400)
    },
  },
  {
    title: '메인 — 상단 안내문구 정리',
    desc: '히어로 아래에 항상 떠 있던 "지금 바로 내 실력을 확인하세요" 문구를 제거했습니다. 이 문구는 이제 검색 결과 바로 아래에 따라붙습니다(다음 화면).',
    path: '/',
    authed: false,
  },
  {
    title: "메인 — 검색 결과를 '세계 상위 %' 범위로 변경",
    desc: '검색창에 본인 수준을 적으면, 기존에는 "Lv.N 추천"이라며 레벨을 노출하고 버튼도 "Lv.N로 시작하기"로 바뀌었습니다. 이제는 응시자 분포를 기반으로 "세계 상위 X~Y%" 범위만 보여주고 그 아래 "지금 바로 내 실력을 확인하세요"를 띄우며, 버튼은 항상 "GARA 레벨테스트 시작"으로 통일했습니다. (예시 입력: 초보 문장)',
    path: '/',
    authed: false,
    steps: async (page) => {
      await page.fill('.lp-search-input', '나는 AI를 업무에 거의 안 써봤고 이제 막 챗봇을 써보는 초보예요')
      await page.click('.lp-search-btn')
      await page.waitForSelector('.lp-reco', { timeout: 20000 })
      await page.waitForTimeout(500)
    },
  },
]
