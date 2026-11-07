'use strict';

const fs = require('fs-extra');
const path = require('node:path');
const { BundledRuntime } = require('../src/main/bundled-runtime');

module.exports = async context => {
  const platform = context.electronPlatformName;
  const arch = typeof context.arch === 'string' ? context.arch : ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch];
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  // @electron/universal requires identical resource trees before merging. Our
  // standard Node/Git binaries intentionally remain separate by architecture;
  // attach them after merging Electron, before its signing/notarization step.
  if (platform === 'darwin' && arch === 'universal') {
    const source = path.resolve(__dirname, '../resources');
    for (const target of ['arm64', 'x64']) {
      await fs.copy(path.join(source, 'runtime', `darwin-${target}`), path.join(resources, 'runtime', `darwin-${target}`));
    }
    await fs.copy(path.join(source, 'templates', 'default'), path.join(resources, 'templates', 'default'));
  }
  for (const target of arch === 'universal' ? ['arm64', 'x64'] : [arch]) {
    new BundledRuntime({ resourcesPath: resources, userDataPath: resources, platform, arch: target }).assertReady();
  }
  const codeRoots = arch === 'universal' && !fs.existsSync(path.join(resources, 'app.asar.unpacked'))
    ? ['app-arm64.asar.unpacked', 'app-x64.asar.unpacked'] : ['app.asar.unpacked'];
  for (const file of [
    ...codeRoots.flatMap(root => [
      `${root}/src/main/hexo-worker.js`,
      `${root}/src/main/hexo-pro-core/process-tools.js`,
      `${root}/node_modules/express/package.json`
    ]),
    'templates/default/package-lock.json',
    'templates/default/node_modules/hexo/package.json',
    'templates/default/node_modules/hexo-server/package.json',
    'templates/default/node_modules/hexo-theme-landscape/package.json'
  ]) {
    if (!fs.existsSync(path.join(resources, file))) throw new Error(`安装包缺少离线运行必需文件: ${file}`);
  }
  // electron-builder 26 names the two intermediate universal builds this way.
  // Remove only verified, reproducible resources; final builds retain them.
  if (platform === 'darwin' && /-universal-(?:x64|arm64)-temp$/.test(context.appOutDir)) {
    await fs.remove(path.join(resources, 'runtime'));
    await fs.remove(path.join(resources, 'templates'));
  }
};
