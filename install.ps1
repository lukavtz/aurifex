#Requires -Version 5.1
# Install Aurifex into every detected host (OMP, DSH, Claude Code).
#
#   powershell -c "irm https://raw.githubusercontent.com/lukavtz/aurifex/main/install.ps1 | iex"
#
# Environment:
#   AURIFEX_REF         git ref to download (default: main)
#   AURIFEX_HOME        persistent install root (default: %LOCALAPPDATA%\Aurifex)
#   AURIFEX_SOURCE_DIR  use an existing checkout instead of downloading
#   AURIFEX_DRY_RUN=1   print the planned host commands without running them
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Repo = "lukavtz/aurifex"
$Ref = if ($env:AURIFEX_REF) { $env:AURIFEX_REF } else { "main" }
$HomeDir = $env:AURIFEX_HOME
if (-not $HomeDir) {
    if ($env:LOCALAPPDATA) {
        $HomeDir = Join-Path $env:LOCALAPPDATA "Aurifex"
    } else {
        $HomeDir = Join-Path $HOME ".aurifex"
    }
}
$PersistDir = Join-Path $HomeDir "src"
$SourceDir = $env:AURIFEX_SOURCE_DIR
$DryRun = $env:AURIFEX_DRY_RUN -eq "1"
$ScratchDir = $null
$StageDir = $null
$Failure = $null

function Fail([string]$Message) {
    [Console]::Error.WriteLine("aurifex install: $Message")
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js was not found. Install Node.js >= 24.9 from https://nodejs.org/ and retry."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm was not found. npm ships with Node.js; reinstall Node.js >= 24.9 and retry."
}

$NodeVersion = (& node -e "process.stdout.write(process.versions.node)").Trim()
if ($LASTEXITCODE -ne 0 -or $NodeVersion -notmatch '^(\d+)\.(\d+)\.') {
    Fail "could not read the Node.js version; reinstall Node.js >= 24.9 and retry."
}
$NodeMajor = [int]$Matches[1]
$NodeMinor = [int]$Matches[2]
if ($NodeMajor -lt 24 -or ($NodeMajor -eq 24 -and $NodeMinor -lt 9)) {
    Fail "Node.js >= 24.9 is required (found $NodeVersion). Update Node.js from https://nodejs.org/ and retry."
}

if ($PSVersionTable.PSVersion.Major -lt 6) {
    try {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {
        # Older platforms without TLS 1.2 support; Invoke-WebRequest will report the failure.
    }
}

try {
    if (-not $SourceDir) {
        $RecordedRef = if (Test-Path (Join-Path $PersistDir ".aurifex-ref")) {
            (Get-Content -Path (Join-Path $PersistDir ".aurifex-ref") -Raw).Trim()
        } else {
            $null
        }
        if ($Ref -ne "main" -and (Test-Path (Join-Path $PersistDir "package.json")) -and $RecordedRef -eq $Ref) {
            Write-Host "Using existing Aurifex checkout: $PersistDir ($Ref)"
            $SourceDir = $PersistDir
        } else {
            New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
            $ScratchDir = Join-Path $HomeDir ("download-" + [guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Path $ScratchDir | Out-Null
            $Archive = Join-Path $ScratchDir "aurifex.zip"
            Write-Host "Downloading $Repo@$Ref..."
            Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $Archive -UseBasicParsing
            $StageDir = Join-Path $HomeDir ("src-stage-" + [guid]::NewGuid().ToString("N"))
            Expand-Archive -Path $Archive -DestinationPath $StageDir -Force
            $Root = Get-ChildItem -Path $StageDir -Directory | Select-Object -First 1
            if (-not $Root) {
                throw "the downloaded archive did not contain the repository"
            }
            Set-Content -Path (Join-Path $Root.FullName ".aurifex-ref") -Value $Ref -NoNewline
            $BackupDir = Join-Path $HomeDir ("src-previous-" + [guid]::NewGuid().ToString("N"))
            if (Test-Path $PersistDir) {
                Move-Item -Path $PersistDir -Destination $BackupDir
            }
            try {
                Move-Item -Path $Root.FullName -Destination $PersistDir
            } catch {
                if (Test-Path $BackupDir) {
                    Move-Item -Path $BackupDir -Destination $PersistDir
                }
                throw
            }
            if (Test-Path $BackupDir) {
                Remove-Item -Path $BackupDir -Recurse -Force
            }
            Remove-Item -Path $StageDir -Recurse -Force -ErrorAction SilentlyContinue
            $SourceDir = $PersistDir
        }
    }

    if (-not (Test-Path (Join-Path $SourceDir "package.json"))) {
        throw "no package.json in $SourceDir; refusing to install"
    }

    if (-not (Test-Path (Join-Path $SourceDir "dist/cli.js"))) {
        Write-Host "Building Aurifex..."
        Push-Location $SourceDir
        try {
            & npm install --silent --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed in $SourceDir"
            }
        } finally {
            Pop-Location
        }
    }

    if (-not (Test-Path (Join-Path $SourceDir "dist/cli.js"))) {
        throw "the build did not produce dist/cli.js in $SourceDir"
    }

    $CliArgs = @("install", "--source", $SourceDir)
    if ($env:AURIFEX_HOSTS) {
        $CliArgs += @("--host", $env:AURIFEX_HOSTS)
    }
    if ($env:AURIFEX_SCOPE) {
        $CliArgs += @("--scope", $env:AURIFEX_SCOPE)
    }
    if ($env:AURIFEX_YES -eq "1") {
        $CliArgs += "--yes"
    }
    if ($DryRun) {
        $CliArgs += "--dry-run"
    }
    Push-Location $SourceDir
    try {
        & node "dist/cli.js" @CliArgs
        if ($LASTEXITCODE -ne 0) {
            throw "aurifex install failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    if (-not $DryRun) {
        if ($SourceDir.Contains('"')) {
            throw "install path contains an unsafe character for the launcher"
        }
        $BinDir = $env:AURIFEX_BIN_DIR
        if (-not $BinDir) {
            $BinDir = Join-Path $HomeDir "bin"
        }
        New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
        $Launcher = Join-Path $BinDir "aurifex.cmd"
        Set-Content -Path $Launcher -Encoding ASCII -Value (
            "@echo off`r`nnode `"$SourceDir\dist\cli.js`" %*`r`n"
        )
        $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($UserPath -notlike "*$BinDir*") {
            [Environment]::SetEnvironmentVariable(
                "Path", (($UserPath, $BinDir) | Where-Object { $_ }) -join ";", "User"
            )
        }
        Write-Host "Installed CLI: $Launcher"
    }
} catch {
    $Failure = $_.Exception.Message
} finally {
    # Remove only the download scratch directory; the install root must persist.
    if ($ScratchDir -and (Test-Path $ScratchDir)) {
        Remove-Item -Path $ScratchDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($StageDir -and (Test-Path $StageDir)) {
        Remove-Item -Path $StageDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Failure) {
    [Console]::Error.WriteLine("aurifex install: $Failure")
    exit 1
}