# 发布与升级

这份文档说明怎么发布这个插件，以及面板里的「发现新版本 → 升级」是怎么实现的、有哪些限制。

---

## 一、发布前检查

1. **包名**：`dsh-weekly-log`。发布前确认 npm 上可用：

   ```bash
   npm view dsh-weekly-log version
   ```

   若返回 404 说明可用；若被占用，`package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`client.js` 里的模块 `id` 三处要一起改。

2. **版本号**：`package.json` 的 `version` 与 `CHANGELOG.md` 的对应小节保持一致。

3. **自检**：

   ```bash
   npm run check          # node --check 三个入口文件
   npm pack --dry-run     # 确认打包内容，不应出现 node_modules/.git 等
   ```

4. **本地装一次**（改过包名必须重装）：

   ```bash
   plugin_manager install_bundle  target=<本目录绝对路径>
   ```

---

## 二、发布到 npm

```bash
npm publish
```

`publishConfig.access` 已设为 `public`，`private` 已移除，`prepublishOnly` 会先跑一遍语法检查。

发布物只包含运行所需文件（`index.js`、`client.js`、`lib/impl.js`、`cordis.patch.yml`、`locale/*`、`icon.svg`、`README.md`、`CHANGELOG.md`、`LICENSE`）。

---

## 三、从 npm 安装

发布后用户用 registry 安装：

```
plugin_manager install_bundle  target=dsh-weekly-log
# 或指定版本：target=dsh-weekly-log@0.1.0
```

**注意安装位置**：`link:`（本地目录链接）与 registry 安装是两种位置。Loader 按包位置缓存模块，两者互换必须重启 Harness 才彻底生效——所以「本地链接安装」状态下不能一键升级（见下）。

---

## 四、自动升级

面板「设置」里有版本号与「检查更新」；发现新版本时，页面顶部会出现一条提示条（可「稍后」关掉）。

实现要点：

- 检查：`ctx.get('pluginManager').listVersions('dsh-weekly-log')`，只返回比已安装版本更新的发布，取第一个兼容（`bundle !== false`、非预发布废弃）的版本；结果缓存 10 分钟。
- 升级：`pluginManager.updateBundle(name, version)`。它会先校验目标版本存在、确实声明了 bundle、且兼容当前 DSH，然后用 HMR 卸载旧版、安装新版，**失败会自动回滚**。
- 升级在后台跑，进度写到 `~/.dsh/weekly-report/upgrade-state.json`，面板每 2 秒轮询一次，直到 `phase` 为 `done` / `failed`。

### 什么时候能用

| 安装方式 | 能否一键升级 |
|---|---|
| registry（`dsh-weekly-log@0.1.0`） | ✅ 同一安装位置内换版本，HMR 生效，通常无需重启 |
| `link:` 本地目录 | ❌ 面板会说明原因，需手动改为 registry 安装 |

`canSelfUpgrade=false` 时面板不显示升级按钮，只在设置里给出原因，避免点了没反应。

### 两个实操坑

1. **镜像延迟**：刚发布 1–2 分钟内，安装来源的镜像可能还没有新版本，`updateBundle` 会停在 `step: "check"`。代码里做了退避重试（0s / 15s / 20s），最后一次改用 `https://registry.npmjs.org/`。
2. **升级过程中不要重启 Harness**：升级是「卸载 → 安装 → 应用」，中途重启可能让 profile 处于半应用状态。面板的提示条也会写明这一点。

升级结果里 `application` 为 `applied` 时刷新页面即可；为 `restart-required` 时按提示重启。

### 手动路径

```
plugin_manager remove_bundle  target=dsh-weekly-log
plugin_manager install_bundle target=dsh-weekly-log@<version>
```

---

## 五、进插件市场（可选）

当前构建没有「提交到官方商店」的入口。Discover 页读的是**用户自己添加的索引**（一个 JSON，format 1），所以「上架」= npm 包 + 托管一个 index.json。

最小示例（托管在 HTTPS 上、不要重定向；`icon` 与 index 同源）：

```jsonc
{
  "format": 1,
  "title": { "en": "Weekly report tools", "zh": "周报工具" },
  "plugins": [
    {
      "name": "dsh-weekly-log",
      "title": { "en": "Weekly report list", "zh": "周报清单" },
      "description": { "en": "Log one line at a time, export a week when the report is due." },
      "icon": "icon.svg",
      "author": "姚迟",
      "versions": [
        { "version": "0.1.0", "publishTimestamp": 1794115200, "source": { "type": "npm" } }
      ]
    }
  ]
}
```

用户侧启用市场能力并添加索引：

```
plugin_manager set_bundle  target=@deepseek-ai/dsh-experimental-plugin-market-bundle  enabled=true
```

然后在 Web 的 **Plugins → Discover** 里填入 index 地址。

---

## 六、发布一个版本的流程

1. 改代码，跑 `npm run check`。
2. 更新 `CHANGELOG.md`，`package.json` 的 `version` 递增。
3. `git commit` + `git tag v<version>`。
4. `npm publish`。
5. 已安装的用户在面板里点「检查更新 → 升级」（镜像延迟时多等一两分钟）。
