-- 전남·광주 통합 — 광주광역시(KR-29)가 전라남도(KR-46)에 흡수되어 '전남광주통합특별시'가 됐다.
--
-- ISO 3166-2:KR 에는 아직 통합 코드가 없어서 **살아남은 쪽 코드(KR-46)를 그대로 쓴다.**
-- 새 코드를 파면 지도 파일(kr-prov.json·adm1/KR.json)의 code 까지 우리만 아는 값이 되고,
-- 나중에 ISO 가 코드를 내면 두 번 옮겨야 한다.
--
-- ⛔ regions 를 먼저 지우면 안 된다 — profiles·ranking_dummies 가 FK 로 물고 있다.
--    참조하는 행을 KR-46 으로 옮긴 **뒤에** 마지막으로 regions 행을 지운다.
--
-- ⚠️ 적용 시점 실측(프로덕션): 실사용자 0명(profiles 에 KR-29·KR-46 을 고른 사람이 없다).
--    옮겨지는 건 더미·시드뿐이다 — ranking_dummies 10행 · 학교 3곳 · 아레나 시드 버킷 2개.
--    그래서 지금이 통합을 반영할 수 있는 가장 싼 시점이었다.

-- 1) 사용자·더미·학교의 지역을 옮긴다.
update profiles        set region_code = 'KR-46' where region_code = 'KR-29';
update ranking_dummies set region_code = 'KR-46' where region_code = 'KR-29';
update schools         set region_code = 'KR-46' where region_code = 'KR-29';

-- 2) 아레나 시드 버킷을 한 덩이로 합친다.
--    ⚠️ avg_level 은 **가중평균**이다 — 그냥 더하거나 큰 쪽을 남기면 통합시가 근거 없이
--       1위로 튀어오른다(두 버킷 다 62명이라 단순평균과 우연히 같지만, 인원이 갈리면 달라진다).
--    ⚠️ PK 가 (scope, code) 라 KR-29 행을 지우기 전에 KR-46 행을 먼저 키운다.
update arena_seed_buckets t
set member_count = t.member_count + s.member_count,
    active_today = t.active_today + s.active_today,
    avg_level    = case when (t.member_count + s.member_count) = 0 then t.avg_level
                        else round((t.avg_level * t.member_count + s.avg_level * s.member_count)
                                   / (t.member_count + s.member_count)) end
from arena_seed_buckets s
where t.scope = 'region' and t.code = 'KR-46'
  and s.scope = 'region' and s.code = 'KR-29';

delete from arena_seed_buckets where scope = 'region' and code = 'KR-29';

-- 3) 집계 테이블은 파생이라 지우고 다시 만든다(시드 + 실집계를 서버가 합친다).
delete from arena_bucket_scores where scope = 'region' and code = 'KR-29';
select refresh_arena_buckets();

-- 4) 마지막으로 지역 목록에서 뺀다. 여기까지 오면 참조가 없다.
delete from regions where code = 'KR-29';
