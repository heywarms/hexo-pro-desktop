'use strict';

const { prepare } = require('./prepare-runtime');

module.exports = async context => {
  const arch = typeof context.arch === 'string' ? context.arch : ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch];
  const platform = context.electronPlatformName;
  if (arch === 'universal') {
    await prepare(platform, 'x64');
    await prepare(platform, 'arm64');
  } else {
    await prepare(platform, arch);
  }
};
