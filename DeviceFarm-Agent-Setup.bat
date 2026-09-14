@echo off
setlocal enabledelayedexpansion

title DeviceFarm Agent — Setup

:: ═══════════════════════════════════════════════════════════════════════════
::  DEVICEFARM AGENT — ONE-CLICK INSTALLER
::  This script is all the customer needs.
::  It will:
::    1. Install Git (if missing)
::    2. Install Node.js LTS (if missing)
::    3. Install ADB platform-tools (if missing)
::    4. Clone / update the agent from GitHub
::    5. Install npm dependencies
::    6. Download Electron binary
::    7. Run payment verification
::    8. Launch the agent
:: ═══════════════════════════════════════════════════════════════════════════

echo.
echo  ================================================================
echo   DEVICEFARM DESKTOP AGENT  ^|  One-Click Setup
echo  ================================================================
echo.

:: ── Where to install the agent ─────────────────────────────────────────────
set "INSTALL_DIR=C:\DeviceFarmAgent"
set "REPO_URL=https://github.com/sammysam254/devicefarm-agent.git"
set "CURRENT_DIR=%~dp0"
if "%CURRENT_DIR:~-1%"=="\" set "CURRENT_DIR=%CURRENT_DIR:~0,-1%"

:: ── Full path to PowerShell (never rely on PATH for this) ──────────────────
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"

echo [*] Install directory : %INSTALL_DIR%
echo [*] Source repository : %REPO_URL%
echo.

:: ── Auto-close EVERYTHING before running (cloudflared, electron, scrcpy, adb, watchdog, port 7400) ──
echo [*] Terminating all previous agent processes, tunnels, and releasing ports...
taskkill /F /IM cloudflared.exe /T >nul 2>&1
taskkill /F /IM electron.exe /T >nul 2>&1
taskkill /F /IM scrcpy.exe /T >nul 2>&1
taskkill /F /IM adb.exe /T >nul 2>&1
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 7400 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {} };" ^
  "Get-CimInstance Win32_Process | Where-Object { ($_.Name -like 'node*' -and $_.CommandLine -and ($_.CommandLine.IndexOf('service-watchdog.js') -ge 0 -or $_.CommandLine.IndexOf('DeviceFarm') -ge 0 -or $_.CommandLine.IndexOf('devicefarm-agent') -ge 0)) } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }" >nul 2>&1
timeout /t 2 /nobreak >nul



:: ════════════════════════════════════════════════════════════════════════════
:: STEP 1 — Git
:: ════════════════════════════════════════════════════════════════════════════
echo [1/6] Checking Git...
set "GIT="
for /f "delims=" %%I in ('where git 2^>nul') do if not defined GIT set "GIT=%%I"
if not defined GIT if exist "%ProgramFiles%\Git\cmd\git.exe"       set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if not defined GIT if exist "%ProgramFiles(x86)%\Git\cmd\git.exe"  set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"
if not defined GIT if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"

