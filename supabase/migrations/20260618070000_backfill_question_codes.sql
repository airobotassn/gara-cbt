-- 기존(code=null) 문항에 사람용 번호 L{레벨}-{NNN} 일괄 부여 (일회성 보정).
--  - 레벨별로 생성순(created_at, id)으로 001 부터 매김.
--  - 이미 번호가 있는 문항이 있으면 그 레벨 최대 번호 다음부터 이어붙임(중복 방지).
--  - 앞으로의 신규/업로드 문항은 admin 함수 upsert 가 자동 부여하므로, 이 마이그레이션은 한 번만 의미 있음.

with existing_max as (
  select level,
         coalesce(max((regexp_match(code, '-(\d+)\s*$'))[1]::int), 0) as maxn
  from questions
  where code is not null
  group by level
),
to_fill as (
  select q.id, q.level,
         row_number() over (partition by q.level order by q.created_at, q.id) as rn
  from questions q
  where q.code is null
)
update questions q
set code = 'L' || q.level || '-' || lpad((coalesce(em.maxn, 0) + tf.rn)::text, 3, '0')
from to_fill tf
left join existing_max em on em.level = tf.level
where q.id = tf.id;
