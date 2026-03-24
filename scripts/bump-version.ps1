#
# bump-version.ps1 — Semantic version bump for JetLag (Windows)
#
# Usage:
#   .\scripts\bump-version.ps1 major      # 0.2.0 → 1.0.0
#   .\scripts\bump-version.ps1 minor      # 0.2.0 → 0.3.0
#   .\scripts\bump-version.ps1 patch      # 0.2.0 → 0.2.1
#   .\scripts\bump-version.ps1 set 1.5.0  # set explicit version
#
param(
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet("major", "minor", "patch", "set")]
    [string]$BumpType,

    [Parameter(Position=1)]
    [string]$ExplicitVersion
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$VersionFile = Join-Path $RootDir "VERSION"
$PackageJson = Join-Path $RootDir "frontend" "package.json"
$ConfluenceDoc = Join-Path $RootDir "docs" "confluence-jetlag.md"

if (-not (Test-Path $VersionFile)) {
    Write-Error "VERSION file not found at $VersionFile"
    exit 1
}

$Current = (Get-Content $VersionFile -Raw).Trim()
Write-Host "Current version: $Current"

# Parse — strip any prerelease suffix
$Core = ($Current -split "-")[0]
$Parts = $Core -split "\."
[int]$Major = $Parts[0]
[int]$Minor = $Parts[1]
[int]$Patch = $Parts[2]

switch ($BumpType) {
    "major" {
        $Major++
        $Minor = 0
        $Patch = 0
    }
    "minor" {
        $Minor++
        $Patch = 0
    }
    "patch" {
        $Patch++
    }
    "set" {
        if (-not $ExplicitVersion) {
            Write-Error "Usage: bump-version.ps1 set <version>"
            exit 1
        }
    }
}

if ($BumpType -eq "set") {
    $NewVersion = $ExplicitVersion
} else {
    $NewVersion = "$Major.$Minor.$Patch"
}

Write-Host "New version:     $NewVersion"
Write-Host ""

# 1. Update VERSION file
Set-Content -Path $VersionFile -Value $NewVersion -NoNewline
Write-Host "  [OK] VERSION"

# 2. Update frontend/package.json
if (Test-Path $PackageJson) {
    $json = Get-Content $PackageJson -Raw
    $json = $json -replace '"version":\s*"[^"]*"', "`"version`": `"$NewVersion`""
    Set-Content -Path $PackageJson -Value $json -NoNewline
    Write-Host "  [OK] frontend/package.json"
}

# 3. Update Confluence doc
if (Test-Path $ConfluenceDoc) {
    $doc = Get-Content $ConfluenceDoc -Raw
    $doc = $doc -replace '\*\*Version:\*\*\s*\d+\.\d+\.\d+', "**Version:** $NewVersion"
    $doc = $doc -replace 'JetLag v\d+\.\d+\.\d+', "JetLag v$NewVersion"
    Set-Content -Path $ConfluenceDoc -Value $doc -NoNewline
    Write-Host "  [OK] docs/confluence-jetlag.md"
}

Write-Host ""
Write-Host "Version bumped to $NewVersion"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  git add VERSION frontend/package.json docs/confluence-jetlag.md"
Write-Host "  git commit -m `"chore: bump version to $NewVersion`""
Write-Host "  git tag v$NewVersion"
