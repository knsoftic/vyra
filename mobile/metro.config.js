// Metro configuration.
//
// The app imports from `shared/contracts`, which sits above this package in the
// repository. Until now every one of those imports was `import type`, which
// TypeScript erases — Metro never had to resolve them, so no config was needed.
//
// `SOCKET_EVENTS` is the first *value* imported from there. Metro has to bundle
// it, and by default it will not look outside the project root, so it must be
// told where the shared folder is and be allowed to resolve into it.
//
// The alternative — copying the event names into this package — would let the
// client and the server drift apart on the exact strings they use to talk to
// each other, which is the thing the shared contract exists to prevent.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the shared contracts so a change there triggers a reload.
config.watchFolders = [path.resolve(workspaceRoot, 'shared')];

// Resolve this package's node_modules first, then the workspace root's, so a
// dependency hoisted to the root is still found.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
