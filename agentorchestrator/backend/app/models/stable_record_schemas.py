"""
稳定记录点数据模型
==================

提供SQLAlchemy ORM模型，用于数据库持久化存储。
同时提供与文件系统的同步机制。
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional, Dict, Any

from sqlalchemy import Column, String, Integer, Float, DateTime, Text, Boolean
from sqlalchemy.dialects.postgresql import JSONB

from app.db import Base


class StableRecordModel(Base):
    """稳定记录点数据库模型"""
    __tablename__ = "stable_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    record_id = Column(String(64), unique=True, index=True, nullable=False, comment="记录点唯一标识")
    title = Column(String(256), nullable=False, comment="记录点标题")
    status = Column(String(64), nullable=False, default="稳定运行", comment="状态: 稳定运行/测试中/里程碑等")
    node = Column(String(128), nullable=False, default="system", comment="创建节点/角色")
    saved_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="保存时间")
    saved_by = Column(String(128), nullable=False, default="auto_service", comment="创建者")
    reason = Column(Text, comment="保存原因")
    trigger_rule = Column(String(256), comment="触发的规则ID，逗号分隔")
    confidence_score = Column(Float, comment="决策置信度 0-100")
    remark = Column(Text, default="", comment="备注信息")
    task_id = Column(String(64), index=True, comment="关联任务ID")
    task_code = Column(String(64), index=True, comment="关联任务代号")
    git_commit = Column(String(64), comment="Git提交哈希")
    git_branch = Column(String(128), comment="Git分支名")
    workspace_path = Column(String(512), comment="工作区路径")
    extra_info = Column(JSONB, default=dict, comment="额外信息JSON")

    # 看板同步状态
    synced_to_kanban = Column(Boolean, default=False, comment="是否已同步到看板")
    synced_at = Column(DateTime, comment="同步到看板的时间")

    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.id,
            "record_id": self.record_id,
            "title": self.title,
            "status": self.status,
            "node": self.node,
            "saved_at": self.saved_at.strftime("%Y-%m-%d %H:%M:%S") if self.saved_at else None,
            "saved_by": self.saved_by,
            "reason": self.reason,
            "trigger_rule": self.trigger_rule,
            "confidence_score": self.confidence_score,
            "remark": self.remark,
            "task_id": self.task_id,
            "task_code": self.task_code,
            "git_commit": self.git_commit,
            "git_branch": self.git_branch,
            "workspace_path": self.workspace_path,
            "extra_info": self.extra_info,
            "synced_to_kanban": self.synced_to_kanban,
            "synced_at": self.synced_at.strftime("%Y-%m-%d %H:%M:%S") if self.synced_at else None,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S") if self.created_at else None,
            "updated_at": self.updated_at.strftime("%Y-%m-%d %H:%M:%S") if self.updated_at else None,
        }

    def to_json(self, indent: int = 2) -> str:
        """转换为JSON字符串"""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    @classmethod
    def from_service_record(cls, record) -> "StableRecordModel":
        """从服务层StableRecord对象创建模型对象"""
        saved_at = datetime.strptime(record.saved_at, "%Y-%m-%d %H:%M:%S") if isinstance(record.saved_at, str) else record.saved_at

        return cls(
            record_id=record.record_id,
            title=record.title,
            status=record.status,
            node=record.node,
            saved_at=saved_at,
            saved_by=record.saved_by,
            reason=record.reason,
            trigger_rule=record.trigger_rule,
            confidence_score=record.confidence_score,
            remark=record.remark,
            task_id=record.task_id,
            task_code=record.task_code,
            git_commit=record.git_commit,
            git_branch=record.git_branch,
            extra_info=record.extra_info or {}
        )


class StableRecordRuleModel(Base):
    """判断规则数据库模型"""
    __tablename__ = "stable_record_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    rule_id = Column(String(64), unique=True, index=True, nullable=False, comment="规则唯一标识")
    rule_type = Column(String(64), nullable=False, comment="规则类型: task_completion/time_interval等")
    name = Column(String(128), nullable=False, comment="规则名称")
    description = Column(Text, comment="规则描述")
    priority = Column(Integer, nullable=False, default=2, comment="优先级: 1=低, 2=中, 3=高")
    threshold = Column(Float, nullable=False, default=60.0, comment="触发阈值 0-100")
    enabled = Column(Boolean, default=True, comment="是否启用")
    config = Column(JSONB, default=dict, comment="规则特定配置JSON")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "rule_id": self.rule_id,
            "rule_type": self.rule_type,
            "name": self.name,
            "description": self.description,
            "priority": self.priority,
            "threshold": self.threshold,
            "enabled": self.enabled,
            "config": self.config,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S") if self.created_at else None,
            "updated_at": self.updated_at.strftime("%Y-%m-%d %H:%M:%S") if self.updated_at else None,
        }
