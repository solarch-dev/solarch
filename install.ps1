# Solarch self-host setup wizard (Windows / PowerShell).
# Branded like @solarch/cli — validates inputs, writes .env, optionally starts Docker.
#
#   git clone https://github.com/solarch-dev/solarch.git; cd solarch; ./install.ps1
param(
  [switch]$Yes,
  [switch]$Reconfigure,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
$InstallVersion = '0.1.0'
Set-Location $PSScriptRoot

function Write-Brand([string]$Text) { Write-Host $Text -ForegroundColor '#FD6A09' }
function Write-Muted([string]$Text) { Write-Host $Text -ForegroundColor DarkGray }
function Write-Ok([string]$Text) { Write-Host "  ✓ $Text" -ForegroundColor Green }
function Write-Fail([string]$Text) { Write-Host "  ✗ $Text" -ForegroundColor Red }
function Write-Warn([string]$Text) { Write-Host "  ! $Text" -ForegroundColor '#FD6A09' }

function Show-Banner {
  $logo = @(
    '        11tttt11',
    '    iittttiiiittttii',
    'iitttt11        11ttttii',
    'ff11      iiii      11ff',
    'fftt11ii11tttt11ii11ttff',
    'tt  11fftt    ttff11  tt',
    'tt    tttttt11tttt    tt',
    'tt    tt11111111tt    tt',
    'tt  11fftt1111ttff11  tt',
    'tttttt11ttffff1111tttttt',
    'ff11      1111      11ff',
    'iitttt11  1111  11ttttii',
    '    iitttt1111ttttii',
    '        11ffff11'
  )
  foreach ($line in $logo) { Write-Host "     $line" -ForegroundColor DarkGray }
  Write-Host ''
  Write-Host '     ' -NoNewline
  Write-Brand 'SOLARCH'
  Write-Muted ' · self-host setup · '
  Write-Host "v$InstallVersion" -ForegroundColor White
  Write-Muted '     ────────────────────────────────────────────'
  Write-Muted '     diagram ⟷ code  ·  rules engine  ·  AI architect'
  Write-Host ''
}

function Show-Usage {
  Write-Brand 'solarch install'
  Write-Muted ' — self-host setup wizard'
  Write-Host ''
  Write-Muted '  Usage:  ./install.ps1 [-Yes] [-Reconfigure] [-Help]'
  Write-Muted '  Already installed? menu: start / reconfigure / exit'
}

function Read-Secret([string]$Prompt) {
  $sec = Read-Host "  $Prompt" -AsSecureString
  [System.Net.NetworkCredential]::new('', $sec).Password
}

function New-Secret {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 16
  $rng.GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Test-Neo4jPassword([string]$Pw) { $Pw.Length -ge 8 }

function Get-Neo4jPassword([string]$Initial) {
  $pw = $Initial
  if ([string]::IsNullOrWhiteSpace($pw)) {
    $pw = New-Secret
    Write-Ok 'Generated a strong Neo4j password (32 hex chars).'
    return $pw
  }
  while (-not (Test-Neo4jPassword $pw)) {
    Write-Fail "Neo4j requires at least 8 characters (yours: $($pw.Length))."
    $pw = Read-Host '  Password (Enter = auto-generate)'
    if ([string]::IsNullOrWhiteSpace($pw)) {
      $pw = New-Secret
      Write-Ok 'Generated a strong Neo4j password.'
      break
    }
  }
  return $pw
}

function Test-ApiKey([string]$Key) { -not [string]::IsNullOrWhiteSpace($Key) }

function Invoke-SolarchCompose {
  Remove-Item Env:SOLARCH_BASIC_AUTH_USER -ErrorAction SilentlyContinue
  Remove-Item Env:SOLARCH_BASIC_AUTH_HASH -ErrorAction SilentlyContinue
  & docker compose @args
}

function Test-Preflight {
  Write-Host ''
  Write-Brand 'Preflight'
  Write-Muted '  Checking Docker…'
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail 'Docker not found. Install Docker Desktop: https://docs.docker.com/get-docker/'
    exit 1
  }
  try { docker compose version | Out-Null } catch {
    Write-Fail "Docker Compose v2 required (docker compose)."
    exit 1
  }
  try { docker info 2>&1 | Out-Null } catch {
    Write-Fail 'Docker daemon is not running. Start Docker Desktop, then re-run.'
    exit 1
  }
  Write-Ok 'Docker ready'
}

function Test-ExistingEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return $true }
  $line = Get-Content $Path | Where-Object { $_ -match '^NEO4J_PASSWORD=' } | Select-Object -First 1
  if (-not $line) { return $true }
  $pw = ($line -split '=', 2)[1]
  if ($pw -and -not (Test-Neo4jPassword $pw)) {
    Write-Fail ".env NEO4J_PASSWORD has only $($pw.Length) chars (Neo4j needs ≥8)."
    return $false
  }
  return $true
}

