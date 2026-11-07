'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { loadDialog, isDialogSender, isValidProjectName } = require('./desktop-security');
const { queryGitHub, validateConnection } = require('./github-project');

function showProjectSourceDialog(parent) {
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({ width: 620, height: 760, minWidth: 480, minHeight: 600, modal: true, parent,
      title: '新建项目', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
        preload: path.join(__dirname, 'dialog-preload.js') } });
    const query = async (event, request) => {
      if (!isDialogSender(event, window) || !Number.isSafeInteger(request?.id)) return;
      let result;
      try { result = { data: await queryGitHub(request) }; }
      catch (error) { result = { error: error.message }; }
      if (!window.isDestroyed()) window.webContents.send('project-source-response', { id: request.id, ...result });
    };
    const submit = (event, result) => {
      if (!isDialogSender(event, window) || !result || typeof result.success !== 'boolean') return;
      if (!result.success) { resolve({ success: false }); window.close(); return; }
      if (!isValidProjectName(result.projectName) || !['template', 'github'].includes(result.source)) return;
      let connection = {};
      try { if (result.source === 'github') connection = validateConnection(result); }
      catch { return; }
      resolve({ success: true, source: result.source, projectName: result.projectName, ...connection });
      window.close();
    };
    ipcMain.on('project-source-query', query);
    ipcMain.on('project-source-result', submit);
    window.on('closed', () => {
      ipcMain.removeListener('project-source-query', query);
      ipcMain.removeListener('project-source-result', submit);
      resolve({ success: false });
    });
    loadDialog(window, fs.readFileSync(path.join(__dirname, 'project-source.html'), 'utf8')).catch(error => {
      reject(error); window.close();
    });
  });
}

module.exports = { showProjectSourceDialog };
