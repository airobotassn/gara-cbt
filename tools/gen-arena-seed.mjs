/**
 * 아레나 시드(더미) 버킷 생성기 — `supabase/migrations/20260818140100_arena_seed_data.sql` 을 만든다.
 *
 * 왜 생성기인가: 시드는 3,700행쯤 되고(국가 177 + 대한민국 시도 17 + 해외 1차행정구역 3,500),
 * 값의 근거가 전부 `public/geo/*.json` 안에 있다(국가 목록·행정구역 목록·`ord` 데모 순위).
 * 손으로 옮겨 적으면 지도를 갈 때마다 어긋나므로, **지도에서 뽑아 SQL 을 찍어낸다.**
 *
 * 실행: node tools/gen-arena-seed.mjs
 *
 * ⚠️ 이 값들은 전부 **데모용 임시값**이다. AI 활용능력 실측이 아니라 화면이 자연스러워 보이라고
 *    손으로 매긴 순서다. 실회원이 쌓이면 `refresh_arena_buckets()` 가 가중평균으로 섞고,
 *    걷어낼 땐 `delete from arena_seed_buckets` 한 줄이다.
 *
 * ⚠️ **member_count 는 장식이 아니라 안정성 손잡이다.**
 *    점수가 베이지안 보정(K=25)을 타므로 인원이 작은 버킷일수록 전체 평균 쪽으로 끌려간다.
 *    인원을 제각각으로 주면 하위권 소국이 위로 끌려 올라가 중위권을 앞지른다(실제로 계산해보면
 *    N=300·평균 255 가 N=5000·평균 270 을 이긴다). 그래서 **모든 시드에 5,000 이상**을 주고
 *    점수에 비례해 키운다 — 그러면 보정이 0.5% 아래라 순위 = 점수 순서 그대로다.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { feature } from 'topojson-client'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'))

// ── M49(world.json feature id) → alpha-2. src/lib/arena/tables.ts 와 같은 표를 그 파일에서 읽는다
//    (여기에 복사해 두면 두 벌이 되고, 지도를 갈 때 한쪽만 갱신된다).
const tablesSrc = readFileSync(resolve(root, 'src/lib/arena/tables.ts'), 'utf8')
const pickTable = (name) => {
  const m = tablesSrc.match(new RegExp(`export const ${name}[^=]*=\\s*(\\{.*?\\})\\n`, 's'))
  if (!m) throw new Error(`${name} 를 tables.ts 에서 못 찾았다`)
  return JSON.parse(m[1])
}
const M49_TO_ISO2 = pickTable('M49_TO_ISO2')
const PROV_TO_ISO = pickTable('PROV_TO_ISO')

// ── 데모 국가 순위 ────────────────────────────────────────────
// 주요국 ~41개를 그럴듯한 순서로 박고, 나머지 소국은 아래 해시로 꼬리만 채운다.
// 해시 난수만 쓰면 지구본 1위가 말라위·소말리아로 잡혀 랭킹이 설득력을 잃는다.
//
// ⚠️ 대한민국(2550)은 3위 인도(2600) 바로 아래에 붙였다 — 5위 영국(2100)과 450점 벌려 두려는 값이다.
//    예전 값 2292 는 영국과 192점 차이라 실회원이 조금만 들어와도 4위에서 밀렸다(그래서 15위였다).
//    위로는 절대 못 올라간다 — 실회원 평균이 시드보다 낮아 합쳐진 값은 내려가기만 한다.
const COUNTRY_SCORE = {
  US: 3200, CN: 2900, IN: 2600, KR: 2550, GB: 2100, ES: 1980, AE: 1880, JP: 1780,
  CA: 1680, IL: 1600, DE: 1560, FR: 1500, IT: 1440, NL: 1390, SE: 1340, CH: 1300,
  FI: 1250, AU: 1200, BR: 1150, RU: 1100, PL: 1050, TR: 1000, SA: 960, IE: 920,
  NO: 880, DK: 840, AT: 800, BE: 760, PT: 720, MX: 680, ID: 640, VN: 600,
  TH: 560, EG: 520, NG: 480, AR: 440, ZA: 400, UA: 360, MY: 320, PH: 290, NZ: 270,
}
/** 고정표에 없는 소국이 받을 상한 — 위 최저(뉴질랜드 270) 아래로 눌러 주요국 순위를 안 깨뜨린다. */
const REST_MAX = 255

// 지역 코드 해시 — 새로고침해도, 다시 생성해도 같은 값이 나오게 한다(기존 프론트 목값과 같은 함수).
const h32 = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
const hashScore = (k, max) => Math.round((h32('s' + k) % (max * 100)) / 100)

