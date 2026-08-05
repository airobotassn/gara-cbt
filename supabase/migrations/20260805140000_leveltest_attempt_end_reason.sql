-- 레벨테스트 응시 종료 사유·위반 내역 기록
--
-- 배경: 관리자 응시 기록에 '중단'과 '경고중단'만 있고 근거가 없었다.
--   · 경고중단 — 클라가 사유(tab/blur/fs)를 감지해 화면에 띄우면서도 서버엔 횟수만 보냈다.
--                왜 걸렸는지가 어디에도 안 남았다.
--   · 중단     — '나가기' 버튼을 누른 것과 그냥 사라진 것이 구분되지 않았다
--                (나가기가 서버에 아무 신호도 안 보냈다).
--
-- end_reason: 'quit'(자진 종료) · 'cheat'(경고 누적 무효) · null(신호 없음 = 무단 이탈)
-- violations: [{at, reason}] — 사유별 시각. 클라 신호라 증거가 아니라 참고 지표다.
-- ⚠️ 이 마이그레이션 이전 기록은 둘 다 비어 있다 — 과거 '중단'은 전부 무단 이탈로 보인다.

alter table test_attempts add column if not exists end_reason text;
alter table test_attempts add column if not exists violations jsonb not null default '[]'::jsonb;

comment on column test_attempts.end_reason is
  'quit=나가기 버튼(자진 종료) · cheat=경고 누적 무효 · null=신호 없음(무단 이탈 또는 정상 제출)';
comment on column test_attempts.violations is
  '[{at,reason}] 부정행위 감지 내역. reason=tab|blur|fs. 클라 신호라 참고 지표.';
