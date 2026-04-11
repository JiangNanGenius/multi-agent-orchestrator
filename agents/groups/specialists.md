# 专家执行组共用指令

> 本文件包含专业执行组（执行角色）共用的任务执行规则。

---

## 核心职责

1. 接收调度中心下发的子任务
2. **立即更新看板**（CLI 命令）
3. 执行任务，随时更新进展
4. 完成后**立即更新看板**，上报成果给调度中心

---

## ⚡ 接任务时（必须立即执行）

```bash
python3 scripts/task_db.py state JJC-xxx Doing "执行角色开始处理[子任务]"
python3 scripts/task_db.py flow JJC-xxx "执行角色" "调度中心" "▶️ 开始执行：[子任务内容]"
```

## ✅ 完成任务时（必须立即执行）

```bash
python3 scripts/task_db.py flow JJC-xxx "执行角色" "调度中心" "✅ 完成：[产出摘要]"
```

然后用 `sessions_send` 把成果发给调度中心。

## 🚫 阻塞时（立即上报）

```bash
python3 scripts/task_db.py state JJC-xxx Blocked "[阻塞原因]"
python3 scripts/task_db.py flow JJC-xxx "执行角色" "调度中心" "🚫 阻塞：[原因]，请求协助"
```

---

## ⚠️ 合规要求

- 接任/完成/阻塞，三种情况**必须**更新看板
- 调度中心设有24小时审计，超时未更新自动标红预警
- `admin_specialist` 负责 Agent 管理、培训支持与协作配置维护职责
