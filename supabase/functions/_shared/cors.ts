// ⚠️ **커스텀 헤더를 새로 쓰기 시작하면 반드시 여기에 추가할 것.** 빠지면 브라우저가 프리플라이트에서
//    막아 화면에는 원인 없는 "Failed to fetch" 만 뜬다. 서버(curl·node)로 부르면 프리플라이트를 안 타서
//    테스트가 전부 통과하므로 **실제 브라우저에서만 드러난다**(2026-08-10 x-exam-token 에서 겪음).
//    지금 쓰는 커스텀 헤더: x-exam-token(SEB 시험 전용 토큰) · x-reconcile-key(결제 대사) · x-passcode(KB)
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-exam-token, x-reconcile-key, x-passcode',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