function Test-EnvComplete([string]$Path = '.env') {
  if (-not (Test-Path $Path)) { return $false }
  if (-not (Test-ExistingEnv $Path)) { return $false }
  $lines = Get-Content $Path
  if (-not ($lines | Where-Object { $_ -match '^NEO4J_PASSWORD=.+' })) { return $false }
  if (-not ($lines | Where-Object { $_ -match '^LLM_GENERATION_PROVIDER=.+' })) { return $false }
  if (-not ($lines | Where-Object { $_ -match '^LLM_CHAT_PROVIDER=.+' })) { return $false }
  $provider = (($lines | Where-Object { $_ -match '^LLM_GENERATION_PROVIDER=' } | Select-Object -First 1) -split '=', 2)[1]
  if ($provider -eq 'ollama') {
    return [bool]($lines | Where-Object { $_ -match '^OLLAMA_BASE_URL=.+' })
  }
  return [bool]($lines | Where-Object { $_ -match '^(OPENAI|ANTHROPIC|GOOGLE|DEEPSEEK|MISTRAL|GROQ|OPENROUTER|BEDROCK|LLM)_' })
}

function Test-Neo4jVolume {
  $vols = docker volume ls -q 2>$null
  return [bool]($vols | Where-Object { $_ -match 'solarch_neo4j_data$' })
}

function Test-StackRunning {
  $ids = Invoke-SolarchCompose ps --status running -q web 2>$null
  return [bool]$ids
}

function Get-EnvSummary {
  $lines = Get-Content '.env'
  $provider = (($lines | Where-Object { $_ -match '^LLM_GENERATION_PROVIDER=' } | Select-Object -First 1) -split '=', 2)[1]
  $model = (($lines | Where-Object { $_ -match '^LLM_MODEL=' } | Select-Object -First 1) -split '=', 2)[1]
  if ($model) { return "$provider · $model" }
  return $provider
}

function Handle-ExistingInstall([string]$Choice = '') {
  Write-Host ''
  Write-Ok 'Solarch is already set up on this machine.'
  Write-Muted "  Config   .env ($(Get-EnvSummary))"
  if (Test-Neo4jVolume) { Write-Muted '  Database Neo4j volume present (local projects kept)' }
  if (Test-StackRunning) { Write-Muted '  Stack    running → http://localhost:3000' }
  elseif (Invoke-SolarchCompose ps -aq 2>$null) { Write-Muted '  Stack    stopped' }
  else { Write-Muted '  Stack    not created yet' }
  Write-Host ''
  if (-not $Choice) {
    Write-Host @"
  1) Start stack (recommended if stopped)
  2) Reconfigure — new .env wizard (keeps DB unless you reset)
  3) Exit
"@ -ForegroundColor DarkGray
    $Choice = Read-Host '  Choice [1-3] (default 1)'
    if ([string]::IsNullOrWhiteSpace($Choice)) { $Choice = '1' }
  } elseif ($Choice -in @('start','up')) { $Choice = '1' }
  elseif ($Choice -in @('reconfigure','configure')) { $Choice = '2' }
  elseif ($Choice -in @('exit','quit')) { $Choice = '3' }
  switch ($Choice) {
    '1' {
      if (Test-StackRunning) {
        Write-Ok 'Already running at http://localhost:3000'
        Write-Muted '  Logs: .\scripts\solarch-compose.ps1 logs -f'
        exit 0
      }
      Write-Ok 'Starting stack…'
      Invoke-SolarchCompose up --build
      exit $LASTEXITCODE
    }
    '2' {
      Write-Warn 'Reconfigure will overwrite .env.'
      $ans = Read-Host '  Continue? [y/N]'
      if ($ans -notmatch '^[yY]') { Write-Ok 'Cancelled.'; exit 0 }
      $line = Get-Content .env | Where-Object { $_ -match '^NEO4J_PASSWORD=' } | Select-Object -First 1
      if ($line) { $script:OldNeo4jPw = ($line -split '=', 2)[1] }
      return
    }
    '3' { Write-Ok 'Nothing changed.'; exit 0 }
    default { Write-Fail 'Invalid choice.'; exit 1 }
  }
}

