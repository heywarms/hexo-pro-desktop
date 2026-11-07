const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Expected a callback');
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

let requestId = 0;
function queryProjectSource(input) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const listener = (_event, response) => {
      if (response?.id !== id) return;
      clearTimeout(timer);
      ipcRenderer.removeListener('project-source-response', listener);
      if (response.error) reject(new Error(response.error)); else resolve(response.data);
    };
    const timer = setTimeout(() => {
      ipcRenderer.removeListener('project-source-response', listener);
      reject(new Error('GitHub 响应超时，请重试'));
    }, 65000);
    ipcRenderer.on('project-source-response', listener);
    ipcRenderer.send('project-source-query', { ...input, id });
  });
}

// Fixed channels expose project selection, GitHub lookups, and progress only.
// The main process checks the exact owning window and top-level frame.
contextBridge.exposeInMainWorld('desktopDialog', {
  queryProjectSource,
  submitProjectSource: result => ipcRenderer.send('project-source-result', { ...result, success: true }),
  cancelProjectSource: () => ipcRenderer.send('project-source-result', { success: false }),
  submitProjectName: projectName => ipcRenderer.send('project-name-result', { success: true, projectName }),
  cancelProjectName: () => ipcRenderer.send('project-name-result', { success: false }),
  confirm: confirmed => ipcRenderer.send('custom-confirm-result', { confirmed: confirmed === true }),
  closeProgress: () => ipcRenderer.send('close-progress-window'),
  onProgress: callback => subscribe('progress-update', callback),
  onLoadingStep: callback => subscribe('loading-step-update', callback)
});
