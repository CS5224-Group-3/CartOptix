#Requires -Version 5.1
<#
.SYNOPSIS
    Verifies the Issue #7 release pipeline on a development machine, without AWS.

.DESCRIPTION
    Runs the parts of the acceptance criteria that need no cloud access:

      1. The workflow files pass actionlint.
      2. deploy/development/compose.yml renders, so the YAML and the Compose
         semantics are both valid.
      3. release.sh passes shell syntax checking.
      4. release.sh completes end to end against a local Compose stack: the pull
         is skipped, migrations run once, the seed import runs once, api is
         recreated, web is recreated after api, and /health/ready is polled
         until it returns 200.
      5. Running release.sh again with another release tag restores that
         release, with no schema rollback.

    What this cannot verify, because it needs the real host and the real
    registry: the Deploy workflow, the SSM command, the ECR pull, the Elastic
    IP, the arm64 images, and whether an older image is compatible with a newer
    schema. Those are the reviewer's checks on the development instance.

    The images are built for the local architecture on purpose. Architecture
    correctness belongs to CI, which builds linux/arm64 natively; emulating
    arm64 here would only make the build slow.

.PARAMETER RepoRoot
    Repository root. Defaults to two directories above this script.

.PARAMETER Release
    Commit SHA to build and release. Defaults to the Git HEAD of the checkout,
    or to a synthetic 40-character SHA when the checkout is not a Git
    repository, which is the case for a downloaded ZIP.

.PARAMETER PreviousRelease
    Second release tag used for the rollback check. Defaults to another
    synthetic SHA.

.PARAMETER WebPort
    Host port for the stack. Defaults to 80 when it is free, otherwise the
    first free port from 8080 upwards.

.PARAMETER SkipBuild
    Reuse images that are already tagged locally.

.PARAMETER SkipStack
    Run only the static checks. Nothing that needs a Docker engine.

.PARAMETER SkipRollback
    Do not run the rollback check.

.PARAMETER NoDownload
    Never download actionlint. Fail the static check when it is absent.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File deploy/development/verify-local.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File deploy/development/verify-local.ps1 -SkipBuild -SkipRollback
#>
[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$Release,
    [string]$PreviousRelease,
    [int]$WebPort = 0,
    [switch]$SkipBuild,
    [switch]$SkipStack,
    [switch]$SkipRollback,
    [switch]$NoDownload
)

# Version 1 catches uninitialised variables, which are the mistakes worth
# catching here, without failing on the optional properties of caught
# exceptions.
Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# The GitHub release tag carries a "v" prefix (v1.7.12) but the Docker Hub
# image tag does not (1.7.12). Mixing them up yields a confusing
# "manifest unknown" at pull time, so keep the two spellings apart.
$ActionlintVersion = '1.7.12'
$LocalRegistry = 'cartoptix-local'
$LocalDbPassword = 'local-verification-only'

$script:Results = New-Object System.Collections.Generic.List[object]

function Write-Step {
    param([string]$Text)
    Write-Host ''
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Add-Result {
    param(
        [Parameter(Mandatory = $true)][string]$Check,
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'FAIL', 'SKIP')][string]$Result,
        [string]$Detail = ''
    )
    $script:Results.Add([pscustomobject]@{ Check = $Check; Result = $Result; Detail = $Detail })
    $colour = switch ($Result) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        default { 'Yellow' }
    }
    Write-Host ("[{0}] {1} - {2}" -f $Result, $Check, $Detail) -ForegroundColor $colour
}

