-- 허브 캐릭터 업로드 (2026-08-31)
-- 캐릭터 그림·비율·이름을 **배포 없이** 관리자 화면에서 넣을 수 있게 한다.
--
-- 여태 캐릭터 한 종은 `public/hub/char/<키>/lv1~7.webp`(파일) + 코드 상수(`CHAR_SERIES`·`CHAR_AR`)
-- + 사전(`hub.part.<키>`) + `shop_catalog` 한 행이었다. 앞의 셋이 코드라 **그림이 도착할 때마다 배포**였다.
-- 이 표가 그 셋을 대신 들고, 없으면 예전처럼 코드/파일로 떨어진다.
--
-- ⛔ **코드의 파일 경로를 지우지 말 것.** 이 표에 행이 없는 캐릭터(지금 `char_a_m`·`char_a_f`)는
--    계속 `public/hub/char/...` 에서 그려진다. 표를 단일 출처로 만들겠다고 파일 규칙을 없애면
--    이미 있는 두 캐릭터를 누군가 다시 업로드하기 전까지 허브가 폴백 한 장으로 뜬다.
--
-- ⛔ **자르기(시트 → 7장)는 여전히 `tools/build-char-art.mjs` 다.** 여기 올리는 건 **완제품 7장**이다.
--    흰 배경 빼기·Lv.7 후광 역산·7장을 같은 캔버스에 얹기는 판단이 섞인 일이라(도구 머리 주석 참고)
--    서버로 옮기지 말 것 — Deno 엣지 함수에는 그 이미지 처리기가 없다.
--
-- ⚠️ **`urls` 는 매번 다른 파일 이름을 담는다**(`lv3-1725...webp`). 같은 경로에 덮어쓰면 공개 URL 이
--    그대로라 브라우저·CDN 이 옛 그림을 계속 보여준다 — 관리자는 올렸는데 화면은 안 바뀐다.
--    대가는 안 쓰는 옛 파일이 버킷에 남는 것이고, 그건 눈에 보이는 사고가 아니다.
--
-- ⚠️ **비율(`ar`)은 브라우저가 재서 보낸다.** 서버에서 재려면 이미지 디코더가 필요한데 엣지에는 없다.
--    캔버스 비율이지 인물 비율이 아니다(hubCosmetics.ts 의 `CHAR_AR` 주석과 같은 뜻).

create table if not exists public.hub_char_art (
  part_key   text primary key,
  -- 캔버스 가로/세로. null 이면 화면이 폴백 비율을 쓴다.
  ar         numeric,
  -- 레벨(문자열 '1'~'7') → 공개 URL. 빠진 레벨은 화면이 폴백 그림으로 그린다.
  urls       jsonb       not null default '{}'::jsonb,
  -- 이름 — 한국어가 원본, 나머지 5개국어는 번역본만 담는다(공지·강의와 같은 규칙: ko 를 i18n 에 넣지 않는다).
  name_ko    text,
  name_i18n  jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint hub_char_art_key_chk check (part_key ~ '^char_[a-z0-9_]+$')
);

-- 그림 주소와 이름뿐이라 공개다. 허브·남의 방(`/room/:handle`)·공유 카드가 **로그인 없이** 읽는다
-- (shop_catalog 가 이미 같은 성격으로 공개돼 있다).
--   ⚠️ 쓰기 정책은 만들지 않는다 = service role(관리자 함수)만 쓴다.
alter table public.hub_char_art enable row level security;
drop policy if exists "hub_char_art_select_all" on public.hub_char_art;
create policy "hub_char_art_select_all" on public.hub_char_art for select using (true);
