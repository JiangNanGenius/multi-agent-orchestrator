# agentorchestrator 命名迁移待办（2026-04-11）

- [x] 确认新的统一命名基线为 `agentorchestrator`
- [x] 盘点顶层目录、脚本与服务入口中的 `agentorchestrator` 命名对象
- [ ] 盘点代码中对 `agentorchestrator` 目录、模块路径、日志前缀、PID 文件、Redis 前缀、cookie/localStorage 键名的依赖
- [ ] 制定目录名、脚本名、systemd 服务名与运行时前缀的完整替换映射
- [ ] 执行目录重命名：`agentorchestrator` -> `agentorchestrator`
- [ ] 执行入口重命名：`agentorchestrator.sh` / `agentorchestrator.service` 等
- [ ] 修复所有受影响的代码、部署脚本、安装脚本与文档引用
- [ ] 全仓复核文本内容、文件名、目录名中的 `agentorchestrator` 残留
- [ ] 输出最终迁移交付说明与剩余风险结论
