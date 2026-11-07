param(
  [string]$ModelZipUrl = "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $projectRoot "assets\models\vosk-model-small-fr"
$targetTar = Join-Path $targetDir "model.tar.gz"
$tempRoot = Join-Path $env:TEMP ("solfun-vosk-" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempRoot "model.zip"
$extractDir = Join-Path $tempRoot "extract"
$stageDir = Join-Path $tempRoot "stage"
$modelStageDir = Join-Path $stageDir "model"

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
  New-Item -ItemType Directory -Path $modelStageDir -Force | Out-Null

  Write-Host "[1/5] Telechargement du modele FR..."
  Invoke-WebRequest -Uri $ModelZipUrl -OutFile $zipPath -UseBasicParsing

  Write-Host "[2/5] Extraction du ZIP..."
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $sourceModelDir = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
  if (-not $sourceModelDir) {
    throw "Aucun dossier de modele detecte dans l'archive." 
  }

  Write-Host "[3/5] Preparation de la structure model/..."
  Copy-Item -Path (Join-Path $sourceModelDir.FullName "*") -Destination $modelStageDir -Recurse -Force

  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw "La commande 'tar' est introuvable sur cette machine."
  }

  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

  Write-Host "[4/5] Creation de model.tar.gz..."
  Push-Location $stageDir
  tar -czf $targetTar model
  Pop-Location

  Write-Host "[5/5] Installation terminee: $targetTar"
  Write-Host "Tu peux maintenant relancer Solfun en mode Vosk."
}
finally {
  if (Test-Path $tempRoot) {
    Remove-Item -Path $tempRoot -Recurse -Force
  }
}
