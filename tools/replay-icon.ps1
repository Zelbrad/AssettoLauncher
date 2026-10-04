param([string]$out)
# Replay icon: a circular arrow (counter-clockwise, head at the top right) around a
# play triangle, Assetto Corsa red, transparent background. 256 px.
Add-Type -AssemblyName System.Drawing
$S = 256; $c = 128.0; $r = 92.0; $w = 15.0
$red = [System.Drawing.Color]::FromArgb(255, 0xD6, 0x16, 0x16)
$bmp = New-Object System.Drawing.Bitmap $S, $S, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)

# Arc: from -62 deg clockwise round to -130 deg (gap at the top).
$pen = New-Object System.Drawing.Pen $red, $w
$pen.StartCap = 'Round'; $pen.EndCap = 'Round'
$start = -62.0; $sweep = 292.0
$g.DrawArc($pen, [single]($c - $r), [single]($c - $r), [single](2 * $r), [single](2 * $r), [single]$start, [single]$sweep)

# Arrow head at the arc's start, pointing counter-clockwise (along the gap).
$t = $start * [math]::PI / 180
$px = $c + $r * [math]::Cos($t); $py = $c + $r * [math]::Sin($t)
$tx = [math]::Sin($t); $ty = -[math]::Cos($t)          # counter-clockwise tangent
$nx = [math]::Cos($t); $ny = [math]::Sin($t)           # outward normal
$len = 34.0; $half = 25.0
$tip = New-Object System.Drawing.PointF ([single]($px + $tx * $len * 0.75)), ([single]($py + $ty * $len * 0.75))
$b1 = New-Object System.Drawing.PointF ([single]($px - $tx * $len * 0.25 + $nx * $half)), ([single]($py - $ty * $len * 0.25 + $ny * $half))
$b2 = New-Object System.Drawing.PointF ([single]($px - $tx * $len * 0.25 - $nx * $half)), ([single]($py - $ty * $len * 0.25 - $ny * $half))
$brush = New-Object System.Drawing.SolidBrush $red
$head = New-Object System.Drawing.Drawing2D.GraphicsPath
$head.AddPolygon([System.Drawing.PointF[]]@($tip, $b1, $b2))
$g.FillPath($brush, $head)
$hp = New-Object System.Drawing.Pen $red, 6; $hp.LineJoin = 'Round'; $g.DrawPath($hp, $head)

# Play triangle, rounded corners, optically centred.
$tri = New-Object System.Drawing.Drawing2D.GraphicsPath
$tri.AddPolygon([System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF 108, 92), (New-Object System.Drawing.PointF 108, 164), (New-Object System.Drawing.PointF 168, 128)))
$g.FillPath($brush, $tri)
$tp = New-Object System.Drawing.Pen $red, 12; $tp.LineJoin = 'Round'; $g.DrawPath($tp, $tri)

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
