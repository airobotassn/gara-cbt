param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Bitmap]::FromFile($InputPath)
$result = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($result)

try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.DrawImageUnscaled($source, 0, 0)

    # Preserve the laurels as bitmap fragments before clearing the body layout.
    $leftLaurel = $source.Clone((New-Object System.Drawing.Rectangle(505, 460, 140, 245)), $source.PixelFormat)
    $rightLaurel = $source.Clone((New-Object System.Drawing.Rectangle(1230, 460, 150, 245)), $source.PixelFormat)

    $paper = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 250, 249, 247))
    $g.FillRectangle($paper, 500, 425, 895, 315)

    # Move the laurels below the certification sentence, keeping the large title slot clear.
    $g.DrawImageUnscaled($leftLaurel, 505, 510)
    $g.DrawImageUnscaled($rightLaurel, 1230, 510)

    $navy = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 8, 27, 76))
    $font = New-Object System.Drawing.Font('Times New Roman', 25, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center

    $g.DrawString('has successfully fulfilled the requirements for and', $font, $navy, (New-Object System.Drawing.RectangleF(570, 435, 760, 38)), $fmt)

    # Compact server insertion slot: earned the [CARIS BEGINNER] certification.
    $g.DrawString('earned the', $font, $navy, (New-Object System.Drawing.RectangleF(650, 480, 150, 38)), $fmt)
    $g.DrawString('certification.', $font, $navy, (New-Object System.Drawing.RectangleF(1090, 480, 180, 38)), $fmt)

    $result.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    if ($fmt) { $fmt.Dispose() }
    if ($font) { $font.Dispose() }
    if ($navy) { $navy.Dispose() }
    if ($paper) { $paper.Dispose() }
    if ($leftLaurel) { $leftLaurel.Dispose() }
    if ($rightLaurel) { $rightLaurel.Dispose() }
    $g.Dispose()
    $result.Dispose()
    $source.Dispose()
}
