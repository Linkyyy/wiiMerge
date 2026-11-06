# wiiMerge 官网

官网源码在 `website/`，是独立的中文静态产品网站，包含合并交互示例、真实桌面截图、功能说明、下载步骤、版本信息和 FAQ。它不接收或比较用户文件，桌面应用仍单独构建。

## 本地构建与验证

```bash
npm run build:site
npm run preview:site
```

构建输出在 `website/dist/`。构建仅使用 Node.js 内置模块，不需要安装桌面应用依赖。预览命令使用项目现有的 Vite。

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:site
```

`test:site` 启动临时回环 HTTP 服务，使用真实浏览器检查合并示例、截图 Tab、放大预览、FAQ、手机菜单、复制包名、下载链接、锚点、资源和生产 CSP。覆盖 1440、768、390、360 像素视口。截图为 `artifacts/website-desktop.png` 和 `artifacts/website-mobile.png`。CI 使用预装的 Google Chrome。

## Vercel 发布

在 Vercel 中导入 `Linkyyy/wiiMerge`，项目根目录选择**仓库根目录**，不是 `website/`。根目录的 `vercel.json` 已配置：

- Framework Preset：Other（`framework: null`）。
- Install Command：`node --version`，避免安装 Electron 和桌面构建依赖。
- Build Command：`node scripts/build-site.mjs`。
- Output Directory：`website/dist`。
- 静态资源包含内容指纹，配置长期缓存及 CSP 等安全头。

构建读取 Vercel 提供的 `VERCEL_PROJECT_PRODUCTION_URL`（优先）或 `VERCEL_URL` 来生成 canonical、Open Graph 与 sitemap。绑定自定义域名后可设置非敏感变量 `SITE_URL=https://你的域名` 再重新部署。

通过自动化工具发布时，需要已授权的 Vercel 账号连接或安全配置的 `VERCEL_TOKEN`，并允许访问 `api.vercel.com`、`vercel.com` 及部署后的 `*.vercel.app` 域名。令牌只在平台安全设置中输入，不提交到仓库，也不通过聊天传递。缺少这些条件时，完成网站源码与构建不代表已上线。

## 更新下载版本

更新 `website/release.json` 的版本号、已成功的 GitHub Actions 构建地址及两种包的体积，并更新 `website/assets/` 中的产品截图。版本号必须与根 `package.json` 一致，构建会检查这一点。

当前下载入口指向已验证的 0.6.0 构建，精简包为 `wiiMerge-WebView2-Windows-x64`，兼容包为 `wiiMerge-Windows-x64`。GitHub Artifacts 需要登录且有保留期限，因此官网明确显示下载步骤；构建产物过期时需要更新链接。
