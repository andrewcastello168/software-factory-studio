$ErrorActionPreference = 'Stop'
$service = 'postgresql-x64-17'
$client = Join-Path $env:ProgramFiles 'PostgreSQL/17/bin/psql.exe'
if (-not (Test-Path $client)) { throw 'The Windows runner must provide PostgreSQL 17.' }
Set-Service -Name $service -StartupType Manual
Start-Service -Name $service
# The preinstalled runner uses this documented bootstrap password.
$env:PGPASSWORD = 'root'
$password = [Guid]::NewGuid().ToString('N')
if ($env:GITHUB_ACTIONS -eq 'true') { Write-Host "::add-mask::$password" }
try {
    & $client --host 127.0.0.1 --username postgres --dbname postgres --no-password --set ON_ERROR_STOP=1 -c "CREATE ROLE factory_test LOGIN PASSWORD '$password'" -c 'CREATE DATABASE factory_check OWNER factory_test' | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the disposable database.' }
} finally {
    Remove-Item Env:PGPASSWORD
}
'postgresql://factory_test:' + $password + '@127.0.0.1:5432/factory_check'