function Invoke-Tool {
    <#
        Runs a native command and reports its exit code.

        Output is streamed to this console unless -Capture is given, so a long
        build is visible while it runs. -Capture is only for commands whose text
        is needed for a check.

        Environment variables and the working directory are set for the duration
        of the call and then restored, because a release must be able to point at
        its own registry without disturbing the session.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory,
        [hashtable]$Environment,
        [switch]$Capture
    )

    $saved = @{}
    if ($Environment) {
        foreach ($key in $Environment.Keys) {
            $saved[$key] = [Environment]::GetEnvironmentVariable($key)
            Set-Item -Path "Env:$key" -Value ([string]$Environment[$key])
        }
    }

    $pushed = $false
    if ($WorkingDirectory) {
        Push-Location -LiteralPath $WorkingDirectory
        $pushed = $true
    }

    $exitCode = 127
    $text = ''
    try {
        if ($Capture) {
            # ForEach-Object { $_.ToString() } keeps stderr readable: without it
            # PowerShell wraps each stderr line in an ErrorRecord and prints the
            # position of the call site with it.
            $text = (& $FilePath @ArgumentList 2>&1 | ForEach-Object { $_.ToString() } | Out-String).Trim()
            $exitCode = $LASTEXITCODE
        }
        else {
            & $FilePath @ArgumentList
            $exitCode = $LASTEXITCODE
        }
    }
    catch {
        $text = $_.Exception.Message
        $exitCode = 127
    }
    finally {
        if ($pushed) { Pop-Location }
        if ($Environment) {
            foreach ($key in $saved.Keys) {
                if ($null -eq $saved[$key]) {
                    Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
                }
                else {
                    Set-Item -Path "Env:$key" -Value $saved[$key]
                }
            }
        }
    }

    return [pscustomobject]@{ ExitCode = $exitCode; Text = $text }
}

function New-SyntheticSha {
    param([Parameter(Mandatory = $true)][string]$Seed)
    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Seed)
        return (($sha1.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha1.Dispose()
    }
}

function Test-PortFree {
    param([Parameter(Mandatory = $true)][int]$Port)
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($listener) { $listener.Stop() }
    }
}

function Get-HttpStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 10
    )
    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if ($curl) {
        $result = Invoke-Tool -Capture -FilePath $curl.Source -ArgumentList @(
            '--silent', '--output', 'NUL', '--write-out', '%{http_code}',
            '--max-time', "$TimeoutSeconds", $Url
        )
        return $result.Text.Trim()
    }
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
        return [string][int]$response.StatusCode
    }
    catch {
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            return [string][int]$_.Exception.Response.StatusCode
        }
        return 'ERROR'
    }
}

function Get-ContainerRelease {
    <#
        Reads the com.cartoptix.release label off a container.

        The obvious template, {{index .Config.Labels "com.cartoptix.release"}},
        does not survive the trip through PowerShell: the embedded double quotes
        are stripped before docker.exe sees them, and docker then reports
        'function "com" not defined' and returns nothing. {{json ...}} needs no
        quoting, so the map is parsed on this side instead.
    #>
    param([Parameter(Mandatory = $true)][string]$Container)
    $result = Invoke-Tool -Capture -FilePath 'docker' -ArgumentList @(
        'inspect', '--format', '{{json .Config.Labels}}', $Container
    )
    if ($result.ExitCode -ne 0 -or $result.Text.Length -eq 0) { return '' }
    try {
        $labels = $result.Text | ConvertFrom-Json
        $value = $labels.'com.cartoptix.release'
        if ($null -eq $value) { return '' }
        return ([string]$value).Trim()
    }
    catch {
        return ''
    }
}

# ---------------------------------------------------------------- preflight

Write-Host 'CartOptix local verification for Issue #7' -ForegroundColor White

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$DeployDir = Join-Path $RepoRoot 'deploy\development'
$ComposeFile = Join-Path $DeployDir 'compose.yml'
$ReleaseScript = Join-Path $DeployDir 'release.sh'

Write-Host "Repository: $RepoRoot"

$required = @(
    $ComposeFile,
    $ReleaseScript,
    (Join-Path $DeployDir 'web.Dockerfile'),
    (Join-Path $RepoRoot 'apps\api\Dockerfile'),
    (Join-Path $RepoRoot '.github\workflows\publish.yml'),
    (Join-Path $RepoRoot '.github\workflows\deploy.yml'),
    (Join-Path $RepoRoot '.github\workflows\ci.yml')
)
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count -gt 0) {
    Write-Host 'Missing required files:' -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 2
}

