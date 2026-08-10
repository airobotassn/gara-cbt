import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Headless Chrome 화면 검수용 임시 프로필은 잠긴 DB 파일을 포함한다.
      // Vite가 Cookies-journal 등을 감시하면 Windows에서 EBUSY로 종료된다.
      ignored: ['**/.chrome-*/**'],
    },
  },
})

// ⚠️ dev 서버 파일 감시에 대해 (2026-08-07)
//   이 저장소는 윈도우 파일시스템(C:\...)에 있다. dev 서버를 **WSL 에서** 띄우면 /mnt/c 를 보는
//   drvfs 가 inotify 이벤트를 만들지 않아 워처가 .tsx 변경을 하나도 못 듣는다 → HMR 이 안 돌고
//   서버가 기동 시점의 변환 결과를 계속 내줘서, 고칠 때마다 재시작해야 하는 상태가 된다.
//   (CSS 는 갱신된다 — @import 로 묶인 index.css 가 따로 갱신을 탄다. "HMR 로그는 뜨는데 화면만
//    그대로" 면 거의 이 문제다.)
//
//   ⛔ 해법으로 `server.watch.usePolling` 을 켜지 말 것. 실제로 넣어봤다가 되돌렸다 —
//      폴링이 /mnt/c 위의 node_modules 까지 훑느라 vite 프로세스가 CPU 40%+ 를 먹고,
//      포트만 잡힌 채 응답을 못 해서 **서버가 아예 안 뜨는 것처럼 보인다.**
//
//   → 해결책은 설정이 아니라 **어디서 띄우느냐**다. 윈도우(PowerShell)에서 `npm run dev` 하면
//     네이티브 감시라 그냥 동작한다. 저장소를 WSL 쪽(~/)으로 옮겨도 해결된다.
