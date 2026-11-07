const { contextBridge, ipcRenderer } = require('electron');

const appVersion = process.argv.find(argument => argument.startsWith('--hexo-pro-version='))?.slice('--hexo-pro-version='.length) || '';
const eventChannels = new Set(['project-loaded', 'create-new-project', 'open-settings', 'updater-status']);
function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Expected a callback');
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// 向渲染进程暴露安全的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 项目管理
  getProjectInfo: () => ipcRenderer.invoke('get-project-info'),
  openProject: () => ipcRenderer.invoke('open-project'),
  createProject: () => ipcRenderer.invoke('create-project'),
  validateHexoProject: (projectPath) => ipcRenderer.invoke('validate-hexo-project', projectPath),
  
  // 文件系统操作
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  
  // 对话框
  showMessage: (options) => ipcRenderer.invoke('show-message', options),
  
  // 外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // 服务器控制
  restartServer: () => ipcRenderer.invoke('restart-server'),
  
  // 导航控制
  loadWebInterface: () => ipcRenderer.invoke('load-web-interface'),
  
  // 强制重启应用
  forceRestartApp: () => ipcRenderer.invoke('force-restart-app'),
  
  // 事件监听
  onProjectLoaded: callback => subscribe('project-loaded', callback),
  
  onCreateNewProject: callback => subscribe('create-new-project', callback),
  
  onOpenSettings: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },
  
  // 移除事件监听器
  removeAllListeners: (channel) => {
    if (eventChannels.has(channel)) ipcRenderer.removeAllListeners(channel);
  },
  
  // 平台信息
  platform: process.platform,
  
  // 应用信息
  getAppVersion: () => appVersion,

  auth: {
    saveToken: token => ipcRenderer.invoke('auth-save-token', token),
    clearToken: () => ipcRenderer.invoke('auth-clear-token')
  },

  // 自动更新
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater-check'),
    downloadUpdate: () => ipcRenderer.invoke('updater-download'),
    installUpdate: () => ipcRenderer.invoke('updater-install'),
    getState: () => ipcRenderer.invoke('updater-get-state'),
    setAutoDownload: (enabled) => ipcRenderer.invoke('updater-set-auto-download', enabled),
    onStatusChange: (callback) => {
      const listener = (event, state) => callback(state);
      ipcRenderer.on('updater-status', listener);
      return () => ipcRenderer.removeListener('updater-status', listener);
    }
  },
  
  // 桌面端特有功能
  desktop: {
    // 最小化窗口
    minimize: () => ipcRenderer.invoke('window-minimize'),
    
    // 最大化窗口
    maximize: () => ipcRenderer.invoke('window-maximize'),
    
    // 关闭窗口
    close: () => ipcRenderer.invoke('window-close'),
    
    // 检查是否为全屏
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    
    // 设置窗口标题
    setTitle: (title) => ipcRenderer.invoke('window-set-title', title)
  },
  
  // 通用功能
  showInFolder: (path) => ipcRenderer.invoke('show-in-folder', path)
});
