# Runs the Playwright suite against a throwaway database. Never touches the real WTF database.
#
#   .\run.ps1                              # all tests (the test accounts' password is made and saved on the first run)
#   .\run.ps1 tests\waste                  # arguments go to `playwright test`
#   .\run.ps1 -KeepDatabase                # leave the database (and print its name) for a look afterwards
#   .\run.ps1 -Serve                       # start the database, API and app, then wait (create .e2e-stop to shut down)
#
# What it does: creates WTF_E2E_<time> on LocalDB (tools\E2eDb), starts the API on 5290 against it and the app on 4300
# (a server already answering on a port is reused and left running), runs the tests, then stops what it started and
# drops the database. E2E_SQL points it at another SQL Server (default: LocalDB).
param(
    [switch]$KeepDatabase,
    [switch]$Serve,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$PlaywrightArgs
)

$ErrorActionPreference = 'Stop'

# Playwright prints UTF-8 (the arrow in test titles); Windows PowerShell reads native output with the old console code page
# unless told otherwise, which shows it as garbage characters.
try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $OutputEncoding = [Console]::OutputEncoding
}
catch {
    # No console attached (for example a background run): nothing to set.
}

# The test accounts' password: E2E_PASSWORD if set, else the one saved in .e2e-password (git-ignored). The first
# run makes a random one, so no credential is ever committed.
if (-not $env:E2E_PASSWORD) {
    $passwordFile = Join-Path $PSScriptRoot '.e2e-password'
    if (-not (Test-Path $passwordFile)) {
        $bytes = New-Object byte[] 18
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $generated = [Convert]::ToBase64String($bytes).Replace('+', 'x').Replace('/', 'y') + 'Aa1!'
        [IO.File]::WriteAllText($passwordFile, $generated)
        Write-Host "Made a password for the throwaway test accounts and saved it in $passwordFile (git-ignored)."
    }

    $env:E2E_PASSWORD = (Get-Content $passwordFile -Raw).Trim()
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$apiPort = 5290
$appPort = 4300
$logs = Join-Path $env:TEMP 'wtf-e2e'
# Builds go to their own folder, so a dev API you have running (it locks WTF.Api's bin folder) never blocks a run.
$artifacts = Join-Path $env:TEMP 'wtf-e2e-artifacts'
New-Item -ItemType Directory -Force $logs | Out-Null

$started = @()
$database = $null
$exitCode = 1

# Everything this script prints also goes to .e2e-last-run.log (git-ignored), so the run can be followed from another
# terminal with: Get-Content .e2e-last-run.log -Wait -Tail 40
$runLog = Join-Path $PSScriptRoot '.e2e-last-run.log'
Set-Content -Path $runLog -Value "Run started $(Get-Date -Format 's')" -Encoding UTF8

function Write-Host {
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Message)
    $text = $Message -join ' '
    Microsoft.PowerShell.Utility\Write-Host $text
    Add-Content -Path $runLog -Value $text -Encoding UTF8
}

function Test-Url([string]$url) {
    try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

function Wait-Url([string]$url, [int]$seconds, [string]$what) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Url $url) { return }
        Start-Sleep -Seconds 2
    }
    throw "$what did not answer at $url within $seconds seconds. Logs are in $logs."
}

