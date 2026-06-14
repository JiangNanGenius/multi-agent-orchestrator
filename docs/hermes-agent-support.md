# Hermes Agent 并行支持

本仓库仍以 OpenClaw 接入为主线，但最终公开快照也补充了 Hermes Agent 的并行运行入口，方便把现有 Agent 角色提示词复用到另一套 runtime 中做实验或迁移评估。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| [`hermes.example.yaml`](../hermes.example.yaml) | Hermes Agent 的无密钥配置模板 |
| [`configs/hermes/env.example`](../configs/hermes/env.example) | `.env` 示例，只保留变量名，不包含任何真实 token |
| [`install-hermes.sh`](../install-hermes.sh) | 生成 `~/.hermes/config.yaml`、`.env`、`personalities/*.md` 和 `context/AGENTS.md` |
| [`deploy.sh`](../deploy.sh) | 本地部署刷新包装脚本，可选执行 Hermes profile 准备 |

## 快速准备

```bash
# 只准备 ~/.hermes 文件，不自动安装 Hermes Agent
./install-hermes.sh --non-interactive

# 如果本机还没有 hermes 命令，并希望脚本尝试安装
./install-hermes.sh --install
```

脚本会读取本仓库现有的 `agents/*/SOUL.md`，为每个 Agent 生成对应的 Hermes personality 文件：

```text
~/.hermes/personalities/control_center.md
~/.hermes/personalities/plan_center.md
~/.hermes/personalities/code_specialist.md
...
```

全局协作约定会从 `agents/GLOBAL.md` 同步到：

```text
~/.hermes/context/AGENTS.md
```

已有文件默认不会覆盖。如需重新生成，可以加：

```bash
./install-hermes.sh --overwrite
```

## 配置密钥

真实 API key、Bot token、App secret 不应写入仓库。请复制或编辑：

```bash
$EDITOR ~/.hermes/.env
```

常见变量包括：

```env
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENAI_BASE_URL=
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
FEISHU_APP_ID=
FEISHU_APP_SECRET=
```

## 启动

```bash
hermes setup
hermes
hermes gateway start
```

如果需要在保留 OpenClaw 的同时试用 Hermes Agent，请让两套 runtime 使用不同的消息机器人或不同的 channel 绑定，避免同一个入口同时被两套系统接管。

## 与本地部署脚本配合

`deploy.sh` 可以做一次本地刷新，并顺手准备 Hermes profile：

```bash
./deploy.sh --hermes
```

如果还要重启本项目后端栈：

```bash
./deploy.sh --hermes --start
```

这个脚本不会把密钥写入仓库，也不会提交运行态数据。`data`、`logs`、`.pids`、`node_modules`、`.venv` 等路径仍由 `.gitignore` 排除。
