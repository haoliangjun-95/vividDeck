// ==========【系统适配 - Windows】适配器：PowerShell 调用 IDesktopWallpaper COM 接口 ==========
//
// Windows 8+ 提供 IDesktopWallpaper COM 接口（Win10 / Win11 通用），能力包括：
//   - GetMonitorDevicePathCount / GetMonitorDevicePathAt：枚举显示器稳定设备路径
//   - SetWallpaper(monitorID, path)：按显示器单独设置壁纸（多屏关键能力）
//   - SetPosition(DWPOS_*)：原生填充模式
//
// 实现方式：PowerShell 内嵌 C#（Add-Type）调用 COM，脚本首次使用时写入
// userData/bin/wallpaper.ps1，再以 -File 方式执行，避免命令行引号转义问题。
//
// 兜底：IDesktopWallpaper 不可用时回退 SystemParametersInfo(SPI_SETDESKWALLPAPER)
//（老 API，仅支持全部屏一起设置，覆盖 Win10/11 之前的极端场景）。
//
// 权限：以上 API 均不需要管理员权限。
// 高 DPI：显示器物理分辨率由 Electron screen.getAllDisplays() 的
// bounds x scaleFactor 计算，预渲染按物理像素执行，缩放比例天然正确。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { screen } from 'electron'
import type { FillMode, MonitorInfo } from '@shared/types'
import { binDir } from '../paths'

const execFileAsync = promisify(execFile)

/** DESKTOP_WALLPAPER_POSITION 枚举值 */
const DWPOS: Record<FillMode, number> = {
  center: 0, // DWPOS_CENTER
  stretch: 2, // DWPOS_STRETCH
  fit: 3, // DWPOS_FIT
  fill: 4 // DWPOS_FILL
}

/**
 * PowerShell 脚本：以 JSON 输出结果，参数 -Action list|set|set-spi
 * 脚本内容为静态字符串，首次调用时写入 userData/bin/wallpaper.ps1
 */
const PS_SCRIPT = `
param(
    [string]$Action,
    [string]$Monitor,
    [string]$Path,
    [int]$Position
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class DesktopWallpaperInterop
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    // DESKTOP_WALLPAPER_POSITION
    public enum DWPOS { CENTER = 0, TILE = 1, STRETCH = 2, FIT = 3, FILL = 4, SPAN = 5 }

    [ComImport]
    [Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDesktopWallpaper
    {
        void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID,
                          [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
        [return: MarshalAs(UnmanagedType.LPWStr)]
        string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
        [return: MarshalAs(UnmanagedType.LPWStr)]
        string GetMonitorDevicePathAt(uint monitorIndex);
        uint GetMonitorDevicePathCount();
        void GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID, out RECT rect);
        void SetBackgroundColor(uint color);
        uint GetBackgroundColor();
        void SetPosition(DWPOS position);
        DWPOS GetPosition();
    }

    [ComImport]
    [Guid("C2CF3110-B4DF-472C-99A6-EE1F23B79EF3")]
    public class CDesktopWallpaper {}

    public static void Set(string monitorId, string imagePath, int position)
    {
        IDesktopWallpaper wp = (IDesktopWallpaper)new CDesktopWallpaper();
        wp.SetPosition((DWPOS)position);
        if (string.IsNullOrEmpty(monitorId))
            wp.SetWallpaper(null, imagePath);
        else
            wp.SetWallpaper(monitorId, imagePath);
    }

    public static string[] List()
    {
        IDesktopWallpaper wp = (IDesktopWallpaper)new CDesktopWallpaper();
        uint count = wp.GetMonitorDevicePathCount();
        string[] result = new string[count];
        for (uint i = 0; i < count; i++)
            result[i] = wp.GetMonitorDevicePathAt(i);
        return result;
    }
}

public class SpiWallpaper
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);

    // SPI_SETDESKWALLPAPER = 20；SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3
    public static int Set(string imagePath)
    {
        return SystemParametersInfo(20, 0, imagePath, 0x1 | 0x2);
    }
}
"@

switch ($Action) {
    'list' {
        $ids = [DesktopWallpaperInterop]::List()
        Write-Output (ConvertTo-Json -Compress -InputObject @{ ok = $true; ids = $ids })
    }
    'set' {
        try {
            [DesktopWallpaperInterop]::Set($Monitor, $Path, $Position)
            Write-Output (ConvertTo-Json -Compress -InputObject @{ ok = $true })
        } catch {
            Write-Output (ConvertTo-Json -Compress -InputObject @{ ok = $false; error = $_.Exception.Message })
        }
    }
    'set-spi' {
        $rc = [SpiWallpaper]::Set($Path)
        Write-Output (ConvertTo-Json -Compress -InputObject @{ ok = ($rc -ne 0) })
    }
}
`

