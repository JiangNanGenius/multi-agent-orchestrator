# 远程 Skills 快速入门

## 5 分钟体验

### 1. 启动官方服务栈

```bash
# 确保你在项目根目录
./agentorchestrator.sh start
# 查看状态
./agentorchestrator.sh status
```

默认主入口会拉起后端 API 与 worker 栈。若需要联调 React 前端，可另开终端执行 `cd agentorchestrator/frontend && pnpm dev`，浏览器访问 `http://127.0.0.1:35173`。

### 2. 添加远程 Skill（CLI）

```bash
# 为规划中心添加代码审查 skill
python3 scripts/skill_manager.py add-remote \
  --agent plan_center \
  --name code_review \
  --source https://raw.githubusercontent.com/your-org/skills-repo/main/code_review/SKILL.md \
  --description "代码审查能力"

# 输出:
# ⏳ 正在从 https://raw.githubusercontent.com/... 下载...
# ✅ 技能 code_review 已添加到 plan_center
#    路径: /Users/xxx/.openclaw/workspace-plan_center/skills/code_review/SKILL.md
#    大小: 2048 字节
```

### 3. 列出所有远程 Skills

```bash
python3 scripts/skill_manager.py list-remote

# 输出:
# 📋 共 1 个远程 skills：
# 
# Agent       | Skill 名称           | 描述                           | 添加时间
# ------------|----------------------|--------------------------------|----------
# plan_center | code_review          | 代码审查能力                   | 2026-03-02
```

### 4. 查看 API 响应

```bash
curl http://localhost:38000/api/remote-skills-list | jq .

# 输出:
# {
#   "ok": true,
#   "remoteSkills": [
#     {
#       "skillName": "code_review",
#       "agentId": "plan_center",
#       "sourceUrl": "https://raw.githubusercontent.com/...",
#       "description": "代码审查能力",
#       "localPath": "/Users/xxx/.openclaw/workspace-plan_center/skills/code_review/SKILL.md",
#       "addedAt": "2026-03-02T14:30:00Z",
#       "lastUpdated": "2026-03-02T14:30:00Z",
#       "status": "valid"
#     }
#   ],
#   "count": 1,
#   "listedAt": "2026-03-02T14:35:00Z"
# }
```

---

## 常见操作

### 一键导入预置远程 skills 集合

```bash
python3 scripts/skill_manager.py import-official-hub \
  --agents plan_center,review_center,dispatch_center,code_specialist,audit_specialist
```

这会自动为每个 agent 添加：
- **plan_center**: code_review, api_design, doc_generation
- **review_center**: code_review, api_design, security_audit, data_analysis, doc_generation, test_framework
- **dispatch_center**: 与 review_center 类似，用于协调执行侧技能装配
- **code_specialist**: code_review, api_design, test_framework
- **audit_specialist**: code_review, security_audit, test_framework

### 更新某个 Skill 到最新版本

```bash
python3 scripts/skill_manager.py update-remote \
  --agent plan_center \
  --name code_review

# 输出:
# ⏳ 正在从 https://raw.githubusercontent.com/... 下载...
# ✅ 技能 code_review 已添加到 plan_center
# ✅ 技能已更新
#    路径: /Users/xxx/.openclaw/workspace-plan_center/skills/code_review/SKILL.md
#    大小: 2156 字节
```

### 移除某个 Skill

```bash
python3 scripts/skill_manager.py remove-remote \
  --agent plan_center \
  --name code_review

# 输出:
# ✅ 技能 code_review 已从 plan_center 移除
```

---

## 前端界面操作

### 在前端中添加 Remote Skill

1. 若在开发模式下，打开 `http://localhost:35173`；若走后端同源托管，则打开对应部署地址
2. 进入 **技能配置** 面板
3. 点击 **添加远程 Skill** 按钮
4. 填写表单：
   - **Agent**: 从下拉列表选择（如 plan_center）
   - **Skill 名称**: 输入内部 ID 如 `code_review`
   - **远程 URL**: 粘贴可访问的 GitHub Raw / HTTPS 地址，如 `https://raw.githubusercontent.com/your-org/skills-repo/main/code_review/SKILL.md`
   - **中文描述**: 可选，如 `代码审查能力`
5. 点击 **导入** 按钮
6. 等待 1-2 秒，看到 ✅ 成功提示

### 管理已添加的 Skills

在前端界面 → **技能配置** → **远程 Skills** 标签页：

