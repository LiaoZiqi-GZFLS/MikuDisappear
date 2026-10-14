# Upload a shot list to FFmpeg's xstack. WSL cannot expand globs for the
# Windows ffmpeg build, so the file list is built here and passed through
# Start-Process. (See docs/制作日志.md, step 30.)
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [int]$Cols = 6,
  [int]$Rows = 4,
  [int]$Width = 2400,
  [string]$Out = "sheet.png"
)

Set-Location $Dir
$names = (Get-ChildItem t*.png | Sort-Object Name | ForEach-Object { $_.Name })
if ($names.Count -eq 0) { Write-Error "no PNGs in $Dir"; exit 1 }
$n = [Math]::Min($Cols * $Rows, $names.Count)
$names = $names[0..($n - 1)]

$ffArgs = @("-y", "-loglevel", "error")
foreach ($f in $names) { $ffArgs += @("-i", $f) }

$layout = @()
for ($r = 0; $r -lt $Rows; $r++) {
  for ($c = 0; $c -lt $Cols; $c++) {
    if ($r * $Cols + $c -ge $n) { break }
    $x = if ($c -eq 0) { "0" } else { (0..($c - 1) | ForEach-Object { "w$_" }) -join "+" }
    $y = if ($r -eq 0) { "0" } else { (0..($r - 1) | ForEach-Object { "h$_" }) -join "+" }
    $layout += "${x}_${y}"
  }
}
$label = (0..($n - 1) | ForEach-Object { "[$_]" }) -join ""
$count = [string]$n
$scale = [string]$Width
$filter = $label + "xstack=inputs=" + $count + ":layout=" + ($layout -join "|") + ",scale=" + $scale + ":-1"

$p = Start-Process -FilePath ffmpeg -ArgumentList ($ffArgs + @("-filter_complex", $filter, $Out)) -Wait -NoNewWindow -PassThru
if ($p.ExitCode -ne 0) { exit $p.ExitCode }
Write-Output ((Get-Item $Out).Length)
