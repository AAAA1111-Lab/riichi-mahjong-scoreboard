$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User");
Write-Host "🚀 Pushing all branches to origin..."
git push -u origin main
git push -u origin release
git push -u origin public-server
git push -u origin release-server
Write-Host "✅ All branches pushed successfully!"
