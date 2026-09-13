$ErrorActionPreference = "Stop"

$root = "D:\fresh-wise-bytebite-tm05"
$baseApk = Join-Path $root "artifacts\WasteWise-FreshWise-API-v1.4.0-railway-base.apk"
$bundle = Join-Path $root "artifacts\railway_bundle_patch\index.android.bundle"
$work = Join-Path $root "artifacts\apk_patch_work"
$unsignedApk = Join-Path $root "artifacts\FreshWise-Railway-AI-v20260913-unsigned.apk"
$alignedApk = Join-Path $root "artifacts\FreshWise-Railway-AI-v20260913-aligned.apk"
$finalApk = Join-Path $root "artifacts\FreshWise-Railway-AI-v20260913.apk"
$zipalign = "C:\Users\Administrator\.cache\wastewise-android\android-sdk\build-tools\36.0.0\zipalign.exe"
$apksigner = "C:\Users\Administrator\.cache\wastewise-android\android-sdk\build-tools\36.0.0\apksigner.bat"
$keystore = Join-Path $root "android\app\debug.keystore"
$jdkRoot = "C:\Users\Administrator\.cache\wastewise-android\jdk-21-extracted\jdk-21.0.12.1+1"

if (-not (Test-Path -LiteralPath $baseApk)) { throw "Base APK not found: $baseApk" }
if (-not (Test-Path -LiteralPath $bundle)) { throw "Bundle not found: $bundle" }
if (-not (Test-Path -LiteralPath $zipalign)) { throw "zipalign not found: $zipalign" }
if (-not (Test-Path -LiteralPath $apksigner)) { throw "apksigner not found: $apksigner" }
if (-not (Test-Path -LiteralPath $keystore)) { throw "debug keystore not found: $keystore" }

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $unsignedApk, $alignedApk, $finalApk -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $work -Force | Out-Null

tar -xf $baseApk -C $work
Copy-Item -LiteralPath $bundle -Destination (Join-Path $work "assets\index.android.bundle") -Force
Remove-Item -LiteralPath (Join-Path $work "META-INF") -Recurse -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $work,
  $unsignedApk,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

& $zipalign -p -f 4 $unsignedApk $alignedApk

$env:JAVA_HOME = $jdkRoot
$env:Path = "$jdkRoot\bin;$env:Path"
& $apksigner sign `
  --ks $keystore `
  --ks-key-alias androiddebugkey `
  --ks-pass pass:android `
  --key-pass pass:android `
  --out $finalApk `
  $alignedApk
& $apksigner verify --verbose $finalApk

Get-Item -LiteralPath $finalApk | Select-Object FullName, Length, LastWriteTime
