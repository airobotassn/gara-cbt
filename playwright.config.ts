import { defineConfig, devices } from '@playwright/test'

// 모바일 반응형 검증 전용 설정 — vite dev 서버를 자동 기동해 폭 매트릭스로 테스트한다.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
