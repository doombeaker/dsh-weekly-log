# Changelog

本文件记录插件每个发布版本的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-08

### Added

- 侧边栏「周报」入口与中央面板：一条一条记录完成 / 计划条目。
- 按 ISO 周翻看任意一周，当前周有品牌色标记；「回到本周」随时跳回。
- 计划项支持完成 / 顺延 / 中止；顺延只改归属周并保留历史痕迹，中止不进周报。
- 导出「上周工作 + 本周工作」的周报正文，可编辑、复制、存成 md。
- 一键用 Harness 默认模型检查整理（措辞、句式、错别字），结果先展示再由用户采用或收起。
- 工具 `weekly_log` 与 `weekly_report`，对话里也能记录与导出。
- 面板内的版本号与更新检查；从 npm 安装时支持一键升级。
