$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '../.runtime'
$target = [IO.Path]::GetFullPath((Join-Path $runtime 'espeak'))
New-Item -ItemType Directory -Force $target | Out-Null
$installer = Join-Path $runtime 'espeak-ng.msi'
Invoke-WebRequest 'https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi' -OutFile $installer
$process = Start-Process msiexec.exe -ArgumentList @('/a', ('"' + $installer + '"'), '/qn', ('TARGETDIR="' + $target + '"')) -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Extraction eSpeak NG : $($process.ExitCode)" }
$engine = Join-Path $target 'eSpeak NG/espeak-ng.exe'
if (!(Test-Path -LiteralPath $engine)) { throw 'Exécutable eSpeak NG introuvable.' }
& $engine ('--path=' + (Split-Path $engine)) --version
if ($LASTEXITCODE -ne 0) { throw "Vérification eSpeak NG : $LASTEXITCODE" }
Write-Output "eSpeak NG disponible dans $target"
