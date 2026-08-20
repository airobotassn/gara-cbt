# 엣지 번역 워커를 윈도우 작업 스케줄러에 등록한다 — 부팅하면 코드가 알아서 뜬다.
#
#   ⚠️ 사람이 브라우저를 켜지 않는다. 이 작업이 node 를 띄우고, node 가 Edge 를 띄운다.
#   ⚠️ 워커는 브라우저가 죽으면 스스로 종료한다(살아있는 척 헛도는 것보다 낫다).
#      그 자리를 이 등록의 재시작 설정이 메운다 — 1분 뒤 다시 띄우고, 하루 최대 999번.
#   ⚠️ 로그온 없이 돌리려면(-AsService) headless 라 화면이 필요 없다. 다만 그 계정으로
#      한 번은 언어팩을 받아둬야 한다 — 프로필 폴더가 계정별이기 때문이다.
#
# 사용:
#   .\install-windows.ps1 -SupabaseUrl https://xxx.supabase.co -AnonKey eyJ... -WorkerKey gara-worker-xxx
#   .\install-windows.ps1 -Uninstall

param(
  [string]$SupabaseUrl,
  [string]$AnonKey,
  [string]$WorkerKey,
  [string]$TaskName = 'GaraTranslateWorker',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "등록 해제: $TaskName"
  exit 0
}

if (-not $SupabaseUrl -or -not $AnonKey -or -not $WorkerKey) {
  Write-Error "SupabaseUrl / AnonKey / WorkerKey 가 모두 필요합니다."
}

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$node = (Get-Command node).Source
$script = Join-Path $PSScriptRoot 'worker.mjs'

if (-not (Test-Path $script)) { Write-Error "worker.mjs 를 못 찾았습니다: $script" }

# 환경변수는 작업에 직접 못 넣는다 → 래퍼 cmd 를 만들어 거기서 세팅한다.
#  ⚠️ 이 파일에 키가 평문으로 들어간다. 저장소 밖(%LOCALAPPDATA%)에 두는 이유다.
$wrapperDir = Join-Path $env:LOCALAPPDATA 'gara-translate-worker'
New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null
$wrapper = Join-Path $wrapperDir 'run.cmd'

@"
@echo off
set SUPABASE_URL=$SupabaseUrl
set SUPABASE_ANON_KEY=$AnonKey
set TRANSLATE_WORKER_KEY=$WorkerKey
cd /d "$repo"
"$node" "$script"
"@ | Set-Content -Path $wrapper -Encoding ascii

$action = New-ScheduledTaskAction -Execute $wrapper
$trigger = New-ScheduledTaskTrigger -AtLogOn
# 워커가 스스로 종료하면 여기서 다시 띄운다. 실행 시간 제한은 없앤다(상시 프로세스).
$settings = New-ScheduledTaskSettingsSet `
  -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "등록 완료: $TaskName"
Write-Host "  래퍼: $wrapper"
Write-Host "  지금 시작: Start-ScheduledTask -TaskName $TaskName"
Write-Host "  상태 보기: Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "  해제:     .\install-windows.ps1 -Uninstall"
