// DAILY QUIZ 해설(글) ↔ 해설 그림(SVG) 정합성 — 순수 정적 검사(DB 안 씀).
//
// 해설이 여러 파일로 갈라진 뒤(theory/batch*.ts · dailyVisuals/batch*.tsx) 생기는 사고를 막는다.
// 이 검사가 없으면 아래가 전부 **에러 없이 조용히** 지나간다:
//   · 해설의 visual 키가 오타 → 그날 해설에 그림만 쏙 빠진 채 글만 뜬다
//   · 두 배치가 같은 그림 키를 쓰면 하나가 덮인다 → 엉뚱한 그림이 붙는다
//   · 두 배치가 같은 용어를 만들면 해설 하나가 사라진다(DB 는 정답 중복을 막지만 코드는 안 막는다)
//   · #hex 색을 박으면 다크/라이트 한쪽에서 그림이 배경과 같은 색이 되어 증발한다
import { readdirSync, readFileSync } from 'node:fs';

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

const THEORY_DIR = 'src/lib/theory';
const VIS_DIR = 'src/components/dailyVisuals';

// ── 해설 키 모으기 (terms.ts 의 원래 8개 + 배치들) ────────────────
/**
 * `  키: {` 또는 `  '키': {` 형태의 최상위 항목을 **본문과 함께** 뽑는다(들여쓰기 2칸이 곧 최상위다).
 * ⚠️ 키 이름으로 indexOf 해서 본문을 자르면 안 된다 — 앞 항목의 compare 줄에 그 낱말이 있으면
 *    엉뚱한 자리를 읽는다(실제로 '그리퍼'가 엔드 이펙터의 compare 에 들어 있어 한 번 걸렸다).
 *    그래서 정규식 match 의 index 로 자른다.
 */
function topEntries(body) {
  const ms = [...body.matchAll(/^ {2}(?:'([^']+)'|"([^"]+)"|([^\s:'"]+)): \{\r?$/gm)];
  return ms.map((m, i) => ({
    key: m[1] ?? m[2] ?? m[3],
    seg: body.slice(m.index, i + 1 < ms.length ? ms[i + 1].index : body.length),
  }));
}

const termsSrc = readFileSync('src/lib/terms.ts', 'utf8');
const legacyBody = termsSrc.slice(termsSrc.indexOf('export const TERM_THEORY'), termsSrc.indexOf('export function termTheory'));
const theoryFiles = [['terms.ts', legacyBody]];
for (const f of readdirSync(THEORY_DIR).filter((f) => /^batch\d+\.ts$/.test(f)).sort()) {
  const src = readFileSync(`${THEORY_DIR}/${f}`, 'utf8');
  theoryFiles.push([f, src.slice(src.indexOf('= {'))]);
}

const theory = new Map(); // 용어 → { file, visual, point, why, compare }
const dupTerms = [];
for (const [file, body] of theoryFiles) {
  for (const { key, seg } of topEntries(body)) {
    if (theory.has(key)) dupTerms.push(`${key}(${theory.get(key).file} ↔ ${file})`);
    theory.set(key, {
      file,
      visual: /visual: '([^']+)'/.exec(seg)?.[1] ?? null,
      point: /point: '((?:[^'\\]|\\.)*)'/.exec(seg)?.[1] ?? '',
      // why 는 배열 안의 줄들 — compare 가 나오기 전까지만 센다
      why: [...seg.slice(0, seg.includes('compare:') ? seg.indexOf('compare:') : seg.length)
        .matchAll(/^ {4}'((?:[^'\\]|\\.)*)',?\r?$/gm)].map((m) => m[1]),
    });
  }
}
eq('⭐ 해설 용어가 두 파일에 겹치지 않는다', dupTerms, []);
ok(`해설 ${theory.size}개를 읽었다`, theory.size >= 8, theory.size);

// ── 그림 키 모으기 ──────────────────────────────────────────────
const visual = new Map(); // 그림 키 → 파일
const dupVis = [];
const visFiles = [['DailyVisual.tsx', readFileSync('src/components/DailyVisual.tsx', 'utf8')]];
for (const f of readdirSync(VIS_DIR).filter((f) => /^batch\d+\.tsx$/.test(f)).sort()) {
  visFiles.push([f, readFileSync(`${VIS_DIR}/${f}`, 'utf8')]);
}
for (const [file, src] of visFiles) {
  const body = src.slice(src.indexOf('Record<string, () => ReactNode> = {'));
  for (const m of body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*): [A-Za-z]/gm)) {
    if (visual.has(m[1])) dupVis.push(`${m[1]}(${visual.get(m[1])} ↔ ${file})`);
    visual.set(m[1], file);
  }
}
eq('⭐ 그림 키가 두 파일에 겹치지 않는다', dupVis, []);
ok(`그림 ${visual.size}장을 읽었다`, visual.size >= 8, visual.size);