/**
 * 점수 → 가상 회원 수. 5,000 바닥 + 점수 비례(위 주석의 이유).
 * 상위권일수록 사람이 많은 그림이라 화면에 뜨는 "참가자 N명"도 자연스럽다.
 */
const membersFor = (score) => 5000 + Math.round(score * 8)
/** 오늘 활동 — 참여율 8% 언저리. 일간창(daily) 점수가 0으로 죽지 않게 하는 값이다. */
const activeFor = (members, key) => Math.round(members * (0.06 + (h32('a' + key) % 40) / 1000))

/**
 * 나라 인원을 그 나라 지역들에 **똑같이** 나눈다.
 *
 * ⚠️ **지역 인원을 점수로 따로 환산하면 안 된다.** 그러면 주(州) 하나가 나라 전체보다 사람이 많아진다
 *    (미국 34,440명 vs 미국 30,600명 — 처음에 실제로 그렇게 나왔다). 파고들었을 때 숫자가 어긋나 보인다.
 *
 * ⚠️ **점수 비율로 쪼개는 것도 안 된다 — 나라 안 순서가 뒤집힌다.**
 *    베이지안 보정이 `(N·s + K·G) / (N + K)` 라 N 이 작을수록 전체 평균 G 쪽으로 세게 끌려간다.
 *    지역은 인원이 수백 명이라 국가(수만 명)보다 보정이 15배쯤 강하게 걸리는데, 꼬리 국가는
 *    점수가 20~40 이고 지역 평균 G 는 600 이라 **점수가 낮아 인원까지 적은 지역이 더 크게 끌려 올라가**
 *    1등을 먹는다(체코·에스토니아 등 17개국에서 실제로 뒤집혔다).
 *    인원을 고르게 두면 분모가 상수가 되어 보정이 점수 순서를 절대 못 흔든다 — 그게 이 함수다.
 *
 * ⚠️ 바닥 120명은 지역이 아주 많은 나라(우간다 111, 북마케도니아 84 …)에서 "👥 55명" 같은 값이
 *    안 나오게 하는 값이다. 이때만 지역 합이 나라 인원을 넘는데, 순서에는 영향이 없다.
 */
const splitMembers = (total, scores) => {
  const each = Math.max(120, Math.round(total / Math.max(1, scores.length)))
  return scores.map(() => each)
}

const rows = []
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const push = (scope, code, countryCode, members, avg, active, label, note) =>
  rows.push(`  (${q(scope)}, ${q(code)}, ${q(countryCode)}, ${members}, ${avg}, ${active}, ${q(label)}, ${q(note)})`)

// ── 국가 ─────────────────────────────────────────────────────
const worldTopo = readJson('public/geo/world.json')
const countries = feature(worldTopo, worldTopo.objects.countries).features.filter(
  (f) => f.properties.name !== 'Antarctica',
)
let skipped = 0
for (const f of countries) {
  const iso = M49_TO_ISO2[String(f.id)]
  // alpha-2 를 모르면 실집계와 맞물릴 수 없다(실집계 키가 profiles.country_code = alpha-2).
  // world.json 에 id 없는 미승인 국가 3개(북키프로스·소말릴란드·코소보)가 여기 걸린다.
  if (!iso) { skipped++; continue }
  const score = COUNTRY_SCORE[iso] ?? hashScore('C' + f.id, REST_MAX)
  const members = membersFor(score)
  push('country', iso, null, members, score, activeFor(members, iso), null, f.properties.name ?? null)
}

// ── 대한민국 시도 ────────────────────────────────────────────
// 경기·서울·부산은 지정값이고 그 아래는 인구순. 코드는 kr-prov.json 기준이며 실집계와 맞물리는
// region_code(ISO 3166-2)로 바꿔 넣는다.
//
// ⚠️ 예전 프론트 목값은 지역만 0~255 스케일이었다(국가는 0~10000). 그래서 실집계가 붙은 시도 하나가
//    나머지 전부를 압도했다. 여기서는 **국가와 같은 season_total 스케일**로 통일한다.
const KR_PROV_ORDER = ['31', '11', '21', '38', '23', '37', '22', '34', '36', '35', '33', '32', '25', '24', '26', '39', '29']
// 1위 3190(대한민국 2550 의 125%) → 17위 1912(75%) 균등 하강. 해외 adm1 과 같은 규칙이라
// 파고들었을 때 나라 평균이 지역들 가운데에 온다. 같은 등수가 없으니 동점도 없다.
const KR_SCORES = KR_PROV_ORDER.map((_, i) =>
  Math.round(COUNTRY_SCORE.KR * (1.25 - (0.5 * i) / (KR_PROV_ORDER.length - 1))),
)
const KR_MEMBERS = splitMembers(membersFor(COUNTRY_SCORE.KR), KR_SCORES)
KR_PROV_ORDER.forEach((prov, i) => {
  const iso = PROV_TO_ISO[prov]
  if (!iso) return
  push('region', iso, 'KR', KR_MEMBERS[i], KR_SCORES[i], activeFor(KR_MEMBERS[i], iso), null, `KR prov ${prov} #${i + 1}`)
})

