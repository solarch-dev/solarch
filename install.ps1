# Solarch self-host setup wizard (Windows / PowerShell).
# Asks for an AI provider + API key and a Neo4j password, writes .env, and
# (optionally) starts the stack. No secret is ever echoed back or logged.
#
#   git clone https://github.com/solarch-dev/solarch.git; cd solarch; ./install.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Read-Secret([string]$Prompt) {
  $sec = Read-Host "   $Prompt" -AsSecureString
  [System.Net.NetworkCredential]::new('', $sec).Password
}
function New-Secret {
  # Create().GetBytes() works on both Windows PowerShell 5.1 and PowerShell 7+.
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32
  $rng.GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

Write-Host "Solarch - self-host setup" -ForegroundColor White
Write-Host ""

# Prerequisites
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker is required. Install Docker Desktop, then re-run ./install.ps1  (https://docs.docker.com/get-docker/)"
  exit 1
}
try { docker compose version | Out-Null } catch {
  Write-Error "Docker Compose v2 is required (the 'docker compose' command)."
  exit 1
}

if (Test-Path .env) {
  $ans = Read-Host ".env already exists. Overwrite it? [y/N]"
  if ($ans -notmatch '^[yY]') { Write-Host "Keeping existing .env."; exit 0 }
}

# 1) AI provider
Write-Host "1) Choose your AI provider" -ForegroundColor White
Write-Host "   The AI Architect needs a tool-calling-capable model. Bring your own key." -ForegroundColor DarkGray
Write-Host @"
   1) OpenAI            6) Groq
   2) Anthropic         7) OpenRouter (300+ models)
   3) Google Gemini     8) Ollama (local, no key)
   4) DeepSeek          9) Bedrock (OpenAI-compatible)
   5) Mistral          10) Custom OpenAI-compatible
"@
$pick = Read-Host "   Provider [1-10] (default 1)"
if ([string]::IsNullOrWhiteSpace($pick)) { $pick = "1" }

$provider = ""; $keyLines = @(); $model = ""; $modelDefault = ""; $askModel = $true
switch ($pick) {
  "1"  { $provider="openai";     $keyLines=@("OPENAI_API_KEY=$(Read-Secret 'OPENAI_API_KEY')");     $modelDefault="gpt-4o" }
  "2"  { $provider="anthropic";  $keyLines=@("ANTHROPIC_API_KEY=$(Read-Secret 'ANTHROPIC_API_KEY')"); $modelDefault="claude-3-5-sonnet-latest" }
  "3"  { $provider="google";     $keyLines=@("GOOGLE_API_KEY=$(Read-Secret 'GOOGLE_API_KEY')");     $modelDefault="gemini-1.5-pro" }
  "4"  { $provider="deepseek";   $keyLines=@("DEEPSEEK_API_KEY=$(Read-Secret 'DEEPSEEK_API_KEY')"); $askModel=$false }
  "5"  { $provider="mistral";    $keyLines=@("MISTRAL_API_KEY=$(Read-Secret 'MISTRAL_API_KEY')");   $modelDefault="mistral-large-latest" }
  "6"  { $provider="groq";       $keyLines=@("GROQ_API_KEY=$(Read-Secret 'GROQ_API_KEY')");         $modelDefault="llama-3.3-70b-versatile" }
  "7"  { $provider="openrouter"; $keyLines=@("OPENROUTER_API_KEY=$(Read-Secret 'OPENROUTER_API_KEY')"); $modelDefault="openai/gpt-4o" }
  "8"  {
         $provider="ollama"; $askModel=$false
         $ob = Read-Host "   OLLAMA_BASE_URL [http://host.docker.internal:11434]"
         if ([string]::IsNullOrWhiteSpace($ob)) { $ob = "http://host.docker.internal:11434" }
         $om = Read-Host "   Model (e.g. llama3.1)"; if ([string]::IsNullOrWhiteSpace($om)) { $om = "llama3.1" }
         $keyLines=@("OLLAMA_BASE_URL=$ob"); $model = $om
       }
  "9"  {
         $provider="bedrock"; $askModel=$false
         $bk = Read-Secret 'BEDROCK_API_KEY'
         $bu = Read-Host "   BEDROCK_BASE_URL"
         $keyLines=@("BEDROCK_API_KEY=$bk","BEDROCK_BASE_URL=$bu")
       }
  "10" {
         $provider="openai-compatible"; $askModel=$false
         $lk = Read-Secret 'LLM_API_KEY'
         $lu = Read-Host "   LLM_BASE_URL"
         $lm = Read-Host "   Model"
         $keyLines=@("LLM_API_KEY=$lk","LLM_BASE_URL=$lu"); $model = $lm
       }
  default { Write-Error "Invalid choice."; exit 1 }
}

