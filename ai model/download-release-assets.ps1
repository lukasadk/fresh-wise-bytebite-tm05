param(
  [string]$Owner = "wwan0255",
  [string]$Repo = "fresh-wise-bytebite-tm05",
  [string]$Tag = "freshwise-qwen3-vl-4b-weights-20260913",
  [string]$DownloadDir = (Join-Path $PSScriptRoot "downloads"),
  [string]$OutputRoot = (Join-Path $PSScriptRoot "models")
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$releaseUrl = "https://api.github.com/repos/$Owner/$Repo/releases/tags/$Tag"
Write-Host "Reading release metadata from $releaseUrl"
$release = Invoke-RestMethod -Uri $releaseUrl -Headers @{ "User-Agent" = "FreshWise-model-downloader" }

foreach ($asset in $release.assets) {
  $target = Join-Path $DownloadDir $asset.name
  if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Length -eq [int64]$asset.size)) {
    Write-Host "Already downloaded: $($asset.name)"
    continue
  }

  Write-Host "Downloading: $($asset.name)"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -Headers @{ "User-Agent" = "FreshWise-model-downloader" }
}

$restoreScript = Join-Path $DownloadDir "restore_freshwise_model_weights.ps1"
$manifest = Join-Path $DownloadDir "freshwise-qwen3-vl-4b-weights-manifest.json"

if (!(Test-Path -LiteralPath $restoreScript)) {
  throw "Missing restore script: $restoreScript"
}
if (!(Test-Path -LiteralPath $manifest)) {
  throw "Missing manifest: $manifest"
}

Write-Host "Restoring model files into $OutputRoot"
& $restoreScript -ManifestPath $manifest -OutputRoot $OutputRoot

Write-Host "Done."
