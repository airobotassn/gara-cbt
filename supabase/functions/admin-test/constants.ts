// 루트 관리자: 삭제 불가, 유일하게 다른 관리자를 추가/삭제할 수 있음.
export const ROOT_ADMIN = (Deno.env.get('ROOT_ADMIN') ?? 'airobotassn@gmail.com').trim().toLowerCase()
