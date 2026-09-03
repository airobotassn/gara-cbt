-- 강의 영상을 **Bunny Stream** 으로도 팔 수 있게 한다(2026-09-03).
--
-- 왜: 유튜브로 파는 유료 강의는 근본 구멍이 있다 — **영상 id 만 알면 누구나 무료로 본다.**
--   그래서 여태 서버가 미소유자에게 youtube_id 를 감췄는데(ebooks 함수), 그건 구멍을 가린 것이지
--   막은 게 아니다(산 사람이 id 를 퍼뜨리면 끝이고, 썸네일 주소에도 id 가 박혀 있다).
--   Bunny 는 **서명된 임베드 URL** 이라야 재생되므로 id 를 알아도 못 본다 — 유료 강의의 정답이다.
--
-- ⛔ **유튜브를 걷어내지 않는다.** 지금 올라가 있는 무료 강의들은 유튜브 그대로 둔다(2026-09-03 지시).
--    두 방식이 공존하고, 강의 한 편이 **둘 중 정확히 한쪽**에 속한다.

-- ---------- ① 영상 출처 두 갈래 ----------
-- Bunny 강의는 유튜브 id 가 없다 → not null 을 푼다.
alter table public.lectures alter column youtube_id drop not null;

-- Bunny 의 영상 GUID. 라이브러리 id 는 여기 안 담는다 —
--   ⚠️ 라이브러리는 **계정 설정**(토큰 키·허용 도메인의 단위)이지 강의의 속성이 아니다.
--      행마다 담으면 라이브러리를 옮길 때 전 행을 갱신해야 하고, 어긋난 행은 화면에 표시도 안 난다.
--      서버 시크릿(BUNNY_STREAM_LIBRARY_ID) 하나가 단일 출처다.
alter table public.lectures add column if not exists bunny_video_id text;

-- ⛔ **정확히 하나만** 차야 한다. 둘 다 차 있으면 어느 쪽으로 재생할지 모호해지는데,
--    그 모호함은 화면 어디에도 안 드러나고 사람마다 다른 영상을 볼 수 있다.
--    (기존 행은 youtube_id 가 차 있으므로 그대로 통과한다.)
alter table public.lectures drop constraint if exists lectures_source_chk;
alter table public.lectures add constraint lectures_source_chk
  check (num_nonnulls(youtube_id, bunny_video_id) = 1);

-- ---------- ② 재생 기록 = 이어보기 + 발급 원장 ----------
-- 한 표가 둘을 겸한다.
--   · position_sec — 어디까지 봤나(이어보기)
--   · plays        — 재생 주소(서명 URL)를 몇 번 받아갔나
--
-- ⛔ **plays 가 그냥 통계가 아니다.** Bunny 는 종량제라 트래픽이 곧 돈이고, 계정 잔액이 마르면
--    강의가 통째로 재생 불가가 된다. 누가 비정상적으로 주소를 긁어가는지 우리 DB 에서 볼 수 있어야
--    한다 — 이게 그 자리다(대시보드 알림은 이미 늦은 뒤에 온다).
--
-- ⚠️ PK 가 (사람, 강의) 라 **행이 안 쌓인다.** 100번 재생해도 행은 하나고 plays 만 오른다
--    (visit_stats 와 같은 이유 — 로그인 없이는 못 부르지만, 무한히 늘 수 있는 쓰기 경로는 바닥이 있어야 한다).
--    대가로 '어제 대비 오늘' 은 못 본다. 일자 축이 필요해지면 그때 (user, lecture, day) 로 넓힐 것.
create table if not exists public.lecture_plays (
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  position_sec integer not null default 0 check (position_sec >= 0),
  plays integer not null default 0,
  last_at timestamptz not null default now(),
  primary key (user_id, lecture_id)
);

-- RLS 켜고 정책은 부여하지 않는다 = service role(엣지 함수) 전용.
--   ⛔ 클라가 직접 쓰게 하면 position_sec 을 아무 값이나 넣을 수 있고, plays 원장이 거짓말을 한다.
alter table public.lecture_plays enable row level security;

-- 관리자가 "요즘 누가 많이 긁어가나" 를 볼 때 쓰는 순서.
create index if not exists lecture_plays_recent_idx on public.lecture_plays (last_at desc);
