# Build single-file HTML (inline CSS/JS into index.html).
#   dist/smart-px-demo.html : offline file for the demo laptop / USB (data in this browser only)
#   dist/smart-px-web.html  : page body for the claude.ai web version (publisher adds the document wrapper)
# Kept ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page.
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$utf8 = New-Object System.Text.UTF8Encoding $false
$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'), $utf8)

$css = [IO.File]::ReadAllText((Join-Path $root 'css\style.css'), $utf8)
$html = $html.Replace('<link rel="stylesheet" href="css/style.css">', "<style>`n$css`n</style>")

foreach ($name in 'qr', 'data', 'store', 'soldier', 'admin', 'sync', 'app') {
  $js = [IO.File]::ReadAllText((Join-Path $root "js\$name.js"), $utf8)
  $html = $html.Replace("<script src=`"js/$name.js`"></script>", "<script>`n$js`n</script>")
}

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist 'smart-px-demo.html'
[IO.File]::WriteAllText($out, $html, $utf8)
Write-Output "Built: $out ($([Math]::Round((Get-Item $out).Length / 1KB)) KB)"

# Web version: drop the document wrapper; the claude.ai publisher supplies doctype, head and body.
$web = $html
foreach ($pattern in '<!doctype html>', '<html lang="ko">', '<head>', '</head>', '<body data-mode="soldier">', '</body>', '</html>',
                     '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">') {
  $web = $web.Replace($pattern, '')
}
$webOut = Join-Path $dist 'smart-px-web.html'
[IO.File]::WriteAllText($webOut, $web.Trim(), $utf8)
Write-Output "Built: $webOut ($([Math]::Round((Get-Item $webOut).Length / 1KB)) KB)"
