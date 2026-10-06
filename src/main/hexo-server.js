const path = require('path');
const fs = require('fs-extra');
const express = require('express');
const bodyParser = require('body-parser');
const serveStatic = require('serve-static');
const net = require('net');
const mime = require('mime');

// 添加fetch支持（对于Node.js < 18版本）
const fetch = (() => {
  try {
    const nodeFetch = require('node-fetch');
    console.log('[Hexo Server]: 使用 node-fetch 库');
    return nodeFetch;
  } catch (error) {
    // Node.js 18+ 内置fetch
    console.log('[Hexo Server]: 使用内置 fetch API');
    return globalThis.fetch;
  }
})();

// 复制 hexo-pro 的核心模块
const api = require('./hexo-pro-core/api');
const { getLiveHexo } = require('./hexo-pro-core/theme_runtime');
const databaseManager = require('./hexo-pro-core/database-manager'); // 导入数据库管理器

class HexoProServer {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.app = null;
    this.server = null;
    this.hexoServer = null; // Hexo内置服务器实例
    this.hexoPort = 4000; // Hexo内置服务器端口（和hexo s默认端口一致）
    this.hexoInstance = null;
    this.isWatching = false;
    this.originalNodePath = null; // 保存原始NODE_PATH
    this.originalCwd = null; // 保存原始工作目录
  }

  async start() {
    try {
      // 在开始前确保数据库管理器重置
      if (this.projectPath) {
        console.log('[Hexo Server]: 重置数据库管理器状态');
        databaseManager.reset();
      }

      // 初始化 Hexo 实例
      await this.initHexo();

      // 启动集成的 Hexo 服务器（包含博客静态文件、API 和管理界面）
      await this.startIntegratedHexoServer();

      console.log(`Hexo Pro Server started at http://127.0.0.1:${this.hexoPort}`);

      return {
        url: `http://127.0.0.1:${this.hexoPort}`,
        port: this.hexoPort
      };
    } catch (error) {
      console.error('启动 Hexo Pro 服务器失败:', error);
      throw error;
    }
  }

  async startIntegratedHexoServer() {
    if (!this.hexoInstance) {
      throw new Error('Hexo 实例未初始化');
    }

    try {
      console.log('[Hexo Server]: 启动集成的 Hexo 服务器...');

      // 先注册Hexo插件（在服务器启动前）
      await this.registerHexoPlugin();

      // 改进的端口选择逻辑，包含错误处理
      let availablePort;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          console.log(`[Hexo Server]: 第 ${attempts + 1} 次尝试寻找可用端口...`);
          availablePort = await this.findAvailablePort(4000);
          break;
        } catch (error) {
          attempts++;
          console.error(`[Hexo Server]: 端口选择失败 (尝试 ${attempts}/${maxAttempts}):`, error.message);

          if (attempts >= maxAttempts) {
            // 最后一次尝试：使用完全动态的端口
            console.log('[Hexo Server]: 所有预定义端口都失败，尝试完全动态端口分配');
            try {
              availablePort = await this.findDynamicPort();
              break;
            } catch (dynamicError) {
              throw new Error(`端口分配完全失败: ${error.message} | 动态端口错误: ${dynamicError.message}`);
            }
          } else {
            // 等待一段时间后重试
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      this.hexoPort = availablePort;
      console.log(`[Hexo Server]: 最终使用端口 ${this.hexoPort}`);

      // 启动 Hexo 内置服务器
      this.hexoServer = await this.hexoInstance.call('server', {
        port: this.hexoPort,
        ip: '127.0.0.1', // 明确指定localhost，避免权限问题
        open: false,
        watch: true,
        draft: false,
        log: false // 减少日志输出
      });

      console.log(`[Hexo Server]: 集成的 Hexo 服务器已启动在 127.0.0.1:${this.hexoPort}`);

      // Windows系统额外等待，确保服务器完全就绪
      if (process.platform === 'win32') {
        console.log('[Hexo Server]: Windows系统，等待服务器完全就绪...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒

        // 验证服务器是否真的可以响应请求
        const maxVerifyAttempts = 5;
        for (let i = 0; i < maxVerifyAttempts; i++) {
          try {
            const testResponse = await fetch(`http://127.0.0.1:${this.hexoPort}/hexopro/api/desktop/status`);
            if (testResponse.ok) {
              console.log('[Hexo Server]: Windows服务器就绪验证成功');
              break;
            }
          } catch (error) {
            if (i === maxVerifyAttempts - 1) {
              console.warn('[Hexo Server]: Windows服务器就绪验证失败，但继续启动');
            } else {
              console.log(`[Hexo Server]: Windows服务器就绪验证尝试 ${i + 1}/${maxVerifyAttempts} 失败，继续重试`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
      }
    } catch (error) {
      console.error('[Hexo Server]: 启动集成的 Hexo 服务器失败:', error);

      // 提供更友好的错误信息
      if (error.message.includes('EACCES') || error.message.includes('权限被拒绝')) {
        const enhancedError = new Error(
          `端口权限被拒绝。这通常在Windows系统上发生。\n` +
          `建议解决方案：\n` +
          `1. 以管理员身份运行应用\n` +
          `2. 检查防火墙设置\n` +
          `3. 确保没有其他应用占用端口\n` +
          `原始错误: ${error.message}`
        );
        enhancedError.code = 'PORT_PERMISSION_DENIED';
        throw enhancedError;
      }

      throw error;
    }
  }

  async registerHexoPlugin() {
    console.log('[Hexo Server]: 注册Hexo插件...');

    // 创建一个临时插件来添加我们的路由
    this.hexoInstance.extend.filter.register('server_middleware', (app) => {
      console.log('[Hexo Server]: Hexo插件 - 添加中间件到应用');

      // 检查是否已经初始化过数据库，避免重复初始化
      if (!global.hexoProDbInitialized) {
        console.log('[Hexo Server]: 首次初始化，设置中间件...');

        // 添加查询字符串解析中间件
        const querystring = require('querystring');
        app.use((req, res, next) => {
          if (!req.query && req.url.includes('?')) {
            const queryStr = req.url.split('?')[1];
            req.query = querystring.parse(queryStr);
          }
          next();
        });

        // 添加body parser中间件（用于API）
        const bodyParser = require('body-parser');
        app.use('/hexopro/api', bodyParser.json({ limit: '50mb' }));
        app.use('/hexopro/api', bodyParser.urlencoded({ extended: true }));

        // 添加hexo-pro管理界面的静态文件服务
        const serveStatic = require('serve-static');
        app.use('/pro', serveStatic(path.join(__dirname, 'hexo-pro-core/www')));

        // 处理前端路由（SPA）
        app.use('/pro', (req, res, next) => {
          console.log('[Hexo Server]: 收到前端路由请求:', req.originalUrl);
          console.log('[Hexo Server]: 请求方法:', req.method);
          console.log('[Hexo Server]: 请求头:', req.headers);

          const isStaticFile = ['.html', '.css', '.js', '.jpg', '.png', '.gif', '.svg', '.ico'].some(
            extension => req.originalUrl.endsWith(extension)
          );

          console.log('[Hexo Server]: 是否静态文件:', isStaticFile);

          if (!isStaticFile) {
            const indexPath = path.resolve(__dirname, 'hexo-pro-core/www/index.html');
            console.log('[Hexo Server]: 准备发送index.html, 路径:', indexPath);

            // 检查文件是否存在
            if (!fs.existsSync(indexPath)) {
              console.error('[Hexo Server]: index.html不存在:', indexPath);
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('File not found');
              return;
            }

            // 检查 sendFile 方法是否可用
            if (typeof res.sendFile === 'function') {
              console.log('[Hexo Server]: 使用 sendFile 方法');
              res.sendFile(indexPath);
            } else if (res._originalSendFile && typeof res._originalSendFile === 'function') {
              // 使用保存的原始方法
              console.log('[Hexo Server]: 使用 _originalSendFile 方法');
              res._originalSendFile.call(res, indexPath);
            } else {
              // 降级方案：直接读取文件并发送
              console.log('[Hexo Server]: 使用降级方案读取文件');
              const fs = require('fs');

              fs.readFile(indexPath, (err, data) => {
                if (err) {
                  console.error('[Hexo Server]: 读取文件失败:', err);
                  res.writeHead(404, { 'Content-Type': 'text/plain' });
                  res.end('File not found');
                } else {
                  const contentType = mime.getType(indexPath) || 'text/html';
                  console.log('[Hexo Server]: 发送文件内容, Content-Type:', contentType);
                  res.writeHead(200, { 'Content-Type': contentType });
                  res.end(data);
                }
              });
            }
          } else {
            console.log('[Hexo Server]: 静态文件请求，交给下一个中间件处理');
            next();
          }
        });

        // 添加桌面端特定路由
        this.setupDesktopRoutesForConnect(app);

        // 标记数据库已初始化
        global.hexoProDbInitialized = true;
      } else {
        console.log('[Hexo Server]: 数据库已初始化，跳过中间件设置');
      }

      // 添加 hexo-pro 的 API 路由（每次都需要重新绑定到新的app实例）
      api(app, this.hexoInstance).then(() => {
        console.log('[Hexo Server]: API路由已添加');
      }).catch(error => {
        console.error('[Hexo Server]: 添加API路由失败:', error);
      });

      console.log('[Hexo Server]: Hexo插件 - 中间件添加完成');
    });

    console.log('[Hexo Server]: Hexo插件已注册');
  }

  async findAvailablePort(startPort) {
    const os = require('os');
    const platform = os.platform();

    // Windows系统的端口选择策略
    if (platform === 'win32') {
      console.log('[Hexo Server]: 检测到Windows系统，使用优化的端口选择策略');

      // Windows上优先尝试用户端口范围(1024-65535)
      // 避免系统保留端口和需要管理员权限的端口
      const safePorts = [
        4000, 4001, 4002, 4003, 4004, 4005, // 首选的端口
        3000, 3001, 3002, 3003, 3004, 3005, // 备选端口
        8000, 8001, 8002, 8003, 8004, 8005, // 高端口
        5000, 5001, 5002, 5003, 5004, 5005  // 其他常用端口
      ];

      // 先尝试预定义的安全端口
      for (const port of safePorts) {
        try {
          console.log(`[Hexo Server]: Windows - 尝试端口 ${port}`);
          if (await this.isPortAvailableWithPermissionCheck(port)) {
            console.log(`[Hexo Server]: Windows - 端口 ${port} 可用且有权限`);
            return port;
          }
        } catch (error) {
          console.log(`[Hexo Server]: Windows - 端口 ${port} 不可用: ${error.message}`);
          continue;
        }
      }

      // 如果预定义端口都不可用，尝试动态分配
      console.log('[Hexo Server]: Windows - 预定义端口都不可用，尝试动态分配');
      return await this.findDynamicPort();
    } else {
      // 非Windows系统保持原有逻辑
      console.log(`[Hexo Server]: 检测到${platform}系统，使用标准端口选择策略`);
      for (let port = startPort; port < startPort + 100; port++) {
        if (await this.isPortAvailable(port)) {
          return port;
        }
      }

      throw new Error(`无法找到可用端口，从 ${startPort} 开始尝试了100个端口`);
    }
  }

  async isPortAvailableWithPermissionCheck(port) {
    return new Promise((resolve, reject) => {
      const server = net.createServer();

      server.on('error', (error) => {
        if (error.code === 'EACCES') {
          console.log(`[Hexo Server]: 端口 ${port} 权限被拒绝 (EACCES)`);
          reject(new Error(`端口 ${port} 权限被拒绝`));
        } else if (error.code === 'EADDRINUSE') {
          console.log(`[Hexo Server]: 端口 ${port} 已被占用 (EADDRINUSE)`);
          resolve(false);
        } else {
          console.log(`[Hexo Server]: 端口 ${port} 其他错误: ${error.code} - ${error.message}`);
          resolve(false);
        }
      });

      server.listen(port, '127.0.0.1', () => {
        server.close(() => {
          console.log(`[Hexo Server]: 端口 ${port} 测试成功`);
          resolve(true);
        });
      });
    });
  }

  async findDynamicPort() {
    console.log('[Hexo Server]: 尝试使用系统分配的动态端口');

    return new Promise((resolve, reject) => {
      const server = net.createServer();

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => {
          console.log(`[Hexo Server]: 系统分配的动态端口: ${port}`);
          resolve(port);
        });
      });

      server.on('error', (error) => {
        console.error('[Hexo Server]: 动态端口分配失败:', error);
        reject(error);
      });
    });
  }

  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.listen(port, '127.0.0.1', () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.on('error', () => {
        resolve(false);
      });
    });
  }

  setupDesktopRoutesForConnect(app) {
    // 桌面端状态路由（统一状态处理）
    app.use('/hexopro/api/desktop/status', (req, res) => {
      const hasProject = !!this.hexoInstance;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: hasProject ? 'running' : 'static-server',
        projectPath: this.projectPath || null,
        port: this.hexoPort,
        uptime: process.uptime(),
        hasProject: hasProject
      }));
    });

    // 桌面端认证检查
    app.use('/hexopro/api/desktop/auth-check', (req, res) => {
      // 检查是否需要登录
      const needsAuth = global.actualNeedLogin;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        needsAuth,
        isDesktop: true
      }));
    });

    // 桌面端保存token（处理前端登录成功）
    app.use('/hexopro/api/desktop/save-token', (req, res) => {
      console.log('[Desktop Server]: /hexopro/api/desktop/save-token 被调用');
      console.log('[Desktop Server]: 请求方法:', req.method);
      console.log('[Desktop Server]: 请求头:', req.headers);
      console.log('[Desktop Server]: 请求体:', req.body);

      if (req.method === 'POST') {
        try {
          const { token } = req.body;
          console.log('[Desktop Server]: 接收到保存token请求');
          console.log('[Desktop Server]: Token长度:', token ? token.length : '无token');
          console.log('[Desktop Server]: Token内容预览:', token ? token.substring(0, 20) + '...' : '无token');
          console.log('[Desktop Server]: 项目路径:', this.projectPath);
          console.log('[Desktop Server]: global.desktopAuthManager存在:', !!global.desktopAuthManager);

          if (!token) {
            console.error('[Desktop Server]: 请求中缺少token');
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, message: '缺少token' }));
            return;
          }

          // 验证token格式 - JWT应该是3个用.分隔的base64字符串
          const jwtPattern = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
          if (!jwtPattern.test(token)) {
            console.error('[Desktop Server]: Token格式无效，拒绝保存:', token.substring(0, 50) + '...');
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, message: 'Token格式无效，必须是标准JWT格式' }));
            return;
          }

          console.log('[Desktop Server]: Token格式验证通过');

          if (!this.projectPath) {
            console.error('[Desktop Server]: 当前项目路径未设置');
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, message: '当前项目路径未设置' }));
            return;
          }

          if (!global.desktopAuthManager) {
            console.error('[Desktop Server]: AuthManager实例不可用');
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, message: 'AuthManager不可用' }));
            return;
          }

          console.log('[Desktop Server]: 正在保存token到AuthManager...');

          // 异步保存token，避免阻塞响应
          global.desktopAuthManager.setToken(this.projectPath, token).then(() => {
            console.log('[Desktop Server]: Token保存操作完成');

            // 验证token是否真的被保存了
            setTimeout(() => {
              const savedToken = global.desktopAuthManager.getToken(this.projectPath);
              if (savedToken === token) {
                console.log('[Desktop Server]: Token验证成功，已正确保存到:', this.projectPath);
              } else {
                console.error('[Desktop Server]: Token验证失败，保存可能有问题');
                console.log('[Desktop Server]: 预期token长度:', token.length);
                console.log('[Desktop Server]: 实际token长度:', savedToken ? savedToken.length : '无token');
              }
            }, 100);
          }).catch((error) => {
            console.error('[Desktop Server]: 保存token时出错:', error);
          });

          console.log('[Desktop Server]: 立即响应成功（异步保存）');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, message: 'Token保存请求已接收' }));

        } catch (error) {
          console.error('[Desktop Server]: 保存token失败:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, message: '保存token失败: ' + error.message }));
        }
      } else {
        console.log('[Desktop Server]: 不支持的请求方法:', req.method);
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, message: '方法不允许，仅支持POST' }));
      }
    });

    // 获取项目信息
    app.use('/hexopro/api/desktop/project-info', (req, res) => {
      if (!this.hexoInstance) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: '项目未加载',
          message: '请先选择一个 Hexo 项目'
        }));
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        projectPath: this.projectPath,
        projectName: path.basename(this.projectPath),
        hexoVersion: this.hexoInstance.version,
        configPath: path.join(this.projectPath, '_config.yml')
      }));
    });

    // 获取文件监听状态
    app.use('/hexopro/api/desktop/watch-status', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        isWatching: this.isWatching
      }));
    });

    // 重启服务器（主题切换等场景使用）
    app.use('/hexopro/api/desktop/restart', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, message: '仅支持 POST 方法' }));
        return;
      }

      try {
        console.log('[Desktop Server]: 收到重启服务器请求');
        await this.restart();
        console.log('[Desktop Server]: 服务器重启成功');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          success: true,
          message: '服务器重启成功',
          url: this.getUrl(),
          port: this.getPort()
        }));
      } catch (error) {
        console.error('[Desktop Server]: 服务器重启失败:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, message: error.message || '重启失败' }));
      }
    });
  }

  async initHexo() {
    // 保存原始工作目录
    const originalCwd = process.cwd();
    
    try {
      console.log('[Hexo Server]: 开始初始化 Hexo 实例...');
      console.log('[Hexo Server]: 项目路径:', this.projectPath);
      console.log('[Hexo Server]: 当前工作目录:', originalCwd);
      
      // 保存原始状态以便后续恢复
      this.originalCwd = originalCwd;
      this.originalNodePath = process.env.NODE_PATH;
      
      // 切换到项目目录 - 这是关键步骤，确保插件加载正确
      process.chdir(this.projectPath);
      console.log('[Hexo Server]: 已切换到项目目录:', process.cwd());
      
      // 确保项目的node_modules在模块解析路径中
      const projectNodeModules = path.join(this.projectPath, 'node_modules');
      if (!require.resolve.paths('').includes(projectNodeModules)) {
        module.paths.unshift(projectNodeModules);
        console.log('[Hexo Server]: 已添加项目node_modules到模块解析路径:', projectNodeModules);
      }

      // 设置NODE_PATH环境变量，确保全局模块解析
      const currentNodePath = this.originalNodePath || '';
      const newNodePath = currentNodePath ? 
        `${projectNodeModules}${path.delimiter}${currentNodePath}` : 
        projectNodeModules;
      
      process.env.NODE_PATH = newNodePath;
      console.log('[Hexo Server]: 已设置NODE_PATH:', newNodePath);
      
      // 重新加载模块路径（这对于某些插件加载非常重要）
      if (require.cache) {
        // 清理模块缓存中可能存在的旧Hexo实例
        Object.keys(require.cache).forEach(key => {
          if (key.includes('hexo') && !key.includes('hexo-pro')) {
            delete require.cache[key];
          }
        });
      }

      // 动态引入 Hexo
      const Hexo = require('hexo');

      // 创建 Hexo 实例
      this.hexoInstance = getLiveHexo(new Hexo(this.projectPath, {
        debug: false,
        safe: false,
        silent: false,
        config: path.join(this.projectPath, '_config.yml')
      }));

      console.log('[Hexo Server]: Hexo 实例创建完成');

      // 初始化 Hexo
      console.log('[Hexo Server]: 开始初始化 Hexo...');
      await this.hexoInstance.init();
      console.log('[Hexo Server]: Hexo 初始化完成');

      // 加载插件和主题 - 现在应该能正确加载用户项目的插件
      console.log('[Hexo Server]: 开始加载插件和主题...');
      await this.hexoInstance.load();
      console.log('[Hexo Server]: 插件和主题加载完成');

      // 输出已加载的插件信息，用于调试
      console.log('[Hexo Server]: =======插件加载状态报告=======');
      
      // 检查渲染器
      try {
        if (this.hexoInstance.extend && this.hexoInstance.extend.renderer) {
          const renderers = this.hexoInstance.extend.renderer.list();
          console.log('[Hexo Server]: 已加载的渲染器:', Object.keys(renderers));
          
          // 检查markdown相关的渲染器
          const markdownRenderers = Object.keys(renderers).filter(name => 
            name.includes('md') || name.includes('markdown')
          );
          if (markdownRenderers.length > 0) {
            console.log('[Hexo Server]: Markdown渲染器:', markdownRenderers);
          }
        }
      } catch (error) {
        console.log('[Hexo Server]: 无法获取渲染器信息:', error.message);
      }
      
      // 检查过滤器
      try {
        if (this.hexoInstance.extend && this.hexoInstance.extend.filter) {
          const filters = this.hexoInstance.extend.filter.list();
          console.log('[Hexo Server]: 已加载的过滤器数量:', Object.keys(filters).length);
          
          // 检查与渲染相关的过滤器
          const renderFilters = Object.keys(filters).filter(name => 
            name.includes('render') || name.includes('before_post_render') || name.includes('after_post_render')
          );
          if (renderFilters.length > 0) {
            console.log('[Hexo Server]: 渲染相关过滤器:', renderFilters);
          }
        }
      } catch (error) {
        console.log('[Hexo Server]: 无法获取过滤器信息:', error.message);
      }
      
      // 检查标签和助手函数
      try {
        if (this.hexoInstance.extend && this.hexoInstance.extend.tag) {
          // 检查是否有list方法
          if (typeof this.hexoInstance.extend.tag.list === 'function') {
            const tags = this.hexoInstance.extend.tag.list();
            console.log('[Hexo Server]: 已加载的标签数量:', Object.keys(tags).length);
          } else {
            // 尝试其他方法获取标签信息
            const tagStore = this.hexoInstance.extend.tag;
            if (tagStore && tagStore.store) {
              console.log('[Hexo Server]: 已加载的标签数量:', Object.keys(tagStore.store).length);
            } else {
              console.log('[Hexo Server]: 标签扩展存在，但无法获取详细信息');
            }
          }
        }
      } catch (error) {
        console.log('[Hexo Server]: 无法获取标签信息:', error.message);
      }
      
      try {
        if (this.hexoInstance.extend && this.hexoInstance.extend.helper) {
          // 检查是否有list方法
          if (typeof this.hexoInstance.extend.helper.list === 'function') {
            const helpers = this.hexoInstance.extend.helper.list();
            console.log('[Hexo Server]: 已加载的助手函数数量:', Object.keys(helpers).length);
          } else {
            // 尝试其他方法获取助手函数信息
            const helperStore = this.hexoInstance.extend.helper;
            if (helperStore && helperStore.store) {
              console.log('[Hexo Server]: 已加载的助手函数数量:', Object.keys(helperStore.store).length);
            } else {
              console.log('[Hexo Server]: 助手函数扩展存在，但无法获取详细信息');
            }
          }
        }
      } catch (error) {
        console.log('[Hexo Server]: 无法获取助手函数信息:', error.message);
      }

      // 检查已加载的npm包插件
      try {
        const packageJsonPath = path.join(this.projectPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
          const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
          
          const hexoPlugins = Object.keys(dependencies).filter(dep => 
            dep.startsWith('hexo-') && dep !== 'hexo' && dep !== 'hexo-cli'
          );
          
          console.log('[Hexo Server]: package.json中的Hexo插件:', hexoPlugins);
          
          // 检查这些插件是否真的被加载了
          hexoPlugins.forEach(plugin => {
            try {
              const pluginPath = path.join(this.projectPath, 'node_modules', plugin);
              if (fs.existsSync(pluginPath)) {
                console.log(`[Hexo Server]: ✓ 插件 ${plugin} 在node_modules中存在`);
              } else {
                console.log(`[Hexo Server]: ✗ 插件 ${plugin} 在node_modules中不存在`);
              }
            } catch (error) {
              console.log(`[Hexo Server]: ? 无法检查插件 ${plugin}:`, error.message);
            }
          });
        }
      } catch (error) {
        console.error('[Hexo Server]: 检查package.json插件时出错:', error);
      }
      
      console.log('[Hexo Server]: =======插件加载状态报告结束=======');

      // 将 hexo 实例设为全局变量，供插件使用
      global.hexo = this.hexoInstance;

      // 立即初始化数据库管理器
      console.log('[Hexo Server]: 预初始化数据库管理器...');
      try {
        await databaseManager.initialize(this.hexoInstance);
        console.log('[Hexo Server]: 数据库管理器预初始化完成');
      } catch (error) {
        console.error('[Hexo Server]: 数据库管理器预初始化失败:', error);
        throw error;
      }

      // 构建索引文件（用于全局搜索）
      try {
        const hexoProCore = require('./hexo-pro-core/index');
        if (hexoProCore && hexoProCore.buildIndex) {
          console.log('[Hexo Server]: 构建搜索索引...');
          // 临时设置全局hexo变量供buildIndex使用
          const originalHexo = global.hexo;
          global.hexo = this.hexoInstance;
          hexoProCore.buildIndex();
          global.hexo = originalHexo;
          console.log('[Hexo Server]: 搜索索引构建完成');
        }
      } catch (error) {
        console.error('[Hexo Server]: 构建搜索索引失败:', error);
        // 如果构建索引失败，创建一个空的索引文件以避免读取错误
        const fs = require('fs');
        const indexPath = path.join(this.projectPath, 'blogInfoList.json');
        if (!fs.existsSync(indexPath)) {
          fs.writeFileSync(indexPath, JSON.stringify([]));
          console.log('[Hexo Server]: 创建了空的搜索索引文件');
        }
      }

      // 启动文件监听
      await this.startWatching();
      
      console.log('[Hexo Server]: Hexo 实例初始化完全完成');
      
    } catch (error) {
      console.error('[Hexo Server]: 初始化 Hexo 实例失败:', error);
      throw error;
    } finally {
      // 恢复原始工作目录（可选，根据需要决定）
      // process.chdir(originalCwd);
      // console.log('[Hexo Server]: 已恢复原始工作目录:', process.cwd());
    }
  }

  async startWatching() {
    if (!this.hexoInstance || this.isWatching) {
      return;
    }

    try {
      console.log('[Hexo Server]: 设置文件监听事件...');
      this.isWatching = true;

      // 注意：不需要手动启动watch，因为Hexo内置服务器已经包含了watch功能
      // 只需要监听相关事件来获取状态更新

      // 监听特定的文件变化事件
      this.hexoInstance.on('generateAfter', () => {
        console.log('[Hexo Server]: 静态文件已重新生成');
      });

      this.hexoInstance.on('processBefore', () => {
        console.log('[Hexo Server]: 开始处理文件变化...');
      });

      this.hexoInstance.on('processAfter', () => {
        console.log('[Hexo Server]: 文件变化处理完成');
      });

      // 监听文件变化事件
      this.hexoInstance.on('ready', () => {
        console.log('[Hexo Server]: Hexo 已就绪');
      });

      // 监听更详细的文件变化
      if (this.hexoInstance.source) {
        this.hexoInstance.source.on('processAfter', (file) => {
          // console.log('[Hexo Server]: 文件已处理:', file.source);
        });
      }

      console.log('[Hexo Server]: 文件监听事件已设置');

    } catch (error) {
      console.error('[Hexo Server]: 设置文件监听事件失败:', error);
      this.isWatching = false;
    }
  }

  async stopWatching() {
    if (!this.isWatching || !this.hexoInstance) {
      return;
    }

    try {
      console.log('[Hexo Server]: 停止文件监听...');

      // 停止监听
      if (this.hexoInstance.unwatch) {
        await this.hexoInstance.unwatch();
      }

      this.isWatching = false;
      console.log('[Hexo Server]: 文件监听已停止');
    } catch (error) {
      console.error('[Hexo Server]: 停止文件监听失败:', error);
    }
  }

  async stop() {
    console.log('正在停止 Hexo Pro Server...');

    // 停止文件监听
    await this.stopWatching();

    // 停止 Hexo 内置服务器
    if (this.hexoServer) {
      try {
        console.log('[Hexo Server]: 停止 Hexo 内置服务器...');
        // Hexo server 的停止方法
        if (typeof this.hexoServer.close === 'function') {
          await this.hexoServer.close();
        }
        this.hexoServer = null;
        console.log('[Hexo Server]: Hexo 内置服务器已停止');
      } catch (error) {
        console.error('[Hexo Server]: 停止 Hexo 内置服务器时出错:', error);
      }
    }

    // 停止基本服务器（如果有）
    if (this.server) {
      try {
        this.server.close();
        this.server = null;
      } catch (error) {
        console.error('[Hexo Server]: 停止基本服务器时出错:', error);
      }
    }

    // 清理项目相关的模块路径
    if (this.projectPath) {
      const projectNodeModules = path.join(this.projectPath, 'node_modules');
      const modulePathIndex = module.paths.indexOf(projectNodeModules);
      if (modulePathIndex !== -1) {
        module.paths.splice(modulePathIndex, 1);
        console.log('[Hexo Server]: 已从模块解析路径中移除项目node_modules');
      }
    }

    // 清理全局状态
    if (global.hexo) {
      delete global.hexo;
    }
    if (global.actualNeedLogin !== undefined) {
      global.actualNeedLogin = false;
    }
    if (global.jwtSecret) {
      delete global.jwtSecret;
    }

    // 清理数据库初始化标记，允许下次重新初始化
    if (global.hexoProDbInitialized) {
      delete global.hexoProDbInitialized;
    }

    // 重置数据库管理器状态
    console.log('[Hexo Server]: 重置数据库管理器状态');
    databaseManager.reset();

    // 重置端口为默认值
    this.hexoPort = 4000;

    // 恢复原始NODE_PATH
    if (this.originalNodePath) {
      process.env.NODE_PATH = this.originalNodePath;
      console.log('[Hexo Server]: 已恢复原始NODE_PATH:', process.env.NODE_PATH);
    }

    console.log('Hexo Pro Server stopped');
  }

  // 强制停止服务器（用于错误恢复）
  async forceStop() {
    console.log('强制停止 Hexo Pro Server...');

    // 停止文件监听
    await this.stopWatching();

    // 强制停止 Hexo 内置服务器
    if (this.hexoServer) {
      try {
        console.log('[Hexo Server]: 强制停止 Hexo 内置服务器...');
        if (typeof this.hexoServer.close === 'function') {
          this.hexoServer.close();
        }
      } catch (error) {
        console.error('[Hexo Server]: 强制停止 Hexo 内置服务器时出错:', error);
      }
      this.hexoServer = null;
    }

    // 清理项目相关的模块路径
    if (this.projectPath) {
      const projectNodeModules = path.join(this.projectPath, 'node_modules');
      const modulePathIndex = module.paths.indexOf(projectNodeModules);
      if (modulePathIndex !== -1) {
        module.paths.splice(modulePathIndex, 1);
        console.log('[Hexo Server]: 已从模块解析路径中移除项目node_modules');
      }
    }

    // 清理所有状态
    this.hexoInstance = null;
    this.isWatching = false;

    // 清理全局状态
    if (global.hexo) {
      delete global.hexo;
    }
    if (global.actualNeedLogin !== undefined) {
      global.actualNeedLogin = false;
    }
    if (global.jwtSecret) {
      delete global.jwtSecret;
    }

    // 清理数据库初始化标记
    if (global.hexoProDbInitialized) {
      delete global.hexoProDbInitialized;
    }

    // 重置数据库管理器状态
    console.log('[Hexo Server]: 强制重置数据库管理器状态');
    databaseManager.reset();

    // 重置端口
    this.hexoPort = 4000;

    // 恢复原始NODE_PATH
    if (this.originalNodePath) {
      process.env.NODE_PATH = this.originalNodePath;
      console.log('[Hexo Server]: 已恢复原始NODE_PATH:', process.env.NODE_PATH);
    }

    console.log('服务器已强制停止');
  }

  async restart() {
    console.log('重启 Hexo Pro Server...');

    // 停止当前服务器
    await this.stop();

    // 重新初始化状态
    this.isWatching = false;

    // 重新初始化 Hexo
    if (this.hexoInstance) {
      // 清理当前实例
      delete global.hexo;
      this.hexoInstance = null;
    }

    // 重新启动
    await this.start();
  }

  getUrl() {
    return `http://127.0.0.1:${this.hexoPort}`;
  }

  getPort() {
    return this.hexoPort;
  }

  getProjectPath() {
    return this.projectPath;
  }

  getHexoInstance() {
    return this.hexoInstance;
  }

  // 获取博客配置
  async getBlogConfig() {
    const configPath = path.join(this.projectPath, '_config.yml');
    if (await fs.pathExists(configPath)) {
      const yaml = require('js-yaml');
      const content = await fs.readFile(configPath, 'utf8');
      return yaml.load(content);
    }
    return null;
  }

  // 保存博客配置
  async saveBlogConfig(config) {
    const configPath = path.join(this.projectPath, '_config.yml');
    const yaml = require('js-yaml');
    const content = yaml.dump(config);
    await fs.writeFile(configPath, content, 'utf8');
  }

  // 生成静态文件
  async generate() {
    if (this.hexoInstance) {
      await this.hexoInstance.call('generate');
    }
  }

  // 部署博客
  async deploy() {
    if (this.hexoInstance) {
      await this.hexoInstance.call('deploy');
    }
  }

  // 清理缓存
  async clean() {
    if (this.hexoInstance) {
      await this.hexoInstance.call('clean');
    }
  }

  async startStaticServer() {
    try {
      // 创建简单的静态服务器（用于当没有项目加载时）
      this.app = express();

      // 设置基本中间件
      this.setupBasicMiddleware();

      // 启动服务器
      await this.startBasicServer();

      console.log(`静态服务器已启动 at http://127.0.0.1:${this.hexoPort}`);

      return {
        url: `http://127.0.0.1:${this.hexoPort}`,
        port: this.hexoPort
      };
    } catch (error) {
      console.error('启动静态服务器失败:', error);
      throw error;
    }
  }

  setupBasicMiddleware() {
    // 静态文件服务
    this.app.use('/pro', serveStatic(path.join(__dirname, 'hexo-pro-core/www')));

    // 处理前端路由
    this.app.use('/pro', (req, res, next) => {
      // 检查是否为静态文件请求
      const isStaticFile = ['.html', '.css', '.js', '.jpg', '.png', '.gif', '.svg', '.ico'].some(
        extension => req.originalUrl.endsWith(extension)
      );

      if (!isStaticFile) {
        // 对于非静态文件请求，返回 index.html（用于前端路由）
        const indexPath = path.resolve(__dirname, 'hexo-pro-core/www/index.html');

        // 检查 sendFile 方法是否可用
        if (typeof res.sendFile === 'function') {
          res.sendFile(indexPath);
        } else if (res._originalSendFile && typeof res._originalSendFile === 'function') {
          // 使用保存的原始方法
          res._originalSendFile.call(res, indexPath);
        } else {
          // 降级方案：直接读取文件并发送
          const fs = require('fs');

          fs.readFile(indexPath, (err, data) => {
            if (err) {
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('File not found');
            } else {
              const contentType = mime.getType(indexPath) || 'text/html';
              res.writeHead(200, { 'Content-Type': contentType });
              res.end(data);
            }
          });
        }
      } else {
        next();
      }
    });

    // 基本API路由
    this.app.get('/hexopro/api/desktop/status', (req, res) => {
      res.json({
        status: 'static-server',
        projectPath: null,
        port: this.hexoPort,
        uptime: process.uptime(),
        hasProject: false
      });
    });

    // 处理其他 API 请求（项目未加载时的响应）
    this.app.use('/hexopro/api', (req, res) => {
      res.status(503).json({
        error: '项目未加载',
        message: '请先选择一个 Hexo 项目',
        code: 'NO_PROJECT_LOADED'
      });
    });
  }

  async startBasicServer() {
    return new Promise((resolve, reject) => {
      const os = require('os');
      const platform = os.platform();

      const startServerWithPort = async (port) => {
        return new Promise((resolvePort, rejectPort) => {
          console.log(`[Hexo Server]: 尝试在端口 ${port} 启动基本服务器...`);

          // Windows系统特殊处理
          const serverOptions = platform === 'win32' ? {
            host: '127.0.0.1' // Windows上明确使用localhost
          } : {};

          this.server = this.app.listen(port, serverOptions.host, (err) => {
            if (err) {
              rejectPort(err);
            } else {
              this.hexoPort = port;
              console.log(`[Hexo Server]: 基本服务器成功启动在 ${serverOptions.host || '0.0.0.0'}:${port}`);
              resolvePort();
            }
          });

          this.server.on('error', (err) => {
            rejectPort(err);
          });
        });
      };

      const tryStartWithFallback = async () => {
        try {
          // 先尝试找到可用端口
          const availablePort = await this.findAvailablePort(this.hexoPort);
          await startServerWithPort(availablePort);
          resolve();
        } catch (error) {
          console.error('[Hexo Server]: 启动基本服务器失败:', error);

          if (error.message.includes('EACCES') || error.message.includes('权限被拒绝')) {
            // 权限错误的特殊处理
            try {
              console.log('[Hexo Server]: 端口权限问题，尝试动态端口...');
              const dynamicPort = await this.findDynamicPort();
              await startServerWithPort(dynamicPort);
              resolve();
            } catch (dynamicError) {
              reject(new Error(
                `无法启动服务器: 端口权限被拒绝。\n` +
                `建议以管理员身份运行应用或检查防火墙设置。\n` +
                `原始错误: ${error.message}\n` +
                `动态端口错误: ${dynamicError.message}`
              ));
            }
          } else {
            reject(error);
          }
        }
      };

      tryStartWithFallback();
    });
  }
}

module.exports = HexoProServer;
