Add-Type -AssemblyName System.Drawing
Add-Type -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
public struct RECT { public int Left, Top, Right, Bottom; }
"@ -Name Win32Print -Namespace Zhimu

$proc = Get-Process | Where-Object { $_.Path -like "*Programs*zhimu-ai*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "window not found"; exit 1 }
Write-Output "capturing PID $($proc.Id) (PrintWindow, works even when occluded)"
# SW_RESTORE = 9 (in case the window is minimized)
[Zhimu.Win32Print]::ShowWindowAsync($proc.MainWindowHandle, 9) | Out-Null
[Zhimu.Win32Print]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 2
$rect = New-Object Zhimu.Win32Print+RECT
[Zhimu.Win32Print]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = [Math]::Min(760, $rect.Bottom - $rect.Top)
if ($width -lt 200) { Write-Output "window still not restored (w=$width)"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT (2) captures DirectComposition/Chromium content.
[Zhimu.Win32Print]::PrintWindow($proc.MainWindowHandle, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$out = Join-Path (Get-Location) "docs\desktop\screenshot-p5-v1.0.1-nomenu.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved: $out ($width x $height)"