if (-not $Release) {
    $gitSha = ''
    if (Get-Command 'git' -ErrorAction SilentlyContinue) {
        $git = Invoke-Tool -Capture -FilePath 'git' -WorkingDirectory $RepoRoot -ArgumentList @('rev-parse', 'HEAD')
        if ($git.ExitCode -eq 0 -and $git.Text -match '^[0-9a-f]{40}$') { $gitSha = $git.Text }
    }
    if ($gitSha) {
        $Release = $gitSha
        Write-Host 'Release:   Git HEAD (this checkout is a Git repository)'
    }
    else {
        $Release = New-SyntheticSha "cartoptix-local|$RepoRoot|$([DateTime]::UtcNow.ToString('o'))"
        Write-Host 'Release:   synthetic SHA (this checkout is not a Git repository)' -ForegroundColor Yellow
    }
}
elseif ($Release -notmatch '^[0-9a-f]{40}$') {
    Write-Host '-Release must be a 40-character commit SHA.' -ForegroundColor Red
    exit 2
}

if (-not $PreviousRelease) {
    $PreviousRelease = New-SyntheticSha "cartoptix-local-previous|$RepoRoot|$Release"
}
Write-Host "Release:   $Release"
Write-Host "Previous:  $PreviousRelease"

$engineUp = $false
$engineVersion = ''
if (Get-Command 'docker' -ErrorAction SilentlyContinue) {
    $info = Invoke-Tool -Capture -FilePath 'docker' -ArgumentList @('info', '--format', '{{.ServerVersion}}')
    # A reachable engine answers with a version such as 27.3.1. The text check
    # matters because the CLI also exits zero in some failures, where the only
    # output is the connection error on stderr.
    if ($info.ExitCode -eq 0 -and $info.Text -match '^\d+\.\d+') {
        $engineUp = $true
        $engineVersion = $info.Text
    }
}

