# 喵言喵语 · Antigravity-maomao 原生插件（v0.4.0 / 适用 Antigravity 2.x）

**结论先行**：100% MIT 净室一体化 Antigravity 原生插件——整合 4K60 动态视频/自定义图片壁纸与液态磨砂玻璃（含 Swarm 防白/黑屏）、内置 Shadow DOM 猫娘桌宠（0 独立进程 + 0px 贴角吸附 + 戳一戳查 5h/周配额）、真实模型面板星空推理滑块与 Orchestrator 切工水晶条、底栏无框遥测条 + 512K 物理浅水波试管 + 980px 用量看板与模型调用日志、纯圆形 6 分块右键轮盘、全界面汉化（严守模型名与思考强度原英文 + AGY 升级自动/手动重载）以及插件内安全在线更新。

## 核心特性

- **五页签侧栏控制台（`壁纸 / 玻璃 / 遥测 / 猫宠 / 增强`）**：全部设置采用玻璃态自定义开关按钮，完整兼容深色 / 浅色 / 深色玻璃 / 浅色玻璃四表面态与浮空 5px 低存在感细滚动条。
- **4K60 动态壁纸 & Swarm 稳定性加固**：支持 `.mp4` / `.webm` / 图片本地直出（`127.0.0.1` 随机端口 + Token 鉴权 HTTP 206 流媒体），单层低开销磨砂与 Swarm 暗色自愈防止白屏/黑屏。
- **内置猫娘桌宠 & 0fps 光学微动效**：无需独立 `StarWidget.exe`，直接内嵌于宿主窗口；支持 0px 贴角与吸附开关、戳一戳显示实时 5h & 周配额与倒计时、打字/退格 0ms 零卡顿快滤、1.5px 极细贴边 RGB 旋转流光。
- **本地 SQLite 遥测与 512K 物理试管**：零外部 npm 依赖，使用 Node 内置 `node:sqlite` 只读解析轨迹与配额，底栏常态无框纯文字、悬停浮现胶囊，980px 用量看板含 53 周热力图与 150 条可筛选/排序/展开的「模型调用日志」。
- **模型面板星空推理滑块**：挂载于 Antigravity 原生模型菜单底部，宽润 26px 星云紫滑块实时切换档位并按模型记忆；`Orchestrator` 与单档模型展示切工水晶条；100% 隔离设置页模型选择器。
- **纯圆形右键分块圆环 & 全界面汉化热重载**：对话区右键呼出无方框 6 分块圆环（`/swarm` `/btw` `/compact` `/plan` `/grill-me` `/learn`）；主宿主与 Swarm 自动汉化且严守模型名与思考强度不汉化红线，AGY 版本升级自动重载并支持一键同步词典重载。
- **插件内安全自更新**：直连 GitHub Releases 检查更新，发现新版本在 AGY 原生右下角 Toast 提示（自动避让猫宠与气泡），支持 HTTPS 白名单 + 防 Zip-Slip + 备份回滚一键热更新。

## 安装与运行

### 前置条件

1. 已安装 Node.js 22+（支持 `node:sqlite`）与 Antigravity 2.x（含全局 `sidecar_sdk`）。

### 一键安装到本机 Antigravity 插件目录

在仓库根目录执行：

```powershell
npm run install:plugin
```

该命令会将全部 72 个自包含插件文件复制至 `~/.gemini/config/plugins/antigravity-star-suite/` 并在 `~/.gemini/config/config.json` 中自动启用，重启或热重载后即可在右侧插件面板打开 **「喵言喵语」**。

## 致谢

- 感谢上游项目 [Monokumakuki/Antigravity-Star-Suite](https://github.com/Monokumakuki/Antigravity-Star-Suite) 提供的初代星语桌宠与织梦皮肤基础。
- 遥测数据模型与工程思路致敬 MIT 开源项目 [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools) 与 [LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider](https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider)。

## 目录用途清单

- `plugin.json`：Antigravity 插件元数据声明（展示名「喵言喵语」，`v0.4.0`）。
- `assets/logo.svg` / `assets/logo.png`：插件图标。
- `sidecars/star-suite/sidecar.json`：Sidecar 进程与 `AUX_PANE` WebView 入口配置。
- `sidecars/star-suite/main.mjs`：Sidecar 主服务（整合 `HostController`、`LocalMediaServer`、遥测/配额/翻译/在线更新/汉化热重载 API）。
- `sidecars/star-suite/runtime-loader.mjs`：自包含 `runtime/` 与源码开发路径双模式加载器。
- `sidecars/star-suite/web/`：五页签控制台前端（`index.html`、`styles.css`、`app.js`）。
- `tests/plugin.test.cjs`：插件清单、加载器、HTTP/CORS 接口、在线更新与汉化重载单元测试。
