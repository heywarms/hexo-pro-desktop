const fs = require('fs-extra');
const path = require('path');

// 智能查找 hexo-pro 目录
function findHexoProDirectory() {
  const possiblePaths = [
    // 作为子模块时的路径（在hexo-pro-client/hexo-pro-desktop中）
    path.join(__dirname, '../../../hexo-pro'),  // 从hexo-pro-desktop到hexo-pro-client/hexo-pro
    // 独立项目时的路径
    path.join(__dirname, '../../hexo-pro-client/hexo-pro'),
    // 检查是否在同级目录
    path.join(__dirname, '../../../../hexo-pro'),
    // 直接检查已知的正确路径
    '/Users/warms/Workspace/code/node_project/hexo-pro-client/hexo-pro',
  ];
  
  for (const checkPath of possiblePaths) {
    const normalizedPath = path.resolve(checkPath);
    console.log(`检查路径: ${normalizedPath}`);
    if (fs.pathExistsSync(normalizedPath) && fs.pathExistsSync(path.join(normalizedPath, 'package.json'))) {
      try {
        const pkg = fs.readJsonSync(path.join(normalizedPath, 'package.json'));
        if (pkg.name === 'hexo-pro') {
          console.log(`✅ 找到 hexo-pro 目录: ${normalizedPath}`);
          return normalizedPath;
        }
      } catch (error) {
        console.log(`❌ 读取 package.json 失败: ${normalizedPath}`);
      }
    }
  }
  
  throw new Error('未找到 hexo-pro 目录，请确保 hexo-pro 项目存在');
}

const sourceDir = findHexoProDirectory();
const targetDir = path.join(__dirname, '../src/main/hexo-pro-core');

console.log(`源目录: ${sourceDir}`);
console.log(`目标目录: ${targetDir}`);

async function copyHexoProCore() {
  try {
    console.log('开始复制 hexo-pro 核心文件...');
    
    // 确保目标目录存在
    await fs.ensureDir(targetDir);
    
    // 需要复制的文件列表
    const filesToCopy = [
      'index.js',
      'api.js',
      'database-manager.js',
      'login_api.js',
      'post_api.js',
      'page_api.js',
      'image_api.js',
      'yaml_api.js',
      'dashboard_api.js',
      'deploy_api.js',
      'settings_api.js',
      'auth_api.js',
      'mcp_api.js',
      'mcp_token.js',
      'ai_api.js',
      'theme_api.js',
      'schema_generator.js',
      'db.js',
      'utils.js',
      'debug.js',
      'headless_server.js',
      'update.js',
      'recycle_api.js'
    ];
    
    // 复制核心 JavaScript 文件
    for (const file of filesToCopy) {
      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);
      
      if (await fs.pathExists(sourcePath)) {
        await fs.copy(sourcePath, targetPath);
        console.log(`复制文件: ${file}`);
      } else {
        console.warn(`文件不存在: ${file}`);
      }
    }
    
    // 复制 www 目录（前端资源）
    const wwwSourceDir = path.join(sourceDir, 'www');
    const wwwTargetDir = path.join(targetDir, 'www');
    
    if (await fs.pathExists(wwwSourceDir)) {
      await fs.remove(wwwTargetDir);
      await fs.copy(wwwSourceDir, wwwTargetDir);
      console.log('复制前端资源: www/');
    } else {
      console.warn('www 目录不存在，需要先构建前端资源');
      
      // 如果 www 目录不存在，尝试构建前端资源
      await buildFrontendResources();
    }
    
    console.log('hexo-pro 核心文件复制完成！');
    
  } catch (error) {
    console.error('复制 hexo-pro 核心文件失败:', error);
    process.exit(1);
  }
}

async function buildFrontendResources() {
  console.log('构建前端资源...');
  
  const { spawn } = require('child_process');
  
  // 智能查找 hexo-pro-client 目录
  function findClientDirectory() {
    const possiblePaths = [
      // 作为子模块时的路径
      path.join(__dirname, '../../..'),
      // 独立项目时的路径
      path.join(__dirname, '../../hexo-pro-client'),
      // 同级目录
      path.join(__dirname, '../../../hexo-pro-client'),
    ];
    
    for (const checkPath of possiblePaths) {
      if (fs.pathExistsSync(checkPath) && fs.pathExistsSync(path.join(checkPath, 'package.json'))) {
        try {
          const pkg = fs.readJsonSync(path.join(checkPath, 'package.json'));
          if (pkg.name === 'hexo-pro-client') {
            console.log(`找到 hexo-pro-client 目录: ${checkPath}`);
            return checkPath;
          }
        } catch (error) {
          // 忽略错误
        }
      }
    }
    
    throw new Error('未找到 hexo-pro-client 目录');
  }
  
  const clientDir = findClientDirectory();
  
  return new Promise((resolve, reject) => {
    // 在 hexo-pro-client 目录执行 yarn build
    const buildProcess = spawn('yarn', ['build'], {
      cwd: clientDir,
      stdio: 'inherit',
      shell: true
    });
    
    buildProcess.on('close', async (code) => {
      if (code === 0) {
        console.log('前端资源构建完成');
        
        // 直接复制构建后的前端资源到桌面应用
        const wwwTargetDir = path.join(targetDir, 'www');
        
        if (await fs.pathExists(sourceDir)) {
          const wwwSourceDir = path.join(sourceDir, 'www');
          if (await fs.pathExists(wwwSourceDir)) {
            await fs.copy(wwwSourceDir, wwwTargetDir);
            console.log('前端资源已复制到桌面应用');
          }
        }
        
        resolve();
      } else {
        reject(new Error(`前端构建失败，退出码: ${code}`));
      }
    });
    
    buildProcess.on('error', reject);
  });
}

// 如果直接运行此脚本
if (require.main === module) {
  copyHexoProCore();
}

module.exports = { copyHexoProCore, buildFrontendResources }; 
