[CmdletBinding()]
param(
    [string]$Server = '160.25.5.68',
    [string]$User = 'root',
    [ValidateRange(1, 65535)]
    [int]$Port = 22,
    [string]$IdentityFile
)

$ErrorActionPreference = 'Stop'
$destination = '/var/www/secure-notes/'
$files = @('index.html', 'styles.css', 'app.js', 'utils.js', 'letter-n.png')

try {
    Get-Command ssh -ErrorAction Stop | Out-Null
    Get-Command scp -ErrorAction Stop | Out-Null

    # Resolve paths relative to this script, regardless of the current directory.
    $localFiles = foreach ($file in $files) {
        $path = Join-Path $PSScriptRoot $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required frontend file is missing: $path"
        }
        $path
    }

    if ($Server -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]*$' -or
        $User -notmatch '^[a-zA-Z_][a-zA-Z0-9_-]*$') {
        throw 'Use a valid server hostname or IPv4 address and SSH username.'
    }

    $sshArgs = @('-p', "$Port")
    $scpArgs = @('-P', "$Port")
    if ($IdentityFile) {
        $keyPath = (Resolve-Path -LiteralPath $IdentityFile -ErrorAction Stop).Path
        $sshArgs += @('-i', $keyPath)
        $scpArgs += @('-i', $keyPath)
    }

    $remote = "${User}@${Server}"
    Write-Host "Preparing ${remote}:${destination}"
    & ssh @sshArgs $remote 'mkdir -p /var/www/secure-notes'
    if ($LASTEXITCODE -ne 0) { throw 'Could not create or access the remote directory.' }

    Write-Host 'Uploading frontend files (existing copies will be replaced)...'
    & scp @scpArgs @localFiles "${remote}:${destination}"
    if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Check your SSH connection and directory permissions.' }

    Write-Host 'Setting static files readable by the web server...'
    & ssh @sshArgs $remote 'chmod 644 /var/www/secure-notes/index.html /var/www/secure-notes/styles.css /var/www/secure-notes/app.js /var/www/secure-notes/utils.js /var/www/secure-notes/letter-n.png'
    if ($LASTEXITCODE -ne 0) { throw 'Files uploaded, but setting read permissions failed.' }

    Write-Host "Deployment completed: http://${Server}/" -ForegroundColor Green
    Write-Host 'No Nginx restart is needed for static file updates. Hard-refresh your browser (Ctrl+F5).'
}
catch {
    Write-Error $_
    exit 1
}