// ── 해설 ↔ 그림 ────────────────────────────────────────────────
const missingVisual = [...theory].filter(([, t]) => t.visual && !visual.has(t.visual)).map(([k, t]) => `${k}→${t.visual}`);
eq('⭐ 해설이 가리키는 그림이 모두 실재한다', missingVisual, []);
const noVisual = [...theory].filter(([, t]) => !t.visual).map(([k]) => k);
eq('⭐ 모든 해설에 그림이 있다(그림 없는 해설은 이 화면에 안 실린다)', noVisual, []);
const orphan = [...visual.keys()].filter((v) => ![...theory.values()].some((t) => t.visual === v));
eq('그림 중에 아무 해설도 안 쓰는 것이 없다', orphan, []);

// ── 배치 파일 위생 ─────────────────────────────────────────────
for (const [file, src] of visFiles.slice(1)) {
  const hex = [...src.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8}|rgb[^"]*|[a-z]+)"/g)]
    .map((m) => m[1]).filter((v) => v !== 'currentColor' && v !== 'none');
  eq(`${file}: 색을 직접 박지 않았다(토큰·클래스만)`, hex, []);
  const banned = ['<foreignObject', '<image', '<marker', '<style', 'dangerouslySetInnerHTML'];
  eq(`${file}: 금지 태그가 없다`, banned.filter((b) => src.includes(b)), []);
  ok(`${file}: 공용 부품(kit)을 쓴다`, /from '\.\/kit'/.test(src), true);
  const keyPrefix = /batch(\d+)\.tsx$/.exec(file)[1];
  const badKeys = [...visual].filter(([, f]) => f === file).map(([k]) => k).filter((k) => !k.startsWith(`b${keyPrefix}_`));
  eq(`${file}: 그림 키가 b${keyPrefix}_ 로 시작한다`, badKeys, []);
}

// ── 해설 글 길이 (읽히는 분량인가) ───────────────────────────────
const longPoint = [...theory].filter(([, t]) => t.point.length > 70).map(([k, t]) => `${k}(${t.point.length}자)`);
eq('한 줄 요약이 70자를 넘지 않는다', longPoint, []);
const tooManyWhy = [...theory].filter(([, t]) => t.why.length > 2).map(([k, t]) => `${k}(${t.why.length}줄)`);
eq('보충 설명이 2줄을 넘지 않는다(줄글 금지)', tooManyWhy, []);

// ── 등록 누락 — 배치 파일을 만들어 놓고 등록표에 안 꽂은 경우 ────────
const dvSrc = readFileSync('src/components/DailyVisual.tsx', 'utf8');
const unregisteredVis = readdirSync(VIS_DIR).filter((f) => /^batch\d+\.tsx$/.test(f))
  .filter((f) => !dvSrc.includes(f.replace('.tsx', '')));
eq('⭐ 그림 배치가 전부 등록표에 꽂혀 있다', unregisteredVis, []);
const unregisteredTh = readdirSync(THEORY_DIR).filter((f) => /^batch\d+\.ts$/.test(f))
  .filter((f) => !termsSrc.includes(f.replace('.ts', '')));
eq('⭐ 해설 배치가 전부 TERM_THEORY 에 합쳐져 있다', unregisteredTh, []);

