// banned-words-live — 관리자 금칙어가 **실제 채팅 검사에 물리는지** 본다(2026-09-07).
//
// 여태 이 기능은 세 토막이 서로 안 이어져 있었다: 표는 있고, 서버 액션도 있는데, 넣을 화면이 없고,
// 넣어도 chat-post 는 코드 목록만 봤다. 그래서 "각 토막이 존재하는가" 가 아니라 **이어졌는가** 를 본다.
//  · ⭐ checkBadword 가 관리자 단어를 실제로 막는가(순수 함수 단위 실행)
//  · ⭐ 관리자 단어에도 회피 표기 정규화가 적용되는가('시 발' 류) — 원문 매칭이면 한 칸만 띄워도 뚫린다
//  · ⭐ 관리자 단어에도 allowlist 예외가 적용되는가 — 안 그러면 멀쩡한 합성어가 막히고 이유를 아무도 모른다
//  · ⭐ 표가 비어도 기본 차단이 그대로 도는가 — 관리자 목록이 코드 목록을 **대체하면** 안 된다
//  · ⭐ chat-post 가 그 목록을 불러 넘기는가(정적)
//  · ⭐ 관리자 화면이 서버 액션을 실제로 부르는가(정적) — 이게 없어서 여태 넣을 방법이 없었다
//  · 저장 쪽에 한 글자 가드가 있는가 — 한 글자를 넣으면 멀쩡한 글이 전부 막힌다
import { readFileSync } from 'node:fs';
import { checkBadword } from '../supabase/functions/_shared/badwords_ko.ts';

const read = (p) => readFileSync(p, 'utf8');
const CHATPOST = read('supabase/functions/chat-post/index.ts');
const REFORM = read('supabase/functions/admin/reform.ts');
const ADMINUI = read('src/pages/Admin.tsx');
const LOADER = read('supabase/functions/_shared/banned-words.ts');

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

// ── (1) ⭐ 관리자 단어가 실제로 막힌다 ──────────────────────
rec('⭐관리자 단어가 없으면 통과', checkBadword('멍뭉이 최고').blocked, false);
rec('⭐관리자 단어를 넣으면 막힌다', checkBadword('멍뭉이 최고', ['멍뭉이']).blocked, true);

// ── (2) ⭐ 회피 표기 정규화가 관리자 단어에도 적용된다 ──────
// 원문 그대로 찾으면 한 칸만 띄워도 뚫린다. 목록 쪽도 같은 정규화를 거쳐야 한다.
rec('⭐띄어쓰기 회피가 막힌다', checkBadword('멍 뭉 이 최고', ['멍뭉이']).blocked, true);
rec('⭐목록 쪽 띄어쓰기도 흡수된다', checkBadword('멍뭉이 최고', ['멍 뭉 이']).blocked, true);

// ── (3) ⭐ allowlist 예외는 관리자 단어에도 산다 ────────────
// KO_BADWORDS 의 '시발' 은 '시발점' 에서 통과해야 한다. 관리자가 같은 말을 넣어도 규칙이 같아야 한다.
rec('기본 목록: 시발점은 통과', checkBadword('시발점에서 만나요').blocked, false);
rec('⭐관리자 목록: 시발점도 통과', checkBadword('시발점에서 만나요', ['시발']).blocked, false);

// ── (4) ⭐ 표가 비어도 기본 차단은 돈다(대체가 아니라 덧셈) ──
const base = checkBadword('시발놈아');
rec('⭐빈 목록에도 기본 욕설은 막힌다', base.blocked && checkBadword('시발놈아', []).blocked, true);
rec('⭐관리자 목록이 있어도 기본은 그대로', checkBadword('시발놈아', ['멍뭉이']).blocked, true);

// ── (5) ⭐ 이어짐: chat-post → 로더 ────────────────────────
rec('⭐chat-post 가 금칙어 목록을 불러온다', /loadBannedWords\(admin\)/.test(CHATPOST), true);
rec('⭐chat-post 가 그 목록을 검사에 넘긴다', /checkBadword\(text,\s*await loadBannedWords/.test(CHATPOST), true);
rec('로더가 active 만 읽는다', /\.eq\('active', true\)/.test(LOADER), true);
rec('로더가 실패해도 빈 목록으로 계속한다(차단이 안 풀린다)', /if \(error \|\| !data\)/.test(LOADER), true);
rec('로더에 캐시가 있다(글마다 DB 왕복 금지)', /TTL_MS/.test(LOADER), true);

// ── (6) ⭐ 이어짐: 관리자 화면 → 서버 액션 ──────────────────
// 이게 없어서 여태 단어를 넣을 방법 자체가 없었다.
rec('⭐관리자 화면이 목록을 부른다', /action: 'bannedWordList'/.test(ADMINUI), true);
rec('⭐관리자 화면이 저장을 부른다', /action: 'bannedWordSave'/.test(ADMINUI), true);
rec('⭐메뉴에 금칙어가 있다', /key: 'words'/.test(ADMINUI), true);
rec('⭐라우트가 이어져 있다', /case 'arena\/words'/.test(ADMINUI), true);
rec('반영 지연(1분)을 화면이 알린다', /최대 1분/.test(ADMINUI), true);

// ── (7) 저장 가드 ──────────────────────────────────────────
rec('한 글자는 저장이 막힌다', /word\.length < 2/.test(REFORM), true);
rec('저장 뒤 캐시를 버린다', /invalidateBannedWords\(\)/.test(REFORM), true);

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name} (got=${r.got} want=${r.want})`);
const passed = results.filter((r) => r.pass).length;
console.log(`\nBANNED-WORDS-LIVE: ${passed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 'banned-words-live', total: results.length, passed, failed: results.length - passed }));
if (passed !== results.length) process.exit(1);
