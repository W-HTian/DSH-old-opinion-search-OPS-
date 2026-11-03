# dsh-recall · 全局搜索

> 这是 [DSH Recall](../README.md) 的插件本体，安装与项目说明见仓库根 README。

给 DSH 加一个「跨项目、跨会话」的内容检索面板：把过去所有对话里你说过的话、AI 的回复、工具调用与结果、任务清单做成一个本地索引，用**子串**方式搜索——中文、英文、代码片段都能命中。

侧栏新增一行 **全局搜索**（快捷键 `Ctrl+Shift+F`）。

## 它解决什么问题

DSH 自带的会话搜索有两个限制：

1. **默认只搜标题和工作区名**。`@deepseek-ai/dsh-session-query-sqlite` 在 base 层以 `openAt: never` 挂载，内容索引默认关闭。
2. 即使打开内容索引，它用的是 SQLite FTS5 `unicode61` 分词器：按空白分词，一串中文是一个整词，搜「论文」**不会**命中「毕业论文」；而且每个会话只回一条最佳片段，最多 20 个会话，点开只到会话不到消息。

`dsh-recall` 不做分词，直接在事件文本上做不区分大小写的子串匹配，所以：

- 中文任意片段可搜（「论文」「分割结果」「发票」）
- 同一会话里命中多少条就显示多少条，带高亮片段
- 按会话分组，右侧直接看命中消息及其前后文，再决定要不要打开会话

## 使用

| 操作 | 说明 |
| --- | --- |
| 侧栏「全局搜索」/ `Ctrl+Shift+F` | 打开面板 |
| 输入关键词 | 240ms 防抖后搜索；空格分隔表示「都要包含」 |
| `↑` `↓` | 在命中之间移动，右侧同步预览上下文 |
| `Enter` | 在会话中打开选中的命中 |
| 双击结果 / 「打开会话」 | 在会话中打开 |
| 「全部项目」下拉 | 只搜某个项目（按会话工作目录） |
| 全部时间 / 近 7 天 / 30 天 / 一年 | 按命中时间过滤 |
| 「刷新索引」 | 立即重扫会话日志（索引默认 5 分钟自动过期） |

空面板会列出最近的项目，点一下即可限定到该项目。

## 原理

```
DSH Host                                   浏览器
┌──────────────────────────────┐          ┌───────────────────────┐
│ dsh-recall (host)            │  JSON    │ dsh-recall (client)   │
│  ctx.sessionQuery            │◀────────▶│  侧栏行 + main 面板   │
│   listSessions()             │  /dsh-   │  输入/过滤/结果/预览  │
│   filterEvents(surface=cur)  │  recall/ │                       │
│   ↓ 内存索引（含小写副本）    │  api/…   │                       │
└──────────────────────────────┘          └───────────────────────┘
```

- 索引只取 **current surface** 的 `user/message`、`assistant/message`、`tool/call`、`tool/result`、`todo/write`，单条最多 4000 字符。会话标题用该会话的第一条用户消息（标题事件在这个版本里没有落盘）。
- 子代理会话（`header.parentSession` 存在）不索引，避免同一段话出现多份。
- 第一次打开面板才开始建索引（本机 32 个会话 / 3600 条事件约 2–12 秒，取决于日志大小与磁盘缓存）；**每完成一个会话就能被搜到**，面板顶部会显示索引状态。之后单次搜索 1–5ms。
- 索引在进程内存里，重启后第一次打开会重建；超过 5 分钟的下一次搜索会在后台重建，不阻塞当前查询。Host 插件热重载（改代码）不会重建。
- 数据不出本机：`/dsh-recall/api/*` 由本机 Host 提供，和 GUI 同源。

## 安装 / 修复

插件源码就在这个目录，通过 **junction + profile patch** 挂进 `~/.dsh/profiles/desktop`，不需要 `pnpm install`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

脚本做两件幂等的事：

1. 建 `~/.dsh/profiles/desktop/node_modules/dsh-recall` → 本目录；
2. 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 追加 `dsh-recall` 的 insert 条目（已存在则跳过）。

Host 的 HMR 会监听 profile 配置和链接包的文件，改动即时生效，**不用重启应用**。profile 被重置或 DSH 升级重写 profile 后，重跑一次脚本即可。

## 限制

- 只索引「当前消息面」的事件；被后续消息替换/隐藏的历史（`shadowed`、`log-only`）不参与搜索。
- 子串匹配没有相关性排序以外的语义理解：搜「部署」不会自动找到「上线」。这是刻意的——它保证中文可搜、结果可预测。
- 单条文本截断到 4000 字符，很长的命令输出只有开头部分可搜。
- 内存索引按进程存在；会话很多（数百个、GB 级日志）时首次构建会变慢，可后续换成磁盘索引。
- 实验性本地插件，未发布到 npm；DSH 大版本升级后若 `sessionQuery` 接口变化需要跟着改。

## 文件

```
dsh-recall/
├── package.json          # dsh.client + dsh.bundle 声明
├── cordis.patch.yml      # bundle 层的 Host 条目
├── lib/index.js          # Host：索引 + /dsh-recall/api
├── lib/client.js         # 浏览器：侧栏行 + 面板（Module Loader factory）
└── scripts/
    ├── install.ps1       # junction + patch（幂等）
    └── mock.mjs          # 用真实 CSS 渲染静态 mock，截图检查布局
```