$bashExe = ''
foreach ($candidate in @(
        (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
        (Join-Path $env:ProgramFiles 'Git\usr\bin\bash.exe')
    )) {
    if (Test-Path -LiteralPath $candidate) { $bashExe = $candidate; break }
}
if (-not $bashExe) {
    $found = Get-Command 'bash' -ErrorAction SilentlyContinue
    if ($found) { $bashExe = $found.Source }
}

# release.sh calls dirname, sed, tail, cut and seq. On Linux those live in
# /usr/bin and are always on PATH. Git for Windows keeps them in <git>\usr\bin,
# which is added only when bash runs as a login shell. Launching bash.exe
# directly from PowerShell therefore yields "dirname: command not found" and
# exit 127, which looks like a bug in release.sh but is not.
#
# Prepending <git>\usr\bin to PATH does NOT work here - measured, that entry is
# dropped before bash sees it. Running bash with -l does work, so the release
# calls below pass -l. The detection underneath only feeds the diagnostic line.
$bashCoreutilsDir = ''
if ($bashExe) {
    $probe = Split-Path -Parent $bashExe
    for ($depth = 0; $depth -lt 4 -and $probe; $depth++) {
        $candidateBin = Join-Path $probe 'usr\bin'
        if (Test-Path -LiteralPath (Join-Path $candidateBin 'dirname.exe')) {
            $bashCoreutilsDir = $candidateBin
            break
        }
        $probe = Split-Path -Parent $probe
    }
}

Write-Host ''
Write-Host 'Environment'
Write-Host ("  docker engine : {0}" -f $(if ($engineUp) { $engineVersion } else { 'not reachable' }))
Write-Host ("  bash          : {0}" -f $(if ($bashExe) { $bashExe } else { 'not found' }))
Write-Host ("  bash coreutils: {0}" -f $(if ($bashCoreutilsDir) { $bashCoreutilsDir } else { 'not found - release.sh may fail with exit 127' }))

if (-not $engineUp) {
    Write-Host ''
    Write-Host 'The Docker engine is not reachable.' -ForegroundColor Yellow
    Write-Host '  1. Start Docker Desktop and wait for it to report that the engine is running.' -ForegroundColor Yellow
    Write-Host '  2. Run: docker context use desktop-linux' -ForegroundColor Yellow
    Write-Host '  3. Confirm with: docker info --format "{{.ServerVersion}}"' -ForegroundColor Yellow
    Write-Host 'Static checks still run below.' -ForegroundColor Yellow
}

# --------------------------------------------------------- 1. actionlint

Write-Step '1. Static check: workflow files pass actionlint'

$actionlintPath = ''
$actionlintSource = ''
$onPath = Get-Command 'actionlint' -ErrorAction SilentlyContinue
if ($onPath) {
    $actionlintPath = $onPath.Source
    $actionlintSource = 'PATH'
}
if (-not $actionlintPath) {
    $localTool = Join-Path $RepoRoot '.tools\actionlint.exe'
    if (Test-Path -LiteralPath $localTool) {
        $actionlintPath = $localTool
        $actionlintSource = '.tools'
    }
}

if (-not $actionlintPath -and $engineUp) {
    $dockerLint = Invoke-Tool -Capture -FilePath 'docker' -ArgumentList @(
        'run', '--rm', '-v', "${RepoRoot}:/repo", '--workdir', '/repo', "rhysd/actionlint:$ActionlintVersion",
        '.github/workflows/ci.yml', '.github/workflows/publish.yml', '.github/workflows/deploy.yml'
    )
    if ($dockerLint.ExitCode -eq 0) {
        Add-Result -Check 'actionlint' -Result 'PASS' -Detail "3 workflows, no findings (rhysd/actionlint:$ActionlintVersion image)"
    }
    else {
        $firstThree = (($dockerLint.Text -split "`n") | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 3) -join ' | '
        Add-Result -Check 'actionlint' -Result 'FAIL' -Detail $firstThree
    }
}

if (-not $actionlintPath -and -not $engineUp -and -not $NoDownload) {
    Write-Host "  Downloading actionlint $ActionlintVersion (checksum verified)..." -ForegroundColor DarkGray
    $toolsDir = Join-Path $RepoRoot '.tools'
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $zipName = "actionlint_${ActionlintVersion}_windows_amd64.zip"
    $zipPath = Join-Path $toolsDir $zipName
    $baseUrl = "https://github.com/rhysd/actionlint/releases/download/v$ActionlintVersion"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        if (-not (Test-Path -LiteralPath $zipPath)) {
            Invoke-WebRequest -Uri "$baseUrl/$zipName" -OutFile $zipPath -UseBasicParsing -TimeoutSec 180
        }
        $sumsPath = Join-Path $toolsDir 'actionlint_checksums.txt'
        Invoke-WebRequest -Uri "$baseUrl/actionlint_${ActionlintVersion}_checksums.txt" -OutFile $sumsPath -UseBasicParsing -TimeoutSec 60
        $line = Get-Content -LiteralPath $sumsPath | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1
        if (-not $line) { throw 'the checksum file does not list the archive' }
        $want = ($line.Trim() -split '\s+')[0].ToLower()
        $got = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower()
        if ($want -ne $got) { throw "checksum mismatch: expected $want, got $got" }
        Expand-Archive -LiteralPath $zipPath -DestinationPath $toolsDir -Force
        $actionlintPath = Join-Path $toolsDir 'actionlint.exe'
        $actionlintSource = 'downloaded to .tools'
    }
    catch {
        Add-Result -Check 'actionlint' -Result 'FAIL' -Detail "download failed: $($_.Exception.Message)"
    }
}

if ($actionlintPath -and (Test-Path -LiteralPath $actionlintPath)) {
    $workflows = @(
        '.github/workflows/ci.yml',
        '.github/workflows/publish.yml',
        '.github/workflows/deploy.yml'
    )
    $lint = Invoke-Tool -Capture -FilePath $actionlintPath -WorkingDirectory $RepoRoot -ArgumentList $workflows
    if ($lint.ExitCode -eq 0) {
        Add-Result -Check 'actionlint' -Result 'PASS' -Detail "$($workflows.Count) workflows, no findings ($actionlintSource)"
    }
    else {
        $firstThree = (($lint.Text -split "`n") | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 3) -join ' | '
        Add-Result -Check 'actionlint' -Result 'FAIL' -Detail $firstThree
    }
}
elseif (-not ($script:Results | Where-Object { $_.Check -eq 'actionlint' })) {
    Add-Result -Check 'actionlint' -Result 'SKIP' -Detail 'not installed; rerun without -NoDownload'
}

