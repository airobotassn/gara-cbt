-- 2026-09-16 · 코인은 출석과 DAILY QUIZ 가 **각각** 받는다 (2026-09-16 지시)
--
--   옛 규칙: 코인 10 은 출석·학습 통틀어 하루 1회 — 둘 중 먼저 한 쪽이 받고 나중 쪽은 빈손.
--   출석은 사이트에 들어오면 자동으로 찍히므로(2026-08-24) DAILY QUIZ 쪽은 **사실상 매일** 빈손이었고,
--   /daily 완료 팝업은 매번 "오늘 출석으로 코인은 이미 받았어요" 라는 변명을 띄웠다.
--   그 '통틀어 1회' 는 2026-07-14 첫 구현 때 코드에 들어간 값이고 **어디에도 지시 기록이 없다** —
--   사용자 앞에 나온 건 8/24 상점 값(캐릭터 500·배경 300)을 정할 때 "하루 10코인이니 50일치" 라는
--   계산 근거로 한 번 쓰인 것뿐이다(그때도 정한 게 아니라 이미 있던 값을 근거로 삼았다).
--
--   새 규칙: 출석 완료 +10 · DAILY QUIZ 완료 +10, 종류별로 각각 하루 1회(= 하루 최대 20).
--   ⛔ **출석 도장(7일 스탬프)과 완주 보너스는 말 그대로 출석에만 붙는다**(2026-09-16 지시). 옛 코드는
--      "출석·학습 중 먼저 한 쪽" 이 도장을 찍었는데(DAILY QUIZ 를 먼저 하면 퀴즈가 도장을 찍었다) 이제
--      퀴즈는 도장을 절대 안 찍는다 — 출석을 오늘 처음 찍는 그 호출만 도장 한 칸 + 7칸째면 보너스.
--   ⚠️ 응답 `first` = **이 호출로 코인이 나갔는가**(= 이 종류를 오늘 처음 완료). /daily 팝업이 이걸 보고
--      +10P 를 그린다. 옛 뜻(재화 통틀어 첫 호출)과 달라졌지만 읽는 자리는 Daily.tsx 하나뿐이다
--      (autoCheckin 은 응답을 안 본다). `stamps` 는 도장이 찍힌 호출(=오늘 첫 출석)에만 값이 있고 나머지는 null.
--      `bonus` 도 같은 호출에만 붙으므로 퀴즈 응답의 bonus 는 항상 0 이다(Daily.tsx 가 읽지만 그릴 일이 없다).
--
--   같이 고치는 것: reward_policy 의 coin/daily_complete 줄 — 라벨이 "오늘의 완료(출석·학습)" 하루 1회였는데
--   이제 **완료 1건당** 이고 하루 최대 2회다. 값(10)은 그대로. 한 줄로 두는 이유: 출석과 퀴즈에 다른 금액을
--   줄 이유가 아직 없고(지시 = 각각 10), 줄을 둘로 가르면 `loadCoinDaily` 를 종류별 조회로 바꾸고 폴백도
--   두 벌이 된다. 다르게 주고 싶어지면 그때 가를 것.
--
--   배포: 이 마이그레이션 + `npx.cmd supabase functions deploy complete-daily`(플래그 없이) + 프론트 push.
--   함수는 RPC 결과를 그대로 넘기므로 순서는 무관하다(SQL 만 바뀌어도 새 규칙이 곧바로 적용된다).
--   검증: tests/db/t-complete-daily.mjs (⭐같은 날 학습 = 코인 +10 · 도장 불변).

begin;

