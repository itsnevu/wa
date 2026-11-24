[CmdletBinding()]
param([string]$RaqioPath)

$ErrorActionPreference = 'Stop'

if (-not $RaqioPath) {
    $RaqioPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'Documents\raqio'
}
$raqioLauncher = Join-Path $RaqioPath 'dev.ps1'
if (-not (Test-Path -LiteralPath $raqioLauncher -PathType Leaf)) {
    throw "Launcher Raqio tidak ditemukan di $raqioLauncher. Gunakan -RaqioPath untuk lokasi lain."
}

$node = Get-Command node.exe -CommandType Application
$docker = Get-Command docker.exe -CommandType Application
$listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
$busy = @(3000, 3001, 3002 | Where-Object { $_ -in $listeners.Port })
if ($busy.Count) {
    throw "Port $($busy -join ', ') sudah dipakai. Hentikan server terkait dari terminal asalnya sebelum menjalankan launcher."
}

& $docker.Source info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) {
    throw 'Docker belum siap. Buka Docker Desktop, tunggu engine aktif, lalu jalankan ulang launcher.'
}

$oldPort = $env:PORT
$oldMigrate = $env:ALLOW_AUTO_MIGRATE
$wa = $null
try {
    try {
        $env:PORT = '3001'
        $env:ALLOW_AUTO_MIGRATE = '0'
        $wa = Start-Process -FilePath $node.Source -ArgumentList '--regexp-interpret-all', 'src/index.js' `
            -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
    } finally {
        $env:PORT = $oldPort
        $env:ALLOW_AUTO_MIGRATE = $oldMigrate
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($wa.HasExited) { throw "WA Suite berhenti saat startup (exit $($wa.ExitCode)). Lihat log di atas." }
        try {
            $ready = (Invoke-RestMethod 'http://127.0.0.1:3001/api/health' -TimeoutSec 1).ok -eq $true
        } catch {
            Start-Sleep -Milliseconds 500
        }
        if ($ready) { break }
    }
    if (-not $ready) { throw 'WA Suite belum siap di port 3001. Lihat log di atas.' }

    Write-Host 'WA Suite              http://127.0.0.1:3001'
    Write-Host 'Competitor Scraping   http://localhost:3002 (setelah Raqio siap)'
    Push-Location
    try {
        & $raqioLauncher
    } finally {
        Pop-Location
    }
} finally {
    if ($wa -and -not $wa.WaitForExit(3000)) {
        Stop-Process -InputObject $wa -ErrorAction SilentlyContinue
    }
}
