// lecture-i18n — 강의(콘텐츠 관리) 제목·소개 자동 번역이 **어긋나지 않게** 소스 수준에서 묶어둔다.
//
// 왜 정적 검사인가: 이 기능이 조용히 틀리는 자리는 DB 제약이 아니라 **여러 파일이 한 벌인 것**이다.
//   컬럼을 만들었는데 select 에서 빼먹거나, 화면은 번역을 보내는데 서버가 ko 까지 담거나,
//   폴백을 빼서 미번역 강의가 빈 제목으로 뜨는 식이다. 셋 다 화면에 오류가 안 뜬다.
//
// 검사하는 규칙:
//   1) 마이그레이션이 title_i18n · description_i18n 을 만든다(기본값 '{}').
//   2) 서버가 저장할 때 **ko 를 담지 않는다** — 한국어의 단일 출처는 원본 컬럼이다.
//   3) 번역 실패로 저장을 막지 않는다(best-effort) — 막으면 강의를 아예 못 올린다.
//   4) 사용자에게 내려줄 때 그 언어 번역이 없으면 **한국어 원문으로 폴백**한다(빈 칸 금지).
//   5) 강의 select 가 두 i18n 컬럼을 실제로 뽑는다 — 안 뽑으면 늘 폴백이라 번역이 통째로 죽는다.
//   6) 결제 상품명(단품·묶음)도 같은 번역을 쓴다 — 화면에서 본 제목과 결제창 제목이 갈리면 안 된다.
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const MIG = read('supabase/migrations/20260826200000_lecture_i18n.sql');
const REFORM = read('supabase/functions/admin/reform.ts');
const EBOOKS = read('supabase/functions/ebooks/index.ts');
const PAY = read('supabase/functions/_shared/payments.ts');

const results = [];
const ok = (name, cond, got) => results.push({ name, pass: !!cond, got: JSON.stringify(got ?? !!cond) });

// ---- 1) 마이그레이션 ----
for (const col of ['title_i18n', 'description_i18n']) {
  ok(`1 마이그레이션이 lectures.${col} 를 만든다`,
    new RegExp(`add column if not exists ${col} jsonb not null default '\\{\\}'`).test(MIG));
}

// ---- 2) 저장: ko 를 담지 않는다 ----
const langsLine = REFORM.match(/const TRANSLATED_LANGS = \[([^\]]*)\]/);
ok('2a 번역 대상 언어 목록이 있다', langsLine != null);
ok('2b ⭐ 그 목록에 ko 가 없다(한국어 원본 컬럼이 단일 출처)',
  langsLine != null && !/'ko'/.test(langsLine[1]), langsLine?.[1]?.trim());
ok('2c 5개국어를 전부 담는다',
  langsLine != null && ['en', 'ja', 'zh', 'hi', 'vi'].every((l) => langsLine[1].includes(`'${l}'`)));
// i18nOf 는 TRANSLATED_LANGS 만 훑는다 = ko 가 결과에 들어갈 길이 없다.
const i18nOf = REFORM.match(/function i18nOf\([\s\S]*?\n\}/);
ok('2d i18nOf 가 TRANSLATED_LANGS 만 훑는다',
  i18nOf != null && /for \(const lg of TRANSLATED_LANGS\)/.test(i18nOf[0]));

// ---- 3) 번역 실패가 저장을 막지 않는다 ----
const upsert = REFORM.match(/async function lectureUpsert\([\s\S]*?\n\}/);
ok('3a lectureUpsert 가 제목·소개를 번역한다',
  upsert != null && /translateKoFields\(\{[\s\S]*?title:[\s\S]*?description:/.test(upsert[0]));
ok('3b ⭐ 번역을 try/catch 로 감싼다(실패해도 한국어로 저장)',
  upsert != null && /try \{[\s\S]*?translateKoFields[\s\S]*?\} catch/.test(upsert[0]));
ok('3c 실패를 관리자에게 알린다(translateWarning)',
  upsert != null && /translateWarning/.test(upsert[0]));

// ---- 4) 서빙: 미번역이면 한국어 폴백 ----
const trField = EBOOKS.match(/const trField = [\s\S]*?\r?\n\r?\n/);
ok('4a trField 폴백 헬퍼가 있다', trField != null);
ok('4b ⭐ 번역이 비면 한국어 원문을 준다(빈 문자열 금지)',
  trField != null && /\|\| ko/.test(trField[0]));
const shapeLec = EBOOKS.match(/function shapeLecture\([\s\S]*?\n\}/);
ok('4c shapeLecture 가 요청 언어를 받는다',
  shapeLec != null && /function shapeLecture\(l: Row, owned: boolean, lang: string\)/.test(shapeLec[0]));
for (const [field, col] of [['title', 'title_i18n'], ['description', 'description_i18n']]) {
  ok(`4d ${field} 이 ${col} 를 지난다`,
    shapeLec != null && new RegExp(`${field}: trField\\(l\\.${col},`).test(shapeLec[0]));
}
// 호출부가 lang 을 빠뜨리면 그 목록만 통째로 한국어가 된다 — 화면엔 오류가 안 뜬다.
//   (인자 안에 `mineLec.has(...)` 처럼 괄호가 또 들어 있어서 줄 단위로 본다.)
const lecCalls = EBOOKS.split(/\r?\n/).filter((l) => l.includes('shapeLecture(') && !l.includes('function shapeLecture('));
ok('4e 모든 호출부가 lang 을 넘긴다', lecCalls.length > 0 && lecCalls.every((c) => /,\s*lang\)/.test(c)),
  lecCalls.map((c) => c.trim()));

// ---- 5) select 가 두 컬럼을 뽑는다 ----
const cols = EBOOKS.match(/const LECTURE_COLS = '([^']*)'/);
ok('5a LECTURE_COLS 가 있다', cols != null);
for (const col of ['title_i18n', 'description_i18n']) {
  ok(`5b ⭐ LECTURE_COLS 가 ${col} 를 뽑는다(빠지면 늘 한국어)`,
    cols != null && cols[1].includes(col));
}

// ---- 6) 결제 상품명도 같은 번역 ----
ok('6a 단품 강의 결제가 title_i18n 을 뽑는다',
  /from\('lectures'\)\s*\n\s*\.select\('id, title, title_i18n, price_usd_cents, published'\)/.test(PAY));
ok('6b 묶음 결제도 title_i18n 을 뽑는다',
  /'id, title, price_usd_cents, title_i18n'/.test(PAY));
ok('6c 묶음 제목 폴백에 강의 i18n 이 끼어 있다',
  /tr\[lang\]\?\.title \|\| i18n\[lang\] \|\| b\.title/.test(PAY));

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nLECTURE-I18N: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 'lecture-i18n', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
