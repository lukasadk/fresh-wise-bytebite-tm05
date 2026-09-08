param(
  [string]$ModelDirectory = "D:\fresh-wise-bytebite-tm05\android\app\src\main\assets\wastewise-vlm\qwen3-vl-2b-distilled-int4-v8-20260908-v1"
)

$ErrorActionPreference = "Stop"
$modelVersion = "qwen3-vl-2b-distilled-int4-v8-20260908-v1"
$requiredFiles = @(
  "config.mobile.json",
  "llm_config.json",
  "llm.mnn",
  "llm.mnn.weight",
  "visual.mnn",
  "visual.mnn.weight",
  "tokenizer.mtok"
)

$resolvedDirectory = [System.IO.Path]::GetFullPath($ModelDirectory)
if (-not (Test-Path -LiteralPath $resolvedDirectory -PathType Container)) {
  throw "Model directory does not exist: $resolvedDirectory"
}

$files = foreach ($name in $requiredFiles) {
  $path = Join-Path $resolvedDirectory $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required model file is missing: $path"
  }
  $file = Get-Item -LiteralPath $path
  if ($file.Length -le 0) {
    throw "Required model file is empty: $path"
  }
  [ordered]@{
    name = $name
    size = $file.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  }
}

$manifest = [ordered]@{
  version = $modelVersion
  deployment_class = "experimental_only_acceptance_failed"
  requires_user_confirmation = $true
  quantization = "language INT4; visual INT8"
  mnn_source_commit = "bef71b9756a2c77549eddbe33eb97290e3b16602"
  files = @($files)
}

$manifestPath = Join-Path $resolvedDirectory "manifest.json"
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
  $manifestPath,
  $json + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false)
)

[pscustomobject]@{
  path = $manifestPath
  fileCount = $files.Count
  totalBytes = ($files | ForEach-Object { [long]$_['size'] } | Measure-Object -Sum).Sum
  deploymentClass = $manifest.deployment_class
} | Format-List
