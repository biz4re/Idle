import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const run = promisify(execFile)

// electron-updater 6 can treat an unavailable PowerShell verifier as success.
// Its supported verification hook lets us fail closed instead. Builder derives
// publisherName from the signing certificate's common name.
export async function verifyUpdateSignature(publishers: string[], filename: string): Promise<string | null> {
  if (!publishers.length || publishers.some((name) => !name || name.includes('='))) return 'A signing certificate common name is required'
  const encodedPath = Buffer.from(filename, 'utf8').toString('base64')
  const script = `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); $s=Get-AuthenticodeSignature -LiteralPath $p; if ($s.Status -ne 'Valid' -or !$s.SignerCertificate) { exit 1 }; $s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)`
  try {
    const systemRoot = process.env.SystemRoot
    if (!systemRoot) return 'Unable to locate Windows signature verifier'
    const { stdout } = await run(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 20_000, windowsHide: true })
    return publishers.includes(stdout.trim()) ? null : 'Update publisher does not match'
  } catch { return 'Unable to verify update signature' }
}
