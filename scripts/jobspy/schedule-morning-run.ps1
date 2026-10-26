<#
Sets up the morning JobSpy run: Windows Task Scheduler runs scheduled.py every day, waking the
computer from sleep if need be, and the jobs it finds are waiting in JobScratch on any device.

From PowerShell in the JobScratch folder:

    powershell -ExecutionPolicy Bypass -File scripts\jobspy\schedule-morning-run.ps1              # every day at 07:00
    powershell -ExecutionPolicy Bypass -File scripts\jobspy\schedule-morning-run.ps1 -At 06:30
    powershell -ExecutionPolicy Bypass -File scripts\jobspy\schedule-morning-run.ps1 -RunNow      # and run it once now, to try it
    powershell -ExecutionPolicy Bypass -File scripts\jobspy\schedule-morning-run.ps1 -Remove      # stop the morning runs

The first time, it makes a helper token, saves it in scripts\jobspy\.env and copies it to the
clipboard: add it in Vercel as JOBSCRATCH_HELPER_TOKEN (see the README). The task runs as you,
while you're signed in to Windows; a computer that's asleep wakes up for it, one that's off
runs it the next time it's on.
#>
param(
    [string]$At = "07:00",
    [string]$Url = "https://jobscratch.vercel.app",
    [switch]$RunNow,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$TaskName = "JobScratch morning JobSpy run"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "The morning run is off. (scripts\jobspy\.env is left as it is.)"
    } else {
        Write-Host "There was no morning run set up."
    }
    return
}

# pythonw runs without opening a window at 7am; everything it does is written to scheduled.log.
$python = Join-Path $here ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $python)) {
    throw "JobSpy isn't installed in scripts\jobspy\.venv yet. Follow the JobSpy steps in the README first."
}

$envFile = Join-Path $here ".env"
if (-not (Test-Path $envFile)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    Set-Content -Path $envFile -Encoding ascii -Value @("JOBSCRATCH_URL=$Url", "JOBSCRATCH_HELPER_TOKEN=$token")
    Set-Clipboard -Value $token
    Write-Host ""
    Write-Host "Made a helper token and saved it in scripts\jobspy\.env. It's on your clipboard now:"
    Write-Host "add it in Vercel (your project > Settings > Environment Variables) as JOBSCRATCH_HELPER_TOKEN,"
    Write-Host "then redeploy. Keep it private: it lets this computer add jobs to your JobScratch."
    Write-Host ""
}

$time = [datetime]::ParseExact($At, "HH:mm", $null)
$action = New-ScheduledTaskAction -Execute $python -Argument "`"$(Join-Path $here 'scheduled.py')`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -RunOnlyIfNetworkAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force `
    -Description "Runs your saved JobSpy search for JobScratch (scripts\jobspy\scheduled.py). Log: scripts\jobspy\scheduled.log" | Out-Null

Write-Host "The morning run is set up for $($time.ToString('HH:mm')) every day."
Write-Host "If the computer sleeps, Windows wakes it for the run when wake timers are allowed:"
Write-Host "Control Panel > Power Options > Change plan settings > Change advanced power settings > Sleep > Allow wake timers."

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Running it once now. It takes a few minutes; see scripts\jobspy\scheduled.log, then JobScratch."
}
