param(
    [Parameter(Mandatory = $true)][string]$CertificatePath,
    [Parameter(Mandatory = $true)][string]$LogoPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

Add-Type -AssemblyName System.Drawing

$certificate = [System.Drawing.Bitmap]::FromFile($CertificatePath)
$logo = [System.Drawing.Bitmap]::FromFile($LogoPath)
$canvas = New-Object System.Drawing.Bitmap($certificate.Width, $certificate.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)

try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.DrawImageUnscaled($certificate, 0, 0)

    # Cover the generated approximation, then composite the user's source PNG without altering its artwork.
    $backdrop = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 3, 20, 45))
    $graphics.FillEllipse($backdrop, 52, 64, 292, 292)
    $backdrop.Dispose()
    $graphics.DrawImage($logo, (New-Object System.Drawing.Rectangle(80, 84, 236, 236)), 0, 0, $logo.Width, $logo.Height, [System.Drawing.GraphicsUnit]::Pixel)

    $canvas.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $graphics.Dispose()
    $canvas.Dispose()
    $logo.Dispose()
    $certificate.Dispose()
}