// ── 번역 (theory/i18n/<lang>.labels.ts · <lang>.theory.ts) ──────────
// 번역은 **덮어쓰기 표**다 — 없는 항목은 한국어가 그대로 나오므로 화면이 비지는 않는다.
// 그래도 아래는 잡아야 한다:
//   · 키에 오타가 나면 그 항목만 영영 한국어로 남는다(에러 없이 조용히)
//   · 원문이 바뀌었는데 번역표에 옛 키가 남아 있으면 그 번역은 죽은 값이다
{
  const I18N = `${THEORY_DIR}/i18n`;
  let dir = [];
  try { dir = readdirSync(I18N); } catch { /* 아직 번역이 없을 수 있다 */ }
  const langs = [...new Set(dir.map((f) => /^([a-z]{2})\.(labels|theory)\.ts$/.exec(f)?.[1]).filter(Boolean))].sort();

  // 원문 라벨 = 그림 파일 안에서 **화면에 닿을 수 있는 한글 전부**.
  // ⚠️ `Lab` 만 세면 안 된다 — 조작줄의 칩·힌트·상태 배지, 데이터 배열의 낱말도 화면에 나온다
  //    (`Frame` 이 자기 아래 글자를 통째로 훑어 갈아 끼운다). 실제로 Lab 만 셌다가 화면 절반이 한국어로 남았다.
  // ⚠️ 주석은 뺀다. `>` 는 비교 연산자로도 쓰이므로 등호·괄호가 섞인 조각은 코드로 보고 버린다.
  const koLabels = new Set();
  for (const [, raw] of visFiles) {
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const add = (s) => {
      const one = String(s).trim().replace(/\s+/g, ' ');
      if (one && /[가-힣]/.test(one)) koLabels.add(one);
    };
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"([^"\n]*)"/g)) add((m[1] ?? m[2]).replace(/\\'/g, "'"));
    // ⚠️ 식과 붙어 있는 글자도 화면에 나온다(`{n}비트`) — 여는 쪽이 `>` 든 `}` 든 잡는다(추출기와 같은 규칙).
    for (const m of src.matchAll(/[>}]([^<>{}]*)[<{]/g)) { if (!/[=;()?]|=>|&&/.test(m[1])) add(m[1]); }
    // ⚠️ `Lab` 본문은 위 필터를 통과 못 하는 것도 대상이다 — 라벨에 등호·괄호가 들어가는 게 자연스럽다
    //    (`왕복 시간 × 소리 속도 ÷ 2 = 거리`). 태그 이름으로 잡으므로 코드 조각이 섞일 일이 없다.
    for (const m of src.matchAll(/<(?:Lab|text)\b[^>]*>([\s\S]*?)<\/(?:Lab|text)>/g)) { if (!/[{<]/.test(m[1])) add(m[1]); }
  }
  ok(`원문 라벨 ${koLabels.size}개를 읽었다`, koLabels.size > 100, koLabels.size);
  // ⛔ 엔티티(&lsquo; 등)를 쓰면 **화면 글자와 소스 글자가 달라져** 번역 키가 안 맞는다(그 라벨만 한국어로 남는다).
  const entity = [...koLabels].filter((s) => /&[a-zA-Z]+;|&#\d+;/.test(s));
  eq('⭐ 라벨에 HTML 엔티티를 쓰지 않았다', entity, []);

  for (const lang of langs) {
    const keysOf = (file, decl) => {
      const src = readFileSync(`${I18N}/${file}`, 'utf8');
      const body = src.slice(src.indexOf(decl));
      // 한 줄짜리('키': '값') 와 블록형('키': { … ) 을 다 잡는다
      return new Set([...body.matchAll(/^ {2}(?:'((?:[^'\\]|\\.)*)'|"([^"]*)"|([^\s:'"]+)): /gm)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'")));
    };
    const lk = keysOf(`${lang}.labels.ts`, 'LABELS');
    const tk = keysOf(`${lang}.theory.ts`, 'THEORY');
    const unknownL = [...lk].filter((k) => !koLabels.has(k));
    const unknownT = [...tk].filter((k) => !theory.has(k));
    eq(`⭐ ${lang}: 없는 라벨을 번역해 두지 않았다(원문이 바뀐 자리)`, unknownL.slice(0, 5), []);
    eq(`⭐ ${lang}: 없는 용어를 번역해 두지 않았다`, unknownT.slice(0, 5), []);
    const missL = [...koLabels].filter((k) => !lk.has(k));
    const missT = [...theory.keys()].filter((k) => !tk.has(k));
    ok(`${lang}: 라벨 ${lk.size}/${koLabels.size}${missL.length ? ` (빠짐 ${missL.length})` : ''}`, missL.length === 0, missL.slice(0, 3));
    ok(`${lang}: 해설 ${tk.size}/${theory.size}${missT.length ? ` (빠짐 ${missT.length})` : ''}`, missT.length === 0, missT.slice(0, 3));
  }
  if (!langs.length) console.log('ℹ️ 번역 파일이 아직 없다(한국어로만 나간다).');
}

// ── 리포트 ───────────────────────────────────────────────────────
let bad = 0;
for (const r of results) {
  if (!r.pass) bad++;
  console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.pass ? '' : `\n     got  ${r.got}\n     want ${r.want}`}`);
}
console.log(`\n${results.length - bad}/${results.length} 통과 · 해설 ${theory.size} · 그림 ${visual.size}`);
if (bad) process.exit(1);
