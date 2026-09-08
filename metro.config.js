const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const pnpmVirtualStore = path.resolve(projectRoot, '..', 'pv');
const config = getDefaultConfig(projectRoot);

// The project keeps pnpm's virtual store at D:\\pv to avoid Windows/CMake
// path-length failures. Metro resolves symlinks to that physical location, so
// explicitly keep both the store and the project's public node_modules graph in
// its search scope (notably for peer dependencies such as React).
config.watchFolders = [...new Set([...(config.watchFolders ?? []), pnpmVirtualStore])];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
