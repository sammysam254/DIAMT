' ════════════════════════════════════════════════════════════════════════════
'  DeviceFarm Agent — Silent Background Service Launcher
'  Runs the agent or watchdog completely invisibly (zero console window).
' ════════════════════════════════════════════════════════════════════════════
Option Explicit

Dim fso, shell, scriptDir, watchdogPath, electronPath, nodePath, cmdToRun

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Check for node.exe and service-watchdog.js
watchdogPath = scriptDir & "\src\main\service-watchdog.js"
nodePath = "node"

If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
    nodePath = """C:\Program Files\nodejs\node.exe"""
ElseIf fso.FileExists("C:\Program Files (x86)\nodejs\node.exe") Then
    nodePath = """C:\Program Files (x86)\nodejs\node.exe"""
End If

' 2. Check for electron binary in local node_modules
electronPath = scriptDir & "\node_modules\electron\dist\electron.exe"

If fso.FileExists(watchdogPath) Then
    ' Run via watchdog to ensure auto-restart on crashes/closure
    cmdToRun = "%comspec% /c " & nodePath & " """ & watchdogPath & """"
ElseIf fso.FileExists(electronPath) Then
    cmdToRun = """" & electronPath & """ """ & scriptDir & "\src\main\index.js"""
Else
    cmdToRun = "%comspec% /c cd /d """ & scriptDir & """ && npm start"
End If

' Set current working directory
shell.CurrentDirectory = scriptDir

' 0 = Hide window, False = Do not wait for script to finish (runs detached in background)
shell.Run cmdToRun, 0, False

' 3. Ensure cloudflared named tunnel daemon runs silently in background
Dim cloudflaredPath
cloudflaredPath = scriptDir & "\assets\bin\cloudflared.exe"
If Not fso.FileExists(cloudflaredPath) Then cloudflaredPath = "C:\cloudflared\cloudflared.exe"
If Not fso.FileExists(cloudflaredPath) Then cloudflaredPath = "C:\Program Files\cloudflared\cloudflared.exe"
If Not fso.FileExists(cloudflaredPath) Then cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
If fso.FileExists(cloudflaredPath) Then
    shell.Run """" & cloudflaredPath & """ tunnel run --token eyJhIjoiYzFlMzEyY2Q2YWFjNTNlOWJkYWUzZTY5MmJiMWM4Y2MiLCJ0IjoiZWI3NGIxNjMtMzcxOC00YWEwLWE1NGYtYmE5MDMwZDZkNzYyIiwicyI6Ik5EVmxPV1l3TkRBdE5HSXdZUzAwTldabUxXRTVOMlF0T0dNd1pETmlZMk14WkRrNSJ9", 0, False
End If

' 4. Open dashboard in default browser
WScript.Sleep 2000
shell.Run "%comspec% /c start """" ""http://localhost:7400""", 0, False

Set shell = Nothing
Set fso = Nothing
