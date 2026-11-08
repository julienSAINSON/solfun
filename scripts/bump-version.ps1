param(
  [string]$Path = "assets/app-version.json"
)

if (-not (Test-Path -LiteralPath $Path)) {
  throw "Version file not found: $Path"
}

$content = Get-Content -LiteralPath $Path -Raw
$data = $content | ConvertFrom-Json
$current = [string]$data.version

if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
  throw "Invalid version format: $current"
}

$major = [int]$Matches[1]
$minor = [int]$Matches[2]
$patch = [int]$Matches[3] + 1

$data.version = "$major.$minor.$patch"

$data | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding utf8
Write-Output "Version bumped to $($data.version)"
