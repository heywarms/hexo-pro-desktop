const STARTUP_DELAY = 15_000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

class DesktopUpdater {
  constructor({ updater, version, isPackaged, platform = process.platform, appImage = process.env.APPIMAGE,
    autoDownload = true, onState = () => {}, saveAutoDownload = () => {},
    confirmInstall = async () => false, beforeInstall = async () => {}, onInstallError = () => {},
    timers = globalThis, logger = console }) {
    this.updater = updater;
    this.onState = onState;
    this.saveAutoDownload = saveAutoDownload;
    this.confirmInstall = confirmInstall;
    this.beforeInstall = beforeInstall;
    this.onInstallError = onInstallError;
    this.timers = timers;
    this.logger = logger;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.installPromise = null;
    this.started = false;
    this.stopped = false;

    const disabledReason = !updater ? 'missing-updater' : !isPackaged ? 'development'
      : platform === 'linux' && !appImage ? 'appimage-required' : null;
    this.state = {
      status: disabledReason ? 'disabled' : 'idle',
      supported: !disabledReason,
      disabledReason,
      currentVersion: version,
      availableVersion: null,
      channel: version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/)?.[1] || 'stable',
      autoDownload: autoDownload !== false,
      progress: 0,
      error: null,
      errorStage: null,
      lastCheckedAt: null,
      releaseUrl: 'https://github.com/heywarms/hexo-pro/releases'
    };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  fail(error, stage) {
    this.logger.warn('[Updater]', stage, error);
    this.setState({ status: 'error', error: error?.message || String(error), errorStage: stage });
    if (stage === 'install') this.onInstallError();
  }

  start() {
    if (this.started || !this.state.supported) return;
    this.started = true;
    // Manage downloads ourselves so both automatic and manual requests share one promise.
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = this.state.channel !== 'stable';
    this.updater.allowDowngrade = false;
    this.updater.logger = this.logger;
    this.updater.on('update-available', info => {
      this.setState({ status: 'update-available', availableVersion: info.version, error: null, errorStage: null });
    });
    this.updater.on('update-not-available', () => {
      this.setState({ status: 'up-to-date', availableVersion: null, error: null, errorStage: null });
    });
    this.updater.on('download-progress', progress => {
      const percent = Number(progress?.percent);
      this.setState({ status: 'downloading', progress: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0 });
    });
    this.updater.on('update-downloaded', info => {
      this.setState({ status: 'downloaded', availableVersion: info.version, progress: 100, error: null, errorStage: null });
    });
    this.updater.on('error', error => {
      const stage = this.state.status === 'installing' ? 'install' : this.downloadPromise ? 'download' : 'check';
      this.fail(error, stage);
    });

    const check = () => { this.checkForUpdates().catch(() => {}); };
    this.startupTimer = this.timers.setTimeout(check, STARTUP_DELAY);
    this.intervalTimer = this.timers.setInterval(check, CHECK_INTERVAL);
    this.startupTimer?.unref?.();
    this.intervalTimer?.unref?.();
  }

  stop() {
    this.stopped = true;
    this.timers.clearTimeout(this.startupTimer);
    this.timers.clearInterval(this.intervalTimer);
  }

  setAutoDownload(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('自动下载设置必须为布尔值');
    this.saveAutoDownload(enabled);
    this.setState({ autoDownload: enabled });
    if (enabled && this.state.status === 'update-available') {
      this.downloadUpdate().catch(() => {});
    }
    return this.state;
  }

  checkForUpdates() {
    if (!this.state.supported || this.stopped) return Promise.resolve({ supported: false });
    if (this.checkPromise) return this.checkPromise;
    // A periodic check must never discard a downloaded installer or interrupt a download.
    if (this.downloadPromise || ['downloading', 'downloaded', 'installing'].includes(this.state.status)) {
      return Promise.resolve({ supported: true });
    }
    this.start();
    this.setState({ status: 'checking', availableVersion: null, progress: 0, error: null, errorStage: null });
    this.checkPromise = Promise.resolve().then(async () => {
      const result = await this.updater.checkForUpdates();
      if (!result) throw new Error('无法检查更新，请使用已安装的桌面客户端重试');
      this.setState({ lastCheckedAt: new Date().toISOString() });
      if (this.state.autoDownload && this.state.status === 'update-available' && !this.stopped) {
        this.downloadUpdate().catch(() => {});
      }
      return { supported: true };
    }).catch(error => {
      this.fail(error, 'check');
      throw error;
    }).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  downloadUpdate() {
    if (!this.state.supported || this.stopped) return Promise.resolve({ supported: false });
    if (this.downloadPromise) return this.downloadPromise;
    if (this.state.status !== 'update-available' && !(this.state.status === 'error' && this.state.errorStage === 'download')) {
      return Promise.reject(new Error('请先检查并找到可用的新版本'));
    }
    this.setState({ status: 'downloading', progress: 0, error: null, errorStage: null });
    this.downloadPromise = Promise.resolve().then(() => this.updater.downloadUpdate())
      .then(() => ({ supported: true }))
      .catch(error => {
        this.fail(error, 'download');
        throw error;
      }).finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  installUpdate() {
    if (!this.state.supported || this.stopped) return Promise.resolve({ supported: false });
    if (this.installPromise) return this.installPromise;
    if (this.state.status !== 'downloaded') return Promise.reject(new Error('请等待更新下载完成后再安装'));
    this.installPromise = Promise.resolve().then(async () => {
      if (!await this.confirmInstall(this.state.availableVersion)) return { supported: true, canceled: true };
      await this.beforeInstall();
      this.setState({ status: 'installing', error: null, errorStage: null });
      // Let the IPC response reach the renderer before the updater closes its window.
      this.timers.setImmediate(() => {
        try {
          this.updater.quitAndInstall(false, true);
        } catch (error) {
          this.fail(error, 'install');
        }
      });
      return { supported: true };
    }).finally(() => { this.installPromise = null; });
    return this.installPromise;
  }
}

module.exports = { DesktopUpdater, STARTUP_DELAY, CHECK_INTERVAL };