function Show-SummaryBox([string[]]$Lines) {
  Write-Host ''
  Write-Muted '  +-- Ready --------------------------------------+'
  foreach ($l in $Lines) {
    Write-Host ('  | {0,-42} |' -f $l) -ForegroundColor DarkGray
  }
  Write-Muted '  +----------------------------------------------+'
}

if ($Help) { Show-Usage; exit 0 }

Show-Banner
Test-Preflight

$script:OldNeo4jPw = ''

if (-not $Reconfigure -and (Test-EnvComplete '.env')) {
  if ($Yes) { Handle-ExistingInstall 'start' }
  Handle-ExistingInstall
}

if ((Test-Path .env) -and -not (Test-ExistingEnv .env)) {
  Write-Warn '.env exists but is invalid.'
  $fix = Read-Host '  Run reconfigure wizard to fix? [Y/n]'
  if ($fix -match '^[nN]') {
    Write-Muted '  Edit .env manually, then: .\scripts\solarch-compose.ps1 up --build'
    exit 1
  }
  $line = Get-Content .env | Where-Object { $_ -match '^NEO4J_PASSWORD=' } | Select-Object -First 1
  if ($line) { $script:OldNeo4jPw = ($line -split '=', 2)[1] }
} elseif ($Reconfigure -and (Test-Path .env)) {
  $line = Get-Content .env | Where-Object { $_ -match '^NEO4J_PASSWORD=' } | Select-Object -First 1
  if ($line) { $script:OldNeo4jPw = ($line -split '=', 2)[1] }
  Write-Warn 'Reconfigure — will overwrite .env.'
}

# Step 1 — AI
Write-Host ''
Write-Brand 'Step 1/3'
Write-Host ' AI provider' -ForegroundColor White
Write-Muted '  Tool-calling model + your API key.'
Write-Host @"
  1) OpenAI            6) Groq
  2) Anthropic         7) OpenRouter (300+ models)
  3) Google Gemini     8) Ollama (local, no key)
  4) DeepSeek          9) Bedrock (OpenAI-compatible)
  5) Mistral          10) Custom OpenAI-compatible
"@ -ForegroundColor DarkGray

$pick = Read-Host '  Provider [1-10] (default 1)'
if ([string]::IsNullOrWhiteSpace($pick)) { $pick = '1' }

$provider = ''; $keyLines = @(); $model = ''; $modelDefault = ''; $askModel = $true
$bedrockUrl = ''; $llmUrl = ''

