param([string]$CmsDomain = $env:ICZPNET_CMS_DOMAIN)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($CmsDomain)) { throw 'ICZPNET_CMS_DOMAIN is required.' }
$resolved = (Resolve-Path -LiteralPath $CmsDomain).Path
if (-not (Test-Path (Join-Path $resolved 'IczpNet.Cms.Domain.csproj'))) { throw "Not an IczpNet.Cms.Domain project: $resolved" }
foreach ($entity in @('Article', 'CatalogEntry')) {
    dotnet run -c Release --project "$PSScriptRoot\..\src\IczpNet.CodeGenerator.Cli" -- validate $entity --project $resolved
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