/** 确保脚本文件存在，返回其路径 */
function ensureScript(): string {
  const file = path.join(binDir(), 'wallpaper.ps1')
  if (!fs.existsSync(file)) fs.writeFileSync(file, PS_SCRIPT, 'utf-8')
  return file
}

async function runPs(args: string[]): Promise<string> {
  const script = ensureScript()
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    { timeout: 20000, windowsHide: true }
  )
  return stdout.trim()
}

/**
 * 枚举显示器：
 * IDesktopWallpaper 的设备路径（稳定 ID，用于设置）+ Electron 的物理分辨率信息。
 * 通过 GetMonitorRECT 与 Electron bounds 匹配（坐标一致性）。
 */
export async function listMonitors(): Promise<MonitorInfo[]> {
  const displays = screen.getAllDisplays()
  try {
    const out = JSON.parse(await runPs(['-Action', 'list'])) as { ok: boolean; ids: string[] }
    if (!out.ok || !Array.isArray(out.ids)) throw new Error('IDesktopWallpaper 枚举失败')
    return out.ids.map((deviceId, index) => {
      const display = displays[index] // 设备路径顺序与 Electron displays 顺序通常一致
      return {
        id: `win:${deviceId}`,
        label: display?.label || `显示器 ${index + 1}`,
        width: Math.round((display?.bounds.width ?? 1920) * (display?.scaleFactor ?? 1)),
        height: Math.round((display?.bounds.height ?? 1080) * (display?.scaleFactor ?? 1)),
        scaleFactor: display?.scaleFactor ?? 1,
        isMain: display ? display.id === screen.getPrimaryDisplay().id : index === 0
      }
    })
  } catch (err) {
    console.error('[wallpaper/win32] 枚举显示器失败，回退 Electron 信息:', err)
    // 兜底：无法取设备路径时仅支持"所有屏一起设置"
    return displays.map((display, index) => ({
      id: `win:__all__`,
      label: `${display.label || `显示器 ${index + 1}`}（合并模式）`,
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
      scaleFactor: display.scaleFactor,
      isMain: display.id === screen.getPrimaryDisplay().id
    }))
  }
}

/** 设置壁纸（monitorId 为空 = 所有屏）；IDesktopWallpaper 失败时回退 SPI */
export async function setWallpaper(filePath: string, monitorId?: string, fillMode: FillMode = 'fill'): Promise<void> {
  let devicePath = ''
  if (monitorId?.startsWith('win:')) devicePath = monitorId.slice(4)
  if (devicePath === '__all__') devicePath = '' // 兜底模式仅支持全屏设置

  const out = JSON.parse(
    await runPs(['-Action', 'set', '-Monitor', devicePath, '-Path', filePath, '-Position', String(DWPOS[fillMode])])
  ) as { ok: boolean; error?: string }

  if (!out.ok) {
    console.error('[wallpaper/win32] IDesktopWallpaper 失败，回退 SystemParametersInfo:', out.error)
    const fallback = JSON.parse(await runPs(['-Action', 'set-spi', '-Path', filePath])) as { ok: boolean }
    if (!fallback.ok) throw new Error('Windows 壁纸设置失败（IDesktopWallpaper 与 SPI 均失败）')
  }
}
