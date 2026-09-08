import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // DAILY QUIZ 해설 그림 묶음 — 파일마다 **그림 여러 장 + 등록표(Record) 하나**를 내보낸다.
    // react-refresh 규칙은 "컴포넌트만 내보내는 파일"을 기대하므로 등록표 때문에 그림마다 오류를 낸다.
    // 등록표를 파일 밖으로 빼면 묶음이 32개가 되고(그림 파일 + 등록 파일), 얻는 건 개발 중 새로고침뿐이라
    // 이 폴더에서만 규칙을 끈다. ⚠️ 다른 화면 파일에는 켜 둔 채로 둘 것.
    files: ['src/components/dailyVisuals/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
