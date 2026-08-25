-- SEB 인계표에 용도를 붙인다 — 실제 응시(exam)와 환경 점검(envcheck).
--
-- 왜: 환경 점검은 "이 PC 에서 SEB 가 실제로 뜨는가" 를 확인하는 것인데, 지금은 **SEB 를 켜기 전에**
--   바깥 브라우저가 기록을 남긴다. 그래서 SEB 가 안 떠도 '점검 완료' 가 된다 — 정작 확인하려던 걸
--   증명하지 못한다. 표를 모의 링크에도 실어 보내고 **SEB 안에서 그 표를 쓸 때** 기록하면,
--   기록이 남았다는 것 자체가 "SEB 가 떴다" 는 증거가 된다.
--
-- ⛔ 용도를 나누는 이유는 **권한 때문이다.** 실제 응시 표는 교환하면 시험을 시작할 수 있는 자격이 나온다.
--    점검 표가 같은 걸 받으면 점검하러 온 사람이 시험을 시작할 수 있게 된다 —
--    그래서 점검 표는 교환해도 **아무 자격도 주지 않고 기록만 남긴다**(seb-handoff 의 redeem 참고).
alter table public.seb_handoff
  add column if not exists purpose text not null default 'exam'
    check (purpose in ('exam', 'envcheck'));

-- 환경 점검은 응시권 없이도 한다("이 PC 는 된다"는 사실은 응시권과 무관하다) → ticket_id 를 비울 수 있어야 한다.
-- ⚠️ 실제 응시(purpose='exam')는 여전히 응시권이 필수다. 그 강제는 아래 CHECK 이 한다 —
--    없으면 응시권 없는 표로 시험을 시작하려 드는 경로가 열린다.
alter table public.seb_handoff alter column ticket_id drop not null;
alter table public.seb_handoff drop constraint if exists seb_handoff_exam_needs_ticket;
alter table public.seb_handoff
  add constraint seb_handoff_exam_needs_ticket
  check (purpose <> 'exam' or ticket_id is not null);
