# Hexo Pro Desktop

基于 Electron 的 Hexo 博客管理桌面客户端

## 简介

Hexo Pro Desktop 是 hexo-pro 插件的桌面版本，提供了一个独立的桌面应用程序来管理您的 Hexo 博客。它包含了原 hexo-pro 插件的所有功能，并增加了桌面端特有的便利功能。

## ✨ 功能特性

### 🖥️ 桌面端增强功能

- **智能认证管理**: 自动保存和恢复登录状态
- **项目管理**: 支持多项目切换，记住最后打开的项目
- **无缝体验**: 自动跳转到Web管理界面，无需手动配置
- **菜单集成**: 完整的原生菜单支持
- **错误处理**: 完善的错误提示和恢复机制
- **自动更新**: 启动后及每 4 小时检查更新，支持后台下载、进度提示和保存内容后重启安装；可在「帮助与更新」关闭自动下载。

更新发布流程、各平台签名与安装包要求见 [桌面自动更新说明](docs/AUTO_UPDATE.md)。发布命令先构建父项目前端再打包，上传到 GitHub Release 草稿；核对后发布草稿即可供客户端检查。

### 🔐 完整认证系统
- **安全登录**: 支持用户注册和登录，完全兼容Web版本
- **自动登录**: 首次登录后，后续启动自动认证
- **记住密码**: 可选择安全存储密码，提升使用体验
- **Token管理**: 自动处理JWT token的存储和刷新

### 📝 博客管理功能
- 📝 **完整的博客管理** - 文章编辑、页面管理、图片上传等
- 🎨 **可视化编辑器** - 支持 Markdown 和可视化编辑
- 📊 **仪表盘统计** - 博客数据统计和分析
- 🚀 **一键部署** - 支持多种部署方式
- 💾 **项目管理** - 支持多个 Hexo 项目切换
- 🔧 **插件设置** - 完整的配置管理界面

## 🆕 最新更新

- **🔧 FrontMatter 布尔值修复** - 修复了 frontMatter 中布尔值的展示和设置问题，确保正确处理 true/false 值
- **🔌 智能插件加载** - 桌面端优化插件加载逻辑，可自动加载已有项目下 node_modules 中所有可用的 Hexo 插件
- **🌐 灵活链接跳转** - 桌面端跳转链接默认指向 localhost:4000，支持通过设置自定义配置目标地址
- **✏️ 编辑器默认模式** - 新增编辑器默认模式配置，可根据个人喜好设置编辑器的默认工作模式
- **🖼️ 封面隐藏控制** - 新增封面隐藏设置选项，开启后可以隐藏文章封面图片显示
- **⚡ 快速部署模式** - 新增部署跳过静态文件生成配置，开启后可直接推送到仓库，提升部署效率

## 系统要求

- **操作系统**: Windows 10+, macOS 12+, Ubuntu 22.04+
- **运行环境**: 安装包自带 Node.js、npm 和 Git，无需安装系统 Node、Git 或全局 Hexo CLI
- **源码开发/构建**: Node.js 22.12.0+、Yarn 1.x
- **内存**: 4GB 以上推荐
- **硬盘**: 建议至少 2GB 可用空间，另需博客文件与下载缓存空间

### 无需配置环境

新建博客直接复制应用内置的 Landscape 模板、示例文章和预装依赖，断网也可以创建、编辑、预览及生成静态文件。默认主题的字体和图标也随应用提供。

打开已有博客时，应用会使用自带 npm 安装依赖，并为自带 Node 重建插件；完成后会记录状态，未变化的博客再次打开无需安装。导入、安装新主题和在线发布需要网络。博客文件保存在用户选择的目录中，创建失败不会覆盖已有文件，启动失败也不会删除已创建的博客。

主题下载、GitHub 同步、Git 发布及云平台发布命令都使用私有工具路径。应用不修改系统 PATH 或全局 npm 安装；下载缓存保存在应用用户数据目录。发布仍需在界面中连接用户自己的账号。含有额外系统程序或需要本地编译器的第三方插件，仍需相应平台的预编译版本。

