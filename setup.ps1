# Oryn - one-step setup for Windows.
#
#   irm https://raw.githubusercontent.com/SouravBeraAkaSpeed/oryn/main/setup.ps1 | iex
#
# or, inside a clone: double-click setup.cmd (or run .\setup.cmd)
#
# Installs whatever is missing (Git, Node.js, Docker Desktop) with winget,
# then Oryn's packages and the agents' workstation image, and starts Oryn.
# It asks once before installing anything. $env:ORYN_YES = "1" skips it.
# -NoStart sets everything up without starting Oryn.

param([switch]$NoStart)

$ErrorActionPreference = "Stop"
$Repo = "https://github.com/SouravBeraAkaSpeed/oryn.git"

function Ok($text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Note($text) { Write-Host "  [!] $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "  [x] $text" -ForegroundColor Red; exit 1 }
function Has($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }

function Ask($question) {
  if ($env:ORYN_YES -eq "1") { return $true }
  $answer = Read-Host "  $question [Y/n]"
  return ($answer -eq "" -or $answer -match "^[Yy]")
}

# Picks up programs installed a moment ago without opening a new terminal
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Node-Ok {
  if (-not (Has "node")) { return $false }
  $version = (node -v).TrimStart("v").Split(".")
  return ([int]$version[0] -gt 20) -or ([int]$version[0] -eq 20 -and [int]$version[1] -ge 9)
}

function Docker-Installed {
  (Has "docker") -or (Test-Path "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe")
}

Write-Host ""
Write-Host "  oryn - setup" -ForegroundColor White
Write-Host ""

$missing = @()
if (-not (Has "git")) { $missing += "Git" }
if (-not (Node-Ok)) { $missing += "Node.js LTS" }
if (-not (Docker-Installed)) { $missing += "Docker Desktop" }

if ($missing.Count -gt 0) {
  Write-Host "  To run Oryn this computer needs: $($missing -join ', ')"
  if (-not (Has "winget")) {
    Fail "winget isn't available. Install 'App Installer' from the Microsoft Store, then run this again."
  }
  if (-not (Ask "Install them now? (Windows may ask for permission)")) {
    Fail "Nothing installed. Install them yourself, then run this again."
  }
}

$wingetArgs = @("--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements")

if (-not (Has "git")) {
  winget install --id Git.Git @wingetArgs
  Refresh-Path
  if (-not (Has "git")) { Fail "Git didn't install. Get it from https://git-scm.com and run this again." }
}
if (-not (Node-Ok)) {
  winget install --id OpenJS.NodeJS.LTS @wingetArgs
  Refresh-Path
  if (-not (Node-Ok)) { Fail "Node.js didn't install. Get it from https://nodejs.org and run this again." }
}
$dockerFresh = $false
if (-not (Docker-Installed)) {
  winget install --id Docker.DockerDesktop @wingetArgs
  Refresh-Path
  $dockerFresh = $true
  Note "Docker Desktop installed. The first time, it may ask you to accept its terms or to restart Windows."
}

Ok "git $((git --version) -replace 'git version ', '')"
Ok "node $(node -v)"

# Run from inside a clone, or clone one here
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$isOryn = { param($dir) (Test-Path "$dir\package.json") -and (Select-String -Path "$dir\package.json" -Pattern '"name": "oryn"' -Quiet) }
if (& $isOryn $here) {
  Set-Location $here
} elseif (& $isOryn (Get-Location).Path) {
  # already here
} else {
  if (Test-Path "oryn\.git") { Note "Using the existing .\oryn folder" }
  else { git clone --depth 1 $Repo oryn }
  Set-Location oryn
}
Ok "oryn in $((Get-Location).Path)"

Write-Host ""
npm install --no-fund --no-audit --loglevel=error
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }

# Docker Desktop, the workstation image and .env
node scripts/setup.mjs --yes
if ($LASTEXITCODE -ne 0 -and $dockerFresh) {
  Note "If Docker Desktop asked to restart Windows, restart, then run setup.cmd again."
}

Write-Host ""
if (-not $NoStart -and (Ask "Start Oryn now?")) {
  $url = "http://127.0.0.1:6796"
  Start-Job -ScriptBlock {
    param($url)
    for ($i = 0; $i -lt 120; $i++) {
      try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $url; return } catch { Start-Sleep 1 }
    }
  } -ArgumentList $url | Out-Null
  Write-Host "  Oryn is starting at $url - press Ctrl+C to stop it."
  Write-Host "  Next time, start it with: cd $((Get-Location).Path); npm run dev"
  Write-Host ""
  npm run dev
} else {
  Write-Host "  Start Oryn any time with: cd $((Get-Location).Path); npm run dev"
  Write-Host ""
}