switch ($pick) {
  '1'  { $provider='openai';     $k=Read-Secret 'OPENAI_API_KEY';     $keyLines=@("OPENAI_API_KEY=$k");     $modelDefault='gpt-4o' }
  '2'  { $provider='anthropic';  $k=Read-Secret 'ANTHROPIC_API_KEY';  $keyLines=@("ANTHROPIC_API_KEY=$k"); $modelDefault='claude-3-5-sonnet-latest' }
  '3'  { $provider='google';     $k=Read-Secret 'GOOGLE_API_KEY';     $keyLines=@("GOOGLE_API_KEY=$k");     $modelDefault='gemini-1.5-pro' }
  '4'  { $provider='deepseek';   $k=Read-Secret 'DEEPSEEK_API_KEY';   $keyLines=@("DEEPSEEK_API_KEY=$k");   $askModel=$false }
  '5'  { $provider='mistral';    $k=Read-Secret 'MISTRAL_API_KEY';    $keyLines=@("MISTRAL_API_KEY=$k");   $modelDefault='mistral-large-latest' }
  '6'  { $provider='groq';       $k=Read-Secret 'GROQ_API_KEY';       $keyLines=@("GROQ_API_KEY=$k");       $modelDefault='llama-3.3-70b-versatile' }
  '7'  { $provider='openrouter'; $k=Read-Secret 'OPENROUTER_API_KEY'; $keyLines=@("OPENROUTER_API_KEY=$k"); $modelDefault='openai/gpt-4o' }
  '8'  {
    $provider='ollama'; $askModel=$false
    $ob = Read-Host '  OLLAMA_BASE_URL [http://host.docker.internal:11434]'
    if ([string]::IsNullOrWhiteSpace($ob)) { $ob = 'http://host.docker.internal:11434' }
    $om = Read-Host '  Model [llama3.1]'; if ([string]::IsNullOrWhiteSpace($om)) { $om = 'llama3.1' }
    $keyLines=@("OLLAMA_BASE_URL=$ob"); $model = $om
  }
  '9'  {
    $provider='bedrock'; $askModel=$false
    $bk = Read-Secret 'BEDROCK_API_KEY'
    $bedrockUrl = Read-Host '  BEDROCK_BASE_URL'
    $keyLines=@("BEDROCK_API_KEY=$bk","BEDROCK_BASE_URL=$bedrockUrl")
  }
  '10' {
    $provider='openai-compatible'; $askModel=$false
    $lk = Read-Secret 'LLM_API_KEY'
    $llmUrl = Read-Host '  LLM_BASE_URL'
    $model = Read-Host '  Model'
    $keyLines=@("LLM_API_KEY=$lk","LLM_BASE_URL=$llmUrl")
  }
  default { Write-Fail 'Invalid choice.'; exit 1 }
}

if ($provider -ne 'ollama') {
  $keyVal = ($keyLines[0] -split '=', 2)[1]
  while (-not (Test-ApiKey $keyVal)) {
    Write-Fail 'API key cannot be empty.'
    switch ($provider) {
      'openai'     { $k = Read-Secret 'OPENAI_API_KEY';     $keyLines=@("OPENAI_API_KEY=$k") }
      'anthropic'  { $k = Read-Secret 'ANTHROPIC_API_KEY';  $keyLines=@("ANTHROPIC_API_KEY=$k") }
      'google'     { $k = Read-Secret 'GOOGLE_API_KEY';     $keyLines=@("GOOGLE_API_KEY=$k") }
      'deepseek'   { $k = Read-Secret 'DEEPSEEK_API_KEY';   $keyLines=@("DEEPSEEK_API_KEY=$k") }
      'mistral'    { $k = Read-Secret 'MISTRAL_API_KEY';    $keyLines=@("MISTRAL_API_KEY=$k") }
      'groq'       { $k = Read-Secret 'GROQ_API_KEY';       $keyLines=@("GROQ_API_KEY=$k") }
      'openrouter' { $k = Read-Secret 'OPENROUTER_API_KEY'; $keyLines=@("OPENROUTER_API_KEY=$k") }
      'bedrock'    { $k = Read-Secret 'BEDROCK_API_KEY';    $keyLines=@("BEDROCK_API_KEY=$k","BEDROCK_BASE_URL=$bedrockUrl") }
      default      { $k = Read-Secret 'LLM_API_KEY';        $keyLines=@("LLM_API_KEY=$k","LLM_BASE_URL=$llmUrl") }
    }
    $keyVal = ($keyLines[0] -split '=', 2)[1]
  }
  Write-Ok "Provider: $provider"
}

if ($askModel) {
  $m = Read-Host "  Model [$modelDefault]"
  $model = if ([string]::IsNullOrWhiteSpace($m)) { $modelDefault } else { $m }
}

# Step 2 — Neo4j
Write-Host ''
Write-Brand 'Step 2/3'
Write-Host ' Database' -ForegroundColor White
if ((Test-Neo4jVolume) -and $script:OldNeo4jPw) {
  Write-Warn 'Neo4j volume exists — keep the same password or the server will not connect.'
  $keep = Read-Host '  Keep existing DB password? [Y/n]'
  if ($keep -match '^[nN]') {
    $neoIn = Read-Host '  New password (Enter = auto-generate)'
    $neo = Get-Neo4jPassword $neoIn
  } else {
    $neo = $script:OldNeo4jPw
    Write-Ok 'Keeping existing Neo4j password.'
  }
} else {
  Write-Muted '  Enter = auto-generate strong password (recommended).'
  $neoIn = Read-Host '  Password (Enter = auto-generate)'
  $neo = Get-Neo4jPassword $neoIn
}

