$ErrorActionPreference = "Stop"
$apk = "D:\fresh-wise-bytebite-tm05\artifacts\FreshWise-Railway-AI-v20260913.apk"
$tmp = "D:\fresh-wise-bytebite-tm05\artifacts\apk_verify_extract"
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
tar -xf $apk -C $tmp assets/index.android.bundle
rg -n "wastewise-ai-api-production|freshwise-api-production" "$tmp\assets\index.android.bundle"
