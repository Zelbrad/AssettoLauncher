param([string]$Logo, [string]$Out, [int]$Size = 256, [double]$Fill = 1.0)
# The launcher logo alone on transparency, as large as the square allows
# (centred; $Fill < 1 leaves a margin). A thin dark outline follows its shape so
# the white parts stay visible on light backgrounds (light taskbar, Explorer).
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($Logo)
$bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
$g.Clear([System.Drawing.Color]::Transparent)

$o = [Math]::Max(1.0, $Size / 80.0)                   # outline width
$box = $Size * $Fill - 2 * $o
$scale = [Math]::Min($box / $src.Width, $box / $src.Height)
$w = $src.Width * $scale; $h = $src.Height * $scale
$x = ($Size - $w) / 2; $y = ($Size - $h) / 2

# Outline: the logo's silhouette in near-black, drawn around it.
$m = New-Object System.Drawing.Imaging.ColorMatrix
$m.Matrix00 = 0; $m.Matrix11 = 0; $m.Matrix22 = 0; $m.Matrix33 = 0.85
$m.Matrix40 = 0.08; $m.Matrix41 = 0.08; $m.Matrix42 = 0.08
$ia = New-Object System.Drawing.Imaging.ImageAttributes; $ia.SetColorMatrix($m)
for ($a = 0; $a -lt 360; $a += 30) {
  $dx = $o * [Math]::Cos($a * [Math]::PI / 180); $dy = $o * [Math]::Sin($a * [Math]::PI / 180)
  $dest = New-Object System.Drawing.Rectangle ([int][Math]::Round($x + $dx)), ([int][Math]::Round($y + $dy)), ([int][Math]::Round($w)), ([int][Math]::Round($h))
  $g.DrawImage($src, $dest, 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
}
$g.DrawImage($src, [single]$x, [single]$y, [single]$w, [single]$h)
$g.Dispose(); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $src.Dispose()
