$taskWorkspace = [IO.Path]::GetFullPath((Get-Location).Path)
$taskTestRoot = [IO.Path]::GetFullPath((Join-Path $taskWorkspace '.superpowers/change-0.1.1'))
$taskInstall = Join-Path $taskTestRoot '升级测试 安装'
if (-not $taskInstall.StartsWith($taskWorkspace + [IO.Path]::DirectorySeparatorChar)) { throw 'Unexpected test install path' }
$taskExisting = Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -eq 'AsterinBook' }
if ($taskExisting) { throw 'An existing user installation is registered; do not replace it with a test installation' }
$taskOld = Join-Path $taskTestRoot 'AsterinBook_0.1.0_x64-setup.exe'
$taskNew = Join-Path $taskWorkspace 'src-tauri/target/release/bundle/nsis/AsterinBook_0.1.1_x64-setup.exe'
$taskBootstrap = Join-Path $env:APPDATA 'local.asterinbook.reader/bootstrap.json'
$taskBootstrapHash = if (Test-Path -LiteralPath $taskBootstrap) { (Get-FileHash -LiteralPath $taskBootstrap).Hash } else { $null }
$taskPrior = Get-Content .superpowers/change-0.1.1/native-smoke-0.1.0.json | ConvertFrom-Json
$taskData = [IO.Path]::GetFullPath((Join-Path $taskPrior.base '迁移后 数据'))
if (-not $taskData.StartsWith($taskWorkspace + [IO.Path]::DirectorySeparatorChar)) { throw 'Unexpected fixture data path' }
$taskDb = Join-Path $taskData 'reader.db'
$taskDataHash = (Get-FileHash -LiteralPath $taskDb).Hash
$taskResult = [ordered]@{from='0.1.0';to='0.1.1';installPath=$taskInstall;fixtureDataRoot=$taskData;dbSha256=$taskDataHash;started=[DateTime]::UtcNow.ToString('o');status='failed'}
try {
  $taskOldProcess = Start-Process -FilePath $taskOld -ArgumentList "/S /D=$taskInstall" -WindowStyle Hidden -Wait -PassThru
  if ($taskOldProcess.ExitCode -ne 0) { throw 'Old version install failed' }
  $taskExe = Join-Path $taskInstall 'asterinbook.exe'
  $taskResult.oldFileVersion = (Get-Item -LiteralPath $taskExe).VersionInfo.FileVersion
  if ($taskResult.oldFileVersion -notlike '0.1.0*') { throw 'Expected old executable' }
  $taskUpgradeProcess = Start-Process -FilePath $taskNew -ArgumentList "/S /D=$taskInstall" -WindowStyle Hidden -Wait -PassThru
  if ($taskUpgradeProcess.ExitCode -ne 0) { throw 'Version upgrade failed' }
  $taskResult.newFileVersion = (Get-Item -LiteralPath $taskExe).VersionInfo.FileVersion
  if ($taskResult.newFileVersion -notlike '0.1.1*') { throw 'Expected new executable' }
  $taskRegistered = Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -eq 'AsterinBook' }
  if ($taskRegistered.DisplayVersion -ne '0.1.1' -or $taskRegistered.InstallLocation.Trim('"') -ne $taskInstall) { throw 'Upgrade registration incorrect' }
  if ((Get-FileHash -LiteralPath $taskDb).Hash -ne $taskDataHash) { throw 'Upgrade changed the reading database' }
  $taskAfterBootstrap = if (Test-Path -LiteralPath $taskBootstrap) { (Get-FileHash -LiteralPath $taskBootstrap).Hash } else { $null }
  if ($taskAfterBootstrap -ne $taskBootstrapHash) { throw 'Upgrade changed the user library locator' }
  $taskResult.oldInstallExit = $taskOldProcess.ExitCode
  $taskResult.upgradeExit = $taskUpgradeProcess.ExitCode
  $taskResult.bootstrapPreserved = $true
  $taskResult.readingDataPreserved = $true
  $taskResult.status = 'passed'
} finally {
  $taskRegistered = Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -eq 'AsterinBook' }
  $taskUninstall = Join-Path $taskInstall 'uninstall.exe'
  if ($taskRegistered -and (Test-Path -LiteralPath $taskUninstall) -and $taskRegistered.InstallLocation.Trim('"') -eq $taskInstall) {
    $taskCleanup = Start-Process -FilePath $taskUninstall -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    Start-Sleep -Milliseconds 700
    $taskResult.cleanupExit = $taskCleanup.ExitCode
    $taskResult.testInstallationRemoved = -not (Test-Path -LiteralPath (Join-Path $taskInstall 'asterinbook.exe'))
  }
  $taskResult | ConvertTo-Json | Set-Content docs/verification/upgrade-0.1.1-results.json
}
$taskResult | ConvertTo-Json