// ── 해외 1차 행정구역 ────────────────────────────────────────
// 순위는 지도 파일에 빌드 때 박아 둔 `ord`(수도 1위 → 그 지역 도시 인구 합 순)를 그대로 쓴다.
// 점수는 **그 나라 점수 언저리**로 만든다 — 나라와 무관한 절대 스케일을 쓰면 미국의 주가
// 인도의 주보다 낮게 나오는 그림이 된다.
const adm1Dir = resolve(root, 'public/geo/adm1')
let regionCount = 0
for (const file of readdirSync(adm1Dir)) {
  const iso = file.replace(/\.json$/, '')
  if (!/^[A-Z]{2}$/.test(iso)) continue        // '-1.json' 같은 미승인/미상 국가 파일은 건너뛴다
  if (iso === 'KR') continue                   // 대한민국은 위 kr-prov 표가 단일 출처
  const base = COUNTRY_SCORE[iso] ?? hashScore('C-adm1' + iso, REST_MAX)
  const topo = readJson(`public/geo/adm1/${file}`)
  const feats = feature(topo, topo.objects[Object.keys(topo.objects)[0]]).features
  const n = feats.length
  // ⚠️ **코드 중복을 접어야 한다.** Natural Earth 는 한 행정구역을 여러 피처로 쪼개 두기도 해서
  //    같은 code 가 두 번 나온다(호주 AU-NSW, 아일랜드 IE-CO, 스페인 ES.CE 등 25건).
  //    안 접으면 (scope, code) PK 에 걸려 시드 insert 가 통째로 죽는다. 순위는 더 앞선 ord 를 쓴다.
  //    화면에서는 두 피처가 같은 버킷을 조회하므로 같은 색·같은 점수로 칠해진다(같은 지역이니 맞다).
  const byCode = new Map()
  for (const f of feats) {
    const code = f.properties.code
    if (!code) continue
    const ord = f.properties.ord ?? n
    const prev = byCode.get(code)
    if (!prev || ord < prev.ord) byCode.set(code, { code, ord })
  }
  const ordered = [...byCode.values()].sort((a, b) => a.ord - b.ord)
  // 1위가 나라 점수의 125%, 꼴찌가 75% — 나라 평균을 가운데 두고 갈린다.
  // 나라끼리의 순서는 안 흔든다(지역 목록은 언제나 한 나라 안에서만 줄을 선다).
  const scores = ordered.map((_, i) =>
    Math.max(1, Math.round(base * (ordered.length <= 1 ? 1 : 1.25 - (0.5 * i) / (ordered.length - 1)))),
  )
  const members = splitMembers(membersFor(base), scores)
  ordered.forEach((r, i) => {
    push('region', r.code, iso, members[i], scores[i], activeFor(members[i], r.code), null, `${iso} adm1 #${i + 1}`)
    regionCount++
  })
}

const sql = `-- ⚠️ 생성물이다 — 손으로 고치지 말고 \`node tools/gen-arena-seed.mjs\` 를 다시 돌릴 것.
--
-- 아레나 시드(더미) 버킷. 실데이터가 아니라 "이미 있던 가상 회원"이고,
-- refresh_arena_buckets() 가 실집계와 가중평균으로 섞는다(20260818140000).
-- 걷어낼 땐 \`delete from arena_seed_buckets;\` + \`select refresh_arena_buckets();\` 두 줄이다.
--
-- 국가 ${countries.length - skipped}개(alpha-2 미상 ${skipped}개 제외) · 대한민국 시도 ${KR_PROV_ORDER.length}개 · 해외 1차행정구역 ${regionCount}개.

insert into arena_seed_buckets (scope, code, country_code, member_count, avg_level, active_today, label, note) values
${rows.join(',\n')}
on conflict (scope, code) do update set
  country_code = excluded.country_code,
  member_count = excluded.member_count,
  avg_level    = excluded.avg_level,
  active_today = excluded.active_today,
  label        = excluded.label,
  note         = excluded.note;

-- 넣자마자 스냅샷을 채운다 — 안 하면 크론이 처음 도는 5분 동안 지구본이 캄캄하다.
select public.refresh_arena_buckets();
`

const out = 'supabase/migrations/20260818140100_arena_seed_data.sql'
writeFileSync(resolve(root, out), sql)
console.log(`${out}: ${rows.length} rows (국가 ${countries.length - skipped} / 시도 ${KR_PROV_ORDER.length} / 해외 adm1 ${regionCount}, alpha-2 미상 ${skipped}개 제외)`)
