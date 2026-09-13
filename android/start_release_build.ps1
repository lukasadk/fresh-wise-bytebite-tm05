$ErrorActionPreference = "Stop"
$stdout = "D:\fresh-wise-bytebite-tm05\android\build-railway.stdout.log"
$stderr = "D:\fresh-wise-bytebite-tm05\android\build-railway.stderr.log"
Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
$process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "D:\fresh-wise-bytebite-tm05\android\build_release_railway.ps1"
  ) `
  -WorkingDirectory "D:\fresh-wise-bytebite-tm05\android" `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr
$process.Id
