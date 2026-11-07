'use strict';

const fs = require('fs-extra');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

const pending = new Map();
const stateFile = project => path.join(project, '.hexo-pro', 'desktop-runtime.json');

async function fingerprint(project, runtime) {
  const manifest = runtime.assertReady();
  const hash = crypto.createHash('sha256').update(JSON.stringify({ node: manifest.node, platform: runtime.platform, arch: runtime.arch }));
  for (const file of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']) {
    hash.update(await fs.readFile(path.join(project, file)).catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    }));
  }
  return hash.digest('hex');
}

async function dependenciesPresent(project) {
  const pkg = await fs.readJson(path.join(project, 'package.json'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!await fs.pathExists(path.join(project, 'node_modules', name, 'package.json'))) return false;
  }
  return true;
}

async function markReady(project, runtime) {
  await fs.outputJson(stateFile(project), { fingerprint: await fingerprint(project, runtime) });
}

async function prepareProject(project, runtime, onOutput) {
  project = path.resolve(project);
  if (pending.has(project)) return pending.get(project);
  const work = (async () => {
    const expected = await fingerprint(project, runtime);
    const state = await fs.readJson(stateFile(project)).catch(() => null);
    if (state?.fingerprint === expected && await dependenciesPresent(project)) return;
    onOutput?.({ type: 'stdout', data: '正在为此博客准备组件，首次导入可能需要下载，请稍候…' });
    // Install preserves existing projects and their lockfile resolution. Rebuild also
    // replaces native addons previously installed for Electron or another Node ABI.
    await runtime.run('npm', ['install', '--include=dev', '--no-audit', '--no-fund'], { cwd: project, onOutput });
    await runtime.run('npm', ['rebuild', '--no-audit', '--no-fund'], { cwd: project, onOutput });
    if (!await dependenciesPresent(project)) throw new Error('博客组件未安装完整，请检查网络后重新打开博客。');
    await markReady(project, runtime);
  })();
  pending.set(project, work);
  try { await work; } finally { pending.delete(project); }
}

async function createProject(project, title, runtime, onOutput) {
  runtime.assertReady();
  if (!await fs.pathExists(path.join(runtime.templatePath, 'node_modules', 'hexo', 'package.json'))) {
    throw new Error('应用内置博客模板不完整，请重新安装 Hexo Pro Desktop。');
  }
  if (await fs.pathExists(project)) throw new Error('此文件夹已存在，请选择其他博客名称。');
  await fs.ensureDir(path.dirname(project));
  const staging = await fs.mkdtemp(path.join(path.dirname(project), '.hexopro-create-'));
  try {
    onOutput?.({ type: 'stdout', data: '正在复制内置主题和博客组件…' });
    await fs.copy(runtime.templatePath, staging, { dereference: false });
    const configPath = path.join(staging, '_config.yml');
    const config = yaml.load(await fs.readFile(configPath, 'utf8'));
    config.title = title;
    await fs.writeFile(configPath, yaml.dump(config), 'utf8');
    await markReady(staging, runtime);
    await fs.move(staging, project, { overwrite: false });
  } finally {
    await fs.remove(staging);
  }
}

module.exports = { createProject, prepareProject, markReady, dependenciesPresent };
