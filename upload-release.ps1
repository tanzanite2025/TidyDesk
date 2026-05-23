# 上传文件到 GitHub Release v3.2.4

$ErrorActionPreference = "Stop"

# 读取 Token
$env:GH_TOKEN = (Get-Content .env | Select-String "GH_TOKEN" | ForEach-Object { $_ -replace "GH_TOKEN=", "" }).ToString().Trim()

Write-Host "Uploading files to GitHub Release v3.2.4..." -ForegroundColor Green

# 上传安装包
Write-Host "Uploading TidyDesk-3.2.4-Setup.exe..." -ForegroundColor Yellow
gh release upload v3.2.4 "release\TidyDesk-3.2.4-Setup.exe" --clobber

# 上传 blockmap
Write-Host "Uploading TidyDesk-3.2.4-Setup.exe.blockmap..." -ForegroundColor Yellow
gh release upload v3.2.4 "release\TidyDesk-3.2.4-Setup.exe.blockmap" --clobber

# 上传 latest.yml
Write-Host "Uploading latest.yml..." -ForegroundColor Yellow
gh release upload v3.2.4 "release\latest.yml" --clobber

Write-Host "Upload completed!" -ForegroundColor Green
Write-Host "Visit: https://github.com/tanzanite2025/TidyDesk/releases/tag/v3.2.4" -ForegroundColor Cyan
