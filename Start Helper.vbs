Option Explicit
Dim shell, fso, root, node, script, folder, candidate
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
node = fso.BuildPath(root, "runtime\node.exe")
script = fso.BuildPath(root, "launcher.mjs")
If Not fso.FileExists(node) Then
  node = ""
  For Each folder In Split(shell.ExpandEnvironmentStrings("%PATH%"), ";")
    folder = Replace(Trim(folder), Chr(34), "")
    If Len(folder) > 0 Then
      candidate = fso.BuildPath(folder, "node.exe")
      If fso.FileExists(candidate) Then
        node = candidate
        Exit For
      End If
    End If
  Next
  If Len(node) = 0 Then
    MsgBox "Install Node.js 24 or newer, then follow the setup steps in README.md.", 16, "mania 7k player pool helper"
    WScript.Quit 1
  End If
End If
shell.CurrentDirectory = root
shell.Run Chr(34) & node & Chr(34) & " " & Chr(34) & script & Chr(34), 0, False
