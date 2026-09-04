-- 2026-09-04 · RLS 안 켜진 표 13개 잠그기
--   ⛔ 이 13개는 RLS 가 꺼진 채 anon 에 SELECT/INSERT/UPDATE/DELETE 권한이 붙어 있었다.
--      anon 키는 프론트 번들에 박혀 있는 공개 값이라, 인터넷 누구나 아래를 할 수 있었다:
--        · term_questions   — 미니게임 용어 문항 72개의 **정답**(answer_i18n) 열람 + 통째 삭제
--        · admin_audit      — 관리자 이메일·행위 이력 열람 + 삭제
--        · minigame_plays   — 회원별 플레이 기록 열람
--        · exam_env_checks  — 응시자 UA·화면 정보 열람
--        · 나머지(lectures·reward_policy·question_banks·term_banks·minigame_question_sets
--          ·mail_log·banned_words·lecture_chunks·system_alerts) — 운영 데이터 열람·변조·삭제
--      2026-09-04 에 실제 anon 키로 HTTP 요청을 날려 전부 200 인 것을 확인했다(DELETE 포함).
--
--   원인은 `create table` 만 하고 `enable row level security` 를 안 친 것이다. Postgres 기본값이
--   off 인데 Supabase 의 public 스키마 기본 grant 가 anon 에 붙어 있어서, 안 치면 그대로 공개된다.
--   같은 이유로 열려 있던 백업 표 15개는 20260904120000 에서 드롭했다.
--
--   ⚠️ 정책은 일부러 하나도 안 만든다 — 저장소 관례(RLS ON + 정책 0개 = service role 전용)를 따른다.
--      13개 전부 데이터 접근은 엣지 함수의 adminClient()(SERVICE_ROLE_KEY)뿐이고 service role 은
--      RLS 를 우회하므로 화면은 안 깨진다. 프론트가 .from() 으로 직접 읽는 표에는 이 중 하나도 없다
--      (직접 읽는 것은 profiles·ebooks·inquiries·notices·site_settings·popups·policy_docs
--       ·hub_char_art·faqs·exam_rounds·exam_fees·board_categories 뿐이고 전부 정책이 있다).
--
--   ⚠️ 새 표를 만들 때 이 한 줄을 빼먹으면 같은 구멍이 다시 난다. 스냅샷 백업 표도 마찬가지다.

begin;

alter table term_questions         enable row level security;
alter table admin_audit            enable row level security;
alter table minigame_plays         enable row level security;
alter table exam_env_checks        enable row level security;
alter table lectures               enable row level security;
alter table lecture_chunks         enable row level security;
alter table reward_policy          enable row level security;
alter table question_banks         enable row level security;
alter table term_banks             enable row level security;
alter table minigame_question_sets enable row level security;
alter table mail_log               enable row level security;
alter table banned_words           enable row level security;
alter table system_alerts          enable row level security;

commit;
