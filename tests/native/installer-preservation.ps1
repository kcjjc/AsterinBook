$taskWorkspace = [IO.Path]::GetFullPath((Get-Location).Path)
$taskInstallPath = [IO.Path]::GetFullPath((Join-Path $taskWorkspace '.superpowers/installer-verification/程序 安装'))
if(-not $taskInstallPath.StartsWith($taskWorkspace + [IO.Path]::DirectorySeparatorChar)){throw 'Unexpected install directory'}
$taskInstaller = Join-Path $taskWorkspace 'src-tauri/target/release/bundle/nsis/AsterinBook_0.1.0_x64-setup.exe'
$taskNative = Get-Content 'docs/verification/native-smoke-results.json' | ConvertFrom-Json
$taskDb = Join-Path $taskNative.base '迁移后 数据/reader.db'
$taskDbHash = (Get-FileHash -LiteralPath $taskDb).Hash
$taskConfig = Join-Path $env:APPDATA 'local.asterinbook.reader'
New-Item -ItemType Directory -Path $taskConfig -Force | Out-Null
$taskMarker = Join-Path $taskConfig ("installer-preservation-" + [guid]::NewGuid() + '.txt')
[IO.File]::WriteAllText($taskMarker,'AsterinBook verification fixture')
$taskResult = [ordered]@{installPath=$taskInstallPath;dataRoot=(Split-Path $taskDb);configDir=$taskConfig;dbSha256=$taskDbHash}
try {
 $taskUpgrade = Start-Process -FilePath $taskInstaller -ArgumentList "/S /D=$taskInstallPath" -WindowStyle Hidden -PassThru -Wait
 if($taskUpgrade.ExitCode -ne 0){throw 'Upgrade failed'}
 if(-not (Test-Path -LiteralPath $taskMarker)){throw 'Upgrade removed configuration directory'}
 $taskUninstall = Start-Process -FilePath (Join-Path $taskInstallPath 'uninstall.exe') -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
 Start-Sleep -Milliseconds 700
 if(Test-Path -LiteralPath (Join-Path $taskInstallPath 'asterinbook.exe')){throw 'Uninstall did not remove program'}
 if(-not (Test-Path -LiteralPath $taskMarker)){throw 'Uninstall removed configuration directory'}
 if((Get-FileHash -LiteralPath $taskDb).Hash -ne $taskDbHash){throw 'Uninstall changed library database'}
 $taskReinstall = Start-Process -FilePath $taskInstaller -ArgumentList "/S /D=$taskInstallPath" -WindowStyle Hidden -PassThru -Wait
 if($taskReinstall.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $taskMarker)){throw 'Reinstall failed preservation check'}
 $taskResult.status='passed';$taskResult.upgradeExit=$taskUpgrade.ExitCode;$taskResult.uninstallExit=$taskUninstall.ExitCode;$taskResult.reinstallExit=$taskReinstall.ExitCode
} finally {
 if(Test-Path -LiteralPath $taskMarker){Remove-Item -LiteralPath $taskMarker}
 $taskResult | ConvertTo-Json | Set-Content 'docs/verification/installer-preservation-results.json'
}
$taskResult | ConvertTo-Json
