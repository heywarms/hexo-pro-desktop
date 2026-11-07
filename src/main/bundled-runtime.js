'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

class BundledRuntime {
  constructor({ resourcesPath, userDataPath, platform = process.platform, arch = process.arch }) {
    this.platform = platform;
    this.arch = arch;
    this.key = `${platform}-${arch}`;
    this.root = path.join(resourcesPath, 'runtime', this.key);
    this.templatePath = path.join(resourcesPath, 'templates', 'default');
    this.userDataPath = userDataPath;
    this.nodeDir = path.join(this.root, 'node', platform === 'win32' ? '' : 'bin');
    this.nodePath = path.join(this.nodeDir, platform === 'win32' ? 'node.exe' : 'node');
    this.npmPath = path.join(this.root, 'node', platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js');
    this.gitRoot = path.join(this.root, 'git');
    this.gitPath = path.join(this.gitRoot, platform === 'win32' ? 'cmd/git.exe' : 'bin/git');
    this.gitPrefix = platform === 'win32' ? path.join(this.gitRoot, arch === 'ia32' ? 'mingw32' : arch === 'arm64' ? 'clangarm64' : 'mingw64') : this.gitRoot;
  }

  assertReady() {
    for (const file of [this.nodePath, this.npmPath, this.gitPath, path.join(this.root, 'manifest.json')]) {
      if (!fs.existsSync(file)) {
        throw new Error('应用内置组件不完整，请重新安装 Hexo Pro Desktop。源码开发请先运行 npm run prepare:runtime。');
      }
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(this.root, 'manifest.json'), 'utf8'));
    if (manifest.platform !== this.platform || manifest.arch !== this.arch) throw new Error('应用内置组件与当前系统不匹配，请安装适合此电脑的版本。');
    return manifest;
  }

  environment(base = process.env, projectPath) {
    const env = { ...base };
    const inheritedPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
    // Do not let a terminal's Node/npm settings select another runtime or global cache.
    for (const key of Object.keys(env)) {
      if (/^(path|node_path|node_options|electron_run_as_node|npm_config_.*|git_exec_path|git_template_dir|git_config_system|local_git_directory)$/i.test(key)) delete env[key];
    }
    const paths = [this.nodeDir, path.dirname(this.gitPath), path.join(this.gitPrefix, 'bin')];
    if (this.platform === 'win32') paths.push(path.join(this.gitRoot, 'usr', 'bin'));
    if (projectPath) paths.push(path.join(projectPath, 'node_modules', '.bin'));
    env.PATH = [...paths, inheritedPath].filter(Boolean).join(this.platform === 'win32' ? ';' : ':');
    Object.assign(env, {
      HEXOPRO_MANAGED_RUNTIME: '1',
      HEXOPRO_NODE_PATH: this.nodePath,
      HEXOPRO_NPM_CLI: this.npmPath,
      HEXOPRO_GIT_PATH: this.gitPath,
      GIT_EXEC_PATH: path.join(this.gitPrefix, 'libexec', 'git-core'),
      GIT_TEMPLATE_DIR: path.join(this.gitPrefix, 'share', 'git-core', 'templates'),
      GIT_TERMINAL_PROMPT: '0',
      NPM_CONFIG_CACHE: path.join(this.userDataPath, 'npm-cache'),
      NPM_CONFIG_USERCONFIG: path.join(this.userDataPath, 'runtime-config', 'npmrc'),
      NPM_CONFIG_GLOBALCONFIG: path.join(this.userDataPath, 'runtime-config', 'global-npmrc'),
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_AUDIT: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/'
    });
    if (this.platform !== 'win32') env.GIT_CONFIG_SYSTEM = path.join(this.gitRoot, 'etc', 'gitconfig');
    if (this.platform === 'linux') {
      env.PREFIX = this.gitRoot;
      env.GIT_SSL_CAINFO = base.GIT_SSL_CAINFO || path.join(this.gitRoot, 'ssl', 'cacert.pem');
    }
    return env;
  }

  run(tool, args, { cwd, onOutput, timeout = 600000, env, ...options } = {}) {
    this.assertReady();
    const commands = { node: [this.nodePath, args], npm: [this.nodePath, [this.npmPath, ...args]], git: [this.gitPath, args] };
    if (!commands[tool]) throw new Error(`Unsupported bundled tool: ${tool}`);
    const [command, parameters] = commands[tool];
    return new Promise((resolve, reject) => {
      const child = spawn(command, parameters, {
        ...options, cwd, env: this.environment(env || process.env, cwd), shell: false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('准备博客组件超时，请检查网络后重试。'));
      }, timeout);
      child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-65536); onOutput?.({ type: 'stdout', data: String(chunk) }); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65536); onOutput?.({ type: 'stderr', data: String(chunk) }); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error((stderr || stdout || `内置组件运行失败 (${code})`).trim()));
      });
    });
  }
}

let desktopRuntime;
function getDesktopRuntime() {
  if (!desktopRuntime) {
    const { app } = require('electron');
    desktopRuntime = new BundledRuntime({
      resourcesPath: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../resources'),
      userDataPath: app.getPath('userData')
    });
  }
  return desktopRuntime;
}

module.exports = { BundledRuntime, getDesktopRuntime };
