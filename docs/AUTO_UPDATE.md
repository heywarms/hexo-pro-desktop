# 桌面端自动更新

桌面端使用 `electron-updater`，更新源为 [heywarms/hexo-pro Releases](https://github.com/heywarms/hexo-pro/releases)。更新的是完整桌面应用，包含内置前端和 Hexo Pro 核心。

## 使用行为

- 安装版启动 15 秒后检查更新，之后每 4 小时检查一次。失败后可手动重试，下一个周期也会重试。
- 默认后台下载。在「设置 → 帮助与更新」可关闭自动下载，此偏好保存在桌面配置中，跨项目、重启保留。关闭不会取消已开始的下载。
- 下载完成会提示。点击「重启安装」并确认后才安装；普通退出不会自动安装。编辑器仍有未保存内容时会阻止重启。
- 尚未打开博客时，欢迎页也显示更新状态，菜单「帮助 → 检查更新」同样可用。
- 手动检查、下载与自动任务共用状态，避免重复下载。已经下载完成的安装包不会被定时检查覆盖。
- 正式版只接收正式发布；`-beta.N` 测试版接收后续 beta 和正式版。禁止版本降级。
- 源码开发模式不请求更新服务器。Linux 需要从 AppImage 运行。

## 发布新版本

1. 更新根目录、`hexo-pro`、`hexo-pro-desktop` 中需要同步发布的 `package.json` 版本。桌面更新比较的是 `hexo-pro-desktop/package.json` 的版本，必须高于用户已经安装的版本。同版本重新上传不能触发更新。
2. 运行根目录的 `yarn verify`。配置发布环境中的 `GH_TOKEN`，不要把令牌写进应用或版本库。
3. 在对应操作系统上运行以下命令之一。命令会先重新构建父项目的前端，再复制核心，最后只打包一次并上传。

   ```sh
   cd hexo-pro-desktop
   yarn dist:publish:mac
   # Windows 构建机：yarn dist:publish:win
   # Linux 构建机：yarn dist:publish:linux
   # 仅构建、不上传：yarn dist:mac / dist:win / dist:linux
   ```

4. 上传目标默认是 **GitHub Release 草稿**。所有目标平台上传完成、核对文件后再发布草稿；测试版勾选「Set as a pre-release」，正式版取消。草稿不会被客户端发现。这也避免用户在上传尚未结束时获取不完整的更新。

发布页必须同时包含安装包、更新描述文件和构建生成的 `.blockmap` 文件，不要只上传安装包，不要在生成描述文件后手动改名。

| 平台 | 安装/更新包 | 正式版描述文件 | beta 描述文件 |
| --- | --- | --- | --- |
| macOS | DMG + ZIP（更新必须有 ZIP） | `latest-mac.yml` | `beta-mac.yml` |
| Windows | NSIS `.exe` | `latest.yml` | `beta.yml` |
| Linux | `.AppImage` | `latest-linux.yml` | `beta-linux.yml` |

多架构 macOS 包应在同一次构建中生成，确保描述文件包含全部 ZIP。需要单架构时直接使用 `yarn build:react && yarn copy-core`，再执行 `yarn electron-builder --mac --arm64 --publish always --config.mac.forceCodeSigning=true`；省略的架构不会获得该版本的更新。不同构建机上传同名描述文件会覆盖，不能把分别生成的 arm64/x64 描述文件直接叠加上传。

## 签名与平台条件

- macOS 的安装版与新版本均需有效且一致的 Developer ID 签名。发布命令开启 `mac.forceCodeSigning`，缺失证书时构建失败，避免发布无法自动安装的包。使用本机钥匙串或构建机的 `CSC_LINK` / `CSC_KEY_PASSWORD` 提供证书；面向普通用户分发时还应配置 Apple 公证。
- Windows 使用 NSIS 安装包，建议持续使用相同发布者证书。不要绕过更新器的签名和校验和验证。
- Linux 目前只配置 AppImage；不要伪造 `APPIMAGE` 环境变量来给解压目录强行启用更新。
- `app-update.yml` 由构建器写入安装包，无需在代码里另设下载地址；客户端不需要 GitHub 令牌。

签名、目标格式和更新描述文件的依据见 [electron-builder v26 自动更新文档](https://www.electron.build/v26/docs/features/auto-update/)。项目使用 builder 26 / updater 6，不应混用 v27 的配置 API。

## 验证一次真实升级

在测试设备安装签名的旧测试版 A，发布更高版本的测试版 B，验证自动检查 → 后台下载 → 稍后安装 → 再次点击重启 → 版本变为 B，并确认原博客、登录状态和桌面偏好仍在。还应验证断网重试和正在保存文章时阻止重启。单元测试使用模拟更新源覆盖状态和并发；不能替代跨两个签名安装包的实际升级测试。

旧版本如果没有更新描述文件，或 macOS 旧包没有有效签名，需先手动安装包含此更新功能的客户端。本次代码接入不会自动创建或发布一个新版本。
