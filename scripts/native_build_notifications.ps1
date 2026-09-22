$ErrorActionPreference = 'Stop'

$logPath = 'D:\fresh-wise-bytebite-tm05\artifacts\native_build_notifications.out.log'
"native build started $(Get-Date -Format o)" | Set-Content -LiteralPath $logPath

Set-Location -LiteralPath 'D:\fresh-wise-bytebite-tm05\android'

$jdkRoot = 'C:\Users\Administrator\.cache\wastewise-android\jdk-17.0.20.1+1'
$nodeBin = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$npmBin = 'C:\Users\Administrator\AppData\Local\OpenAI\Codex\runtimes\cua_node\b58ca2eaa616c2da\bin'
$env:JAVA_HOME = $jdkRoot
$env:Path = "$jdkRoot\bin;$nodeBin;$npmBin;$env:Path"

if (Test-Path Env:\JAVA_TOOL_OPTIONS) {
  Remove-Item Env:\JAVA_TOOL_OPTIONS
}

cmd.exe /c ".\gradlew.bat :app:assembleDebug --stacktrace >> `"$logPath`" 2>&1"
"native build finished $(Get-Date -Format o) exit=$LASTEXITCODE" | Add-Content -LiteralPath $logPath
exit $LASTEXITCODE
