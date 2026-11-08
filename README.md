# 周报清单（dsh-weekly-report）

一个 DeepSeek Harness 插件：平时顺手记下「做了什么 / 要做什么」，写周报时按周导出成周报正文，并可一键调用默认模型检查整理。

不考核、不统计，只为「一周结束后不用再回忆」。

## 功能

- **面板**：侧边栏「周报」入口，一条一条记，按周翻看；计划项可以标完成 / 顺延 / 中止，顺延保留因果痕迹。
- **导出**：按「上周完成 + 本周计划」渲染成周报，可编辑、复制、存成 md。
- **一键整理**：用 Harness 当前默认模型做措辞层面的整理（压字数、统一句式、修错别字），不新增事实；结果先展示，再由你决定采用还是收起。
- **对话**：`weekly_log` / `weekly_report` 两个工具，说「记一下…」「这周我都记了什么」「生成周报」即可。

## 安装

在 DeepSeek Harness 里把本目录作为插件包安装即可（Plugin Manager 的本地目录安装，或 `plugin_manager` 的 `install_bundle`，`target` 传本目录的绝对路径）。

安装后在页面里刷新一次，侧边栏会出现「周报」图标。

## 用法

1. **记一条**：输入框写一句话，选择「完成」或「计划」，回车提交。
   - 默认是「完成」，因为工作日里顺手记的绝大多数是刚做完的事。
   - 计划可以记到别的周：翻到目标周再记，提示会说明「将记入第 N 周的计划」。
2. **回顾**：周导航翻看任意一周；点「回到本周」随时跳回当前周（当前周有品牌色标记）。
3. **处理计划**：每条计划项可以「完成 / 顺延 / 中止」。顺延不复制条目，只改归属周并留痕，所以上一周仍能看到「顺延至第 N 周」。
4. **出周报**：点「生成周报」，得到「上周工作 / 本周工作」草稿；再点「AI 检查整理」，确认后采用或收起；最后复制或存 md。

## 条目模型

| 字段 | 说明 |
|---|---|
| `text` | 一行正文，例如「完善并合并了 warmup 功能」 |
| `state` | `plan` 计划 / `done` 完成 / `aborted` 中止 |
| `week` | 归属周（ISO 周，如 `2026-W45`） |
| `day` | 最近一次状态变更的日期 |
| `tag` | 可选标签，例如 `warmup`、`crossing-studio`（只用于自己归类，不参与导出分组） |
| `link` | 可选链接，导出时跟在正文后面 |
| `history` | 创建 / 完成 / 中止 / 顺延 / 移动的痕迹，用于追溯因果 |

## 导出规则

- 上周工作 = 该周 `done` 的条目
- 本周工作 = 当前为该周 `plan` 的条目（含顺延进来的）
- 模板：`姓名：…`（设置里填一次，可留空）、`上周工作：`、`本周工作：`，每条一个 `- `
- 「本周」取面板里选中的那一周，上一周即其前一周；面板上的提示文案会说明当前选择对应哪两周。

## 数据与文件

- 数据：`$DSH_HOME/weekly-report/data.json`（默认 `~/.dsh/weekly-report/data.json`），profile 级、跨工作区、重启不丢。面板「设置」里能看到实际路径。
- 导出：设置里的「导出目录」，默认当前工作区下的 `reports/`，文件名 `weekly-<ISO 周>.md`；可填绝对路径。
- 存储是插件自管的 JSON 文件，没有使用框架的 KV domain——profile 里安装的插件解析不到 `@deepseek-ai/dsh-storage-domain`，因此以文件形式落地，行为等价。

## 目录结构

```
index.js          Loader 入口：带 cache-busting 参数加载 lib/impl.js，改 Host 代码后重新激活即生效
lib/impl.js       Host：存储、ISO 周计算、条目操作、两个工具、POST /weekly/api
client.js         面板：sidebar.panellist 图标 + main 面板（key = weekly-report）
cordis.patch.yml  插入 weekly-report 这一行
locale/           meta 标题与描述（zh / en）
icon.svg          插件图标
```

## 开发

```bash
npm run check      # node --check index.js client.js lib/impl.js
```

面板通过同源 `POST /weekly/api` 调 Host，动作：`state / week / add / update / setState / carry / delete / report / write / polish / settings`。面板与工具调用同一套操作实现。

## 已知限制

- 只有中文界面（locale 文件里有中文标题与描述，面板文案目前固定中文）。
- 「AI 检查整理」依赖 Harness 已配置默认模型；没有配置时会提示，不影响手动整理。
- 数据不随工作区走，也不进 git；如果想让周报进版本库，导出目录指向仓库里的某个目录即可。
