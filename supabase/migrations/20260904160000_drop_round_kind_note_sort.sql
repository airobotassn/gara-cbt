-- 2026-09-04 · exam_rounds 에서 회차유형(kind)·안내문(note_i18n)·수동순서(sort) 제거
--   (2026-09-04 지시 — "상시 없어졌음 / 안내문도 안 써 / sort 도 필요없어")
--
--   · kind      — 5행 전부 'regular' 였다. 'rolling'(상시)은 만들 수는 있어도 **응시권을 팔 수 없는**
--                 회차였다(결제 상품번호가 영구 고정 → 계정당 평생 1회만 결제, 시험일이 없어 응시창·
--                 만료 판정 근거도 없음). 즉 만들면 아무도 못 사는 자리라 기능째로 없앴다.
--   · note_i18n — 회차별 안내문. 5행 전부 비어 있었다(관리자 화면에도 상시일 때만 뜨던 칸).
--   · sort      — 수동 정렬 순서. 정렬 3순위(접수일 → 시험일 → sort)라 앞의 둘이 같아야 도달하는데
--                 그런 회차가 없어 **한 번도 안 걸렸다**. 실제 값도 4·6·9999 로 제각각이었다.
--
--   ⛔ **이 마이그레이션은 코드 배포 뒤에 적용해야 한다.** 브라우저(src/lib/rounds.ts)와 엣지 함수
--      (_shared/exam-tickets.ts 의 EXAM_ROUND_COLS · admin · my-attempts · start-exam)가 이 컬럼들을
--      **이름으로 select** 하기 때문에, 먼저 지우면 PostgREST 가 400 을 내고 /plan 과 응시 흐름이 통째로
--      멈춘다. 순서: ① 프론트 push + 함수 배포 → ② 이 파일 적용.
--
--   같이 없앤 것: admin 의 examRoundReorder 액션(수동 ↑↓), 화면의 '상시시험' 필터 탭·유형 select·
--   설명 입력칸, /plan 의 상시 섹션, src/lib/caris.ts 의 getRolling(), 사전 키 caris.rolling.*·sched.rolling*.

begin;

alter table exam_rounds drop column if exists kind;
alter table exam_rounds drop column if exists note_i18n;
alter table exam_rounds drop column if exists sort;

commit;
