const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const pnpmVirtualStore = path.resolve(projectRoot, '..', 'pv');
const config = getDefaultConfig(projectRoot);

// The project keeps pnpm's virtual store at D:\\pv to avoid Windows/CMake
// path-length failures. Metro resolves symlinks to that physical location, so
// explicitly keep both the store and the project's public node_modules graph in
// its search scope (notably for peer dependencies such as React).
//
// This folder only exists when dependencies were installed with pnpm (per
// pnpm-workspace.yaml's virtualStoreDir: ../pv). If node_modules was instead
// installed with npm, `../pv` is never created and Metro's file watcher
// throws ENOENT trying to watch a missing directory - so only add it when
// it's actually there.
const watchFolders = [...(config.watchFolders ?? [])];
if (fs.existsSync(pnpmVirtualStore)) {
  watchFolders.push(pnpmVirtualStore);
} else {
  console.warn(
    `[metro.config.js] Skipping watchFolders entry for pnpm virtual store - ` +
      `'${pnpmVirtualStore}' does not exist. If you intended to use pnpm's ` +
      `short-path workaround (recommended for Android native builds on ` +
      `Windows), delete node_modules/package-lock.json and run "pnpm install" ` +
      `instead of "npm install".`
  );
}
config.watchFolders = [...new Set(watchFolders)];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
