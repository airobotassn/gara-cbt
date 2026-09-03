// lecture-bunny — 유료 강의의 Bunny Stream 재생이 **조용히 뚫리거나 조용히 죽지 않게** 소스에 묶어둔다.
//
// 왜 정적 검사인가: 이 기능이 틀리는 자리는 전부 **화면에 아무 표시가 안 나는** 종류다.
//   · 토큰 공식이 어긋나면 재생이 안 되는 게 아니라 **아무나 통과**할 수 있고(스위치가 꺼진 상태와 구분 불가),
//   · `expires` 를 ms 로 넣으면 100배 미래라 사실상 무기한 링크가 나가고,
//   · 구매 확인을 뒤로 미루면 안 산 사람이 강의 존재·id 를 알아내고,
//   · GUID 정규식이 화면·서버 두 벌로 갈리면 미리보기는 뜨는데 저장이 거절된다.
//   전부 "돌아가는 것처럼 보이는" 실패라 눈으로는 못 잡는다.
//
// 검사하는 규칙:
//   1) 마이그레이션이 출처를 **정확히 하나**로 강제한다(num_nonnulls = 1) + 재생 기록 표.
//   2) 토큰 = SHA256(키+영상id+expires) hex · **초 단위** · 해시와 URL 이 **같은 expires**.
//   3) `play` 가 **구매 확인을 먼저** 하고, 시크릿이 없으면 서명하지 않는다.
//   4) 사용자 응답에 `bunny_video_id` 가 안 실린다(화면이 쓸 일이 없다).
//   5) 화면·서버의 GUID 규칙이 한 벌이다.
//   6) iframe 의 referrerPolicy 가 no-referrer 가 아니다 — 허용 도메인 검사가 referer 를 본다.
//   7) 진도 저장(progress)이 발급 원장(plays)을 건드리지 않는다.
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const MIG = read('supabase/migrations/20260903140000_lecture_bunny.sql');
const BUNNY = read('supabase/functions/_shared/bunny.ts');
const EBOOKS = read('supabase/functions/ebooks/index.ts');
const REFORM = read('supabase/functions/admin/reform.ts');
const ADMIN_UI = read('src/pages/AdminReform.tsx');
const LIB_UI = read('src/components/LearningLibrary.tsx');

const results = [];
const ok = (name, cond, got) => results.push({ name, pass: !!cond, got: JSON.stringify(got ?? !!cond) });

// ---- 1) 마이그레이션 ----
ok('1a lectures.bunny_video_id 를 만든다',
  /add column if not exists bunny_video_id text/.test(MIG));
ok('1b ⭐ 출처가 정확히 하나임을 DB 가 강제한다(둘 다 차면 어느 영상인지 화면에 안 드러난다)',
  /check \(num_nonnulls\(youtube_id, bunny_video_id\) = 1\)/.test(MIG));
ok('1c 유튜브 강의를 남겨두려면 youtube_id 의 not null 을 푼다',
  /alter column youtube_id drop not null/.test(MIG));
ok('1d 재생 기록 표(이어보기 + 발급 원장)를 만든다',
  /create table if not exists public\.lecture_plays/.test(MIG));
ok('1e ⭐ PK 가 (사람, 강의) 라 행이 무한히 안 쌓인다',
  /primary key \(user_id, lecture_id\)/.test(MIG));
ok('1f ⭐ RLS 를 켠다(정책 없음 = service role 전용 — 클라가 position/plays 를 못 조작한다)',
  /alter table public\.lecture_plays enable row level security/.test(MIG));