### 内置环境的构建与验证

`yarn dev` / `yarn start` 会先准备本机运行资源；所有 electron-builder 构建入口通过 `beforePack` 自动准备目标平台的资源。首次构建需要下载，后续使用校验后的本地缓存。也可以手动执行：

```bash
yarn prepare:runtime
# 交叉打包的资源准备示例
node scripts/prepare-runtime.js win32 x64
```

- `scripts/runtime/releases.json` 固定 Node 22.23.3、npm 10.9.9、Git 2.53.0 的官方分发地址与 SHA-256；更新时应同时更新版本、校验值及验证结果。
- Git 使用 GitHub Desktop 的 dugite-native 完整可移植发行包，保留 HTTPS 支持、辅助程序和相关通知文件。
- `templates/default/package-lock.json` 固定默认博客的依赖。构建模板时禁用安装脚本、排除可选原生依赖，并提供 Windows 和 POSIX 启动脚本。
- `resources/` 和 `.runtime-cache/` 是生成目录，不提交源码。缺少资源或校验失败会阻止打包，不回退到用户系统里的命令。
- 博客服务运行在内置标准 Node 子进程中；Electron 负责窗口和安全凭据。服务代码及其依赖通过 `asarUnpack` 放到标准 Node 可读取的位置。
- `afterPack` 检查安装包实际包含 Node/npm/Git、博客服务和模板依赖。macOS Universal 包分别保留两个架构的私有环境。

在上级客户端仓库可运行真实离线集成测试：

```bash
HEXOPRO_RUNTIME_INTEGRATION=1 node --test test/desktop-bundled-integration.test.js
```

测试覆盖离线创建、HTTP 预览、生成、主题安装、已有项目导入和向本地测试仓库发布。可通过 `HEXOPRO_BUNDLED_RESOURCES` 与 `HEXOPRO_WORKER_PATH` 指向解包后的安装包，以验证实际分发产物。Windows / Linux 的实际安装与系统兼容性还应在对应系统上验证。

## 安装方法

