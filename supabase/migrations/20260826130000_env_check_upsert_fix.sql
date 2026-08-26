-- 시험환경 점검 기록이 **한 건도 안 쌓이고 있었다**(2026-08-26 발견 · 실측 exam_env_checks 0행).
--
-- 증상: SEB 안에서 점검 화면까지 정상으로 뜨고 표(seb_handoff)도 redeemed 로 찍히는데,
--       마이페이지 응시권 카드의 `시험하러 가기` 가 영영 비활성이었다(envChecked=false).
-- 원인: 기록을 쓰는 쪽(seb-handoff 의 `upsert(row, { onConflict: 'ticket_id' })`)이 만드는
--       `on conflict (ticket_id)` 는 **부분 유니크 인덱스**를 중재자로 못 쓴다 —
--       `where ticket_id is not null` 이 붙어 있으면 Postgres 가 42P10
--       ("there is no unique or exclusion constraint matching the ON CONFLICT specification")
--       을 던진다. 그 예외가 500 이 되어 점검 기록만 조용히 사라졌다.
--       (표를 소비하는 UPDATE 는 그 앞에서 이미 끝나서, 남는 건 "redeemed 인데 기록은 없는" 상태였다.)
--
-- 고침: 술어를 뗀 **평범한 유니크 인덱스**로 바꾼다. 의미는 그대로다 —
--       Postgres 유니크는 NULL 을 서로 다른 값으로 보므로(NULLS DISTINCT 기본),
--       `ticket_id is null` 인 '응시권 없이 체험만 한' 기록은 예전처럼 여러 건 쌓인다.
-- ⚠️ 여기에 술어를 다시 붙이지 말 것 — 붙이는 순간 위 42P10 이 그대로 재발한다.
--    (PostgREST 는 `on conflict (col) where …` 형태를 만들 수 없다.)
drop index if exists public.exam_env_checks_ticket_uniq;
create unique index if not exists exam_env_checks_ticket_uniq
  on public.exam_env_checks (ticket_id);
