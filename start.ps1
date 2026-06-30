# Start Solarch (Docker). First time? Run ./install.ps1 instead.
param(
  [switch]$Detach,
  [switch]$Build,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Write-Brand([string]$Text) { Write-Host $Text -ForegroundColor '#FD6A09' }
function Write-Muted([string]$Text) { Write-Host $Text -ForegroundColor DarkGray }
function Write-Ok([string]$Text) { Write-Host "  ✓ $Text" -ForegroundColor Green }
function Write-Fail([string]$Text) { Write-Host "  ✗ $Text" -ForegroundColor Red }

function Test-EnvComplete([string]$Path = '.env') {
  if (-not (Test-Path $Path)) { return $false }
  $lines = Get-Content $Path
  if (-not ($lines | Where-Object { $_ -match '^NEO4J_PASSWORD=.+' })) { return $false }
  if (-not ($lines | Where-Object { $_ -match '^LLM_GENERATION_PROVIDER=.+' })) { return $false }
  return $true
}

function Invoke-SolarchCompose {
  Remove-Item Env:SOLARCH_BASIC_AUTH_USER -ErrorAction SilentlyContinue
  Remove-Item Env:SOLARCH_BASIC_AUTH_HASH -ErrorAction SilentlyContinue
  & docker compose @args
}

if ($Help) {
  Write-Brand 'solarch start'
  Write-Muted '  Usage: ./start.ps1 [-Detach] [-Build]'
  Write-Muted '  First time: ./install.ps1'
  exit 0
}

if (-not (Test-EnvComplete)) {
  Write-Fail 'Run ./install.ps1 first (missing or incomplete .env).'
  exit 1
}

$running = Invoke-SolarchCompose ps --status running -q web 2>$null
if ($running) {
  Write-Ok 'Already running → http://localhost:3000'
  exit 0
}

$args = @('up')
if ($Build) { $args += '--build' }
if ($Detach) { $args += '-d' }

Write-Ok 'Starting Solarch…'
Invoke-SolarchCompose @args
