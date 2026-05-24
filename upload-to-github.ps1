# 使用 GitHub API 上传文件到 Release

$ErrorActionPreference = "Stop"

# 配置
$owner = "tanzanite2025"
$repo = "TidyDesk"
$tag = "v3.0.1"

# 读取 Token
$token = (Get-Content .env | Select-String "GH_TOKEN" | ForEach-Object { $_ -replace "GH_TOKEN=", "" }).ToString().Trim()

# 设置请求头
$headers = @{
    "Authorization" = "token $token"
    "Accept" = "application/vnd.github.v3+json"
}

Write-Host "Getting release info for $tag..." -ForegroundColor Green

# 获取 Release ID
$releaseUrl = "https://api.github.com/repos/$owner/$repo/releases/tags/$tag"
try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers $headers -Method Get
    $releaseId = $release.id
    # 修复 upload_url - 移除模板部分并确保格式正确
    $uploadUrlBase = $release.upload_url -replace '\{\?name,label\}', ''
    Write-Host "Release ID: $releaseId" -ForegroundColor Yellow
    Write-Host "Upload URL: $uploadUrlBase" -ForegroundColor Yellow
} catch {
    Write-Host "Error getting release: $_" -ForegroundColor Red
    exit 1
}

# 上传文件的函数
function Upload-Asset {
    param(
        [string]$FilePath,
        [string]$UploadUrl,
        [hashtable]$Headers
    )
    
    $fileName = Split-Path $FilePath -Leaf
    $fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
    $fileSize = $fileBytes.Length
    
    Write-Host "Uploading $fileName ($([math]::Round($fileSize/1MB, 2)) MB)..." -ForegroundColor Yellow
    
    # 确定 Content-Type
    $contentType = switch ([System.IO.Path]::GetExtension($fileName)) {
        ".exe" { "application/x-msdownload" }
        ".blockmap" { "application/octet-stream" }
        ".yml" { "text/yaml" }
        default { "application/octet-stream" }
    }
    
    $uploadHeaders = $Headers.Clone()
    $uploadHeaders["Content-Type"] = $contentType
    
    # 构建完整的上传 URL
    $fullUrl = "$UploadUrl" + "?name=" + [System.Web.HttpUtility]::UrlEncode($fileName)
    
    try {
        $response = Invoke-RestMethod -Uri $fullUrl -Headers $uploadHeaders -Method Post -Body $fileBytes
        Write-Host "✓ Uploaded $fileName" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ Failed to upload $fileName : $_" -ForegroundColor Red
        return $false
    }
}

# 上传文件
$files = @(
    "release\TidyDesk-3.0.1-Setup.exe",
    "release\TidyDesk-3.0.1-Setup.exe.blockmap",
    "release\latest.yml"
)

$success = 0
$failed = 0

foreach ($file in $files) {
    if (Test-Path $file) {
        if (Upload-Asset -FilePath $file -UploadUrl $uploadUrlBase -Headers $headers) {
            $success++
        } else {
            $failed++
        }
    } else {
        Write-Host "✗ File not found: $file" -ForegroundColor Red
        $failed++
    }
}

Write-Host "`nUpload Summary:" -ForegroundColor Cyan
Write-Host "  Success: $success" -ForegroundColor Green
Write-Host "  Failed: $failed" -ForegroundColor Red

if ($failed -eq 0) {
    Write-Host "`n✓ All files uploaded successfully!" -ForegroundColor Green
    Write-Host "Visit: https://github.com/$owner/$repo/releases/tag/$tag" -ForegroundColor Cyan
} else {
    Write-Host "`n✗ Some files failed to upload" -ForegroundColor Red
    exit 1
}