# Step 3 — Network
Write-Host ''
Write-Brand 'Step 3/3'
Write-Host ' Network' -ForegroundColor White
Write-Muted '  Local-only is safest. Remote adds HTTP Basic Auth.'
Write-Host @"
  1) Local only (127.0.0.1) - this machine only
  2) LAN / remote (0.0.0.0 + HTTP Basic Auth)
"@ -ForegroundColor DarkGray

$exposure = Read-Host '  Exposure [1-2] (default 1)'
if ([string]::IsNullOrWhiteSpace($exposure)) { $exposure = '1' }

$bindAddress = '127.0.0.1'
$authUser = ''
$authHash = ''

if ($exposure -eq '2') {
  $bindAddress = '0.0.0.0'
  $authUser = 'solarch'
  $authPassword = (New-Secret).Substring(0, 24)
  Write-Muted '  Generating HTTP Basic Auth…'
  $authHash = (docker run --rm caddy:2-alpine caddy hash-password --plaintext $authPassword).Trim()
  Write-Host ''
  Write-Host '  Save these credentials — shown once:' -ForegroundColor White
  Write-Host "    User:     $authUser"
  Write-Host "    Password: $authPassword"
  Write-Host ''
  Write-Ok 'Remote exposure + Basic Auth enabled.'
} elseif ($exposure -ne '1') {
  Write-Fail 'Invalid choice.'; exit 1
} else {
  Write-Ok 'Local only (127.0.0.1:3000).'
}

$lines = @(
  '# Generated by install.ps1 — do not commit (gitignored).',
  'PUBLIC_URL=http://localhost:3000',
  'PORT_PUBLIC=3000',
  "BIND_ADDRESS=$bindAddress",
  "NEO4J_PASSWORD=$neo",
  'LOCAL_USER_ID=local_owner',
  "LLM_GENERATION_PROVIDER=$provider",
  "LLM_CHAT_PROVIDER=$provider"
) + $keyLines

if (-not [string]::IsNullOrWhiteSpace($model)) { $lines += "LLM_MODEL=$model" }
if ($authUser) {
  $lines += "SOLARCH_BASIC_AUTH_USER=$authUser"
  $lines += "SOLARCH_BASIC_AUTH_HASH=$authHash"
} else {
  $lines += '# SOLARCH_BASIC_AUTH_USER='
  $lines += '# SOLARCH_BASIC_AUTH_HASH='
}

$content = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Ok ".env written (provider: $provider)"
Write-Muted '  Secrets stay in .env only — never printed here.'

if ($script:OldNeo4jPw -and $neo -ne $script:OldNeo4jPw -and (Test-Neo4jVolume)) {
  Write-Warn 'NEO4J_PASSWORD changed — Neo4j volume still has the old password.'
  $reset = Read-Host '  Reset database volume (local projects lost)? [Y/n]'
  if ($reset -notmatch '^[nN]') {
    Write-Ok 'Clearing Neo4j volume…'
    Invoke-SolarchCompose down -v 2>$null
    Write-Ok 'Neo4j volume cleared.'
  } else {
    Write-Warn 'Keeping volume — expect auth errors. Fix: .\scripts\solarch-reset-db.ps1'
  }
}

Show-SummaryBox @(
  'Open  http://localhost:3000',
  "AI    $provider$(if ($model) { " · $model" })",
  'Auth  no login (local owner)',
  'Stop  Ctrl+C · .\scripts\solarch-compose.ps1 down'
)

Write-Host ''
if ($Yes) {
  Write-Ok 'Starting stack…'
  Invoke-SolarchCompose up --build
} else {
  $go = Read-Host 'Start Solarch now? [Y/n]'
  if ($go -match '^[nN]') {
    Write-Muted '  When ready:  .\scripts\solarch-compose.ps1 up --build'
  } else {
    Write-Ok 'Starting stack…'
    Invoke-SolarchCompose up --build
  }
}
