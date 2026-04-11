# 公开仓库全面检查摘要（2026-04-07）

## 检查结论

本轮全面检查确认：当前公开仓库的“未改干净”问题并不局限于主 README，而是同时存在于多语言 README、贡献说明、安全策略、Issue 模板配置，以及部分对外可见的说明性文档中。

用户指出的典型问题已经得到验证：在 README 中仍能看到旧体系角色代号、旧项目命名、旧仓库链接，以及不适合继续保留在公开版首页的外部账号宣传信息。这些内容会直接影响访客对仓库定位的理解，因此应视为高优先级公开发布问题，而不是“仅内部兼容保留”。

## 高优先级问题分组

| 类别 | 说明 | 典型位置 | 风险判断 |
| --- | --- | --- | --- |
| 旧仓库链接残留 | 仍指向 `cft0808/agentorchestrator` 的 clone、Docker、Issues、Discussions、Security Advisories、Star History 等链接 | `README_EN.md`、`README_JA.md`、`CONTRIBUTING.md`、`SECURITY.md`、`.github/ISSUE_TEMPLATE/config.yml` | 高 |
| 旧项目品牌与对外宣传残留 | 仍以 `AgentOrchestrator` 作为主品牌，保留旧 WeChat 标识、二维码、账号名与宣传收口文案 | `README_EN.md`、`README_JA.md` | 高 |
| 旧角色体系直接对外展示 | README 架构图与角色表仍使用 `Crown Prince / Planning Dept / Review Dept / Dispatch Dept`、三省六部、吏部/礼部等旧体系称谓 | `README_EN.md`、`README_JA.md`、部分 `agents/` 文档 | 高 |
| 公开版定位不一致 | 中文 README 已切换为现代中文架构表述，但英文、日文 README 仍保留旧叙事，导致公开仓库首页与多语言说明不一致 | `README.md`、`README_EN.md`、`README_JA.md` | 高 |
| 可见配置入口未同步 | GitHub 提问入口、文档入口、安全报告入口仍跳旧仓库 | `.github/ISSUE_TEMPLATE/config.yml`、`SECURITY.md`、`CONTRIBUTING.md` | 高 |
| 引用保留与“残留未清理”混杂 | `wanikua/danghuangshang` 与 `cft0808/agentorchestrator` 的来源说明本身应保留，但必须与“运行入口/宣传链接/主品牌文案”分开，不应混为一体 | `README.md`、`PUBLIC_REPO_METADATA.md` | 中 |
| 内部角色模板文档仍是旧体系 | `agents/*/SOUL.md` 与 `agents/groups/*.md` 大量保留三省六部与旧角色代号，若公开访客直接浏览会形成“主文档已现代化、代码人格仍停留旧制”的割裂感 | `agents/` 目录 | 中高 |

## 已核实的代表性问题

### 1. 中文 README

中文 README 的主叙事已经基本切换为现代中文架构，但仍需进一步检查是否存在以下问题：

1. 虽然正文已改为“总控中心 / 规划中心 / 评审中心 / 调度中心 / 专业执行角色”，但若关联文档仍保留旧体系，会造成仓库整体观感不一致。
2. Attribution 中保留对 `wanikua/danghuangshang` 与 `cft0808/agentorchestrator` 的引用是合理的，但必须明确它们属于“来源说明”，不是“当前推荐入口”。

### 2. 英文 README

英文 README 目前仍属于旧版公开宣传文案，问题最集中，包括但不限于：

- 仍使用 `AgentOrchestrator` 作为主项目名。
- 仍使用 `Crown Prince`、`Planning Dept`、`Review Dept`、`Dispatch Dept` 等旧体系角色称谓。
- 仍保留 `docker run -p 7891:7891 cft0808/agentorchestrator`。
- 仍保留 `git clone https://github.com/cft0808/agentorchestrator.git`。
- 仍保留旧 Star History 链接。
- 仍保留 WeChat 二维码、`cft0808` 账号和对外宣传信息。

### 3. 日文 README

日文 README 与英文 README 类似，整体仍是旧版 `AgentOrchestrator` 叙事，属于整篇未完成现代化改写，而不是零星遗留。

### 4. CONTRIBUTING / SECURITY / Issue 模板

这些文件虽不是首页，但会直接影响公开仓库访客操作路径，问题包括：

- `CONTRIBUTING.md` 中 clone 地址和目录名仍为旧仓库。
- `CONTRIBUTING.md` 页尾 Issues / Discussions 仍指向旧仓库。
- `SECURITY.md` 的私密漏洞上报地址仍指向旧仓库 Security Advisories。
- `.github/ISSUE_TEMPLATE/config.yml` 的 Discussions 与文档链接仍指向旧仓库。

## 清理建议优先级

| 优先级 | 建议动作 |
| --- | --- |
| P0 | 重写 `README_EN.md`，移除旧项目品牌、旧仓库入口、WeChat 宣传、旧角色直出文案 |
| P0 | 重写 `README_JA.md`，与中文 README 保持同一公开定位 |
| P0 | 修正 `CONTRIBUTING.md`、`SECURITY.md`、`.github/ISSUE_TEMPLATE/config.yml` 中所有旧仓库链接 |
| P1 | 检查 `dashboard/` 与 `docs/` 中仍会被公开访客直接阅读的文档，统一现代中文架构表述 |
| P1 | 评估 `agents/` 目录是否保留旧制命名：若保留，应在 README 中明确说明其为兼容/历史角色模板；若不保留，则继续统一 |
| P2 | 为公开版增加一份明确的“Source & Attribution / 来源与引用说明”，把“主要引用来源”和“当前仓库官方入口”区分开 |

## 下一步处理策略

下一步应进入集中修订阶段，优先清理所有会直接影响公开访客理解和操作路径的内容。具体顺序建议为：先修正英文 README、日文 README、贡献说明、安全策略和 Issue 模板；再统一其余辅助文档；最后进行一次二次全文扫描并推送。