- **查看**: 点击 Skill 名称查看 SKILL.md 内容
- **更新**: 点击 🔄 重新从源 URL 下载最新版本
- **删除**: 点击 ✕ 移除本地副本
- **复制 URL**: 快速分享给他人

---

## 创建自己的 Skill 库

### 目录结构

```
my-skills-hub/
├── code_review/
│   └── SKILL.md          # 代码审查能力
├── api_design/
│   └── SKILL.md          # API 设计审查
├── data_analysis/
│   └── SKILL.md          # 数据分析
└── README.md
```

### SKILL.md 模板

```markdown
---
name: my_custom_skill
description: 简短描述
version: 1.0.0
tags: [tag1, tag2]
---

# Skill 完整名称

详细描述...

## 输入

说明接收什么参数

## 处理流程

具体步骤...

## 输出规范

输出格式说明
```

### 上传到 GitHub

```bash
git init
git add .
git commit -m "Initial commit: my-skills-hub"
git remote add origin https://github.com/yourname/my-skills-hub
git push -u origin main
```

### 导入自己的 Skill

```bash
python3 scripts/skill_manager.py add-remote \
  --agent plan_center \
  --name my_skill \
  --source https://raw.githubusercontent.com/yourname/my-skills-hub/main/my_skill/SKILL.md \
  --description "我的定制技能"
```

---

## API 完整参考

### POST /api/add-remote-skill

默认由统一服务栈对外暴露在 `http://localhost:38000`（或你的部署域名）。

添加远程 skill。

**请求：**
```bash
curl -X POST http://localhost:38000/api/add-remote-skill \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "plan_center",
    "skillName": "code_review",
    "sourceUrl": "https://raw.githubusercontent.com/...",
    "description": "代码审查"
  }'
```

**响应 (200):**
```json
{
  "ok": true,
  "message": "技能 code_review 已从远程源添加到 plan_center",
  "skillName": "code_review",
  "agentId": "plan_center",
  "source": "https://raw.githubusercontent.com/...",
  "localPath": "/Users/xxx/.openclaw/workspace-plan_center/skills/code_review/SKILL.md",
  "size": 2048,
  "addedAt": "2026-03-02T14:30:00Z"
}
```

### GET /api/remote-skills-list

列出所有远程 skills。

```bash
curl http://localhost:38000/api/remote-skills-list
```

**响应:**
```json
{
  "ok": true,
  "remoteSkills": [
    {
      "skillName": "code_review",
      "agentId": "plan_center",
      "sourceUrl": "https://raw.githubusercontent.com/...",
      "description": "代码审查能力",
      "localPath": "/Users/xxx/.openclaw/workspace-plan_center/skills/code_review/SKILL.md",
      "addedAt": "2026-03-02T14:30:00Z",
      "lastUpdated": "2026-03-02T14:30:00Z",
      "status": "valid"
    }
  ],
  "count": 1,
  "listedAt": "2026-03-02T14:35:00Z"
}
```

### POST /api/update-remote-skill

更新远程 skill 为最新版本。

```bash
curl -X POST http://localhost:38000/api/update-remote-skill \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "plan_center",
    "skillName": "code_review"
  }'
```

### DELETE /api/remove-remote-skill

移除远程 skill。

```bash
curl -X POST http://localhost:38000/api/remove-remote-skill \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "plan_center",
    "skillName": "code_review"
  }'
```

---

## 故障排查

### Q: 下载失败，提示 "Connection timeout"

**A:** 检查网络连接和 URL 有效性

```bash
curl -I https://raw.githubusercontent.com/...
# 应该返回 HTTP/1.1 200 OK
```

### Q: 文件格式无效

**A:** 确保 SKILL.md 以 YAML frontmatter 开头

```markdown
---
name: skill_name
description: 描述
---

# 正文开始...
```

### Q: 导入后看不到 Skill

**A:** 刷新看板或检查 Agent 是否配置正确

```bash
# 检查 Agent 是否存在
python3 scripts/skill_manager.py list-remote

# 检查本地文件
ls -la ~/.openclaw/workspace-plan_center/skills/
```

---

## 更多信息

- 📚 [完整指南](remote-skills-guide.md)
- 🏛️ [架构文档](current_architecture_overview.md)
- 🌐 官方技能注册表：<https://clawhub.ai>
- 🤝 [项目贡献](../CONTRIBUTING.md)
