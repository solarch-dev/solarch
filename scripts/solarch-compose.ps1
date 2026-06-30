# docker compose wrapper — ignores shell SOLARCH_BASIC_AUTH_* that override .env.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
Remove-Item Env:SOLARCH_BASIC_AUTH_USER -ErrorAction SilentlyContinue
Remove-Item Env:SOLARCH_BASIC_AUTH_HASH -ErrorAction SilentlyContinue
& docker compose @Args
