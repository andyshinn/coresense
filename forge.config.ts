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

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'build/icon',
    extraResource: bundledTiles,
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
    },
    // Auto-detects Developer ID Application cert from keychain. Required so
    // FusesPlugin skips its arm64-only ad-hoc resign and both per-arch builds
    // go into universal stitching with matching signature state; the merged
    // universal app is then signed once by @electron/osx-sign post-stitch.
    osxSign: {},
  },
  rebuildConfig: {},
  hooks: {
    // @abandonware/noble ships per-arch prebuilds at `bin/darwin-{arch}-{abi}/`,
    // and @electron/rebuild also writes its cross-arch build output there. Each
    // per-arch bundle ends up with only its own arch's path, which breaks
    // universal stitching. The runtime resolves the binary via node-gyp-build
    // from `build/Release/binding.node`, so the `bin/` directory is unused.
    // Runs in packageAfterPrune so it fires after @electron/rebuild.
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      const nobleBin = join(buildPath, 'node_modules', '@abandonware', 'noble', 'bin');
      await rm(nobleBin, { recursive: true, force: true });
    },
  },
  makers: [
    new MakerSquirrel({ setupIcon: 'build/icon.ico' }),
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
