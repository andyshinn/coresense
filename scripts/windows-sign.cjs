// Windows code-signing hook for @electron/windows-sign, wired in via
// forge.config.ts -> packagerConfig.windowsSign.hookModulePath (only when
// WINDOWS_SIGN=1). Electron Forge calls this once per binary that needs a
// signature: every packaged .exe/.dll/.node, then MakerSquirrel's Setup.exe.
// The hook signs the file IN PLACE and must throw on failure.
//
// This template targets a Certum "Open Source Code Signing" certificate
// exposed as a virtual smart card by Certum SimplySign Desktop. Set:
//   CODESIGN_THUMBPRINT  - SHA-1 thumbprint of the cert (certmgr.msc ->
//                          your cert -> Details -> Thumbprint, no spaces)
//   CODESIGN_TIMESTAMP_URL (optional) - RFC-3161 timestamp server
//   SIGNTOOL_PATH (optional) - full path to signtool.exe if not on PATH
//
// For Azure Trusted Signing instead, see the note at the bottom of this file.

const { execFileSync } = require('node:child_process');

const THUMBPRINT = process.env.CODESIGN_THUMBPRINT;
const TIMESTAMP_URL = process.env.CODESIGN_TIMESTAMP_URL || 'http://time.certum.pl';
const SIGNTOOL = process.env.SIGNTOOL_PATH || 'signtool.exe';

module.exports = async function windowsSign(fileToSign) {
  if (!THUMBPRINT) {
    throw new Error(`CODESIGN_THUMBPRINT is not set — cannot sign ${fileToSign}`);
  }

  execFileSync(
    SIGNTOOL,
    [
      'sign',
      '/sha1',
      THUMBPRINT, // select signing cert by thumbprint
      '/fd',
      'sha256', // file digest algorithm
      '/tr',
      TIMESTAMP_URL, // RFC-3161 timestamp server (survives cert expiry)
      '/td',
      'sha256', // timestamp digest algorithm
      '/d',
      'CoreSense', // description shown in the Windows UAC prompt
      fileToSign,
    ],
    { stdio: 'inherit' },
  );
};

// --- Azure Trusted Signing alternative ---------------------------------------
// Trusted Signing is the most CI-friendly option (no smart card, no GUI app).
// Replace the execFileSync call above with the trusted-signing dlib:
//
//   execFileSync(SIGNTOOL, [
//     'sign', '/v', '/debug', '/fd', 'sha256',
//     '/tr', 'http://timestamp.acs.microsoft.com', '/td', 'sha256',
//     '/dlib', process.env.AZURE_TRUSTED_SIGNING_DLIB,
//     '/dmdf', process.env.AZURE_TRUSTED_SIGNING_METADATA, // JSON: endpoint,
//                                                          // account, profile
//     fileToSign,
//   ], { stdio: 'inherit' });
//
// Auth is via the standard Azure env vars (AZURE_TENANT_ID, AZURE_CLIENT_ID,
// AZURE_CLIENT_SECRET) picked up by the dlib's DefaultAzureCredential.