create or replace function complete_daily_kind(p_uid uuid, p_points int, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_kind text := case when p_kind = 'daily_learn' then 'daily_learn' else 'attendance' end;
  v_att boolean;
  v_lrn boolean;
  v_kind_first boolean; -- 이 종류가 오늘 처음인가 → 코인은 이걸로 준다(종류별 하루 1회)
  v_stamp boolean;      -- 오늘 첫 출석인가 → 도장은 이걸로만 찍는다(출석 도장은 출석에만 붙는다 · 퀴즈는 안 찍음)
  v_cycle int;          -- 이번 적립 뒤 사이클 위치(1..7). 도장이 안 찍힌 호출이면 null.
  v_bonus int := 0;     -- 7일 완주 보너스 코인
  c_cycle_len constant int := 7;
  c_cycle_bonus constant int := 20;  -- ⚠️ 뽑기 1회분(get-hub ECON.drawCost)과 같은 값으로 정한 것
begin
  -- (1) 오늘 행 확보(레벨테스트·미니게임이 이미 만들어 뒀을 수 있다) 후 FOR UPDATE 로 잠근다.
  --     동시 호출은 여기서 직렬화되므로 아래 판정/적립이 원자적이다.
  insert into daily_activity (user_id, day) values (p_uid, v_day)
    on conflict (user_id, day) do nothing;
  select did_attendance, did_learn into v_att, v_lrn
    from daily_activity where user_id = p_uid and day = v_day for update;

  v_kind_first := case when v_kind = 'daily_learn' then not v_lrn else not v_att end;
  v_stamp := (v_kind = 'attendance') and not v_att;

  -- (2) 종류 플래그 세팅(멱등).
  update daily_activity
     set did_attendance = did_attendance or (v_kind = 'attendance'),
         did_learn      = did_learn      or (v_kind = 'daily_learn')
   where user_id = p_uid and day = v_day;

  -- (3) 출석 도장 — 오늘 첫 출석에만. 7일 사이클과 완주 보너스는 여기서만 정해진다(퀴즈는 여기 안 들어온다).
  if v_stamp then
    -- ⚠️ 7 을 찍은 그 자리에서 0 으로 접지 않는다. 그러면 7일째 출석한 사람이 꽉 찬 판을 못 보고
    --    바로 빈 판을 본다. 다음 출석에서 1 로 넘어가며 새 사이클이 열린다.
    select count into v_cycle
      from user_stamps where user_id = p_uid and stamp_kind = 'daily' for update;
    v_cycle := case when coalesce(v_cycle, 0) >= c_cycle_len then 1 else coalesce(v_cycle, 0) + 1 end;

    insert into user_stamps (user_id, stamp_kind, count) values (p_uid, 'daily', v_cycle)
      on conflict (user_id, stamp_kind) do update
        set count = v_cycle, updated_at = now();

    -- 총 누적 출석일 — 사이클 리셋과 무관하게 계속 쌓인다.
    insert into user_stamps (user_id, stamp_kind, count) values (p_uid, 'daily_total', 1)
      on conflict (user_id, stamp_kind) do update
        set count = user_stamps.count + 1, updated_at = now();

    if v_cycle = c_cycle_len then v_bonus := c_cycle_bonus; end if;
  end if;

  -- (4) 코인 — 종류별 하루 1회. 절대값이 아니라 원자 증분. 완주 보너스는 도장이 찍힌 호출(첫 출석)에 얹힌다.
  if v_kind_first then
    insert into user_currency (user_id, points) values (p_uid, p_points + v_bonus)
      on conflict (user_id) do update
        set points = user_currency.points + p_points + v_bonus, updated_at = now();
  end if;

  return jsonb_build_object(
    'ok', true, 'day', v_day, 'kind', v_kind,
    'first', v_kind_first,      -- 이 호출로 코인이 나갔는가(클라 보상 연출 조건)
    'kind_first', v_kind_first, -- 이 종류를 오늘 처음 완료했는가(= first, 옛 호환)
    'stamps', v_cycle,          -- 도장이 찍힌 호출에만 사이클 위치(1..7), 아니면 null
    'bonus', v_bonus            -- 7일 완주 보너스 코인(0 이면 없음)
  );
end
$$;

revoke all on function complete_daily_kind(uuid, int, text) from public, anon, authenticated;
grant execute on function complete_daily_kind(uuid, int, text) to service_role;

-- 적립 정책 표 — 관리자 화면이 이 라벨을 그대로 보여주므로 규칙과 같은 말을 해야 한다. 값(10)은 그대로.
update reward_policy
   set label = '출석 · DAILY QUIZ 완료 (건당)',
       per_day = 2,
       updated_at = now()
 where wallet = 'coin' and kind = 'daily_complete';

commit;
