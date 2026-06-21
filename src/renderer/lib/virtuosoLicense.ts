// Single source for the @virtuoso.dev/message-list commercial license key,
// read once from the Vite build-time env (VITE_-prefixed, inlined into the
// renderer bundle) and shared by every <VirtuosoMessageListLicense> wrapper.
//
// .trim() guards against a trailing newline/space in the build-time env value
// (CI secrets commonly pick one up): any extra char breaks Virtuoso's checksum
// (key is [32-char checksum][base64]) and triggers a "license key is invalid"
// warning instead of rendering messages.
export const VIRTUOSO_LICENSE_KEY = ((import.meta.env.VITE_VIRTUOSO_LICENSE_KEY as string | undefined) ?? '').trim();