try {
    if (-not $env:E2E_SQL) {
        # Prefer the tests' own LocalDB instance, so they never depend on (or disturb) the default one. When LocalDB does not
        # work in this Windows session (a broken instance registration is common), fall back to SQL Express. Either way only
        # databases named WTF_E2E_* are ever created or dropped; the real WTF database is never touched.
        $instance = if ($env:E2E_LOCALDB_INSTANCE) { $env:E2E_LOCALDB_INSTANCE } else { 'WtfE2E' }
        $ErrorActionPreference = 'Continue'
        $localDbReady = $false
        $known = (& sqllocaldb info 2>&1 | Out-String) -split '\s+'
        if ($known -notcontains $instance) {
            $createOutput = & sqllocaldb create $instance 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                Write-Host "LocalDB: $($createOutput.Trim())"
            }
        }

        $localDbOutput = & sqllocaldb start $instance 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) {
            # "start" can report success and the SQL process still fail when it is first used, so try a real connection.
            $probe = New-Object System.Data.SqlClient.SqlConnection "Server=(localdb)\$instance;Integrated Security=true;Initial Catalog=master;TrustServerCertificate=true;Connect Timeout=30"
            try {
                $probe.Open()
                $localDbReady = $true
            }
            catch {
                Write-Host "LocalDB instance $instance started but would not accept a connection: $($_.Exception.Message)"
            }
            finally {
                $probe.Dispose()
            }
        }
        else {
            Write-Host "LocalDB instance $instance could not start: $($localDbOutput.Trim())"
        }

        $ErrorActionPreference = 'Stop'
        if ($localDbReady) {
            $env:E2E_SQL = "Server=(localdb)\$instance;Integrated Security=true;TrustServerCertificate=true"
        }
        else {
            Write-Host 'LocalDB is not usable here, so SQL Express (.\SQLEXPRESS) is used instead.'
            $env:E2E_SQL = 'Server=.\SQLEXPRESS;Integrated Security=true;TrustServerCertificate=true'
        }
    }

    # A run that was stopped half way leaves its database behind: remove those first.
    dotnet run --artifacts-path $artifacts --project (Join-Path $root 'tools\E2eDb') -- drop-all | ForEach-Object { Write-Host $_ }

    Write-Host 'Creating the throwaway database...'
    $created = dotnet run --artifacts-path $artifacts --project (Join-Path $root 'tools\E2eDb') -- create
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the throwaway database.' }
    $info = ($created | Select-Object -Last 1) | ConvertFrom-Json
    $database = $info.database
    Write-Host "  $database"

    if (Test-Url "http://localhost:$apiPort/api/health") {
        throw "Something already answers on port $apiPort. Stop it first: it may point at another database."
    }

    Write-Host "Starting the API on $apiPort..."
    $env:ConnectionStrings__WtfDb = $info.connectionString
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    # All test workers call the public ordering and chat endpoints from one address; lift those per-address limits.
    $env:RateLimiting__Multiplier = '100'
    $api = Start-Process -FilePath 'dotnet' -PassThru -WindowStyle Hidden `
        -ArgumentList @('run', '--no-launch-profile', '--artifacts-path', "`"$artifacts`"", '--project', "`"$(Join-Path $root 'src\WTF.Api')`"", '--urls', "http://localhost:$apiPort") `
        -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api.err')
    $started += $api
    Remove-Item Env:\ConnectionStrings__WtfDb, Env:\ASPNETCORE_ENVIRONMENT, Env:\RateLimiting__Multiplier -ErrorAction SilentlyContinue
    Wait-Url "http://localhost:$apiPort/api/health" 240 'The API'

    if (Test-Url "http://localhost:$appPort") {
        Write-Host "Reusing the app already running on $appPort."
    }
    else {
        Write-Host "Starting the app on $appPort..."
        $app = Start-Process -FilePath 'cmd.exe' -PassThru -WindowStyle Hidden -WorkingDirectory (Join-Path $root 'src\wtf-pos') `
            -ArgumentList @('/c', "npx ng serve --configuration e2e --port $appPort") `
            -RedirectStandardOutput (Join-Path $logs 'app.log') -RedirectStandardError (Join-Path $logs 'app.err')
        $started += $app
        Wait-Url "http://localhost:$appPort" 300 'The app'
    }

    if ($Serve) {
        # Leave the throwaway stack up so several people (or agents) can run `npx playwright test <file>` against it.
        $stopFile = Join-Path $PSScriptRoot '.e2e-stop'
        Remove-Item $stopFile -ErrorAction SilentlyContinue
        Write-Host "READY: API http://localhost:$apiPort, app http://localhost:$appPort, database $database"
        Write-Host "Stop it by creating $stopFile"
        while (-not (Test-Path $stopFile)) { Start-Sleep -Seconds 2 }
        Remove-Item $stopFile -ErrorAction SilentlyContinue
        $exitCode = 0
    }
    else {
        Write-Host 'Running the tests...'
        Push-Location $PSScriptRoot
        $previousPreference = $ErrorActionPreference
        try {
            # Node prints a harmless warning on stderr when both NO_COLOR and FORCE_COLOR are set; PowerShell 5.1
            # would turn that into a terminating error.
            $ErrorActionPreference = 'Continue'
            Remove-Item Env:\NO_COLOR, Env:\FORCE_COLOR -ErrorAction SilentlyContinue
            # Each line is shown and appended to the run log as it arrives.
            npx playwright test @PlaywrightArgs 2>&1 | ForEach-Object {
                $line = "$_"
                Microsoft.PowerShell.Utility\Write-Host $line
                Add-Content -Path $runLog -Value $line -Encoding UTF8
            }
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousPreference
            Pop-Location
        }
    }
}
catch {
    # Show the reason and keep it in the log, instead of the window closing with the error unread.
    Write-Host "ERROR: $($_.Exception.Message)"
    $exitCode = 1
}
finally {
    foreach ($process in $started) {
        if ($process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F | Out-Null
        }
    }

    if ($database) {
        if ($KeepDatabase) {
            Write-Host "Database kept: $database (drop it with: dotnet run --project tools\E2eDb -- drop $database)"
        }
        else {
            Start-Sleep -Seconds 2
            dotnet run --no-build --artifacts-path $artifacts --project (Join-Path $root 'tools\E2eDb') -- drop $database | Out-Null
            Write-Host "Dropped $database."
        }
    }
}

# Started by double-click or "Run with PowerShell" (the parent is Explorer): wait, so the result can be read.
$parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction SilentlyContinue).ParentProcessId
if ($parentId -and (Get-Process -Id $parentId -ErrorAction SilentlyContinue).ProcessName -eq 'explorer') {
    Microsoft.PowerShell.Utility\Write-Host "Finished with exit code $exitCode. Press Enter to close."
    [void](Read-Host)
}

exit $exitCode
