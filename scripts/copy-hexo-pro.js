const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

const REQUIRED_CORE_FILES = [
  'index.js', 'api.js', 'database-manager.js', 'login_api.js', 'post_api.js',
  'page_api.js', 'image_api.js', 'yaml_api.js', 'dashboard_api.js', 'deploy_api.js',
  'settings_api.js', 'auth_api.js', 'mcp_api.js', 'mcp_token.js', 'ai_api.js',
  'theme_api.js', 'theme_runtime.js', 'preview_api.js', 'document_identity.js',
  'sync_api.js', 'sync_service.js', 'source_sync.js', 'cloud_sync.js',
  'schema_generator.js', 'db.js', 'utils.js', 'debug.js', 'headless_server.js',
  'process-tools.js', 'update.js', 'recycle_api.js', 'auth_security.js', 'document_write.js', 'node-runtime.js'
];

function findHexoProDirectory(scriptDir = __dirname, override = process.env.HEXO_PRO_CORE_PATH) {
  const candidates = override ? [override] : [
    path.resolve(scriptDir, '../../hexo-pro'), // client/desktop/scripts -> client/core
    path.resolve(scriptDir, '../../hexo-pro-client/hexo-pro'),
    path.resolve(scriptDir, '../../../hexo-pro') // standalone sibling checkout
  ];
  for (const candidate of candidates) {
    const directory = path.resolve(candidate);
    try {
      if (fs.readJsonSync(path.join(directory, 'package.json')).name === 'hexo-pro') return directory;
    } catch (_) { /* Try the next supported checkout layout. */ }
  }
  throw new Error('未找到 hexo-pro 源码。请初始化子模块，或设置 HEXO_PRO_CORE_PATH。');
}

async function copyHexoProCore(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || findHexoProDirectory());
  const targetDir = path.resolve(options.targetDir || path.join(__dirname, '../src/main/hexo-pro-core'));
  const requiredFiles = options.requiredFiles || REQUIRED_CORE_FILES;
  const missing = [];
  for (const file of [...requiredFiles, 'package.json', 'www/index.html']) {
    if (!(await fs.stat(path.join(sourceDir, file)).catch(() => null))?.isFile()) missing.push(file);
  }
  if (missing.length) {
    throw new Error(`缺少构建必需文件：${missing.join(', ')}。请先完成前端构建。`);
  }

  // Copy all top-level runtime modules so adding a helper never needs a second
  // manual manifest update. Tests and source directories are not packaged here.
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const runtimeFiles = entries.filter(entry => entry.isFile() && /\.[cm]?js$/.test(entry.name)).map(entry => entry.name);
  await fs.ensureDir(path.dirname(targetDir));
  const stagingDir = await fs.mkdtemp(`${targetDir}.stage-`);
  const backupDir = `${stagingDir}.previous`;
  let movedPrevious = false;
  try {
    for (const file of runtimeFiles) await fs.copy(path.join(sourceDir, file), path.join(stagingDir, file));
    await fs.copy(path.join(sourceDir, 'package.json'), path.join(stagingDir, 'package.json'));
    await fs.copy(path.join(sourceDir, 'www'), path.join(stagingDir, 'www'));
    if (await fs.pathExists(targetDir)) {
      await fs.move(targetDir, backupDir);
      movedPrevious = true;
    }
    try {
      await fs.move(stagingDir, targetDir);
    } catch (error) {
      if (movedPrevious) await fs.move(backupDir, targetDir);
      throw error;
    }
    if (movedPrevious) await fs.remove(backupDir);
    return { sourceDir, targetDir, files: runtimeFiles };
  } finally {
    await fs.remove(stagingDir);
  }
}

async function buildFrontendResources(clientDir = path.resolve(__dirname, '../..')) {
  const manifest = await fs.readJson(path.join(clientDir, 'package.json'));
  if (manifest.name !== 'hexo-pro-client') throw new Error('前端项目路径无效');
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', ['build'], {
      cwd: clientDir, stdio: 'inherit', shell: process.platform === 'win32'
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`前端构建失败，退出码: ${code}`)));
  });
}

if (require.main === module) {
  copyHexoProCore().then(({ files }) => {
    console.log(`已复制 ${files.length} 个核心模块和前端资源。`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { copyHexoProCore, buildFrontendResources, findHexoProDirectory, REQUIRED_CORE_FILES };
