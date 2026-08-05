// admin-test: CARIS ARENA 전용 백오피스 API (service role). 액션 라우터 → handlers/* 로 위임.
//  - gara-cbt(CARIS CBT) 로 이관된 CARIS ARENA 관리 함수. CBT admin 함수와 별개.
//  - CARIS ARENA 테이블: questions→test_questions, attempt_answers→test_answers (이관 시 개명).
//  - 인증: 루트(ROOT_ADMIN) 또는 admin_users 테이블 등록 이메일만 통과
//  - _shared 사용 + 멀티파일 → CLI 로만 배포할 것
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/scoring.ts'
import { ROOT_ADMIN } from './constants.ts'
import { listQuestions, statsQuestions, upsertQuestions, setActive, deleteQuestion, restoreQuestion, listEvents, listRestorable } from './handlers/questions.ts'
import { overview, analytics } from './handlers/analytics.ts'
import { listUsers, userDetail, setRank } from './handlers/users.ts'
import { listAttempts, attemptDetail } from './handlers/attempts.ts'
import { manageAdmins } from './handlers/admins.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    const email = (user?.email ?? '').toLowerCase()
    const admin = adminClient()
    const isRoot = !!email && email === ROOT_ADMIN
    let isAdmin = isRoot
    if (user && !isAdmin) {
      // admin_users 테이블에 등록된 이메일이면 관리자 (테이블 없으면 무시 → 루트만 통과)
      const { data } = await admin.from('admin_users').select('email').eq('email', email).maybeSingle()
      isAdmin = !!data
    }
    if (!isAdmin) return json({ error: '관리자 전용입니다.' }, 403)

    const body = await req.json()
    const action = body?.action

    switch (action) {
      case 'me': return json({ isAdmin: true, isRoot, email })
      case 'admins':
      case 'addAdmin':
      case 'removeAdmin': return await manageAdmins(admin, body, action, email, isRoot)
      case 'list': return await listQuestions(admin, body)
      case 'stats': return await statsQuestions(admin)
      case 'upsert': return await upsertQuestions(admin, body, email)
      case 'setActive': return await setActive(admin, body, email)
      case 'delete': return await deleteQuestion(admin, body, email)
      case 'restore': return await restoreQuestion(admin, body, email)
      case 'events': return await listEvents(admin, body)
      case 'restorable': return await listRestorable(admin)
      case 'overview': return await overview(admin)
      case 'analytics': return await analytics(admin)
      case 'users': return await listUsers(admin)
      case 'userDetail': return await userDetail(admin, body)
      case 'setRank': return await setRank(admin, body)
      case 'attempts': return await listAttempts(admin)
      case 'attemptDetail': return await attemptDetail(admin, body)
      default: return json({ error: '알 수 없는 action' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
