// Windows code-signing hook for @electron/windows-sign, wired in via
// forge.config.ts -> packagerConfig.windowsSign.hookModulePath (only when
// WINDOWS_SIGN=1). Electron Forge calls this once per binary that needs a
// signature: every packaged .exe/.dll/.node, then MakerSquirrel's Setup.exe.
// The hook signs the file IN PLACE and must throw on failure.
//
// This targets Azure Trusted Signing (cloud, CI-friendly — no smart card, no
// GUI). signtool loads the Trusted Signing dlib, which authenticates to Azure
// via the standard env vars (AZURE_TENANT_ID / AZURE_CLIENT_ID /
// AZURE_CLIENT_SECRET) picked up by DefaultAzureCredential, and signs using the
// account + certificate profile described in the metadata JSON. The CI job
// installs the dlib, writes the metadata file, and exports:
//   AZURE_TRUSTED_SIGNING_DLIB     - path to Azure.CodeSigning.Dlib.dll
//   AZURE_TRUSTED_SIGNING_METADATA - path to metadata.json
//   SIGNTOOL_PATH (optional)       - full path to a recent signtool.exe
//   CODESIGN_TIMESTAMP_URL (opt.)  - RFC-3161 timestamp server
// Env is read inside the function so a single hook instance honours per-call env.

const { execFileSync } = require('node:child_process');

module.exports = async function windowsSign(fileToSign) {
  const dlib = process.env.AZURE_TRUSTED_SIGNING_DLIB;
  const metadata = process.env.AZURE_TRUSTED_SIGNING_METADATA;
  const signtool = process.env.SIGNTOOL_PATH || 'signtool.exe';
  const timestampUrl = process.env.CODESIGN_TIMESTAMP_URL || 'http://timestamp.acs.microsoft.com';

  if (!dlib) {
    throw new Error(`AZURE_TRUSTED_SIGNING_DLIB is not set — cannot sign ${fileToSign}`);
  }
  if (!metadata) {
    throw new Error(`AZURE_TRUSTED_SIGNING_METADATA is not set — cannot sign ${fileToSign}`);
  }

  execFileSync(
    signtool,
    [
      'sign',
      '/v',
      '/fd',
      'sha256', // file digest algorithm
      '/tr',
      timestampUrl, // RFC-3161 timestamp server (survives cert expiry)
      '/td',
      'sha256', // timestamp digest algorithm
      '/dlib',
      dlib, // Trusted Signing dlib that performs the cloud sign
      '/dmdf',
      metadata, // JSON: Endpoint, CodeSigningAccountName, CertificateProfileName
      '/d',
      'CoreSense', // description shown in the Windows UAC prompt
      fileToSign,
    ],
    { stdio: 'inherit' },
  );
};
