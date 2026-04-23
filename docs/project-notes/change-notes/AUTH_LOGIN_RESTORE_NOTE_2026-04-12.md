# 5173 登录弹窗恢复核验记录

- 核验时间：2026-04-12 16:08 GMT+10
- 修复文件：`agentorchestrator/backend/app/api/compat.py`
- 修复内容：将 `/api/auth/status` 从写死返回 `authenticated: true` 改为默认返回未登录状态，并从 `data/auth.json` 读取 `username` 与 `must_change_password`。
- 接口实测：`http://127.0.0.1:38000/api/auth/status` 当前返回：

```json
{"authenticated":false,"mustChangePassword":false,"currentUser":"","username":"admin","ok":true}
```

- 前端实测：`http://127.0.0.1:5173` 已恢复为登录页，页面包含：
  - Username 输入框（默认值 `admin`）
  - Password 输入框
  - `Enter Workspace` 登录按钮

结论：用户指出的问题属实，且现已修复；5173 环境不再因 compat 路由写死登录状态而直接跳过密码登录流程。
