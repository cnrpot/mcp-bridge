$ErrorActionPreference = 'Stop'
# Build-process-only environment. Never changes global proxy, TLS or signing settings.
$probe = [Uri]'https://github.com'
$proxy = [System.Net.WebRequest]::DefaultWebProxy.GetProxy($probe)
if ($proxy -and $proxy.AbsoluteUri -ne $probe.AbsoluteUri) {
    $env:HTTPS_PROXY = $proxy.AbsoluteUri
    $env:HTTP_PROXY = $proxy.AbsoluteUri
    $env:GLOBAL_AGENT_HTTP_PROXY = $proxy.AbsoluteUri
    $env:GLOBAL_AGENT_HTTPS_PROXY = $proxy.AbsoluteUri
    $env:ELECTRON_GET_USE_PROXY = '1'
}
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Remove-Item Env:CSC_LINK,Env:WIN_CSC_LINK,Env:CSC_NAME,Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Set-Location (Split-Path $PSScriptRoot -Parent)
npm run check
if ($LASTEXITCODE -ne 0) { throw 'Syntax checks failed' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
npm run dist
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
