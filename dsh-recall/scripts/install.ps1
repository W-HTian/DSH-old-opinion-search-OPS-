# Install / repair dsh-recall into the running DSH desktop profile.
#
# The plugin lives in this folder; DSH's desktop profile gets a junction to it,
# plus one Loader entry in the profile's user patch layer. The Host's HMR watcher
# picks both up while the app is running - no restart, no pnpm install.
#
# Re-run this after a profile reset or a DSH upgrade that rewrites the profile.

$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome 'profiles\desktop'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'

if (-not (Test-Path $profileDir)) { throw "Desktop profile not found: $profileDir" }

$utf8 = New-Object System.Text.UTF8Encoding($false)

# 1. node_modules junction so `import('dsh-recall')` resolves from the profile.
$nodeModules = Join-Path $profileDir 'node_modules'
New-Item -ItemType Directory -Path $nodeModules -Force | Out-Null
$link = Join-Path $nodeModules 'dsh-recall'
if (Test-Path $link) {
  $item = Get-Item $link -Force
  $target = @($item.Target)[0]
  if ($item.LinkType -eq 'Junction' -and $target -and ($target.TrimEnd('\') -ieq $pluginDir.TrimEnd('\'))) {
    Write-Host "junction ok: $link -> $pluginDir"
  } else {
    cmd /c rmdir "$link" | Out-Null
    cmd /c mklink /J "$link" "$pluginDir" | Out-Null
    Write-Host "junction replaced: $link -> $pluginDir"
  }
} else {
  cmd /c mklink /J "$link" "$pluginDir" | Out-Null
  Write-Host "junction created: $link -> $pluginDir"
}

# 2. Loader entry in the profile patch (idempotent).
#    Read/write as UTF-8 explicitly: the patch may contain non-ASCII text and
#    Windows PowerShell's default file encoding would corrupt it.
$patch = if (Test-Path $patchPath) { [System.IO.File]::ReadAllText($patchPath, $utf8) } else { '' }
if ($patch -match '(?m)^\s*-\s*id:\s*dsh-recall\s*$') {
  Write-Host "patch entry already present: $patchPath"
} else {
  if (-not $patch.EndsWith("`n")) { $patch += "`n" }
  $patch += "- insert:`n    - id: dsh-recall`n      name: dsh-recall`n"
  [System.IO.File]::WriteAllText($patchPath, $patch, $utf8)
  Write-Host "patch entry appended: $patchPath"
}

Write-Host ''
Write-Host 'Done. Open DSH and use the sidebar row, or press Ctrl+Shift+F.'