# ------------------------------------------- 2. compose file renders

Write-Step '2. Static check: deploy/development/compose.yml renders'

$localEnv = @{
    IMAGE_REGISTRY    = $LocalRegistry
    RELEASE           = $Release
    POSTGRES_DB       = 'cartoptix'
    POSTGRES_USER     = 'cartoptix'
    POSTGRES_PASSWORD = $LocalDbPassword
}

if (-not (Get-Command 'docker' -ErrorAction SilentlyContinue)) {
    Add-Result -Check 'compose config' -Result 'SKIP' -Detail 'the docker CLI is not installed'
}
else {
    $config = Invoke-Tool -Capture -FilePath 'docker' -WorkingDirectory $DeployDir -Environment $localEnv -ArgumentList @(
        'compose', '--file', $ComposeFile, 'config', '--quiet'
    )
    if ($config.ExitCode -eq 0) {
        Add-Result -Check 'compose config' -Result 'PASS' -Detail 'YAML and Compose semantics are valid'
    }
    else {
        Add-Result -Check 'compose config' -Result 'FAIL' -Detail (($config.Text -split "`n" | Select-Object -First 3) -join ' | ')
    }
}

# ------------------------------------------- 3. release.sh syntax

Write-Step '3. Static check: release.sh shell syntax'

if (-not $bashExe) {
    Add-Result -Check 'bash -n release.sh' -Result 'SKIP' -Detail 'bash not found; install Git for Windows'
}
else {
    $syntax = Invoke-Tool -Capture -FilePath $bashExe -ArgumentList @('-n', $ReleaseScript)
    if ($syntax.ExitCode -eq 0) {
        Add-Result -Check 'bash -n release.sh' -Result 'PASS' -Detail 'no syntax errors'
    }
    else {
        Add-Result -Check 'bash -n release.sh' -Result 'FAIL' -Detail $syntax.Text
    }
}

# ------------------------------------------- 4. the stack

