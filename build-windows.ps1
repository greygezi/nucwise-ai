$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$chatboxRoot = Join-Path $projectRoot "chatbox-ui"
$distRoot = Join-Path $projectRoot "dist"
$buildRoot = Join-Path $projectRoot "build"
$trayExe = Join-Path $distRoot "DesktopAssistantTray.exe"
$iconPath = Join-Path $chatboxRoot "assets\nucwise-nid-icon-imagen-v1-transparent.ico"

Write-Host "[1/5] Checking build dependencies..."
python -m pip install --requirement (Join-Path $projectRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }
corepack pnpm --dir $chatboxRoot install --frozen-lockfile --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed." }

Write-Host "[2/5] Building the bundled tray assistant..."
$pyInstallerArgs = @(
  "--noconfirm",
  "--clean",
  "--onefile",
  "--noconsole",
  "--name", "DesktopAssistantTray",
  "--distpath", $distRoot,
  "--workpath", (Join-Path $buildRoot "pyinstaller"),
  "--specpath", $buildRoot
)
if (Test-Path $iconPath) {
  $pyInstallerArgs += @("--icon", $iconPath, "--add-data", "$iconPath;.")
}
$pyInstallerArgs += (Join-Path $projectRoot "Floating_window.py")
python -m PyInstaller @pyInstallerArgs
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed." }

if (-not (Test-Path $trayExe)) {
  throw "Tray executable was not created: $trayExe"
}

Write-Host "[3/5] Checking and building the integrated frontend..."
corepack pnpm --dir $chatboxRoot run check
if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed." }
corepack pnpm --dir $chatboxRoot run build
if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed." }

Write-Host "[4/5] Creating the portable Windows executable..."
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
corepack pnpm --dir $chatboxRoot exec electron-builder build --win portable --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw "Portable packaging failed." }

$installer = Get-ChildItem (Join-Path $chatboxRoot "release\build") -Filter "*Portable.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw "Portable Windows executable was not created."
}

$package = Get-Content (Join-Path $chatboxRoot "package.json") -Raw | ConvertFrom-Json
$unpackedRoot = Join-Path $chatboxRoot "release\build\win-unpacked"
$greenArchive = Join-Path $chatboxRoot "release\build\$($package.productName)-$($package.version)-Green-x64.zip"
if (-not (Test-Path (Join-Path $unpackedRoot "$($package.productName).exe"))) {
  throw "Green build executable was not created: $unpackedRoot"
}

Write-Host "[5/5] Creating the extract-and-run green ZIP package..."
Compress-Archive -Path (Join-Path $unpackedRoot "*") -DestinationPath $greenArchive -CompressionLevel Optimal -Force
if (-not (Test-Path $greenArchive)) {
  throw "Green ZIP package was not created: $greenArchive"
}

Write-Host "Portable build complete: $($installer.FullName)"
Write-Host "Green build complete: $greenArchive"
