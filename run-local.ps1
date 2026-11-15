# Optional: run from the terminal instead of F5. Reads .env, then starts the app on http://localhost:5224
#   powershell -ExecutionPolicy Bypass -File .\run-local.ps1
Get-Content "$PSScriptRoot\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#=\s][^=]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process') }
}
$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:ASPNETCORE_URLS = "http://localhost:5224"
dotnet run --project "$PSScriptRoot\CrediTrack.Api\CrediTrack.Api.csproj" --no-launch-profile
