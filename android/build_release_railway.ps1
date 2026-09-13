$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidRoot = Resolve-Path $PSScriptRoot
$jdkRoot = "C:\Users\Administrator\.cache\wastewise-android\jdk-21-extracted\jdk-21.0.12.1+1"

$env:JAVA_HOME = $jdkRoot
$env:Path = "$jdkRoot\bin;$env:Path"
$env:GRADLE_USER_HOME = "D:\fresh-wise-bytebite-tm05\.gradle-build-home"

Set-Location -LiteralPath $androidRoot
& .\gradlew.bat --no-daemon assembleRelease