if ($SkipStack) {
    Write-Step '4. Local Compose stack (skipped)'
    Add-Result -Check 'release.sh against a local stack' -Result 'SKIP' -Detail '-SkipStack was passed'
    Add-Result -Check '/health/ready returns 200' -Result 'SKIP' -Detail '-SkipStack was passed'
}
elseif (-not $engineUp) {
    Write-Step '4. Local Compose stack'
    Add-Result -Check 'release.sh against a local stack' -Result 'SKIP' -Detail 'the Docker engine is not running'
}
elseif (-not $bashExe) {
    Write-Step '4. Local Compose stack'
    Add-Result -Check 'release.sh against a local stack' -Result 'SKIP' -Detail 'bash not found'
}
else {
    if ($WebPort -le 0) {
        $WebPort = 0
        if (Test-PortFree -Port 80) { $WebPort = 80 }
        else {
            foreach ($candidate in 8080..8090) {
                if (Test-PortFree -Port $candidate) { $WebPort = $candidate; break }
            }
        }
        if ($WebPort -eq 0) {
            Add-Result -Check 'picking a host port' -Result 'FAIL' -Detail 'no free port found between 8080 and 8090'
        }
        elseif ($WebPort -ne 80) {
            Write-Host "  Port 80 is in use, using $WebPort instead." -ForegroundColor Yellow
        }
    }

    $envFile = Join-Path $DeployDir '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        Write-Host '  Creating deploy/development/.env for local verification.' -ForegroundColor DarkGray
        @(
            '# Created by verify-local.ps1. Local verification only; never used on the host.',
            "IMAGE_REGISTRY=$LocalRegistry",
            "RELEASE=$Release",
            'POSTGRES_DB=cartoptix',
            'POSTGRES_USER=cartoptix',
            "POSTGRES_PASSWORD=$LocalDbPassword"
        ) | Set-Content -LiteralPath $envFile -Encoding ASCII
    }
    elseif (-not (Select-String -LiteralPath $envFile -Pattern '^IMAGE_REGISTRY=' -Quiet)) {
        Add-Result -Check 'deploy/development/.env' -Result 'FAIL' -Detail 'the existing .env has no IMAGE_REGISTRY; add it as .env.example shows'
    }

    if ($SkipBuild) {
        Write-Host '  Skipping the image build (-SkipBuild).' -ForegroundColor DarkGray
    }
    else {
        Write-Step "4a. Building $LocalRegistry images for the local architecture"
        Write-Host '    CI builds linux/arm64 natively; this build only exercises the deploy path.' -ForegroundColor DarkGray

        $apiBuild = Invoke-Tool -FilePath 'docker' -WorkingDirectory $RepoRoot -ArgumentList @(
            'build', '--file', 'apps/api/Dockerfile', '--tag', "$LocalRegistry/cartoptix-api:$Release", '.'
        )
        if ($apiBuild.ExitCode -eq 0) {
            Add-Result -Check 'build the api image' -Result 'PASS' -Detail "$LocalRegistry/cartoptix-api:$Release"
        }
        else {
            Add-Result -Check 'build the api image' -Result 'FAIL' -Detail "docker build exited $($apiBuild.ExitCode)"
        }

        $webBuild = Invoke-Tool -FilePath 'docker' -WorkingDirectory $RepoRoot -ArgumentList @(
            'build', '--file', 'deploy/development/web.Dockerfile', '--tag', "$LocalRegistry/cartoptix-web:$Release", '.'
        )
        if ($webBuild.ExitCode -eq 0) {
            Add-Result -Check 'build the web image' -Result 'PASS' -Detail "$LocalRegistry/cartoptix-web:$Release"
        }
        else {
            Add-Result -Check 'build the web image' -Result 'FAIL' -Detail "docker build exited $($webBuild.ExitCode)"
        }
    }

    $buildFailed = @($script:Results | Where-Object { $_.Result -eq 'FAIL' -and $_.Check -like 'build the *' }).Count -gt 0
    if (-not $buildFailed) {
        Write-Step "4b. Releasing $Release with release.sh"
        $releaseEnv = @{
            IMAGE_REGISTRY = $LocalRegistry
            RELEASE        = $Release
            WEB_PORT       = [string]$WebPort
            SKIP_PULL      = '1'
            READY_ATTEMPTS = '40'
        }
        $releaseRun = Invoke-Tool -FilePath $bashExe -WorkingDirectory $DeployDir -Environment $releaseEnv -ArgumentList @(
            '-l', ($ReleaseScript -replace '\\', '/'), $Release
        )
        if ($releaseRun.ExitCode -eq 0) {
            Add-Result -Check 'release.sh against a local stack' -Result 'PASS' -Detail "exit 0 for $Release"
        }
        else {
            Add-Result -Check 'release.sh against a local stack' -Result 'FAIL' -Detail "exit $($releaseRun.ExitCode); see the output above"
        }

        Write-Step '4c. Smoke checks through web'
        $smoke = [ordered]@{
            '/health/live'                       = 200
            '/health/ready'                      = 200
            '/api/v1/catalogue'                  = 200
            '/api/v1/products?page=1&pageSize=5' = 200
            '/'                                  = 200
        }
        foreach ($path in $smoke.Keys) {
            $status = Get-HttpStatus -Url "http://127.0.0.1:$WebPort$path"
            if ($status -eq [string]$smoke[$path]) {
                Add-Result -Check "GET $path" -Result 'PASS' -Detail "HTTP $status"
            }
            else {
                Add-Result -Check "GET $path" -Result 'FAIL' -Detail "expected HTTP $($smoke[$path]), got $status"
            }
        }

        foreach ($container in @('cartoptix-api', 'cartoptix-web')) {
            $label = Get-ContainerRelease -Container $container
            if ($label -eq $Release) {
                Add-Result -Check "$container release label" -Result 'PASS' -Detail $label
            }
            else {
                Add-Result -Check "$container release label" -Result 'FAIL' -Detail "expected $Release, got '$label'"
            }
        }

        # --------------------------------------- 5. rollback

        if ($SkipRollback) {
            Write-Step '5. Rollback (skipped)'
            Add-Result -Check 'rollback restores a previous release' -Result 'SKIP' -Detail '-SkipRollback was passed'
        }
        else {
            Write-Step "5. Rolling back to $PreviousRelease"
            Write-Host '    A previous release is identified by its tag alone, so this needs no rebuild.' -ForegroundColor DarkGray

            $apiTag = Invoke-Tool -Capture -FilePath 'docker' -ArgumentList @(
                'tag', "$LocalRegistry/cartoptix-api:$Release", "$LocalRegistry/cartoptix-api:$PreviousRelease"
            )
            $webTag = Invoke-Tool -Capture -FilePath 'docker' -ArgumentList @(
                'tag', "$LocalRegistry/cartoptix-web:$Release", "$LocalRegistry/cartoptix-web:$PreviousRelease"
            )
            if ($apiTag.ExitCode -ne 0 -or $webTag.ExitCode -ne 0) {
                Add-Result -Check 'rollback restores a previous release' -Result 'SKIP' -Detail 'the images are not present locally; run without -SkipBuild'
            }
            else {
                Write-Host '    Note: both tags point at the same local build. This exercises the rollback' -ForegroundColor DarkGray
                Write-Host '    path, not the compatibility of an older image with a newer schema.' -ForegroundColor DarkGray
                $rollbackEnv = @{
                    IMAGE_REGISTRY = $LocalRegistry
                    RELEASE        = $PreviousRelease
                    WEB_PORT       = [string]$WebPort
                    SKIP_PULL      = '1'
                    READY_ATTEMPTS = '40'
                }
                $rollbackRun = Invoke-Tool -FilePath $bashExe -WorkingDirectory $DeployDir -Environment $rollbackEnv -ArgumentList @(
                    '-l', ($ReleaseScript -replace '\\', '/'), $PreviousRelease
                )
                if ($rollbackRun.ExitCode -eq 0) {
                    $label = Get-ContainerRelease -Container 'cartoptix-api'
                    if ($label -eq $PreviousRelease) {
                        Add-Result -Check 'rollback restores a previous release' -Result 'PASS' -Detail "api runs release $PreviousRelease, no schema rollback"
                    }
                    else {
                        Add-Result -Check 'rollback restores a previous release' -Result 'FAIL' -Detail "api label is '$label'"
                    }
                }
                else {
                    Add-Result -Check 'rollback restores a previous release' -Result 'FAIL' -Detail "exit $($rollbackRun.ExitCode)"
                }
            }
        }

        Write-Host ''
        Write-Host 'The stack is still running. To stop it:' -ForegroundColor DarkGray
        Write-Host "    docker compose --file `"$ComposeFile`" down" -ForegroundColor DarkGray
        Write-Host 'The PostgreSQL volume is kept, so a later release reuses the imported data.' -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------- summary

Write-Step 'Summary'

$width = 20
$maxCheck = ($script:Results | ForEach-Object { $_.Check.Length } | Measure-Object -Maximum).Maximum
if ($maxCheck -gt $width) { $width = $maxCheck }

foreach ($row in $script:Results) {
    Write-Host ("  {0}  {1}  {2}" -f $row.Result.PadRight(4), $row.Check.PadRight($width), $row.Detail)
}

$failures = @($script:Results | Where-Object { $_.Result -eq 'FAIL' })
$skipped = @($script:Results | Where-Object { $_.Result -eq 'SKIP' })
Write-Host ''
Write-Host ("  {0} passed, {1} failed, {2} skipped" -f ($script:Results.Count - $failures.Count - $skipped.Count), $failures.Count, $skipped.Count)

if ($failures.Count -gt 0) {
    exit 1
}

Write-Host ''
Write-Host 'Local verification passed.' -ForegroundColor Green
exit 0
