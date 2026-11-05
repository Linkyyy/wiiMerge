# wiiMerge

Windows 优先的本地桌面差异比较工具，使用 React 界面和共享 Node.js 比较引擎，提供 WebView2 精简版和 Electron 兼容版。支持文本、文件、文件夹、Excel 和 ZIP / WAR / JAR 的差异比较，独立差分窗口、多 Tab、双向合并及 HTML / Excel 报告。所有比较在本机执行，不上传内容；合并后手动保存，覆盖前保留原文件备份。

## 使用

Windows 10 / 11 x64：在 [GitHub Actions 构建页面](https://github.com/Linkyyy/wiiMerge/actions/workflows/ci.yml) 打开成功的构建记录，从 **Artifacts → wiiMerge-WebView2-Windows-x64** 下载精简版 ZIP（需要登录 GitHub）。**解压整个 ZIP 后运行 `wiiMerge.exe`**，请勿只复制启动器。无需另装 Node.js 或 Office。这是未签名的开发版便携程序。

[0.2.1 精简版下载页面](https://github.com/Linkyyy/wiiMerge/actions/runs/41983769224#artifacts)

精简版依赖系统的 **Microsoft Edge WebView2 Runtime 和 .NET Framework 4.8**，Windows 11 通常自带；缺少 WebView2 时程序会提示微软官方安装地址。它仍然自带比较引擎，正常比较不需要联网。旧版 Electron 的规则配置继续可用。

如果电脑不能安装系统组件，可下载 **wiiMerge-Windows-x64** 兼容版，解压后运行 `wiiMerge-0.2.1-Windows-x64.exe`。兼容版自带浏览器运行时，体积较大。Actions 下载有保留期限，过期后可在上述页面重新运行构建。

### 0.2.1 体积

| 本地构建实测     | 原 0.1.0  | WebView2 精简版 | 减少  |
| ---------------- | --------- | --------------- | ----- |
| 下载文件         | 108.8 MiB | 35.5 MiB        | 67.3% |
| 解压后的应用文件 | 421.7 MiB | 93.4 MiB        | 77.9% |

WebView2 浏览器由系统共享，上表不包括已有系统组件的磁盘占用。精简版保留相同的比较引擎及功能；另外也优化了 Electron 兼容版的依赖和语言资源。所有发布包保留相关开源许可。具体字节数及前后对比写在下载包的 `size-report.json` 中，`SHA256SUMS.txt` 可校验解压后的文件。

1. 选择「文件比较」「文件夹比较」或「文本比较」。可一次拖入两个文件夹或文件，按拖放列表顺序填入左、右两侧；拖入后可通过交换按钮调整。文本支持直接粘贴。
2. 按需配置「比较规则」，点击「开始比较」，或按 `Ctrl + Enter`。
3. 双击文件条目或点击「打开独立差分窗口」。左侧目录树展示文件及归档层级；双击 ZIP / WAR / JAR 结点，在新 Tab 浏览内部差异，支持嵌套归档。
4. 文本差分侧栏显示每个差异块，点击跳转；用每块中间的箭头或工具栏「使用左边 / 使用右边」合并。可编辑原文、撤销合并，再分别保存左侧或右侧。Excel / 二进制支持确认后整文件采用。
5. 点击 HTML / Excel 报告，导出差分一览和各文件明细，覆盖所有条目及归档内容，不受搜索、筛选影响。从差分窗口导出会同步当前未保存文本，并标明工作区快照。修改输入或规则后需重新比较。

窗口使用外部阴影代替实体边框，保留嵌入式最小化、最大化和关闭按钮。拖动顶部空白处移动，双击顶部空白处切换最大化，也可拖动窗口边缘缩放。

### 合并与快捷键

| 操作                       | 快捷键          |
| -------------------------- | --------------- |
| 开始比较                   | Ctrl + Enter    |
| 下一处 / 上一处文本差分    | F7 / Shift + F7 |
| 当前块：左侧内容采用到右侧 | Alt + →         |
| 当前块：右侧内容采用到左侧 | Alt + ←         |
| 保存当前选中的一侧         | Ctrl + S        |

保存原文本会保留目标侧的编码、BOM 和换行符。保存前检查文件指纹，发现外部修改时拒绝覆盖；备份位于应用数据目录的 `backups/`，`.bak.json` 记录原路径。归档条目和粘贴文本通过「另存为」写出 UTF-8 文件，不自动回写或重新打包 ZIP / WAR / JAR。文本合并按原始文本对齐，避免忽略规则隐藏的行被误删。

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

WebView2 启动器可在 Linux 交叉编译。`npm run dist:lite` 使用固定版本的官方 Windows Node.js ZIP，并验证固定 SHA-256；WebView2 SDK 与 .NET 引用程序集由 NuGet 锁文件固定。产物在 `release/wiiMerge-0.2.1-WebView2-Windows-x64.zip`，解压文件也保留在 `.native-build/`。代理环境需在命令前设置 `NODE_USE_ENV_PROXY=1`。`WIIMERGE_DOTNET` 可指定 `dotnet` 的绝对路径。

Linux 上单独检查精简版界面与后台：先执行 `npm run build && node scripts/build-native.mjs --prepare-only`，再执行 `npm run test:native`；可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定 Chrome / Chromium。这项检查模拟原生对话框，Windows CI 则启动编译后的 WinForms + WebView2 程序，测试真实宿主消息、文件授权、拖放和导出。

Electron 新版本安装器使用 Node `fetch`。环境要求代理且自动下载未完成时，使用继承的代理和 CA 信任，不关闭 TLS / 校验：

```bash
NODE_USE_ENV_PROXY=1 node node_modules/electron/install.js
```

桌面测试使用隔离的临时用户目录和测试数据；自动选择对话框的测试返回值，实际执行桥接、路径授权、后台比较及报告写入。覆盖独立窗口、双路径拖放、归档 Tab、按块合并、换行保留和报告明细；核心测试检查规则、安全边界和外部修改冲突。截图输出在 `artifacts/`。GitHub Actions 同时检查两种宿主，在 Windows 构建后测试真实打包程序，并检查发行包体积预算。

## 当前边界

- 支持双向文本块合并及 Excel / 二进制整文件采用；不包含三方合并、Excel 单元格级编辑、批量目录同步或自动重新打包归档。不会通过整文件采用隐式删除目标文件。
- 旧版 `.xls` 请先另存为 `.xlsx`；不支持 `.xlsb`、RAR、7z、加密 ZIP / Excel。
- Excel 比较单元格内容的字符串表示，不比较单元格类型、样式、图表、宏、合并布局或公式计算过程。读取缓存值时不会重新计算公式，缓存缺失视为空值。
- 不设固定的单文件、文本、合并编辑、单侧累计输入或归档展开大小上限，也不再因文本超过 2 MiB 自动切换成二进制。二进制文件使用流式 SHA-256 比较，整文件采用和备份也使用文件复制。文本和 Excel 解析、归档展开及导出仍需要相应内存，实际容量取决于系统和运行时可用资源。
- 比较任务没有固定总时长截止，仍可手动取消。复杂文本对齐保留 2.5 秒的计算超时，以免长时间卡住；可通过忽略规则简化差异。
- 每侧最多 5,000 个匹配条目；文件夹扫描最多 20,000 个条目、64 层，嵌套归档最多三层。符号链接、特殊文件、加密归档、不安全路径及解压尺寸与声明不符的归档仍会拒绝。
- Excel 不再额外限制工作表行列数或非空单元格数，仍受 Excel 格式及解析器支持范围约束；归档只在内存中读取，不向磁盘释放内部路径。
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

Electron 主界面关闭 Node 集成，启用 context isolation、sandbox 和 CSP；IPC 只向应用创建的窗口开放。WebView2 精简版使用原生宿主授权文件路径，本地服务只监听 `127.0.0.1` 的随机端口；浏览器会话使用 HttpOnly / SameSite cookie，文件授权和写入另外要求仅宿主掌握的随机凭据，并拒绝跨源请求。窗口禁止导航到其他来源；比较和导出在可取消的 worker 线程中运行。没有遥测、远程页面或对外监听端口。