if defined GIT (
    echo [OK] Git found: %GIT%
) else (
    echo [*] Git not found. Downloading Git for Windows...
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
        "Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.45.2.windows.1/Git-2.45.2-64-bit.exe' -OutFile '%TEMP%\git_installer.exe' -UseBasicParsing"
    if not exist "%TEMP%\git_installer.exe" (
        echo [ERROR] Could not download Git. Check your internet connection.
        pause & exit /b 1
    )
    echo [*] Installing Git silently — please wait...
    start /wait "" "%TEMP%\git_installer.exe" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"
    del "%TEMP%\git_installer.exe" >nul 2>nul
    set "GIT=%ProgramFiles%\Git\cmd\git.exe"
    if not exist "!GIT!" (
        echo [ERROR] Git installation failed. Please install from https://git-scm.com
        pause & exit /b 1
    )
    echo [OK] Git installed: !GIT!
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 2 — Node.js
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [2/6] Checking Node.js...
set "NODE="
set "NPM="

if exist "%ProgramFiles%\nodejs\node.exe"          set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%ProgramFiles%\nodejs\npm.cmd"           set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd"  set "NPM=%LOCALAPPDATA%\Programs\nodejs\npm.cmd"
if not defined NODE for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE set "NODE=%%I"
if not defined NPM  for /f "delims=" %%I in ('where npm.cmd 2^>nul') do if not defined NPM  set "NPM=%%I"
if not defined NPM  for /f "delims=" %%I in ('where npm 2^>nul')     do if not defined NPM  set "NPM=%%I"

if defined NODE (
    echo [OK] Node.js found: %NODE%
) else (
    echo [*] Node.js not found. Downloading LTS installer...
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
        "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi' -OutFile '%TEMP%\node_installer.msi' -UseBasicParsing"
    if not exist "%TEMP%\node_installer.msi" (
        echo [ERROR] Node.js download failed. Check your internet connection.
        pause & exit /b 1
    )
    echo [*] Installing Node.js — please wait...
    start /wait msiexec /i "%TEMP%\node_installer.msi" /qn /norestart ADDLOCAL=ALL
    del "%TEMP%\node_installer.msi" >nul 2>nul
    set "NODE=%ProgramFiles%\nodejs\node.exe"
    set "NPM=%ProgramFiles%\nodejs\npm.cmd"
    if not exist "!NODE!" (
        echo [ERROR] Node.js installation failed. Install from https://nodejs.org
        pause & exit /b 1
    )
    echo [OK] Node.js installed: !NODE!
)
if not defined NPM for %%I in ("%NODE%") do set "NPM=%%~dpInpm.cmd"
echo [OK] npm  : %NPM%

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 3 — ADB platform-tools
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [3/6] Checking ADB...
set "ADB="
if exist "%INSTALL_DIR%\assets\bin\adb.exe"  set "ADB=%INSTALL_DIR%\assets\bin\adb.exe"
if not defined ADB if exist "C:\platform-tools\adb.exe" set "ADB=C:\platform-tools\adb.exe"
if not defined ADB for /f "delims=" %%I in ('where adb 2^>nul') do if not defined ADB set "ADB=%%I"

if defined ADB (
    echo [OK] ADB found: %ADB%
) else (
    echo [*] ADB not found. Downloading Android SDK platform-tools...
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
        "Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile '%TEMP%\pt.zip' -UseBasicParsing"
    if exist "%TEMP%\pt.zip" (
        "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
            "Expand-Archive -Path '%TEMP%\pt.zip' -DestinationPath 'C:\' -Force"
        del "%TEMP%\pt.zip" >nul 2>nul
    )
    if exist "C:\platform-tools\adb.exe" (
        set "ADB=C:\platform-tools\adb.exe"
        echo [OK] ADB installed: C:\platform-tools\adb.exe
    ) else (
        echo [WARN] ADB install failed — device detection may not work until ADB is available.
    )
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 4 — Clone or update the agent repo
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [4/6] Setting up agent files...

if exist "%INSTALL_DIR%\.git" (
    echo [*] Agent directory exists — updating cleanly to latest version...
    taskkill /F /IM adb.exe /T >nul 2>&1
    taskkill /F /IM electron.exe /T >nul 2>&1
    taskkill /F /IM cloudflared.exe /T >nul 2>&1
    "%GIT%" -C "%INSTALL_DIR%" fetch origin main
    "%GIT%" -C "%INSTALL_DIR%" reset --hard origin/main
    echo [OK] Agent updated to latest version from GitHub.
) else (
    echo [*] Cloning agent from GitHub into %INSTALL_DIR% ...
    echo [*] Using shallow clone for faster download...
    "%GIT%" clone --depth 1 --single-branch --branch main "%REPO_URL%" "%INSTALL_DIR%"
    if %errorlevel% neq 0 (
        echo [ERROR] git clone failed. Check your internet connection.
        pause & exit /b 1
    )
    echo [OK] Agent cloned successfully.
)

:: Switch working directory to the install dir for all remaining steps
cd /d "%INSTALL_DIR%"
echo [OK] Working directory: %CD%

:: ── Add Node.js directory to PATH so npm postinstall scripts can call node ──
for %%I in ("%NODE%") do set "NODE_DIR=%%~dpI"
set "PATH=%NODE_DIR%;%PATH%"
echo [OK] Node.js added to PATH: %NODE_DIR%

:: Patch config.json with correct binary paths and Cloudflare token for this install location
echo [*] Patching config.json with local binary paths and Cloudflare token...
"%NODE%" -e "const fs=require('fs'),p='config.json',cfg=fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):{}; cfg.adbPath=require('path').join(process.cwd(),'assets','bin','adb.exe'); cfg.cloudflaredPath=require('path').join(process.cwd(),'assets','bin','cloudflared.exe'); if(!cfg.cloudflareToken) cfg.cloudflareToken='eyJhIjoiMjEzYzI3Y2IwOTVjZTBlMTE0ZTNkNWYzZDM3ODJiNWQiLCJ0IjoiMDVkMzUyZjgtZGU5Yi00MzBiLWIxYzUtNDUyNzNlZWQzOTExIiwicyI6Ik1qWmlaak13WVdZdE1UTmpPUzAwTm1NeExUZ3hNR0V0TlRWalpURTFNV1ZsTURNMSJ9'; fs.writeFileSync(p,JSON.stringify(cfg,null,2));"
echo [OK] config.json updated.

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 5 — npm install + Electron binary + scrcpy-server.jar
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo [5/6] Installing dependencies...

if exist "node_modules\winston\package.json" (
    echo [OK] npm dependencies already installed.
) else (
    echo [*] Running npm install — this may take a few minutes...
    call "%NPM%" install --no-audit --no-fund
    if !errorlevel! neq 0 (
        echo [ERROR] npm install failed. Check your internet connection and try again.
        pause & exit /b 1
    )
    echo [OK] npm packages installed.
)

:: Download scrcpy-server.jar if missing
if not exist "scrcpy-server.jar" (
    echo [*] Downloading scrcpy-server.jar...
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
        "Invoke-WebRequest -Uri 'https://github.com/Genymobile/scrcpy/releases/download/v2.4/scrcpy-server-v2.4' -OutFile 'scrcpy-server.jar' -UseBasicParsing"
    if exist "scrcpy-server.jar" (
        echo [OK] scrcpy-server.jar ready.
    ) else (
        echo [WARN] scrcpy-server.jar missing — streaming may fail!
    )
) else (
    echo [OK] scrcpy-server.jar already present.
)

:: Download Electron binary if missing
if not exist "node_modules\electron\dist\electron.exe" (
    echo [*] Downloading Electron v33.4.11...
    if not exist "node_modules\electron\dist" mkdir "node_modules\electron\dist" >nul 2>nul
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
        "Invoke-WebRequest -Uri 'https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-win32-x64.zip' -OutFile 'node_modules\electron\ez.zip' -UseBasicParsing"
    if exist "node_modules\electron\ez.zip" (
        "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
            "Expand-Archive -Path 'node_modules\electron\ez.zip' -DestinationPath 'node_modules\electron\dist' -Force"
        del "node_modules\electron\ez.zip" >nul 2>nul
        echo electron.exe> "node_modules\electron\path.txt"
    )
    if exist "node_modules\electron\dist\electron.exe" (
        echo [OK] Electron binary ready.
    ) else (
        echo [WARN] Electron binary not found — launch may fail.
    )
) else (
    echo [OK] Electron binary already present.
)

:: ════════════════════════════════════════════════════════════════════════════
:: STEP 6 — Payment verification + Launch
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo  ================================================================
echo   STEP 1: PAYMENT SYSTEM VERIFICATION  ($30 / month)
echo  ================================================================
echo.
echo [*] Generating Machine Binding Code...
"%NODE%" -e "const fs=require('fs'),p=require('path'),c=p.join(process.cwd(),'config.json'),cfg=fs.existsSync(c)?JSON.parse(fs.readFileSync(c)):{};if(!cfg.machineBindingCode||!/^\d{8}$/.test(cfg.machineBindingCode)){cfg.machineBindingCode=Math.floor(10000000+Math.random()*90000000).toString();fs.writeFileSync(c,JSON.stringify(cfg,null,2));}"
"%NODE%" "src\services\verify-payment.js"

:: ── Terminate any existing agent process on port 7400 to apply new code ──
echo [*] Stopping running agent instances to reload latest code...
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 7400 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {} }"
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "Stop-Process -Name 'electron','scrcpy' -Force -ErrorAction SilentlyContinue"
ping 127.0.0.1 -n 2 >nul 2>nul


echo.
echo  ================================================================
echo   STEP 2: RESETTING ADB SERVER
echo  ================================================================
echo.

:: ── Reset ADB so the phone gets a fresh authorization prompt ───────────────
echo [*] Resetting ADB server to force fresh USB authorization prompt...
set "ADB_BIN=%INSTALL_DIR%\assets\bin\adb.exe"
if not exist "%ADB_BIN%" set "ADB_BIN=adb"

:: Kill bundled ADB server
"%ADB_BIN%" kill-server >nul 2>&1
ping 127.0.0.1 -n 2 >nul

:: Restart ADB server with bundled binary
echo [*] Starting fresh ADB server...
"%ADB_BIN%" start-server >nul 2>&1
ping 127.0.0.1 -n 2 >nul

echo.
echo  ================================================================
echo   ACTION REQUIRED — READ THIS CAREFULLY
echo  ================================================================
echo.
echo   1. UNLOCK your phone screen right now
echo   2. Keep the phone screen ON and USB cable plugged in
echo   3. A popup asking "Allow USB Debugging?" should appear
echo   4. Tap ALLOW  (check "Always allow" to skip this next time)
echo.
echo   If no popup appears after 10 seconds:
echo     - Unplug the USB cable, wait 3 seconds, plug it back in
echo     - The popup should appear within 5 seconds
echo  ================================================================
echo.

:: Force a reconnect to re-trigger the auth handshake
"%ADB_BIN%" reconnect >nul 2>&1
ping 127.0.0.1 -n 3 >nul

:: Wait loop — check every 5 seconds for up to 60 seconds
set /a ADB_WAIT=0
:adb_auth_loop
set /a ADB_WAIT+=1
if %ADB_WAIT% gtr 12 goto adb_auth_timeout

:: Check if device is now authorized
"%ADB_BIN%" devices 2>nul | findstr /R "device$" >nul
if %errorlevel% equ 0 (
    echo [OK] Phone authorized successfully!
    "%ADB_BIN%" devices -l
    goto adb_auth_done
)

:: Still unauthorized — nudge it with a reconnect every 3 checks
set /a ADB_MOD=%ADB_WAIT% %% 3
if %ADB_MOD% equ 0 (
    "%ADB_BIN%" reconnect >nul 2>&1
)

echo [*] Waiting for phone authorization... attempt %ADB_WAIT%/12  ^(plug/unplug cable if no popup^)
ping 127.0.0.1 -n 6 >nul
goto adb_auth_loop

:adb_auth_timeout
echo.
echo  [WARN] Phone not authorized after 60 seconds.
echo         The agent will still launch — once you accept on the phone,
echo         devices will appear in the dashboard automatically.
echo.
goto adb_auth_done

:adb_auth_done
echo.

echo.
echo  ================================================================
echo   STEP 3: LAUNCHING DEVICEFARM AGENT
echo  ================================================================
echo.

:: ── Stop any existing DeviceFarm Agent processes safely ───────────────────
echo [*] Ensuring previous DeviceFarm Agent instances are stopped...
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dirs = @('%INSTALL_DIR%', '%CURRENT_DIR%') | Where-Object { $_ -and (Test-Path $_) };" ^
  "Get-CimInstance Win32_Process | Where-Object {" ^
  "  $p = $_; if ($p.ProcessId -eq $PID) { return $false };" ^
  "  $matchDir = $false;" ^
  "  foreach ($d in $dirs) { if (($p.ExecutablePath -and $p.ExecutablePath.StartsWith($d, [System.StringComparison]::OrdinalIgnoreCase)) -or ($p.CommandLine -and $p.CommandLine.IndexOf($d, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) { $matchDir = $true; break } };" ^
  "  $isWatchdog = ($p.Name -like 'node*' -and $p.CommandLine -and ($p.CommandLine.IndexOf('service-watchdog.js', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or $p.CommandLine.IndexOf('DeviceFarm', [System.StringComparison]::OrdinalIgnoreCase) -ge 0));" ^
  "  return (($matchDir -or $isWatchdog) -and ($p.Name -match '^(electron|node|cloudflared|scrcpy|adb|DeviceFarm Agent)\.exe$'))" ^
  "} | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }"
ping 127.0.0.1 -n 2 >nul 2>nul
echo [OK] Previous instances stopped.

:: ── Register and launch 24/7 Silent Background Service ──────────────────
echo [*] Configuring and registering Windows 24/7 Background Service...

set "TASK_BOOT=DeviceFarm_Agent_BootService"
set "TASK_LOGON=DeviceFarm_Agent_LogonService"
set "VBS_LAUNCHER=%INSTALL_DIR%\Start-Agent-Silent.vbs"
set "STARTUP_ALL=%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK_ALL=%STARTUP_ALL%\DeviceFarm-Agent-Service.lnk"

:: Remove old conflicting tasks safely
schtasks /delete /tn "DeviceFarm Agent AutoStart" /f >nul 2>&1
schtasks /delete /tn "DeviceFarm_Agent_BootService" /f >nul 2>&1
schtasks /delete /tn "DeviceFarm_Agent_LogonService" /f >nul 2>&1

:: Register Boot Task (starts when PC turns on / restarts)
schtasks /create /tn "%TASK_BOOT%" /tr "wscript.exe \"%VBS_LAUNCHER%\"" /sc ONSTART /ru "SYSTEM" /rl HIGHEST /f >nul 2>&1

:: Register Logon Task (starts when user logs in)
schtasks /create /tn "%TASK_LOGON%" /tr "wscript.exe \"%VBS_LAUNCHER%\"" /sc ONLOGON /rl HIGHEST /f >nul 2>&1

:: Redundant All-Users Startup Shortcut
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%LNK_ALL%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_LAUNCHER%\"'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.WindowStyle = 0; $s.Description = 'DeviceFarm Agent Autonomous Background Service'; $s.Save() } catch {}" >nul 2>&1

echo [OK] Windows 24/7 background service registered.

:: Stop any existing cloudflared tunnel processes
echo [*] Stopping old cloudflared tunnel processes...
taskkill /F /IM cloudflared.exe /T >nul 2>&1
ping 127.0.0.1 -n 2 >nul 2>nul

:: Start service silently right now in the background
echo [*] Starting DeviceFarm Agent silently in the background...
if exist "%VBS_LAUNCHER%" (
    wscript.exe "%VBS_LAUNCHER%"
) else (
    set "ELECTRON_BIN=node_modules\electron\dist\electron.exe"
    if exist "%ELECTRON_BIN%" (
        start "" "%INSTALL_DIR%\%ELECTRON_BIN%" "%INSTALL_DIR%\src\main\index.js"
    ) else (
        start "" "%NPM%" exec -- electron "%INSTALL_DIR%"
    )
)

:: Ensure Cloudflare named tunnel daemon is restarted for agent.dennoh.site
echo [*] Starting Cloudflare tunnel daemon for agent.dennoh.site...
set "CLOUDFLARED_EXE=%INSTALL_DIR%\assets\bin\cloudflared.exe"
if not exist "%CLOUDFLARED_EXE%" set "CLOUDFLARED_EXE=%CURRENT_DIR%\assets\bin\cloudflared.exe"
if not exist "%CLOUDFLARED_EXE%" set "CLOUDFLARED_EXE=C:\cloudflared\cloudflared.exe"
if not exist "%CLOUDFLARED_EXE%" set "CLOUDFLARED_EXE=C:\Program Files\cloudflared\cloudflared.exe"
if not exist "%CLOUDFLARED_EXE%" set "CLOUDFLARED_EXE=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist "%CLOUDFLARED_EXE%" (
    echo [*] Cloudflared not found locally. Downloading cloudflared-windows-amd64.exe...
    if not exist "%INSTALL_DIR%\assets\bin" mkdir "%INSTALL_DIR%\assets\bin" >nul 2>nul
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%INSTALL_DIR%\assets\bin\cloudflared.exe' -UseBasicParsing"
    if exist "%INSTALL_DIR%\assets\bin\cloudflared.exe" set "CLOUDFLARED_EXE=%INSTALL_DIR%\assets\bin\cloudflared.exe"
)
if exist "%CLOUDFLARED_EXE%" (
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
        "Start-Process -FilePath '%CLOUDFLARED_EXE%' -ArgumentList 'tunnel','run','--token','eyJhIjoiMjEzYzI3Y2IwOTVjZTBlMTE0ZTNkNWYzZDM3ODJiNWQiLCJ0IjoiMDVkMzUyZjgtZGU5Yi00MzBiLWIxYzUtNDUyNzNlZWQzOTExIiwicyI6Ik1qWmlaak13WVdZdE1UTmpPUzAwTm1NeExUZ3hNR0V0TlRWalpURTFNV1ZsTURNMSJ9' -WindowStyle Hidden"
    echo [OK] Cloudflare tunnel daemon started in background for agent.dennoh.site.
) else (
    echo [WARN] Cloudflared binary not found - tunnel will not be available.
)

echo [*] Waiting for Dashboard...
ping 127.0.0.1 -n 4 >nul 2>nul
start "" "http://localhost:7400"

:end_launch

echo.
echo  ================================================================
echo  [OK] DeviceFarm Agent is running continuously in the background!
echo       Dashboard : http://localhost:7400
echo       Public    : https://agent.dennoh.site
echo       Install   : %INSTALL_DIR%
echo       Status    : Active 24/7 Background Service (Auto-starts on Boot)
echo  ================================================================
echo.
echo  Setup complete. This window will close automatically.
ping 127.0.0.1 -n 3 >nul 2>nul
exit /b 0

