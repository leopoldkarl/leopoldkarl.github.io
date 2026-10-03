# Richtet die Windows-Aufgabe "Trainingsdaten synchronisieren" ein.
#   - taeglich um 10:00, 12:00 und 15:00 und 10 Minuten nach jeder Anmeldung
#   - war der Rechner zu einem Termin aus, wird der Lauf beim naechsten Start nachgeholt
#   - laeuft unsichtbar (pythonw), Protokoll: %USERPROFILE%\garmin-training\sync.log
# Aufruf in PowerShell im Ordner training\sync:
#   powershell -ExecutionPolicy Bypass -File .\aufgabe_einrichten.ps1
# Entfernen:
#   Unregister-ScheduledTask -TaskName 'Trainingsdaten synchronisieren'

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command python.exe).Source }

$action = New-ScheduledTaskAction -Execute $py -Argument '"training_sync.py" auto' -WorkingDirectory $dir
$t10 = New-ScheduledTaskTrigger -Daily -At '10:00'
$t12 = New-ScheduledTaskTrigger -Daily -At '12:00'
$t15 = New-ScheduledTaskTrigger -Daily -At '15:00'
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$logon.Delay = 'PT10M'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'Trainingsdaten synchronisieren' -Action $action `
    -Trigger $t10, $t12, $t15, $logon -Settings $settings -Principal $principal -Force `
    -Description 'Holt neue Garmin-Aktivitaeten und laedt sie verschluesselt auf leopoldkarl.com/training' | Out-Null

Write-Host "Aufgabe eingerichtet. Python: $py"
Write-Host "Test jetzt:  Start-ScheduledTask -TaskName 'Trainingsdaten synchronisieren'"
Write-Host "Protokoll:   $env:USERPROFILE\garmin-training\sync.log"
