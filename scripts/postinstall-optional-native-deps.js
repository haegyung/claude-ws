/**
 * Postinstall script — chmod spawn-helper for node-pty on Unix,
 * and log a friendly message if node-pty is unavailable.
 *
 * node-pty is in optionalDependencies so npm/pnpm handle install failures
 * gracefully. This script just does post-setup and user feedback.
 *
 * If node-pty is not available (e.g. Windows ARM64), the interactive
 * terminal panel is disabled but everything else works.
 */

const path = require('path');
const fs = require('fs');

const PKG = '@homebridge/node-pty-prebuilt-multiarch';
const PKG_DIR = path.join(__dirname, '..', 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch');

try {
  require.resolve(PKG, { paths: [path.join(__dirname, '..')] });
  // chmod +x the spawn-helper binary on Unix
  try {
    const helper = path.join(
      PKG_DIR, 'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper'
    );
    fs.chmodSync(helper, 0o755);
  } catch {
    // spawn-helper may not exist on this platform
  }
} catch {
  // node-pty not installed — this is fine, terminal feature will be disabled
}
