// Updates remain accessible before a blog has been opened.
(() => {
  const api = window.electronAPI?.updater;
  if (!api) return;
  const panel = document.getElementById('update-panel');
  const status = document.getElementById('update-status');
  const check = document.getElementById('update-check');
  const download = document.getElementById('update-download');
  const install = document.getElementById('update-install');
  let state = { status: 'idle', supported: false };
  let pending = false;
  let receivedEvent = false;
  panel.hidden = false;

  const render = () => {
    const labels = {
      idle: `当前版本 ${state.currentVersion || ''}`,
      disabled: state.disabledReason === 'development' ? '开发模式不检查更新' : '当前安装方式不支持自动更新',
      checking: '正在检查更新…',
      'up-to-date': `当前已是最新版本 ${state.currentVersion}`,
      'update-available': `发现新版本 ${state.availableVersion}`,
      downloading: `正在下载 ${state.availableVersion} · ${Number(state.progress || 0).toFixed(1)}%`,
      downloaded: `新版本 ${state.availableVersion} 已下载，可以重启安装`,
      installing: '正在重启安装…',
      error: `更新失败：${state.error || '请重试'}`
    };
    status.textContent = labels[state.status] || '';
    const busy = pending || ['checking', 'downloading', 'installing'].includes(state.status);
    check.disabled = state.supported === false || busy || state.status === 'downloaded';
    download.hidden = state.status !== 'update-available' && !(state.status === 'error' && state.errorStage === 'download');
    download.disabled = busy;
    install.hidden = state.status !== 'downloaded';
    install.disabled = busy;
  };
  const run = async action => {
    if (pending) return;
    pending = true;
    render();
    let error;
    try { await api[action](); } catch (failure) { error = failure.message; }
    finally { pending = false; render(); }
    if (error) status.textContent = error;
  };
  check.onclick = () => run('checkForUpdates');
  download.onclick = () => run('downloadUpdate');
  install.onclick = () => run('installUpdate');
  api.onStatusChange(next => { receivedEvent = true; state = next; render(); });
  api.getState().then(next => {
    if (!receivedEvent) { state = next; render(); }
  }).catch(error => { status.textContent = error.message; });
  window.electronAPI.onOpenSettings?.(options => {
    if (options?.action !== 'check-update') return;
    panel.scrollIntoView({ block: 'nearest' });
    if (state.status === 'downloaded') install.focus();
    else if (!check.disabled) run('checkForUpdates');
  });
})();
