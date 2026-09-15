param(
    [Parameter(Mandatory = $true)][string]$CertificatePath,
    [Parameter(Mandatory = $true)][string]$LogoPath,
    [Parameter(Mandatory = $true)][string]$SealPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

Add-Type -AssemblyName System.Drawing

$certificate = [System.Drawing.Bitmap]::FromFile($CertificatePath)
$logo = [System.Drawing.Bitmap]::FromFile($LogoPath)
$sealSource = [System.Drawing.Bitmap]::FromFile($SealPath)
$result = New-Object System.Drawing.Bitmap($certificate.Width, $certificate.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($result)

try {
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImageUnscaled($certificate, 0, 0)

    # Replace the generated symbol area with a clean network-background patch.
    $g.DrawImage($certificate, (New-Object System.Drawing.Rectangle(70, 65, 245, 175)), 0, 0, 82, 82, [System.Drawing.GraphicsUnit]::Pixel)

    # Crop the transparent padding and composite the exact source logo pixels.
    $minX = $logo.Width; $minY = $logo.Height; $maxX = 0; $maxY = 0
    for ($y = 0; $y -lt $logo.Height; $y += 4) {
        for ($x = 0; $x -lt $logo.Width; $x += 4) {
            if ($logo.GetPixel($x, $y).A -gt 12) {
                if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    # Preserve the 1.523:1 source-art aspect ratio.
    $logoRect = New-Object System.Drawing.Rectangle(92, 82, 205, 135)
    $g.DrawImage($logo, $logoRect, $minX, $minY, ($maxX - $minX + 4), ($maxY - $minY + 4), [System.Drawing.GraphicsUnit]::Pixel)

    # Downsample the supplied seal, then derive alpha from its white paper background.
    $sealSize = 164
    $scaledSeal = New-Object System.Drawing.Bitmap($sealSize, $sealSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $sg = [System.Drawing.Graphics]::FromImage($scaledSeal)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.DrawImage($sealSource, (New-Object System.Drawing.Rectangle(0, 0, $sealSize, $sealSize)))
    $sg.Dispose()

    for ($y = 0; $y -lt $sealSize; $y++) {
        for ($x = 0; $x -lt $sealSize; $x++) {
            $c = $scaledSeal.GetPixel($x, $y)
            $redDominance = $c.R - [Math]::Max($c.G, $c.B)
            # Keep the red seal artwork fully opaque; feather only the outer anti-aliased edge.
            if ($redDominance -ge 24) { $alpha = 255 }
            elseif ($redDominance -le 5) { $alpha = 0 }
            else { $alpha = [Math]::Min(255, [int](($redDominance - 5) * 14)) }
            $scaledSeal.SetPixel($x, $y, [System.Drawing.Color]::FromArgb([int]$alpha, $c.R, $c.G, $c.B))
        }
    }

    # Clear the generated seal footprint, then place the exact supplied seal artwork.
    $sample = $certificate.GetPixel(1210, 850)
    $paper = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $sample.R, $sample.G, $sample.B))
    $g.FillEllipse($paper, 1245, 895, 185, 185)
    $paper.Dispose()
    $g.DrawImageUnscaled($scaledSeal, 1260, 905)
    $scaledSeal.Dispose()

    $result.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $g.Dispose()
    $result.Dispose()
    $sealSource.Dispose()
    $logo.Dispose()
    $certificate.Dispose()
}
