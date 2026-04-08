# 来源引用记录（2026-04-07）

## 1. 引用来源仓库

- 上游参考一：`cft0808/edict`
- 上游参考二：`wanikua/danghuangshang`
- 访问页面：[https://github.com/wanikua/danghuangshang](https://github.com/wanikua/danghuangshang)

## 2. 从页面提取到的明确要求

`wanikua/danghuangshang` 仓库首页公开说明中包含以下要点：

> 本项目是 MIT License，欢迎 PR 贡献、Fork 二次开发。但请注明出处并保留 License。

页面同时出现一段“Originality Notice / 维权声明”，其核心含义是：

1. 该项目作者主张其多 Agent 朝廷化架构设计、角色映射与目录结构具有原创性。
2. 对二次开发、Fork 与共创持开放态度，但强调：
   - **需要注明出处**
   - **需要保留 License**

## 3. 对本次改造的执行要求

在“多Agent智作中枢”改造过程中，需要保证以下事项：

1. 根目录 `LICENSE` 文件保留 MIT License，不删除、不替换为与上游不兼容的许可文本。
2. `README.md` 中新增或保留“来源 / 致谢 / 引用说明”章节。
3. 在改造说明文档中明确写出：
   - 本项目基于 `cft0808/edict` 进行重构与现代化改造；
   - 同时参考了 `wanikua/danghuangshang` 的相关思路与公开仓库内容；
   - 按上游公开说明保留 MIT License 与来源引用。
4. 如界面页脚、关于页、文档页存在许可说明区域，应补充简洁引用语句，而不是仅在代码层保留。
5. 避免把“改名重构”写成完全原创的新项目，文案中应明确“基于开源项目改造”。

## 4. 建议落地文案

### README 建议表述

> 本项目当前版本“多Agent智作中枢”基于开源项目 `cft0808/edict` 进行现代化重构，并参考了 `wanikua/danghuangshang` 的公开实现思路与组织方式。遵循上游项目公开许可要求，保留 MIT License，并在文档中注明来源与致谢信息。

### 关于 / 页脚建议表述

> 基于开源项目改造，保留 MIT License，并感谢 `cft0808/edict` 与 `wanikua/danghuangshang` 社区贡献。

## 5. 注意事项

- “注明出处”不等于只保留 Git 历史；需在可见文档中明确出现来源说明。
- “保留 License”不等于仅保留依赖许可证；需保留项目根级 MIT 许可文本。
- 若后续新增品牌名“多Agent智作中枢”，应将其表述为**现版本产品名**，而不是抹去上游来源。
