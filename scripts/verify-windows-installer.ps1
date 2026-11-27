# Run only under a disposable Windows account, such as the hosted CI runner.
param(
    [Parameter(Mandatory)][string]$Candidate,
    [Parameter(Mandatory)][string]$Previous,
    [switch]$DisposableAccount
)

$ErrorActionPreference = 'Stop'
if (-not $DisposableAccount -or -not $IsWindows) {
    throw 'Use PowerShell 7 on a disposable Windows account and pass -DisposableAccount.'
}
$Candidate = (Resolve-Path $Candidate).Path
$Previous = (Resolve-Path $Previous).Path
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('factory-installer-' + [Guid]::NewGuid().ToString('N'))
$product = 'Software Factory Studio'
$install = Join-Path $env:LOCALAPPDATA 'Programs\Software Factory Studio'
$profile = Join-Path $env:APPDATA $product
$exe = Join-Path $install 'Software Factory Studio.exe'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"
$desktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) "$product.lnk"
$uninstallRegistry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Get-StudioRegistration {
    @(Get-ChildItem $uninstallRegistry -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath } |
        Where-Object { $_.DisplayName -eq $product })
}
if ((Test-Path $install) -or (Test-Path $profile) -or (Test-Path $startMenu) -or (Test-Path $desktop) -or
    (Get-StudioRegistration).Count -gt 0) {
    throw 'The test requires a clean, disposable account. Existing Studio files and registrations were left intact.'
}

function Invoke-Installer([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(600000)) {
        throw "Installer did not finish within ten minutes: $File"
    }
    if ($process.ExitCode -ne 0) { throw "Installer exited $($process.ExitCode): $File" }
}

function Assert-Installed([string]$Version) {
    $entry = @(Get-StudioRegistration)
    if ($entry.Count -ne 1 -or $entry[0].DisplayVersion -ne $Version -or $entry[0].Publisher -ne $product) {
        throw "The current-user uninstall entry does not match $Version."
    }
    if (-not (Test-Path $exe -PathType Leaf) -or -not (Test-Path $startMenu -PathType Leaf) -or (Test-Path $desktop)) {
        throw 'Unexpected executable or shortcut state.'
    }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($startMenu)
    if ($link.TargetPath -ne $exe) { throw 'Start Menu shortcut does not target the installed application.' }
    $entry[0]
}

function Invoke-InstalledSmoke([string]$Operation, [string]$Version) {
    $env:FACTORY_INSTALLED_EXECUTABLE = $exe
    $env:FACTORY_INSTALL_LIFECYCLE = $Operation
    $env:FACTORY_INSTALL_FIXTURE = $fixture
    $env:FACTORY_INSTALL_VERSION = $Version
    pnpm test:electron installer.spec.ts --output "dist/installer-evidence/$Operation"
    if ($LASTEXITCODE -ne 0) { throw "Installed application smoke failed at $Operation." }
    Write-Output "Verified installed application $Version at $Operation."
}

New-Item -Path $fixture -ItemType Directory | Out-Null
$version = (Get-Content apps/desktop/package.json -Raw | ConvertFrom-Json).version
try {
    Invoke-Installer $Previous '/S /currentuser'
    $null = Assert-Installed '1.0.0-rc.0'
    Invoke-InstalledSmoke 'seed' '1.0.0-rc.0'
    $paths = @('preferences.json', 'recent-projects.json', 'engineering-library.json')
    $hashes = @{}
    foreach ($path in $paths) { $hashes[$path] = (Get-FileHash (Join-Path $profile $path)).Hash }

    Invoke-Installer $Candidate '/S /currentuser'
    $registered = Assert-Installed $version
    Invoke-InstalledSmoke 'upgrade' $version

    Invoke-Installer $Candidate '/S /currentuser'
    $registered = Assert-Installed $version
    Invoke-InstalledSmoke 'reinstall' $version

    if ($registered.QuietUninstallString -notmatch '^"([^"]+)" (/currentuser /S)$') {
        throw 'The registry does not provide the expected per-user quiet uninstaller.'
    }
    $uninstaller = $Matches[1]
    $arguments = $Matches[2]
    if ((Split-Path $uninstaller) -ne $install -or -not (Test-Path $uninstaller -PathType Leaf)) {
        throw 'The registered uninstaller is outside the tested installation.'
    }
    Invoke-Installer $uninstaller $arguments
    $limit = (Get-Date).AddMinutes(2)
    while ((Test-Path $exe) -or (Test-Path $startMenu) -or @(Get-StudioRegistration).Count -gt 0) {
        if ((Get-Date) -gt $limit) { throw 'Uninstall did not remove the executable, shortcut and registration.' }
        Start-Sleep -Milliseconds 500
    }
    foreach ($path in $paths) {
        if ((Get-FileHash (Join-Path $profile $path)).Hash -ne $hashes[$path]) { throw "User data changed: $path" }
    }
    if (-not (Test-Path (Join-Path $fixture 'Client project café\client-owned.txt') -PathType Leaf)) {
        throw 'The client directory changed during uninstall.'
    }
    Write-Output 'Verified removal of application files and registration with preserved profile and client files.'
    Invoke-Installer $Candidate '/S /currentuser'
    $null = Assert-Installed $version
    Invoke-InstalledSmoke 'after-uninstall' $version
} finally {
    Remove-Item Env:FACTORY_INSTALL_LIFECYCLE, Env:FACTORY_INSTALL_FIXTURE, Env:FACTORY_INSTALL_VERSION -ErrorAction SilentlyContinue
}
