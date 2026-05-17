#requires -Version 5.1
<#
  Local DB <-> Yandex Managed PostgreSQL (pg_dump / pg_restore / prisma migrate).

  Dump (DATABASE_URL from repo .env, or -SourceUrl):
    .\scripts\sync-db-yandex.ps1 Dump

  Restore to cloud (set URL in env, do not commit secrets):
    $env:YANDEX_DATABASE_URL = "postgresql://...@....mdb.yandexcloud.net:6432/db?sslmode=require"
    .\scripts\sync-db-yandex.ps1 Restore

  Schema only — applies prisma/migrations to cloud (same as: DATABASE_URL=... npx prisma migrate deploy):
    $env:YANDEX_DATABASE_URL = "postgresql://..."
    .\scripts\sync-db-yandex.ps1 Migrate

  Client tools: prefers OLDEST PostgreSQL major under Program Files\PostgreSQL\*\bin (pg 17 client
  sends SET transaction_timeout; PG16 Yandex rejects it). Pin: $env:PG_TOOLS_MAJOR = '16'

  Then PATH. Stop dev server before prisma generate.
#>
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('Dump', 'Restore', 'Migrate')]
  [string] $Action,

  [string] $SourceUrl = $env:DATABASE_URL,
  [string] $TargetUrl = $env:YANDEX_DATABASE_URL,
  [string] $DumpPath = '',
  [string] $EnvFile = '.env'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Read-DatabaseUrlFromDotEnv {
  param([string] $Root, [string] $File)
  $path = Join-Path $Root $File
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing file: $path. Set -SourceUrl or `$env:DATABASE_URL."
  }
  foreach ($line in Get-Content -LiteralPath $path) {
    $t = $line.Trim()
    if ($t -match '^\s*#' -or $t -eq '') { continue }
    if ($t -match '^\s*DATABASE_URL\s*=\s*(.+)\s*$') {
      $v = $Matches[1].Trim()
      if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
        $v = $v.Substring(1, $v.Length - 2)
      }
      return $v
    }
  }
  throw "No DATABASE_URL= line in: $path"
}

function Resolve-PgExe {
  param([string] $ExeName)

  $pgRoots = @()
  if ($env:ProgramFiles) {
    $pgRoots += (Join-Path $env:ProgramFiles 'PostgreSQL')
  }
  if (${env:ProgramFiles(x86)}) {
    $pgRoots += (Join-Path ${env:ProgramFiles(x86)} 'PostgreSQL')
  }

  $found = @()
  foreach ($root in $pgRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $candidate = Join-Path $_.FullName "bin\$ExeName.exe"
      if (Test-Path -LiteralPath $candidate) { $found += $candidate }
    }
  }

  $pin = $env:PG_TOOLS_MAJOR
  if ($pin) {
    foreach ($root in $pgRoots) {
      $exact = Join-Path (Join-Path (Join-Path $root $pin) 'bin') "$ExeName.exe"
      if (Test-Path -LiteralPath $exact) { return $exact }
    }
    throw "PG_TOOLS_MAJOR=$pin but not found: ...\PostgreSQL\$pin\bin\$ExeName.exe"
  }

  if ($found.Count -gt 0) {
    return (
      $found |
        Sort-Object {
          $verDir = Split-Path (Split-Path $_ -Parent) -Leaf
          $n = 999
          [void][int]::TryParse($verDir, [ref]$n)
          $n
        } |
        Select-Object -First 1
    )
  }

  $fromPath = Get-Command -Name $ExeName -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }

  throw (
    "Not found: $ExeName. Install PostgreSQL for Windows (add 16.x client if cloud is PG16; " +
      'set PG_TOOLS_MAJOR=16 to pin). https://www.postgresql.org/download/windows/'
  )
}

switch ($Action) {
  'Dump' {
    if (-not $SourceUrl) { $SourceUrl = Read-DatabaseUrlFromDotEnv -Root $RepoRoot -File $EnvFile }
    if (-not $DumpPath) {
      $dir = Join-Path $RepoRoot '.db-backups'
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      $DumpPath = Join-Path $dir 'emi-local.dump'
    }
    $pgDump = Resolve-PgExe 'pg_dump'
    Write-Host "Using: $pgDump"
    Write-Host "pg_dump -> $DumpPath"
    & $pgDump --format=custom --no-owner --no-acl -f $DumpPath -- $SourceUrl
    if ($LASTEXITCODE -ne 0) { throw "pg_dump exit code: $LASTEXITCODE" }
    Write-Host 'Done.'
  }
  'Restore' {
    if (-not $TargetUrl) {
      throw 'Set $env:YANDEX_DATABASE_URL or -TargetUrl (cloud database URL).'
    }
    if (-not $DumpPath) {
      $defaultDump = Join-Path $RepoRoot '.db-backups\emi-local.dump'
      if (-not (Test-Path -LiteralPath $defaultDump)) {
        throw "Dump file not found: $defaultDump. Run Dump first or pass -DumpPath."
      }
      $DumpPath = $defaultDump
    }
    if (-not (Test-Path -LiteralPath $DumpPath)) { throw "Missing file: $DumpPath" }
    $pgRestore = Resolve-PgExe 'pg_restore'
    Write-Host "Using: $pgRestore"
    Write-Host 'pg_restore to cloud (uses --clean: drops existing objects in target DB).'
    & $pgRestore --clean --if-exists --no-owner --no-acl -d $TargetUrl -- $DumpPath
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
      throw "pg_restore exit code: $LASTEXITCODE"
    }
    Write-Host ('Done. Exit code ' + $LASTEXITCODE + ' (1 is often OK for pg_restore warnings).')
  }
  'Migrate' {
    if (-not $TargetUrl) {
      throw 'Set $env:YANDEX_DATABASE_URL or -TargetUrl.'
    }
    Push-Location $RepoRoot
    try {
      $env:DATABASE_URL = $TargetUrl
      npx prisma migrate deploy
      npx prisma generate
    }
    finally {
      Pop-Location
    }
    Write-Host 'Done.'
  }
}
