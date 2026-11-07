'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');
const { getDesktopRuntime } = require('./bundled-runtime');

// Electron owns windows and credentials; the bundled standard Node owns all
// project code, npm addons, the preview server and publishing processes.
class HexoServerProcess {
  constructor(projectPath, runtime = getDesktopRuntime(), options = {}) {
    this.projectPath = projectPath;
    this.runtime = runtime;
    this.workerPath = options.workerPath || path.join(__dirname.replace(/(app(?:-(?:x64|arm64))?\.asar)([\\/])/, '$1.unpacked$2'), 'hexo-worker.js');
    this.child = null;
    this.requests = new Map();
    this.sequence = 0;
    this.info = null;
    this.spawnChild = options.fork || fork;
  }

  launch() {
    if (this.child) return;
    this.runtime.assertReady();
    const child = this.spawnChild(this.workerPath, [this.projectPath || ''], {
      execPath: this.runtime.nodePath,
      execArgv: [],
      cwd: this.projectPath || path.dirname(this.workerPath),
      env: this.runtime.environment(process.env, this.projectPath),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
    });
    this.child = child;
    child.stdout.on('data', data => console.log('[Blog]', String(data).trim()));
    child.stderr.on('data', data => console.warn('[Blog]', String(data).trim()));
    child.on('message', message => {
      if (this.child !== child) return;
      if (message.info) this.info = message.info;
      const request = this.requests.get(message.id);
      if (!request) return;
      this.requests.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else request.resolve(message.result);
    });
    const failed = error => {
      if (this.child !== child) return;
      this.child = null;
      this.info = null;
      for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); }
      this.requests.clear();
    };
    child.once('error', failed);
    child.once('exit', (code, signal) => failed(new Error(`博客服务已停止 (${signal || code})，请重新打开博客。`)));
  }

  request(method, args = [], timeout = 120000) {
    this.launch();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('博客服务响应超时，请重新打开博客。'));
        this.child?.kill();
      }, timeout);
      this.requests.set(id, { resolve, reject, timer });
      this.child.send({ id, method, args }, error => {
        if (!error) return;
        clearTimeout(timer);
        this.requests.delete(id);
        reject(error);
      });
    });
  }

  async start() {
    try { return await this.request('start'); }
    catch (error) { await this.forceStop(); throw error; }
  }
  async startStaticServer() {
    try { return await this.request('startStaticServer'); }
    catch (error) { await this.forceStop(); throw error; }
  }
  restart() { return this.request('restart'); }
  generate() { return this.request('generate'); }
  deploy() { return this.request('deploy', [], 600000); }
  clean() { return this.request('clean'); }
  getBlogConfig() { return this.request('getBlogConfig'); }
  saveBlogConfig(config) { return this.request('saveBlogConfig', [config]); }
  getProjectPath() { return this.projectPath; }
  getUrl() { return this.info?.url; }
  getPort() { return this.info?.port; }

  async stop() {
    const child = this.child;
    if (!child) return;
    try { await this.request('stop', [], 10000); }
    finally { await this.forceStop(); }
  }

  async forceStop() {
    const child = this.child;
    if (!child) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
  }
}

module.exports = HexoServerProcess;
