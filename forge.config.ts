import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { PublisherGithub } from '@electron-forge/publisher-github';
import type { ForgeConfig } from '@electron-forge/shared-types';

// Bundled PMTiles extracts (basemap + terrain) ship as extraResource so they
// land outside app.asar and remain accessible to fs ranged reads. They're
// tracked in git-LFS but optional at build time — the app must package and
// run without them (Map panel shows a "missing tiles" empty-state). Only
// include files that actually exist on disk.
const TILE_EXTRACTS = ['resources/tiles/basemap.pmtiles', 'resources/tiles/terrain.pmtiles'];
const bundledTiles = TILE_EXTRACTS.filter((p) => existsSync(p));

// The macOS app icon is built from logo/coresense.icon (Icon Composer bundle)
// by compiling it once with `actool` and committing the two outputs:
//   build/icon.icns  - legacy fallback, picked up by packagerConfig.icon below
//                      (-> CFBundleIconFile) for macOS versions before 26.
//   build/Assets.car - compiled asset catalog read by macOS 26+ for the Liquid
//                      Glass rendering; must sit in Contents/Resources/ and is
//                      paired with CFBundleIconName in extendInfo below.
// To regenerate after editing the .icon bundle:
//   actool logo/coresense.icon --compile <tmp> --app-icon coresense \
//     --output-partial-info-plist <tmp>/partial.plist --platform macosx \
//     --minimum-deployment-target 11.0
// then copy <tmp>/coresense.icns -> build/icon.icns and <tmp>/Assets.car.
// Shipped only in macOS builds — it's dead weight in Windows/Linux bundles.
const macIconCatalog = process.platform === 'darwin' ? ['build/Assets.car'] : [];

// Windows code signing is opt-in: only wired up when WINDOWS_SIGN=1 so local
// and CI builds still package while unsigned. When enabled, the hook module
// (scripts/windows-sign.cjs) signs each packaged binary; MakerSquirrel reuses
// the same options below to sign the generated Setup.exe. Signing must run on
// a Windows host — signtool.exe is not available on macOS/Linux.
const windowsSign = process.env.WINDOWS_SIGN
  ? { hookModulePath: join(process.cwd(), 'scripts', 'windows-sign.cjs') }
  : undefined;

// Notarization is opt-in: only configured when API key credentials are present,
// so local/unsigned builds still package. Uses App Store Connect API key auth
// (issuer + key ID + .p8 file path) rather than Apple ID + app-specific password.
const osxNotarize =
  process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER
    ? {
        appleApiKey: process.env.APPLE_API_KEY,
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        appleApiIssuer: process.env.APPLE_API_ISSUER,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'build/icon',
    extraResource: [...bundledTiles, ...macIconCatalog],
    // The Vite plugin's default ignore excludes everything outside /.vite, but
    // we need /node_modules for the native module (@stoprocent/noble) that
    // cannot be bundled by Rollup. AutoUnpackNativesPlugin moves the .node
    // binaries out of app.asar at package time.
    ignore: (file: string) => {
      if (!file) return false;
      if (file.startsWith('/.vite')) return false;
      if (file === '/package.json') return false;
      if (file.startsWith('/node_modules')) return false;
      return true;
    },
    extendInfo: {
      NSBluetoothAlwaysUsageDescription: 'CoreSense uses Bluetooth to scan for and connect to MeshCore radios.',
      NSBluetoothPeripheralUsageDescription: 'CoreSense uses Bluetooth to scan for and connect to MeshCore radios.',
      // macOS 26+ reads the app icon from Assets.car (shipped via extraResource)
      // by this name; older macOS falls back to CFBundleIconFile / build/icon.icns.
      // Must match the `actool --app-icon` value used to build build/Assets.car.
      CFBundleIconName: 'coresense',
    },
    osxUniversal: {
      mergeASARs: true,
    },
    // Required so FusesPlugin skips its arm64-only ad-hoc resign and both
    // per-arch builds go into universal stitching with matching signature
    // state; the merged universal app is then signed once by @electron/osx-sign
    // post-stitch. APPLE_SIGNING_IDENTITY pins the cert (e.g. "Developer ID
    // Application: Name (TEAMID)"); when unset, osx-sign auto-detects via
    // `security find-identity` and picks the first match.
    osxSign: {
      identity: process.env.APPLE_SIGNING_IDENTITY,
    },
    osxNotarize,
    windowsSign,
  },
  rebuildConfig: {
    // Skip @electron/rebuild entirely. The only native dependency,
    // @stoprocent/noble (and its @stoprocent/bluetooth-hci-socket dep), ships
    // N-API prebuilds via prebuildify; N-API is ABI-stable, so those prebuilt
    // binaries load in Electron as-is with no per-arch recompile. Skipping the
    // rebuild means no per-arch node-gyp build/ tree is generated — that
    // per-arch output is what made universal (x64+arm64) stitching fail.
    onlyModules: [],
  },
  hooks: {
    // Universal macOS builds package x64 and arm64 separately, then
    // @electron/universal stitches them; any non-Mach-O file that differs
    // between the two aborts the merge. With the rebuild skipped above, the
    // native modules resolve from their shipped N-API prebuilds/, so this hook
    // only strips leftovers that would otherwise trip the stitch. Runs in
    // packageAfterPrune, after forge's devDependency prune.
    packageAfterPrune: async (_forgeConfig, buildPath, _electronVersion, platform) => {
      const nodeModules = join(buildPath, 'node_modules');
      // A prior local `electron-forge`/`@electron/rebuild` run can leave a
      // single-arch build/ or bin/ cache in the dev node_modules, which forge
      // copies verbatim into both per-arch builds. node-gyp-build resolves from
      // prebuilds/ here, so drop them — a stray thin .node trips the merge.
      for (const pkg of ['noble', 'bluetooth-hci-socket']) {
        const pkgDir = join(nodeModules, '@stoprocent', pkg);
        await rm(join(pkgDir, 'build'), { recursive: true, force: true });
        await rm(join(pkgDir, 'bin'), { recursive: true, force: true });
      }
      // @stoprocent/bluetooth-hci-socket is never loaded on macOS: noble uses
      // the CoreBluetooth ("mac") binding there, and the HCI binding — this
      // module's only consumer — is reached only via a USB HCI adapter. Its
      // prebuilds are dead weight, and its darwin prebuild is a broken thin
      // x86_64 binary that aborts the universal merge, so drop them on macOS.
      // TO SUPPORT USB HCI ADAPTERS ON macOS LATER: provide a genuine universal
      // (x64+arm64) bhs binary — fork the package or `pnpm patch` a correct
      // prebuild in — then delete this block.
      if (platform === 'darwin') {
        await rm(join(nodeModules, '@stoprocent', 'bluetooth-hci-socket', 'prebuilds'), {
          recursive: true,
          force: true,
        });
      }
      // Forge's prune removes devDependency packages but leaves their
      // node_modules/.bin/* CLI shims behind as dangling symlinks. @electron/asar
      // packs those, and @electron/universal's asar merge dereferences every
      // entry — a dangling shim aborts the merge. The shims are dev-only and
      // unused at runtime, so drop the directory entirely.
      await rm(join(nodeModules, '.bin'), { recursive: true, force: true });
    },
  },
  makers: [
    new MakerSquirrel({ setupIcon: 'build/icon.ico', windowsSign }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerDMG({ icon: 'build/icon.icns' }),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'andyshinn',
        name: 'coresense',
      },
      draft: true,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
