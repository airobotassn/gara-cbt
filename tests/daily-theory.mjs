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

// ── 리포트 ───────────────────────────────────────────────────────
let bad = 0;
for (const r of results) {
  if (!r.pass) bad++;
  console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.pass ? '' : `\n     got  ${r.got}\n     want ${r.want}`}`);
}
console.log(`\n${results.length - bad}/${results.length} 통과 · 해설 ${theory.size} · 그림 ${visual.size}`);
if (bad) process.exit(1);
