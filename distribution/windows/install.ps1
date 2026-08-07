$Root = Join-Path $env:LOCALAPPDATA 'Cleanflix Connector'
$Config = Join-Path $env:APPDATA 'Cleanflix Connector'
New-Item -ItemType Directory -Force -Path $Config | Out-Null
Copy-Item "$PSScriptRoot\..\common\config.env.example" "$Config\config.env" -Force
$Action = New-ScheduledTaskAction -Execute "$Root\node\node.exe" -Argument "`"$Root\server.js`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'Cleanflix Connector' -Action $Action -Trigger $Trigger -Force | Out-Null
Start-Process notepad.exe "$Config\config.env"
Write-Host "Edit config.env, then start the Cleanflix Connector scheduled task."
