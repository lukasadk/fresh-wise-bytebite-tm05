param(
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$AndroidSdkRoot = $env:ANDROID_SDK_ROOT,
  [ValidateSet("Debug", "Release")]
  [string]$Variant = "Debug",
  [ValidateRange(1, 32)]
  [int]$MaxWorkers = 1
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot "android"
$toolchainRoot = Join-Path $env:USERPROFILE ".cache\wastewise-android"

function Read-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $escapedName = [Regex]::Escape($Name)
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*$escapedName\s*=\s*(.*?)\s*$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($JavaHome)) {
  $JavaHome = Get-ChildItem $toolchainRoot -Directory -Filter "jdk-17*" |
    Sort-Object Name -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

if ([string]::IsNullOrWhiteSpace($AndroidSdkRoot)) {
  $AndroidSdkRoot = Join-Path $toolchainRoot "android-sdk"
}

if (-not (Test-Path (Join-Path $JavaHome "bin\java.exe"))) {
  throw "JDK 17 was not found at: $JavaHome"
}

if (-not (Test-Path (Join-Path $AndroidSdkRoot "platform-tools"))) {
  throw "Android SDK was not found at: $AndroidSdkRoot"
}

# Java's Windows NIO selector creates an AF_UNIX wakeup socket below TEMP.
# Keep this path deliberately short or Gradle can fail before evaluating the
# project with "Unable to establish loopback connection".
$temporaryRoot = Join-Path $env:SystemDrive "wwtmp"
New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdkRoot
$env:ANDROID_SDK_ROOT = $AndroidSdkRoot
$env:TEMP = $temporaryRoot
$env:TMP = $temporaryRoot
$env:NODE_ENV = if ($Variant -eq "Release") { "production" } else { "development" }

$dotEnvPath = Join-Path $projectRoot ".env"
$effectiveApiBaseUrl = if (-not [string]::IsNullOrWhiteSpace($env:EXPO_PUBLIC_API_BASE_URL)) {
  $env:EXPO_PUBLIC_API_BASE_URL
} else {
  Read-DotEnvValue $dotEnvPath "EXPO_PUBLIC_API_BASE_URL"
}
$effectiveApiKey = if (-not [string]::IsNullOrWhiteSpace($env:EXPO_PUBLIC_API_KEY)) {
  $env:EXPO_PUBLIC_API_KEY
} else {
  Read-DotEnvValue $dotEnvPath "EXPO_PUBLIC_API_KEY"
}
$apiKeyConfigured = -not [string]::IsNullOrWhiteSpace($effectiveApiKey)
if ($effectiveApiBaseUrl -match "freshwise-api-production\.up\.railway\.app" -and -not $apiKeyConfigured) {
  Write-Warning "The hosted inventory API requires EXPO_PUBLIC_API_KEY. This build can recognise photos, but confirmed items will receive HTTP 401 until .env is configured and the APK is rebuilt."
}

$gradleTask = ":app:assemble$Variant"
Push-Location $androidRoot
try {
  & .\gradlew.bat $gradleTask --no-daemon "--max-workers=$MaxWorkers"
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

$variantFolder = $Variant.ToLowerInvariant()
$apk = Get-ChildItem (Join-Path $androidRoot "app\build\outputs\apk\$variantFolder") -Filter "*.apk" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $apk) {
  throw "Gradle reported success but no $Variant APK was found."
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $apk.FullName
$modelAssetRoot = Join-Path $androidRoot "app\src\main\assets\wastewise-vlm"
$modelManifest = Get-ChildItem -LiteralPath $modelAssetRoot -Filter "manifest.json" -Recurse -File -ErrorAction SilentlyContinue |
  Select-Object -First 1
$modelBundled = $null -ne $modelManifest
[pscustomobject]@{
  path = $apk.FullName
  bytes = $apk.Length
  sha256 = $hash.Hash.ToLowerInvariant()
  variant = $Variant
  modelBundled = $modelBundled
  apiBaseUrl = $effectiveApiBaseUrl
  apiKeyConfigured = $apiKeyConfigured
  note = if ($modelBundled) {
    "An experimental model manifest is present; user confirmation remains mandatory and device acceptance is still required."
  } else {
    "The native shell intentionally remains fail-closed until an accepted MNN artifact is packaged."
  }
} | Format-List
