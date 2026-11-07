'use strict';

const fs = require('fs-extra');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const tar = require('tar');
const releases = require('./runtime/releases.json');
const { BundledRuntime } = require('../src/main/bundled-runtime');

const appDir = path.resolve(__dirname, '..');
const resources = path.join(appDir, 'resources');
const cache = path.join(appDir, '.runtime-cache');
const jobs = new Map();

async function checksum(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(asset) {
  await fs.ensureDir(cache);
  const file = path.join(cache, `${asset.sha256}-${path.basename(new URL(asset.url).pathname)}`);
  if (await fs.pathExists(file) && await checksum(file) === asset.sha256) return file;
  const temporary = `${file}.${crypto.randomUUID()}.download`;
  try {
    console.log(`准备内置组件：${path.basename(new URL(asset.url).pathname)}`);
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error(`下载失败 (${response.status}): ${asset.url}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
    if (await checksum(temporary) !== asset.sha256) throw new Error(`内置组件校验失败: ${asset.url}`);
    await fs.move(temporary, file, { overwrite: true });
    return file;
  } finally { await fs.remove(temporary); }
}

async function extractNode(archive, destination) {
  await fs.ensureDir(destination);
  if (archive.endsWith('.zip')) {
    const extractZip = require('extract-zip');
    const staging = `${destination}.zip`;
    try {
      await extractZip(archive, { dir: staging });
      const entries = await fs.readdir(staging);
      if (entries.length !== 1) throw new Error('Unexpected Node archive layout');
      await fs.copy(path.join(staging, entries[0]), destination);
    } finally { await fs.remove(staging); }
  } else {
    await tar.x({ file: archive, cwd: destination, strip: 1 });
  }
}

async function prepareRuntime(platform, arch) {
  const key = `${platform}-${arch}`;
  if (jobs.has(key)) return jobs.get(key);
  const job = (async () => {
    const assets = releases.targets[key];
    if (!assets) throw new Error(`没有可分发的内置环境：${key}`);
    const root = path.join(resources, 'runtime', key);
    const manifest = { platform, arch, node: releases.nodeVersion, npm: releases.npmVersion, git: releases.gitVersion, assets };
    const existing = await fs.readJson(path.join(root, 'manifest.json')).catch(() => null);
    const runtime = new BundledRuntime({ resourcesPath: resources, userDataPath: path.join(cache, 'build-user'), platform, arch });
    if (JSON.stringify(existing) === JSON.stringify(manifest)) {
      try { runtime.assertReady(); return runtime; } catch (_) { /* Repair incomplete build output. */ }
    }
    await fs.ensureDir(path.dirname(root));
    const staging = await fs.mkdtemp(`${root}.stage-`);
    try {
      const [nodeArchive, gitArchive] = await Promise.all([download(assets.node), download(assets.git)]);
      await extractNode(nodeArchive, path.join(staging, 'node'));
      await fs.ensureDir(path.join(staging, 'git'));
      await tar.x({ file: gitArchive, cwd: path.join(staging, 'git') });
      await fs.writeJson(path.join(staging, 'manifest.json'), manifest, { spaces: 2 });
      await fs.remove(root);
      await fs.move(staging, root);
      runtime.assertReady();
      return runtime;
    } finally { await fs.remove(staging); }
  })();
  jobs.set(key, job);
  try { return await job; } catch (error) { jobs.delete(key); throw error; }
}

async function assertPortableTemplate(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertPortableTemplate(file);
    else if (entry.name.endsWith('.node')) throw new Error(`内置模板含有平台相关模块，需要为每个平台分别构建: ${file}`);
  }
}

async function prepareTemplate() {
  if (jobs.has('template')) return jobs.get('template');
  const job = (async () => {
    const source = path.join(appDir, 'templates', 'default');
    const target = path.join(resources, 'templates', 'default');
    const templateHash = crypto.createHash('sha256').update(await fs.readFile(__filename)).update(releases.nodeVersion);
    async function hashSource(directory) {
      for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === 'node_modules') continue;
        const file = path.join(directory, entry.name);
        templateHash.update(path.relative(source, file));
        if (entry.isDirectory()) await hashSource(file);
        else templateHash.update(await fs.readFile(file));
      }
    }
    await hashSource(source);
    const hash = templateHash.digest('hex');
    const marker = `${target}.manifest.json`;
    if ((await fs.readJson(marker).catch(() => null))?.hash === hash &&
        await fs.pathExists(path.join(target, 'node_modules', '.bin', 'hexo.cmd')) &&
        await fs.pathExists(path.join(target, 'themes', 'landscape', 'layout', '_partial', 'head.ejs'))) return;
    const hostRuntime = await prepareRuntime(process.platform, process.arch);
    await fs.ensureDir(path.dirname(target));
    const staging = await fs.mkdtemp(`${target}.stage-`);
    try {
      await fs.copy(source, staging, { filter: file => !file.split(path.sep).includes('node_modules') });
      await hostRuntime.run('npm', ['ci', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund'], {
        cwd: staging, onOutput: ({ data }) => process.stdout.write(data)
      });
      await assertPortableTemplate(path.join(staging, 'node_modules'));
      // npm creates host-specific launchers; generate both Windows and POSIX
      // shims so this pure-JS template can be copied by cross-platform builds.
      const cmdShim = require(path.resolve(path.dirname(hostRuntime.npmPath), '../node_modules/cmd-shim'));
      const modules = path.join(staging, 'node_modules');
      for (const entry of await fs.readdir(modules)) {
        if (entry.startsWith('.')) continue;
        const names = entry.startsWith('@') ? (await fs.readdir(path.join(modules, entry))).map(name => `${entry}/${name}`) : [entry];
        for (const name of names) {
          const pkgDir = path.join(modules, name);
          const pkg = await fs.readJson(path.join(pkgDir, 'package.json'));
          const bins = typeof pkg.bin === 'string' ? { [pkg.name.split('/').pop()]: pkg.bin } : pkg.bin || {};
          for (const [name, relative] of Object.entries(bins)) {
            await cmdShim(path.join(pkgDir, relative), path.join(modules, '.bin', name));
          }
        }
      }
      // Landscape references CDN fonts by default. Ship a local copy of its
      // theme and assets, including their licenses, for a fully offline preview.
      const theme = path.join(staging, 'themes', 'landscape');
      await fs.copy(path.join(modules, 'hexo-theme-landscape'), theme);
      for (const name of ['fork-awesome', 'typeface-source-code-pro']) {
        await fs.copy(path.join(modules, name), path.join(theme, 'source', 'vendor', name));
      }
      const head = path.join(theme, 'layout', '_partial', 'head.ejs');
      const originalHead = await fs.readFile(head, 'utf8');
      await fs.writeFile(head, originalHead
        .replace('https://cdn.jsdelivr.net/npm/typeface-source-code-pro@0.0.71/index.min.css', 'vendor/typeface-source-code-pro/index.css')
        .replace('https://cdn.jsdelivr.net/npm/fork-awesome@1.2.0/css/fork-awesome.min.css', 'vendor/fork-awesome/css/fork-awesome.min.css'));
      await fs.remove(target);
      await fs.move(staging, target);
      await fs.writeJson(marker, { hash });
    } finally { await fs.remove(staging); }
  })();
  jobs.set('template', job);
  return job;
}

async function prepare(platform = process.platform, arch = process.arch) {
  await prepareRuntime(platform, arch);
  await prepareTemplate();
}

if (require.main === module) {
  prepare(process.argv[2] || process.platform, process.argv[3] || process.arch).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { prepare, prepareRuntime, prepareTemplate, checksum, download };
