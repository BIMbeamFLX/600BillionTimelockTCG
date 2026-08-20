<#
.SYNOPSIS
  Publish the card faces to a Blossom server, then prove they arrived.

.DESCRIPTION
  Card faces are content-addressed: the census names each one by sha256, and the
  wallet fetches it from a mirror and re-hashes it before it will show the card.
  So a face that is not on a mirror is a card that renders as "Blossom failed",
  and the census naming a hash nobody serves is the one state to avoid.

  Uploading is idempotent by construction. A blob already on the server has the
  same hash, so re-sending it changes nothing -- which is why this uploads ALL
  faces rather than a curated list of the ones that changed. A list can miss one;
  the full set cannot.

  --no-publish is deliberate. blossom-cli otherwise writes a NIP-94 metadata
  event and a BUD-03 server-list event per upload, which for 297 files is 297
  events on the relays for no benefit: nothing in this project discovers faces
  through NIP-94, it reads the hash out of the census.

.PARAMETER Server
  Blossom server. Defaults to the project's own mirror.

.PARAMETER FaceDir
  Where the .webp faces live.

.PARAMETER VerifyOnly
  Skip uploading and only report which census hashes the server already serves.

.NOTES
  THE SIGNING KEY IS YOURS AND STAYS YOURS. blossom-cli reads it from
  BLOSSOM_SECRET_KEY and signs locally; this script never reads, prints or
  stores it. Set it in the shell you run this from:

      $env:BLOSSOM_SECRET_KEY = "nsec1..."

  and close that shell afterwards, or use a session that does not persist
  history.
#>
[CmdletBinding()]
param(
  [string]$Server = "https://blossom.bimcvp.com",
  [string]$FaceDir = "$PSScriptRoot\..\art\cards\node-runner-web",
  [string]$Census = "$PSScriptRoot\..\cards\nutft-census.json",
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"

$faces = Get-ChildItem -Path (Join-Path $FaceDir "*.webp") -File
if (-not $faces) { throw "No .webp faces found in $FaceDir" }

if (-not $VerifyOnly) {
  if (-not $env:BLOSSOM_SECRET_KEY) {
    throw "BLOSSOM_SECRET_KEY is not set. blossom-cli signs the upload with it and this script never handles it: set it in this shell first."
  }

  Write-Host "Uploading $($faces.Count) faces to $Server" -ForegroundColor Cyan
  $failed = @()
  $i = 0
  foreach ($face in $faces) {
    $i++
    Write-Progress -Activity "Uploading card faces" -Status "$i / $($faces.Count)  $($face.Name)" `
      -PercentComplete ($i * 100 / $faces.Count)
    # 2>&1 is deliberately NOT used: blossom-cli's stderr can quote the request,
    # and this is the one process on the machine holding the signing key.
    $null = & uvx blossom-cli upload --server $Server --no-publish --format json $face.FullName
    if ($LASTEXITCODE -ne 0) { $failed += $face.Name }
  }
  Write-Progress -Activity "Uploading card faces" -Completed

  if ($failed.Count -gt 0) {
    Write-Host "$($failed.Count) upload(s) failed:" -ForegroundColor Yellow
    $failed | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
    if ($failed.Count -gt 10) { Write-Host "  ... and $($failed.Count - 10) more" }
  } else {
    Write-Host "All $($faces.Count) uploads reported success" -ForegroundColor Green
  }
}

# ---------------------------------------------------------------- verification
#
# The upload reporting success is not the same as the mirror serving the bytes,
# and the census is what the wallet actually asks for. So this checks the hashes
# the CENSUS names, not the files on disk -- if those two ever disagree, that is
# the more important thing to find out.

Write-Host "`nVerifying the hashes the census names..." -ForegroundColor Cyan
$census = Get-Content -Raw -Path $Census | ConvertFrom-Json
$named = @($census.cards | Where-Object { $_.face } | ForEach-Object { $_.face.sha256 } | Select-Object -Unique)

$missing = @()
$n = 0
foreach ($hash in $named) {
  $n++
  Write-Progress -Activity "Checking the mirror" -Status "$n / $($named.Count)" `
    -PercentComplete ($n * 100 / $named.Count)
  try {
    $res = Invoke-WebRequest -Uri "$Server/$hash.webp" -Method Head -TimeoutSec 20 -UseBasicParsing
    if ($res.StatusCode -ne 200) { $missing += $hash }
  } catch {
    $missing += $hash
  }
}
Write-Progress -Activity "Checking the mirror" -Completed

if ($missing.Count -eq 0) {
  Write-Host "All $($named.Count) census faces are on $Server" -ForegroundColor Green
  Write-Host "The wallet's Blossom check will pass for every card."
} else {
  Write-Host "$($missing.Count) of $($named.Count) census faces are NOT on $Server:" -ForegroundColor Red
  $missing | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
  if ($missing.Count -gt 10) { Write-Host "  ... and $($missing.Count - 10) more" }
  Write-Host "`nThose cards will render as 'Blossom failed' until they are served."
  exit 1
}
