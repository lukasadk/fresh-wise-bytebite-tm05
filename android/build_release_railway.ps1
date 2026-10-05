$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidRoot = Resolve-Path $PSScriptRoot
$jdkRoot = "C:\Users\Administrator\.cache\wastewise-android\jdk-21-extracted\jdk-21.0.12.1+1"

$env:JAVA_HOME = $jdkRoot
$env:Path = "$jdkRoot\bin;$env:Path"
$env:GRADLE_USER_HOME = "C:\g"
$env:TEMP = "C:\jtmp"
$env:TMP = "C:\jtmp"
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=C:\jtmp"

New-Item -ItemType Directory -Path $env:GRADLE_USER_HOME -Force | Out-Null
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null

Set-Location -LiteralPath $androidRoot
& .\gradlew.bat --no-daemon assembleRelease
