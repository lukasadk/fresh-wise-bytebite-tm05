$ErrorActionPreference = "Stop"
$out = "D:\fresh-wise-bytebite-tm05\artifacts\railway_bundle_patch"
Remove-Item -LiteralPath $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $out -Force | Out-Null
$env:EXPO_PUBLIC_API_BASE_URL = "https://wastewise-ai-api-production.up.railway.app"
$env:EXPO_PUBLIC_API_KEY = ""
$env:EXPO_PUBLIC_GROCERY_AI_API_URL = "https://wastewise-ai-api-production.up.railway.app"
$env:EXPO_PUBLIC_GROCERY_AI_SERVICE_KEY = ""
Set-Location -LiteralPath "D:\fresh-wise-bytebite-tm05"
pnpm exec expo export:embed `
  --platform android `
  --dev false `
  --minify true `
  --entry-file node_modules/expo/AppEntry.js `
  --bundle-output "$out\index.android.bundle" `
  --assets-dest "$out\assets" `
  --reset-cache
