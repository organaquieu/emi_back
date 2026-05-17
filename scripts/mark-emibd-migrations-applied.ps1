# After running emibd-apply-all-schema.sql on Yandex, sync _prisma_migrations so Prisma stops re-applying.
# Requires: DATABASE_URL or YANDEX_DATABASE_URL pointing at emibd.
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$url = $env:DATABASE_URL
if (-not $url) { $url = $env:YANDEX_DATABASE_URL }
if (-not $url) {
  throw 'Set DATABASE_URL or YANDEX_DATABASE_URL to emibd connection string.'
}
Push-Location $RepoRoot
try {
  $env:DATABASE_URL = $url
  $names = @(
    '20260411123000_diary_entry_situation_tags',
    '20260413133000_remove_notifications',
    '20260414110000_add_behavior_alt_to_diary_entry',
    '20260416120000_add_reflection',
    '20260416130000_add_tas_attempt',
    '20260418100000_user_phone_nullable_email'
  )
  foreach ($n in $names) {
    Write-Host "resolve --applied $n"
    npx prisma migrate resolve --applied $n
  }
  npx prisma migrate deploy
}
finally {
  Pop-Location
}
Write-Host 'Done.'
