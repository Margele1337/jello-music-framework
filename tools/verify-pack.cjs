const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

// electron 源码里 import 的 ../shared/*.js 必须一起进 asar，否则主进程启动即 ERR_MODULE_NOT_FOUND
const collectSharedImports = (dir, found = new Set()) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSharedImports(full, found);
    else if (entry.name.endsWith('.js')) {
      const source = fs.readFileSync(full, 'utf8');
      for (const match of source.matchAll(/from\s+'[^']*?(shared\/[^']+)'/g)) found.add(match[1]);
    }
  }
  return found;
};

exports.default = async (context) => {
  const resources = path.join(context.appOutDir, 'resources');
  const required = ['app.asar'];
  for (const relative of required) {
    if (!fs.existsSync(path.join(resources, relative))) {
      throw new Error(`[package] missing ${relative}; the application bundle is incomplete`);
    }
  }

  const archive = path.join(resources, 'app.asar');
  const packed = new Set(
    asar.listPackage(archive).map((entry) => entry.split(/[\\/]/).join('/').replace(/^\//, ''))
  );
  const projectDir = path.join(__dirname, '..');
  const missing = ['electron/main.js', 'dist/index.html', ...collectSharedImports(path.join(projectDir, 'electron'))]
    .filter((file) => !packed.has(file));

  if (missing.length > 0) {
    throw new Error(`[package] missing from app.asar: ${missing.join(', ')}; add them to build.files`);
  }
};
