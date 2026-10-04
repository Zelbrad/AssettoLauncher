# Stage map for the launcher: crops the site's 800x800 map PNG to its outline,
# turns the black start arrow / finish flag light grey (they sit on a dark bar)
# and fits it in $size px, keeping transparency.
# Usage: powershell -File tools/map.ps1 <in.png> <out.png> [size]
param([string]$in, [string]$out, [int]$size = 160)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $in))
$bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.DrawImage($src, 0, 0, $src.Width, $src.Height); $g.Dispose(); $src.Dispose()

$minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $bmp.Height; $y++) {
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.A -lt 24) { continue }
    # White pixels on a white page background aren't part of the drawing.
    if ($c.R -gt 245 -and $c.G -gt 245 -and $c.B -gt 245 -and $c.A -eq 255) { $bmp.SetPixel($x, $y, [System.Drawing.Color]::Transparent); continue }
    if ($c.R -lt 90 -and $c.G -lt 90 -and $c.B -lt 90) { $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($c.A, 225, 225, 225)) }
    if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
    if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
  }
}
$w = $maxX - $minX + 1; $h = $maxY - $minY + 1
$k = [math]::Min($size / $w, $size / $h)
$ow = [math]::Max(1, [int]($w * $k)); $oh = [math]::Max(1, [int]($h * $k))
$dst = New-Object System.Drawing.Bitmap $ow, $oh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'HighQuality'
$g.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $ow, $oh), $minX, $minY, $w, $h, ([System.Drawing.GraphicsUnit]::Pixel))
$g.Dispose(); $bmp.Dispose()
$dst.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $dst.Dispose()
