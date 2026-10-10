param([int]$ProcessId,[string]$ExpectedExe)
$taskProcess = Get-Process -Id $ProcessId -ErrorAction Stop
if([IO.Path]::GetFullPath($taskProcess.Path) -ne [IO.Path]::GetFullPath($ExpectedExe)){throw 'Unexpected process path'}
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class ReaderWindowClose {
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
}
'@
if(-not [ReaderWindowClose]::PostMessage($taskProcess.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Window close message failed'}
