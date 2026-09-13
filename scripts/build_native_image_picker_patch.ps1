$ErrorActionPreference = "Stop"

$Root = "D:\fresh-wise-bytebite-tm05"
$Work = Join-Path $Root "artifacts\native_patch_classes4"
if (Test-Path -LiteralPath $Work) {
  Remove-Item -LiteralPath $Work -Recurse -Force
}
New-Item -ItemType Directory -Path $Work | Out-Null

$StubSource = Join-Path $Root "artifacts\java_stubs"
$StubClasses = Join-Path $Work "stub_classes"
$AppClasses = Join-Path $Work "app_classes"
$DexOut = Join-Path $Work "dex"
New-Item -ItemType Directory -Path $StubClasses, $AppClasses, $DexOut | Out-Null

$AndroidJar = "C:\Users\Administrator\.cache\wastewise-android\android-sdk\platforms\android-36\android.jar"
$JavaHome = "C:\Users\Administrator\.cache\wastewise-android\jdk-17.0.20.1+1"
$env:JAVA_HOME = $JavaHome
$env:PATH = "$JavaHome\bin;$env:PATH"

$StubFiles = Get-ChildItem -LiteralPath $StubSource -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }
& javac -source 17 -target 17 -cp $AndroidJar -d $StubClasses @StubFiles

$AppFiles = @(
  (Join-Path $Root "android\app\src\main\java\com\bytebite\freshwise\FreshWiseImagePickerModule.java"),
  (Join-Path $Root "android\app\src\main\java\com\bytebite\freshwise\FreshWiseImagePickerPackage.java"),
  (Join-Path $Root "android\app\src\main\java\com\bytebite\freshwise\FreshWisePreviewImageViewManager.java")
)
$ClassPath = "$AndroidJar;$StubClasses"
& javac -source 17 -target 17 -cp $ClassPath -d $AppClasses @AppFiles

$AppJar = Join-Path $Work "freshwise-image-picker.jar"
Push-Location -LiteralPath $AppClasses
try {
  & jar cf $AppJar .
} finally {
  Pop-Location
}

$D8 = "C:\Users\Administrator\.cache\wastewise-android\android-sdk\build-tools\36.0.0\d8.bat"
& $D8 --min-api 24 --output $DexOut $AppJar

Move-Item -LiteralPath (Join-Path $DexOut "classes.dex") -Destination (Join-Path $Work "classes4.dex") -Force

$Dexdump = "C:\Users\Administrator\.cache\wastewise-android\android-sdk\build-tools\36.0.0\dexdump.exe"
& $Dexdump -f (Join-Path $Work "classes4.dex") | Select-String -Pattern "Class descriptor" | Select-Object -First 20
Write-Output "new_classes4=$(Join-Path $Work "classes4.dex")"
