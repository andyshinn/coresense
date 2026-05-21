import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
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

// Universal macOS builds compile x64 and arm64 separately, then
// @electron/universal stitches them. Any file that differs between the two
// builds and isn't a Mach-O binary aborts the asar merge ("Can't reconcile two
// non-macho files"). Native modules carry per-arch build output that triggers
// this — node-gyp scaffolding (Makefile, *.target.mk, config.gypi, gyp-mac-tool,
// .deps/, obj.target/, *.o, *.a) plus @electron-forge's own `.forge-meta`
// rebuild marker. Only the compiled `*.node` binaries are needed at runtime.
//
// pruneBuildArtifacts walks the whole packaged node_modules. A native module is
// identified by a `binding.gyp` at its root; that module's `build/` tree is
// wiped down to just its `.node` files. Everywhere else only files with
// unambiguous build-artifact names are removed — so real package code shipped
// in a non-native `build/` directory (e.g. maplibre-gl) is left untouched.
const GYP_ARTIFACT_DIRS = new Set(['obj.target', '.deps']);

const isBuildArtifactFile = (name: string): boolean =>
  name === 'Makefile' ||
  name === 'config.gypi' ||
  name === 'gyp-mac-tool' ||
  name === '.forge-meta' ||
  name.endsWith('.Makefile') ||
  name.endsWith('.target.mk') ||
  name.endsWith('.o') ||
  name.endsWith('.a');

// Within a native module's node-gyp `build/` tree, keep only `*.node` binaries.
const keepOnlyNodeBinaries = async (dir: string): Promise<void> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await keepOnlyNodeBinaries(full);
    } else if (!entry.name.endsWith('.node')) {
      await rm(full, { force: true });
    }
  }
};

const pruneBuildArtifacts = async (dir: string): Promise<void> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const isNativeModule = entries.some((e) => e.isFile() && e.name === 'binding.gyp');
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isNativeModule && entry.name === 'build') {
        await keepOnlyNodeBinaries(full);
      } else if (GYP_ARTIFACT_DIRS.has(entry.name)) {
        await rm(full, { recursive: true, force: true });
      } else {
        await pruneBuildArtifacts(full);
      }
    } else if (isBuildArtifactFile(entry.name)) {
      await rm(full, { force: true });
    }
  }
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'build/icon',
    extraResource: [...bundledTiles, ...macIconCatalog],
    // The Vite plugin's default ignore excludes everything outside /.vite, but
    // we need /node_modules for native modules (@abandonware/noble, better-sqlite3)
    // that cannot be bundled by Rollup. AutoUnpackNativesPlugin moves the .node
    // binaries out of app.asar at package time.
    ignore: (file: string) => {
      if (!file) return false;
      if (file.startsWith('/.vite')) return false;
      if (file === '/package.json') return false;
      if (file.startsWith('/node_modules')) return false;
      return true;
    },
    extendInfo: {
      NSBluetoothAlwaysUsageDescription:
        'CoreSense uses Bluetooth to scan for and connect to MeshCore radios.',
      NSBluetoothPeripheralUsageDescription:
        'CoreSense uses Bluetooth to scan for and connect to MeshCore radios.',
      // macOS 26+ reads the app icon from Assets.car (shipped via extraResource)
      // by this name; older macOS falls back to CFBundleIconFile / build/icon.icns.
      // Must match the `actool --app-icon` value used to build build/Assets.car.
      CFBundleIconName: 'coresense',
    },
    osxUniversal: {
      mergeASARs: true,
      // singleArchFiles: '**/node_modules/@stoprocent/**/*.node',
    },
    // Auto-detects Developer ID Application cert from keychain. Required so
    // FusesPlugin skips its arm64-only ad-hoc resign and both per-arch builds
    // go into universal stitching with matching signature state; the merged
    // universal app is then signed once by @electron/osx-sign post-stitch.
    osxSign: {},
    windowsSign,
  },
  rebuildConfig: {},
  hooks: {
    // Universal macOS builds package x64 and arm64 separately, then
    // @electron/universal stitches them. Several leftovers in node_modules
    // break that stitch; this hook strips them. Runs in packageAfterPrune so it
    // fires after @electron/rebuild (forge runs that in afterCopy) and after
    // forge's devDependency prune.
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      const nodeModules = join(buildPath, 'node_modules');
      // @stoprocent native modules: @electron/rebuild leaves a per-arch `bin/`
      // build cache (differently named per arch -> file-count mismatch), and
      // they ship `prebuilds/` (bluetooth-hci-socket's is a mislabeled thin
      // x86_64 binary -> trips the x64ArchFiles guard). Neither is used at
      // runtime — node-gyp-build resolves from build/Release first.
      for (const pkg of ['noble', 'bluetooth-hci-socket']) {
        const pkgDir = join(nodeModules, '@stoprocent', pkg);
        await rm(join(pkgDir, 'bin'), { recursive: true, force: true });
        await rm(join(pkgDir, 'prebuilds'), { recursive: true, force: true });
      }
      // Strip per-arch native build output from every package — see the
      // helper comment above.
      await pruneBuildArtifacts(nodeModules);
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