### 方法一：从源码构建

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd hexo-pro-desktop
   ```

2. **安装依赖**
   ```bash
   yarn install
   ```

3. **复制核心文件**
   ```bash
   yarn copy-core
   ```

4. **启动开发环境**
   ```bash
   yarn dev
   ```

5. **构建应用**
   ```bash
   yarn build
   ```

### 方法二：下载预构建版本

从 [Releases](releases) 页面下载适合您操作系统的安装包。

## 使用方法

### 1. 启动应用

首次启动时，您需要选择一个 Hexo 博客项目：

- 点击 **"文件"** → **"打开博客项目"**
- 选择您的 Hexo 博客根目录
- 应用会自动启动 Hexo Pro 服务器

### 2. 创建新项目

如果您还没有 Hexo 项目：

- 点击 **"文件"** → **"新建博客项目"**
- 选择项目目录
- 应用会引导您完成 Hexo 项目的初始化

### 3. 管理文章

- **创建文章**: 点击 "新建文章" 按钮
- **编辑文章**: 在文章列表中点击文章标题
- **删除文章**: 在文章操作菜单中选择删除

### 4. 配置设置

- 点击 **"文件"** → **"设置"** 或使用快捷键 `Ctrl/Cmd + ,`
- 配置博客基本信息、主题、插件等

### 5. 部署博客

- 在仪表盘页面点击 **"部署"** 按钮
- 或使用快捷键 `Ctrl/Cmd + D`

## 项目结构

```
hexo-pro-desktop/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── main.js          # 应用入口
│   │   ├── hexo-server.js   # Hexo 服务器封装
│   │   ├── preload.js       # 预加载脚本
│   │   └── hexo-pro-core/   # hexo-pro 核心文件
│   └── renderer/            # 渲染进程（React 应用）
├── scripts/                 # 构建脚本
├── assets/                  # 应用资源（图标等）
├── package.json
└── README.md
```

## 开发指南

### 开发环境设置

1. **准备前置项目**
   确保 `hexo-pro` 和 `hexo-pro-client` 项目在同级目录：
   ```
   parent-directory/
   ├── hexo-pro/
   ├── hexo-pro-client/
   └── hexo-pro-desktop/
   ```

2. **安装依赖**
   ```bash
   cd hexo-pro-desktop
   yarn install
   ```

3. **复制核心文件**
   ```bash
   yarn copy-core
   ```

4. **启动开发服务器**
   ```bash
   yarn dev
   ```

### 构建和打包

1. **构建前端资源**
   ```bash
   yarn build:react
   ```

2. **打包桌面应用**
   ```bash
   yarn build:electron
   ```

3. **创建分发包**
   ```bash
   yarn dist
   ```

### 调试

- **主进程调试**: 使用 VS Code 的 Node.js 调试器
- **渲染进程调试**: 在应用中按 `F12` 打开开发者工具
- **日志查看**: 检查控制台输出和应用日志

## 技术栈

- **框架**: Electron 43.x
- **前端**: React 18 + TypeScript + Ant Design
- **后端**: Express.js + hexo-pro APIs
- **构建**: Webpack + electron-builder
- **存储**: NeDB + electron-store

## 与原插件的区别

| 功能 | hexo-pro 插件 | Hexo Pro Desktop |
|------|---------------|------------------|
| 部署方式 | 依赖 hexo s 命令 | 独立桌面应用 |
| 用户界面 | 浏览器访问 | 原生桌面界面 |
| 项目管理 | 单项目 | 多项目切换 |
| 文件操作 | 受限 | 完整文件系统访问 |
| 系统集成 | 无 | 菜单、快捷键、通知 |

## 故障排除

### 常见问题

1. **启动失败**
   - 运行预构建客户端时，请使用更新后的安装包；升级系统 Node.js 不会更新旧客户端内置的 Node.js
   - 从源码启动或构建时，检查 Node.js 版本是否为 22.12.0+
   - Hexo 8 本身要求 Node.js 20.19.0+；客户端会在初始化前检查内置运行环境并给出升级提示
   - 确保没有其他应用占用端口 4000
   - 查看控制台错误信息

2. **项目加载失败**
   - 确认选择的是有效的 Hexo 项目目录
   - 检查项目中是否有 `_config.yml` 文件
   - 确保项目依赖已安装

3. **端口冲突问题**
   - 应用会自动尝试释放端口并重试
   - 如果多次尝试失败，应用会提示重启
   - 可以使用"文件"菜单中的"强制重启"选项
   - 应用包含智能端口管理，会自动寻找可用端口

4. **切换项目时的端口占用**
   - 应用会在加载新项目前完全停止旧服务器
   - 包含3秒强制超时机制确保端口释放
   - 如果遇到问题，应用会自动重试最多3次

5. **前端资源加载失败**
   - 运行 `yarn copy-core` 重新复制核心文件
   - 检查 `src/main/hexo-pro-core/www` 目录是否存在

### 性能优化

- 关闭不必要的插件
- 定期清理博客缓存
- 使用 SSD 存储项目文件

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 发起 Pull Request

## 路线图

### 近期计划
- [ ] 移动端适配（React Native）
- [ ] 主题预览功能
- [ ] 批量操作优化
- [ ] 插件市场集成

### 长期计划
- [ ] 云同步功能
- [ ] 协作编辑
- [ ] AI 辅助写作
- [ ] 性能监控

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 致谢

- [hexo-pro](https://github.com/wuzheng228/hexo-pro) - 原始插件项目
- [Electron](https://electronjs.org/) - 桌面应用框架
- [React](https://reactjs.org/) - 前端框架
- [Ant Design](https://ant.design/) - UI 组件库
