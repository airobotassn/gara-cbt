# 엣지 번역 워커를 윈도우에 등록한다 — 로그온하면 코드가 알아서 뜬다.
#
#   ⚠️ 사람이 브라우저를 켜지 않는다. 이 등록이 node 를 띄우고, node 가 Edge 를 띄운다.
#   ⚠️ 워커는 브라우저가 죽으면 스스로 종료한다(살아있는 척 헛도는 것보다 낫다).
#      그 자리를 **래퍼의 재시작 루프**가 메운다 — node 가 끝나면 5초 뒤 다시 띄운다.
#
#   등록 방식이 둘이고 자동으로 고른다:
#     · 작업 스케줄러 — 관리자 권한이 있을 때. 상태 조회·중지가 깔끔하다.
#     · 시작프로그램 폴더 — 권한이 없을 때(기본). ⚠️ Register-ScheduledTask 는 일반 사용자에게
#       Access denied 라 이 폴백이 사실상 기본 경로다.
#   재시작은 어느 쪽이든 래퍼 루프가 하므로 동작 차이가 없다.
#
# 사용:
#   .\install-windows.ps1 -SupabaseUrl https://xxx.supabase.co -AnonKey eyJ... -WorkerKey gara-worker-xxx
#   .\install-windows.ps1 -Uninstall

param(
  [string]$SupabaseUrl,
  [string]$AnonKey,
  [string]$WorkerKey,
  # Which browser translates. Default is Edge Dev, NOT Edge Stable - see README
  # ("Edge Stable cannot fetch the translation engine", 2026-08-27).
  [string]$Channel = 'msedge-dev',
  [string]$TaskName = 'GaraTranslateWorker',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$wrapperDir = Join-Path $env:LOCALAPPDATA 'gara-translate-worker'
$wrapper    = Join-Path $wrapperDir 'run.cmd'
$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) "$TaskName.lnk"

if ($Uninstall) {
  try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop; Write-Host "작업 스케줄러 등록 해제" } catch { }
  if (Test-Path $startupLnk) { Remove-Item $startupLnk -Force; Write-Host "시작프로그램 등록 해제" }
  Write-Host "해제 완료. 돌고 있는 프로세스는 따로 종료하세요."
  exit 0
}

if (-not $SupabaseUrl -or -not $AnonKey -or -not $WorkerKey) {
  Write-Error "SupabaseUrl / AnonKey / WorkerKey 가 모두 필요합니다."
}

$repo   = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$node   = (Get-Command node).Source
$script = Join-Path $PSScriptRoot 'worker.mjs'
if (-not (Test-Path $script)) { Write-Error "worker.mjs 를 못 찾았습니다: $script" }

New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null

# 래퍼 = 환경변수 세팅 + **재시작 루프**.
#  ⚠️ 이 파일에 키가 평문으로 들어간다. 저장소 밖(%LOCALAPPDATA%)에 두는 이유다.
#  ⚠️ 루프가 없으면 브라우저가 한 번 죽는 순간 번역이 영영 멈춘다(워커는 일부러 종료한다).
@"
@echo off
set SUPABASE_URL=$SupabaseUrl
set SUPABASE_ANON_KEY=$AnonKey
set TRANSLATE_WORKER_KEY=$WorkerKey
set TRANSLATE_CHANNEL=$Channel
cd /d "$repo"
set LOG=%~dp0worker.log
:loop
echo [%date% %time%] --- start --- >> "%LOG%"
"$node" "$script" >> "%LOG%" 2>&1
rem 워커가 끝났다(브라우저 사망·크래시). 5초 쉬고 다시 띄운다.
echo [%date% %time%] --- exited, restarting in 5s --- >> "%LOG%"
timeout /t 5 /nobreak >nul
goto loop
"@ | Set-Content -Path $wrapper -Encoding ascii

# ① 작업 스케줄러 시도(관리자면 성공)
$registered = $false
try {
  $action   = New-ScheduledTaskAction -Execute $wrapper
  $trigger  = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
                -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
  $registered = $true
  Write-Host "등록 완료(작업 스케줄러): $TaskName"
  Write-Host "  지금 시작: Start-ScheduledTask -TaskName $TaskName"
} catch {
  Write-Host "작업 스케줄러 등록 불가(관리자 권한 없음) → 시작프로그램 폴더로 등록합니다."
}

# ② 폴백: 시작프로그램 폴더 바로가기(권한 불필요)
if (-not $registered) {
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut($startupLnk)
  $lnk.TargetPath = $wrapper
  $lnk.WorkingDirectory = $repo
  # 창을 띄우지 않는다(워커 자체가 headless 라 볼 것도 없다)
  $lnk.WindowStyle = 7
  $lnk.Description = 'GARA 채팅 번역 워커'
  $lnk.Save()
  Write-Host "등록 완료(시작프로그램): $startupLnk"
  Write-Host "  지금 시작: Start-Process -FilePath '$wrapper' -WindowStyle Hidden"
}

Write-Host "  래퍼: $wrapper"
Write-Host "  로그: $(Join-Path $wrapperDir 'worker.log')"
Write-Host "  해제: .\install-windows.ps1 -Uninstall"
