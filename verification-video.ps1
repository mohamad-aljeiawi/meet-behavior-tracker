<#
.SYNOPSIS
    Creates a verification video by burning speaker names from a JSON timeline onto an audio file.
#>
param(
    [string]$JsonPath = ".\speaker_timeline.json",
    [string]$AudioPath = ".\meeting_audio.webm",
    [string]$OutputVideoPath = ".\verification_video.mp4"
)

# --- Function to convert seconds to SRT timestamp format ---
function ConvertTo-SrtTime {
    param([double]$Seconds)
    $timespan = [TimeSpan]::FromSeconds($Seconds)
    return $timespan.ToString("hh\:mm\:ss\,fff")
}

# --- Step 1: Check for FFmpeg ---
Write-Host "Checking for FFmpeg..." -ForegroundColor Yellow
$ffmpegCheck = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegCheck) {
    Write-Host "FATAL: ffmpeg was not found in your system's PATH." -ForegroundColor Red
    exit 1
}
Write-Host "✅ FFmpeg found!" -ForegroundColor Green

# --- Step 2: Read JSON and create SRT content ---
Write-Host "Reading JSON file: $JsonPath" -ForegroundColor Yellow
if (-not (Test-Path $JsonPath)) {
    Write-Host "FATAL: JSON file not found at '$JsonPath'." -ForegroundColor Red
    exit 1
}

$srtPath = Join-Path -Path (Get-Location) -ChildPath "subtitles.srt"
$srtContent = New-Object System.Text.StringBuilder
$timeline = Get-Content -Raw -Path $JsonPath | ConvertFrom-Json
$counter = 1

foreach ($event in $timeline) {
    $startTime = ConvertTo-SrtTime -Seconds $event.start
    $endTime = ConvertTo-SrtTime -Seconds $event.end
    $speakerName = if ($event.speaker -is [array]) { $event.speaker -join ', ' } else { $event.speaker }
    
    [void]$srtContent.AppendLine($counter)
    [void]$srtContent.AppendLine("$startTime --> $endTime")
    [void]$srtContent.AppendLine($speakerName)
    [void]$srtContent.AppendLine()
    $counter++
}

Set-Content -Path $srtPath -Value $srtContent.ToString() -Encoding UTF8
Write-Host "✅ SRT subtitle file created successfully at '$srtPath'." -ForegroundColor Green

# --- Step 3: Generate the video using FFmpeg ---
Write-Host "Generating verification video... (this may take a moment)" -ForegroundColor Yellow

if (-not (Test-Path $AudioPath)) {
    Write-Host "FATAL: Audio file not found at '$AudioPath'." -ForegroundColor Red
    exit 1
}

$fullOutputVideoPath = Join-Path -Path (Get-Location) -ChildPath $OutputVideoPath

# Create a simple temp file name without spaces or special characters
$tempSrtPath = "temp_subs.srt"
Copy-Item -Path $srtPath -Destination $tempSrtPath -Force

# Use the simple path without any escaping
$ffmpegArgs = @(
    "-f", "lavfi",
    "-i", "color=c=black:s=1280x720:r=25",
    "-i", $AudioPath,
    "-vf", "subtitles=${tempSrtPath}:force_style='Alignment=10,FontSize=48,PrimaryColour=&H00FFFFFF&'",
    "-c:a", "aac",
    "-c:v", "libx264",
    "-shortest",
    "-y",
    $fullOutputVideoPath
)

# Execute FFmpeg
Write-Host "Running FFmpeg with args: $($ffmpegArgs -join ' ')" -ForegroundColor Cyan
& ffmpeg @ffmpegArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "----------------------------------------------------" -ForegroundColor Cyan
    Write-Host "✅ Success! Verification video created at: '$fullOutputVideoPath'" -ForegroundColor Green
    Write-Host "----------------------------------------------------" -ForegroundColor Cyan
} else {
    Write-Host "❌ Error: FFmpeg failed to generate the video. Exit code: $LASTEXITCODE" -ForegroundColor Red
}

# Clean up the temporary SRT files
Remove-Item -Path $srtPath -ErrorAction SilentlyContinue
Remove-Item -Path $tempSrtPath -ErrorAction SilentlyContinue