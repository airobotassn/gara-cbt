-- 친구 초대 귀속(2026-08-04) — 피초대자가 등록한 초대자를 계정에 1회 박는다.
--  · 등록 창구는 허브 '초대하기' 모달 하나뿐이다(온보딩 아님). 모달은 다시 열 수 있으므로
--    오타·없는 코드는 **에러로 알려준다** — 한 번뿐인 화면(온보딩)에서 조용히 삼키면 기회를 영영 잃기 때문.
--  · referred_by 가 한 번 채워지면 끝이다(계정당 1회, 되돌릴 수 없음) — 모달 입력칸도 그때부터 비활성.
--  · 보상은 초대자에게 activity_ledger(kind='referral') +5. 하루 1회 캡은 daycap 부분 unique 가 이미 건다.
--  멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.

alter table profiles add column if not exists referred_by uuid references auth.users(id) on delete set null;
create index if not exists profiles_referred_by_idx on profiles (referred_by);
