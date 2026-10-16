export type ReaderExecutable = "reader-client.mjs" | "reader-mcp.mjs";

/** Fixed file names only; no user-input interpolation into executable shell code. */
export function readerVerification(file: ReaderExecutable) {
  if(file !== "reader-client.mjs" && file !== "reader-mcp.mjs") throw new Error("Unsupported executable");
  return {
    linux: `sha256sum -c ${file}.sha256`,
    macos: `shasum -a 256 -c ${file}.sha256`,
    powershell: [
      `$line = (Get-Content -LiteralPath '${file}.sha256' -Raw).Trim()`,
      `$match = [regex]::Match($line, '^([a-f0-9]{64})  ${file.replace(/\./g,"\\.")}$')`,
      "if (-not $match.Success) { throw 'Invalid checksum file' }",
      `$actual = (Get-FileHash -LiteralPath '${file}' -Algorithm SHA256).Hash.ToLowerInvariant()`,
      "if ($actual -ne $match.Groups[1].Value) { throw 'Checksum mismatch; do not run the download' }",
      `Write-Output '${file}: OK'`,
    ].join("\n"),
  };
}

export function readerDownloadMarkdown(origin: string, version: string, file: ReaderExecutable) {
  const commands=readerVerification(file), fence=String.fromCharCode(96).repeat(3);
  return [
    `Download ${origin}/clients/reader/${version}/${file} and ${origin}/clients/reader/${version}/${file}.sha256 into the same folder. Requires Node 20.19+ after verification. No npm installation.`, "",
    "Verify this one executable before running it. Stop on any failure. Linux:", "", fence+"sh", commands.linux, fence, "",
    "macOS:", "", fence+"sh", commands.macos, fence, "",
    "PowerShell:", "", fence+"powershell", commands.powershell, fence, "",
    `The complete SHA256SUMS list remains at ${origin}/clients/reader/${version}/SHA256SUMS for people downloading all artifacts. Do not check that whole list after downloading only one file. SHA-256 checks detect changed bytes against the published checksum; the checksum is served through the same website and is not an independent signature. Public source: https://github.com/Nutshell2000/agent-data-tools/tree/main/clients .`, "",
  ].join("\n");
}

export function readerVerificationHtml(file: ReaderExecutable) {
  const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
  const commands=readerVerification(file);
  return `<details><summary>Verify this download before running it</summary><p>Save the executable and its matching .sha256 file in the same folder. Linux:</p><pre><code>${esc(commands.linux)}</code></pre><p>macOS:</p><pre><code>${esc(commands.macos)}</code></pre><p>PowerShell:</p><pre><code>${esc(commands.powershell)}</code></pre><p>Stop on any verification failure. The complete SHA256SUMS list also contains other artifacts; checking that list requires those files. Checksums detect changed bytes against this site's published value and are not independent signatures.</p></details>`;
}
