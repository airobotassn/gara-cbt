-- 응시료(exam_fees) — 키를 현행 티어 체계로 옮기고 금액을 **원(KRW)** 으로 확정한다.
--
-- 배경: 2026-07 개편으로 급수 체계가 바뀌었는데(구: Pro 단일시험 + Master 4~1급 →
--   현행: CARIS-Ⅰ Beginner/Pro/Elite · CARIS-Ⅱ Master/Grand Master/Zenith) exam_fees 키는
--   구 체계(pro·master_g4~g1) 그대로 남아 **어느 티어와도 대응되지 않았다**. 게다가 화면은 이 테이블을
--   읽지도 않고 caris.ts 의 `fee: 1`(달러 임시값)을 쓰고 있었다(= 정가 소스가 사실상 없었다).
--
-- 결정(2026-08-06): **통화는 원(KRW) 하나**. 달러 정가 + 환율 곱셈은 쓰지 않는다 —
--   주문 시점과 승인 시점의 환율이 다르면 금액 불일치로 승인이 튕기고, 관리자가 입력한 값과
--   실제 청구액이 달라진다. 해외 결제를 나중에 얹을 땐 환산이 아니라 **통화별 정가를 따로** 둔다
--   (토스도 MID 가 통화별로 갈린다).
--   환산 기준: $1 = 1,500원 → Beginner $1 / Pro $2 / Elite $3.
--
-- ⚠️ CARIS-Ⅱ(Master·Grand Master·Zenith)는 **행을 만들지 않는다.** 결제를 붙이지 않기로 했고,
--    근거 없는 금액을 넣어두면 화면에 정가처럼 뜬다. 행이 없으면 화면이 '준비 중'으로 표시한다.
--    나중에 열 때 여기에 세 줄(t2_master·t2_grandmaster·t2_zenith)을 넣으면 화면은 손댈 게 없다.
--
-- 키 규칙 = `${트랙키}_${티어키}` (src/lib/fees.ts 의 feeKey()). 바꾸면 양쪽 같이 고칠 것.

-- 구 급수 체계 키 제거.
--   지울 때 값(되돌릴 일이 있으면 참고): pro=30000, master_g4=80000, master_g3=100000,
--   master_g2=120000, master_g1=150000. 전부 개편 전 임시값이고 현행 티어에 대응되지 않는다.
delete from public.exam_fees
 where key in ('pro', 'master_g4', 'master_g3', 'master_g2', 'master_g1');

-- 현행 CARIS-Ⅰ 3티어. 이후 금액 변경은 마이그레이션이 아니라 **관리자 화면**에서 한다
--   (그래서 do nothing — 재실행이 관리자가 고친 값을 되돌리면 안 된다).
insert into public.exam_fees (key, amount) values
  ('t1_beginner', 1500),
  ('t1_pro',      3000),
  ('t1_elite',    4500)
on conflict (key) do nothing;
