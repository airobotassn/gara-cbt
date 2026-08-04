-- 시즌 점수 체계 원안 반영(2026-08-04) — activity_ledger 에 'referral'(친구 초대) 종류 추가.
--  · 적립값·일일 횟수·시즌 상한은 코드가 단일 출처다(src/lib/scoring.ts ↔ supabase/functions/_shared/scoring.ts 의
--    ACTIVITY_DELTA / ACTIVITY_PER_DAY / ACTIVITY_SEASON_MAX). 여기서는 DB 가 그 종류를 받아들이도록
--    check 제약과 하루-cap 인덱스만 넓힌다.
--  · referral 은 하루 1회라 attendance/daily_learn 과 같은 daycap 부분 인덱스에 편입한다.
--    ⚠️ 적립 호출부는 아직 없다 — 초대코드 발급·가입 귀속 플로우가 미구현이라 점수 규칙만 선반영된 상태다.
--  · minigame 은 하루 1회 → 3회로 늘었지만 인덱스 변경이 필요 없다: source_ref 가 게임id 에서 회차 슬롯
--    ('play:1'…'play:3')으로 바뀌었을 뿐이고 unique(user_id, day, source_ref) 가 그대로 하루 캡이 된다.
--    기존 check(kind <> 'minigame' or source_ref is not null) 도 그대로 성립한다.
--  멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.

alter table activity_ledger drop constraint if exists activity_ledger_kind_check;
alter table activity_ledger
  add constraint activity_ledger_kind_check
  check (kind in ('attendance', 'daily_learn', 'minigame', 'referral'));

drop index if exists activity_ledger_daycap_idx;
create unique index if not exists activity_ledger_daycap_idx
  on activity_ledger (user_id, kind, day)
  where kind in ('attendance', 'daily_learn', 'referral');

-- skill_score 스케일 전환 백필 — 옛 값(0~10,000: 레벨당 1,428 + 레벨내 부분점수)을 새 값(레벨당 정액 1,000)으로.
--  ⚠️ 이게 없으면 안 된다: applyAttempt 가 skill_score 를 GREATEST 로만 올리므로, 옛 값(최대 10,000)이
--     새 만점(7,000)보다 커서 영영 내려오지 않고 season_total 이 부풀어 있는다.
--  · 사다리가 순차라 클리어한 레벨 수 = rank − 1. Lv.7 자체의 통과 여부는 이력만으로 확정하기 어려워
--    보수적으로 rank − 1 로 환산한다(해당자는 다음 Lv.7 통과 때 7,000 으로 복구된다).
--  · where 절이 멱등성을 만든다 — 이미 새 스케일인 행(= (rank−1)×1000, 또는 Lv.7 클리어분 7,000)은 건드리지 않는다.
update user_progress
   set skill_score = greatest(rank - 1, 0) * 1000
 where skill_score <> greatest(rank - 1, 0) * 1000
   and not (rank >= 7 and skill_score = 7000);