if ($askModel) {
  $m = Read-Host "   Model [$modelDefault]"
  $model = if ([string]::IsNullOrWhiteSpace($m)) { $modelDefault } else { $m }
}

# 2) Neo4j password
Write-Host ""; Write-Host "2) Database password (Neo4j)" -ForegroundColor White
$neo = Read-Host "   Press Enter to auto-generate, or type a password"
if ([string]::IsNullOrWhiteSpace($neo)) { $neo = New-Secret; Write-Host "   Generated a strong password." }

# 3) Network exposure
Write-Host ""; Write-Host "3) Network exposure" -ForegroundColor White
Write-Host "   Local-only is safest. LAN/VPS enables HTTP Basic Auth at the edge." -ForegroundColor DarkGray
Write-Host @"
   1) Local only (127.0.0.1) - default, this machine only
   2) LAN / remote (0.0.0.0 + HTTP Basic Auth)
"@
$exposure = Read-Host "   Exposure [1-2] (default 1)"
if ([string]::IsNullOrWhiteSpace($exposure)) { $exposure = "1" }

$bindAddress = "127.0.0.1"
$authUser = ""
$authHash = ""
$authPassword = ""

if ($exposure -eq "2") {
  $bindAddress = "0.0.0.0"
  $authUser = "solarch"
  $authPassword = (New-Secret).Substring(0, 24)
  Write-Host "   Generating HTTP Basic Auth credentials..."
  $authHash = (docker run --rm caddy:2-alpine caddy hash-password --plaintext $authPassword).Trim()
  Write-Host ""
  Write-Host "   Save these credentials - shown once:" -ForegroundColor White
  Write-Host "   User:     $authUser"
  Write-Host "   Password: $authPassword"
  Write-Host ""
} elseif ($exposure -ne "1") {
  Write-Error "Invalid choice."; exit 1
}

# Write .env (fresh, real values; never printed)
$lines = @(
  "# Generated by install.ps1 - do not commit (this file is gitignored).",
  "PUBLIC_URL=http://localhost:3000",
  "PORT_PUBLIC=3000",
  "BIND_ADDRESS=$bindAddress",
  "NEO4J_PASSWORD=$neo",
  "LOCAL_USER_ID=local_owner",
  "LLM_GENERATION_PROVIDER=$provider",
  "LLM_CHAT_PROVIDER=$provider"
) + $keyLines
if (-not [string]::IsNullOrWhiteSpace($model)) { $lines += "LLM_MODEL=$model" }
if ($authUser) {
  $lines += "SOLARCH_BASIC_AUTH_USER=$authUser"
  $lines += "SOLARCH_BASIC_AUTH_HASH=$authHash"
}
# Write without a BOM (works on 5.1 and 7+) so docker compose parses the .env cleanly.
$content = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "OK - wrote .env (provider: $provider)" -ForegroundColor Green
Write-Host "  Secrets were written to .env only - never printed here." -ForegroundColor DarkGray
Write-Host ""
$go = Read-Host "Start Solarch now with 'docker compose up --build'? [Y/n]"
if ($go -match '^[nN]') {
  Write-Host "When ready:  docker compose up --build   ->   http://localhost:3000"
} else {
  docker compose up --build
}