// ---- 2) 토큰 공식 ----
const sign = BUNNY.match(/export async function signBunnyEmbed[\s\S]*?\n\}/);
ok('2a signBunnyEmbed 가 있다', sign != null);
if (sign) {
  const S = sign[0];
  ok('2b ⭐ SHA-256 이다(HMAC 아님)', /digest\('SHA-256'/.test(S));
  ok('2c ⭐ 해시 입력 순서 = 토큰키 + 영상id + expires',
    /TOKEN_KEY \+ videoId \+ expires/.test(S));
  ok('2d ⭐ expires 는 **초** 단위다(ms 면 100배 미래 = 사실상 무기한)',
    /Math\.floor\(Date\.now\(\) \/ 1000\)/.test(S));
  ok('2e ⭐ 해시에 쓴 expires 를 URL 에도 그대로 쓴다(따로 계산하면 늘 불일치)',
    /expires: String\(expires\)/.test(S));
  ok('2f 토큰은 hex 다', /token: toHex\(/.test(S));
}
ok('2g 만료는 3시간 — 강의 한 편을 덮는 길이',
  /export const BUNNY_EMBED_TTL = 3 \* 60 \* 60/.test(BUNNY));

// ---- 3) play 액션의 순서·게이트 ----
// ⚠️ 블록 끝을 중괄호로 잡지 말 것 — 안에 중괄호가 잔뜩이라 정규식이 어디서 끊길지 모른다.
//    다음 액션이 시작하는 자리로 자른다(액션 순서가 바뀌면 여기도 같이 볼 것).
const slice = (from, to) => {
  const a = EBOOKS.indexOf(from);
  const b = EBOOKS.indexOf(to, a + 1);
  return a > -1 && b > a ? [EBOOKS.slice(a, b)] : null;
};
const play = slice("if (action === 'play')", "if (action === 'progress')");
ok('3a play 액션이 있다', play != null);
if (play) {
  const P = play[0];
  const iOwn = P.indexOf("from('lecture_purchases')");
  const iLec = P.indexOf("from('lectures')");
  const iSign = P.indexOf('signBunnyEmbed');
  ok('3b ⭐ 구매 확인이 강의 조회보다 **먼저**다(뒤로 미루면 안 산 사람이 강의 존재를 떠본다)',
    iOwn > -1 && iLec > -1 && iOwn < iLec, { iOwn, iLec });
  ok('3c ⭐ 미보유는 403 이다', /구매한 강의만 시청할 수 있습니다/.test(P));
  ok('3d ⭐ 시크릿이 없으면 서명하지 않는다(반쪽 토큰을 내보내지 않는다)',
    /if \(!bunnyConfigured\(\)\) return json/.test(P) && P.indexOf('bunnyConfigured') < iSign);
  ok('3e 유튜브 강의를 이 경로로 부르면 거절한다(조용히 넘기지 않는다)',
    /다른 방식으로 재생됩니다/.test(P));
  ok('3f 발급 기록 실패가 시청을 막지 않는다', /try \{[\s\S]*lecture_plays[\s\S]*catch/.test(P));
}

// ---- 4) 사용자 응답에 영상 id 가 안 샌다 ----
const shapeLec = EBOOKS.match(/function shapeLecture\([\s\S]*?\n\}/);
ok('4a shapeLecture 가 source 를 내려준다(화면이 재생 경로를 이걸로 가른다)',
  shapeLec != null && /source: \(bunnyId \? 'bunny' : 'youtube'\)/.test(shapeLec[0]));
ok('4b ⭐ 응답에 bunny_video_id 를 담지 않는다',
  shapeLec != null && !/bunnyVideoId|bunny_video_id:/.test(shapeLec[0]));
ok('4c ⭐ Bunny 강의에는 youtubeId 를 안 준다(유튜브 은닉 규칙과 섞이지 않게)',
  shapeLec != null && /youtubeId: owned && !bunnyId \? ytId : null/.test(shapeLec[0]));
ok('4d LECTURE_COLS 가 bunny_video_id 를 뽑는다(안 뽑으면 전부 유튜브로 읽힌다)',
  /const LECTURE_COLS = '[^']*bunny_video_id/.test(EBOOKS));

// ---- 5) GUID 규칙이 화면·서버 한 벌 ----
const GUID = /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/;
ok('5a 서버가 GUID 를 뽑아낸다(임베드 주소를 통째로 붙여넣어도 된다)', GUID.test(REFORM));
ok('5b ⭐ 화면도 **같은 규칙**이다(화면만 통과하면 미리보기는 뜨고 저장이 거절된다)', GUID.test(ADMIN_UI));
ok('5c ⭐ 출처를 화면이 명시해 보낸다(서버가 추측하면 갈아탈 때 둘 다 찬다)',
  /source: lecSource\(edit\)/.test(ADMIN_UI));
ok('5d 서버가 반대편 컬럼을 null 로 비운다',
  /const ytVid = isBunny \? null :/.test(REFORM) && /const bnVid = isBunny \?/.test(REFORM));

// ---- 6) 프론트 재생 ----
ok('6a ⭐ referrerPolicy 가 no-referrer 가 아니다(허용 도메인 검사가 referer 를 본다)',
  /referrerPolicy="strict-origin-when-cross-origin"/.test(LIB_UI) && !/referrerPolicy="no-referrer"/.test(LIB_UI));
ok('6b ⭐ 재생 주소는 누를 때 받아온다(목록에 실으면 만료돼 죽는다)',
  /callFunction<LecturePlayResp>\('ebooks', \{ action: 'play'/.test(LIB_UI));
ok('6c 실패는 문구가 아니라 **사전 키**로 담는다(t 를 이펙트 deps 에 넣지 않기 위해)',
  /setPlayErrKey\('ll\.play_failed'\)/.test(LIB_UI));
ok('6d 이어보기 저장이 조용히 실패한다(진도 때문에 재생을 막지 않는다)',
  /action: 'progress'[\s\S]{0,120}\.catch\(\(\) => \{\}\)/.test(LIB_UI));

// ---- 7) progress 가 원장을 안 건드린다 ----
const prog = slice("if (action === 'progress')", "알 수 없는 action");
ok('7a progress 액션이 있다', prog != null);
ok('7b ⭐ progress 가 plays 를 올리지 않는다(올리면 30초마다 올라 발급 원장이 뜻을 잃는다)',
  prog != null && !/plays:/.test(prog[0]));
ok('7c progress 도 구매 확인을 한다(안 산 강의로 원장을 더럽히지 못하게)',
  prog != null && /from\('lecture_purchases'\)/.test(prog[0]));

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nLECTURE-BUNNY: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 'lecture-bunny', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
