# wiiMerge

Windows 优先的本地桌面差异比较工具，使用 React 界面和共享 Node.js 比较引擎，提供 WebView2 精简版和 Electron 兼容版。支持并排查看文本、文件、文件夹、Excel 和 ZIP / WAR / JAR 的差异，导出 HTML 或 Excel 报告。所有比较在本机执行，不上传内容；只读比较，不覆盖源文件。

## 使用

Windows 10 / 11 x64：在 [GitHub Actions 构建页面](https://github.com/Linkyyy/wiiMerge/actions/workflows/ci.yml) 打开成功的构建记录，从 **Artifacts → wiiMerge-WebView2-Windows-x64** 下载精简版 ZIP（需要登录 GitHub）。**解压整个 ZIP 后运行 `wiiMerge.exe`**，请勿只复制启动器。无需另装 Node.js 或 Office。这是未签名的开发版便携程序。

[0.1.1 精简版下载页面](https://github.com/Linkyyy/wiiMerge/actions/runs/41953611324#artifacts)

精简版依赖系统的 **Microsoft Edge WebView2 Runtime 和 .NET Framework 4.8**，Windows 11 通常自带；缺少 WebView2 时程序会提示微软官方安装地址。它仍然自带比较引擎，正常比较不需要联网。旧版 Electron 的规则配置继续可用。

如果电脑不能安装系统组件，可下载 **wiiMerge-Windows-x64** 兼容版，解压后运行 `wiiMerge-0.1.1-Windows-x64.exe`。兼容版自带浏览器运行时，体积较大。Actions 下载有保留期限，过期后可在上述页面重新运行构建。

### 0.1.1 体积优化

| 本地构建实测     | 原 0.1.0  | WebView2 精简版 | 减少  |
| ---------------- | --------- | --------------- | ----- |
| 下载文件         | 108.8 MiB | 35.2 MiB        | 67.6% |
| 解压后的应用文件 | 421.7 MiB | 92.3 MiB        | 78.1% |

WebView2 浏览器由系统共享，上表不包括已有系统组件的磁盘占用。精简版保留相同的比较引擎及功能；另外也优化了 Electron 兼容版的依赖和语言资源。所有发布包保留相关开源许可。具体字节数及前后对比写在下载包的 `size-report.json` 中，`SHA256SUMS.txt` 可校验解压后的文件。

1. 选择「文件比较」「文件夹比较」或「文本比较」。文件和文件夹可通过选择按钮或拖放输入；文本支持直接粘贴，也可载入示例。
2. 按需配置「比较规则」，点击「开始比较」，或按 `Ctrl + Enter`。
3. 左侧筛选、搜索比较条目，右侧查看并排差异。用上下箭头跳转差异，支持只看不同及自动换行。
4. 点击「导出报告」，选择 HTML 或 Excel。导出包含全部比较条目，不受界面搜索、筛选影响。修改输入或规则后需要重新比较才能导出。

## 功能

| 类型                    | 比较方式                                                                        |
| ----------------------- | ------------------------------------------------------------------------------- |
| 文本 / 代码             | 行对齐、原始行号、字符级高亮；统一 CRLF / LF / CR，保留末尾换行差异             |
| 文件                    | 自动识别文本、Excel；其他内容按原始字节比较，展示 SHA-256                       |
| 文件夹                  | 递归按相对路径配对，识别新增、移除、修改、一致、错误和空文件夹                  |
| ZIP / WAR / JAR         | 内存中展开，不向磁盘释放条目；支持归档内 Excel 和最多三层嵌套归档               |
| Excel `.xlsx` / `.xlsm` | 按工作表名称与单元格位置比较，或按指定主键列匹配行；支持公式表达式 / 缓存值切换 |
| HTML 导出               | 单个独立文件，包含比较摘要、规则、文件和差异明细；转义内容，无脚本及远程资源    |
| Excel 导出              | 摘要、文件清单、文本差异、Excel 差异、工作表清单、二进制指纹六类工作表          |

「仅左侧」「仅右侧」始终相对当前输入，不代表实际的版本历史。

### 匹配规则

- 忽略大小写、行首尾空白、所有空白、空白行。
- 原始文本行上的忽略正则，每行一个，不带 `/` 分隔符。
- 内容正则替换：比较规范化后的内容，明细仍显示原文；支持 JavaScript 替换语法，如 `$1`。
- Glob 排除路径，例如 `**/.git/**`、`**/node_modules/**`、`**/*.log`；前两项为默认排除。
- 路径忽略大小写、路径正则替换，例如 `-v\d+` → 空串，匹配不同版本文件名。同侧路径规则造成重名时明确报错。
- 编码：自动检测 UTF-8、UTF-16 BOM；可指定 GB18030 / GBK、UTF-8、UTF-16 LE。自动模式下无法作为文本解码的内容按二进制比较。
- Excel 主键：填写 `A` 或 `A,B`。第 1 行固定为表头，后续非空行按规范化后的列值组合匹配；空主键、重复主键报错。工作表按名称匹配。
- 规则保存在 Electron `userData/rules.json`，支持 JSON 导入、导出和恢复默认，不保存文件内容或输入文本。

## 开发

推荐 Node.js 24 LTS、npm 11；最低 Node.js 22.12。编译 WebView2 启动器还需要 .NET SDK 10；终端用户不需要安装该 SDK。使用现有检出目录，每个云任务已隔离，无需额外创建 Git worktree。

```bash
npm ci
npm run dev
```

`npm run dev` 同时启动 Vite 和 Electron，支持界面热更新。修改主进程或 preload 后重启。需要具有图形会话的桌面环境。`npm run dev:ui` 只预览界面，不能读取本地文件或执行比较。

```bash
npm test                 # 核心比较、规则、安全边界和导出回读测试
npm run build            # 构建界面及无需 node_modules 的独立后台包
npm run test:desktop     # 真实 Electron UI / IPC / worker 测试（先 build）
npm run dist:lite        # WebView2 精简版 ZIP（需要 .NET SDK 10）
npm run test:native      # Windows 测真实 WebView2；Linux 测相同界面和后台协议
npm run dist:win         # Electron 兼容版 Windows x64 便携 EXE
npm run check:package    # 检查兼容版依赖、语言资源、体积与校验文件
npm run pack             # 当前平台解包后的应用
```

Linux 无图形显示器的云容器可使用以下测试方式。`--no-sandbox` 仅由测试脚本在该显式开关下加入，正常启动不关闭 Chromium 沙箱。

```bash
WIIMERGE_SMOKE_HEADLESS=1 WIIMERGE_TEST_APP_PATH=.desktop-build npm run test:desktop
```

WebView2 启动器可在 Linux 交叉编译。`npm run dist:lite` 使用固定版本的官方 Windows Node.js ZIP，并验证固定 SHA-256；WebView2 SDK 与 .NET 引用程序集由 NuGet 锁文件固定。产物在 `release/wiiMerge-0.1.1-WebView2-Windows-x64.zip`，解压文件也保留在 `.native-build/`。代理环境需在命令前设置 `NODE_USE_ENV_PROXY=1`。`WIIMERGE_DOTNET` 可指定 `dotnet` 的绝对路径。

Linux 上单独检查精简版界面与后台：先执行 `npm run build && node scripts/build-native.mjs --prepare-only`，再执行 `npm run test:native`；可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定 Chrome / Chromium。这项检查模拟原生对话框，Windows CI 则启动编译后的 WinForms + WebView2 程序，测试真实宿主消息、文件授权、拖放和导出。

Electron 新版本安装器使用 Node `fetch`。环境要求代理且自动下载未完成时，使用继承的代理和 CA 信任，不关闭 TLS / 校验：

```bash
NODE_USE_ENV_PROXY=1 node node_modules/electron/install.js
```

桌面测试使用隔离的临时用户目录和测试数据；自动选择对话框的测试返回值，实际执行桥接、路径授权、后台比较及报告写入。还会检查规则保存、旧结果失效、取消任务和未授权路径拒绝。截图输出在 `artifacts/`。GitHub Actions 同时检查两种宿主，在 Windows 构建后测试真实打包程序，并检查发行包体积预算。

## 当前边界

- 首版为只读差异查看器，不包含编辑合并、三方合并或目录同步。
- 旧版 `.xls` 请先另存为 `.xlsx`；不支持 `.xlsb`、RAR、7z、加密 ZIP / Excel。
- Excel 比较单元格内容的字符串表示，不比较单元格类型、样式、图表、宏、合并布局或公式计算过程。读取缓存值时不会重新计算公式，缓存缺失视为空值。
- 默认每侧总输入 / 展开数据上限 128 MiB、单文件 16 MiB、5,000 个匹配条目；文件夹扫描最多 20,000 个条目、64 层。符号链接及特殊文件报告为未能比较。
- 超过 2 MiB 的文本文件走二进制比较；直接粘贴文本每侧最多 2 MiB。单次任务 120 秒超时，文本差异计算另有 2.5 秒上限，均可取消。
- Excel 每工作表最多 10,000 行、256 列，每个工作簿最多 300,000 个非空单元格；归档有压缩大小与展开大小检查，不写出归档路径。
- 每项文本 / Excel 明细最多保留 12,000 条，统计仍覆盖完整输入。长文本优先保留差异行并省略一致行；界面和 HTML / Excel 导出均标记截断。Excel 导出单元格超过 32,767 字符时会标记截断。存在错误或截断时，不应把报告当作完整明细。
- Windows 打包运行检查由 CI 提供；交叉编译通过不等于 Windows 界面验证通过，应检查对应构建记录的测试结果。

## 结构

```text
core/       比较引擎、归档读取、Excel 解析、规则和报告；可独立测试
electron/   主进程、路径授权、系统对话框、隔离 preload
native/     WinForms + WebView2 宿主、带会话认证的本地比较服务
src/        中文 React 界面
scripts/    开发启动和桌面端到端检查
tests/      自动化测试与样本生成器
build/      应用图标
```

Electron 主界面关闭 Node 集成，启用 context isolation、sandbox 和 CSP；IPC 只向当前主窗口开放。WebView2 精简版使用原生宿主授权文件路径，本地服务只监听 `127.0.0.1` 的随机端口；浏览器会话使用 HttpOnly / SameSite cookie，文件授权和写入另外要求仅宿主掌握的随机凭据，并拒绝跨源请求。窗口禁止导航到其他来源；比较和导出继续在有内存限制、可取消的 worker 线程中运行。没有遥测、远程页面或对外监听端口。
