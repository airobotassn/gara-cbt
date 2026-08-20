// 공지 본문 '문서형' 판정 — 순수 로직 단위 테스트(DOM 없이).
//
// 이 판정 하나가 공지 화면의 **글칸 폭과 격리 여부**를 정한다. 틀리면 두 방향으로 망가진다:
//   · 문서인데 조각으로 보면 → 읽기 칸(768px)에 갇혀 900px 로 만든 표가 눌린다(2026-08-20 실제 사례)
//   · 조각인데 문서로 보면  → 편집기로 쓴 평범한 글이 그림자 안에서 앱 서체를 잃고 브라우저 기본으로 뜬다
//
// ⚠️ 관리자가 어떤 모양으로 HTML 을 만들어 올지 우리는 모른다. "이렇게 만들어 오세요" 를 요구하지
//    않기로 했으므로, 실제로 들어올 법한 모양들을 여기 모아 두고 판정이 다 커버하는지 지킨다.
import { isIsolatedHtml, declaredDocWidth } from '../src/lib/noticeRender.ts';

const results = [];
const rec = (name, got, want) => results.push({ name, got, want, pass: got === want });

// ── 문서로 봐야 하는 것 ────────────────────────────────────────────────
rec('style 태그가 있으면 문서',
  isIsolatedHtml('<style>.a{color:red}</style><div class="a">안녕</div>'), true);

// ⭐ 이번에 뚫린 구멍 — 인라인 style 로만 짠 문서(생성 AI 로 뽑으면 대개 이 모양이다)
rec('⭐ 인라인 style 로 폭을 선언하면 문서',
  isIsolatedHtml('<div style="max-width: 900px; margin: 0 auto; padding: 10px;">표</div>'), true);
rec('style 태그 안에서 폭을 선언해도 문서',
  isIsolatedHtml('<style>.wrap{max-width:1200px}</style><div class="wrap">x</div>'), true);
rec('width(=max-width 아님) 로 선언해도 문서',
  isIsolatedHtml('<div style="width:1024px">x</div>'), true);
rec('공백·대문자 표기도 잡는다',
  isIsolatedHtml('<div style="MAX-WIDTH :  980PX">x</div>'), true);
rec('소수점 폭도 잡는다', isIsolatedHtml('<div style="max-width:900.5px">x</div>'), true);

// ── 조각으로 남겨야 하는 것 ────────────────────────────────────────────
rec('편집기로 쓴 평범한 글은 조각',
  isIsolatedHtml('<p>안녕하세요</p><ul><li>첫째</li></ul>'), false);
rec('편집기가 넣는 인라인 색·굵기는 조각',
  isIsolatedHtml('<p><span style="color: rgb(230,0,0); font-weight:700">빨강</span></p>'), false);
// 비율 폭은 반응형이라 스스로 폭을 정한 게 아니다.
rec('width:100% 는 조각', isIsolatedHtml('<table style="width:100%"><tr><td>a</td></tr></table>'), false);
rec('width:15% 는 조각', isIsolatedHtml('<th style="width:15%">등급</th>'), false);
// 배지·아이콘 같은 작은 px 폭에 걸리면 평범한 글이 전부 문서가 된다.
rec('작은 px 폭(배지·아이콘)은 조각',
  isIsolatedHtml('<img style="width:120px"><span style="max-width: 240px">배지</span>'), false);
rec('빈 본문은 조각', isIsolatedHtml(''), false);
rec('평문은 조각', isIsolatedHtml('그냥 줄글입니다.'), false);

// ── 선언 폭 값 ────────────────────────────────────────────────────────
rec('선언 폭을 읽는다(900)', declaredDocWidth('<div style="max-width:900px">x</div>'), 900);
rec('여럿이면 제일 큰 값', declaredDocWidth('<div style="max-width:900px"><div style="width:1280px">x</div></div>'), 1280);
rec('문서급이 아니면 0', declaredDocWidth('<div style="width:320px">x</div>'), 0);

// ── 실제로 올라온 파일과 같은 모양(회귀) ───────────────────────────────
//    2026-08-20 에 눌려 보였던 그 공지: 인라인 style 뿐이고 wrapper 가 max-width:900px,
//    표의 칸 폭은 %(15/25/42/18) 로만 잡혀 있다.
const REAL = `<div style="font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 10px;">
  <div style="overflow-x: auto; border: 1px solid #e2e8f0;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <thead><tr><th style="width: 15%">등급</th><th style="width: 25%">검정방법</th>
      <th style="width: 42%">검정 과목</th><th style="width: 18%">합격기준</th></tr></thead>
    </table>
  </div>
</div>`;
rec('⭐ 실제 올라온 공지가 문서로 잡힌다', isIsolatedHtml(REAL), true);
rec('⭐ 그 공지의 선언 폭 = 900', declaredDocWidth(REAL), 900);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nNOTICE-DOC-DETECT: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 'notice-doc-detect', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
