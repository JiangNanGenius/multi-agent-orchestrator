"""
稳定记录点 HTTP API
===================

提供RESTful API接口用于管理稳定记录点。

API端点:
  GET  /api/stable-records          列出记录点
  POST /api/stable-records          创建记录点
  GET  /api/stable-records/{id}     获取单个记录点
  POST /api/stable-records/auto     自动判断创建
  GET  /api/stable-records/rules    列出所有规则
  POST /api/stable-records/rules    添加自定义规则
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

router = APIRouter(prefix="/api/stable-records", tags=["stable-records"])


class StableRecordCreateRequest(BaseModel):
    """创建记录点请求"""
    title: str = Field(..., description="记录点标题")
    status: str = Field(default="稳定运行", description="状态: 稳定运行/测试中/里程碑/热修复/已部署")
    node: str = Field(default="api", description="创建节点/角色")
    reason: str = Field(default="API调用创建", description="保存原因")
    remark: str = Field(default="", description="备注信息")
    task_id: str = Field(default="", description="关联任务ID")
    task_code: str = Field(default="", description="关联任务代号")
    extra_info: Optional[Dict[str, Any]] = Field(default=None, description="额外信息")


class AutoCreateRequest(BaseModel):
    """自动创建请求"""
    task_id: str = Field(..., description="任务ID")
    task_code: Optional[str] = Field(default=None, description="任务代号")
    task_state: Optional[str] = Field(default=None, description="任务状态")
    task_progress: Optional[int] = Field(default=0, description="任务进度 0-100")
    task_title: Optional[str] = Field(default=None, description="任务标题")
    ci_passed: Optional[bool] = Field(default=False, description="CI是否通过")
    test_coverage: Optional[int] = Field(default=0, description="测试覆盖率")
    bug_count: Optional[int] = Field(default=0, description="Bug数量")
    event_type: Optional[str] = Field(default=None, description="事件类型")
    message: Optional[str] = Field(default=None, description="上下文消息")
    manual_request: Optional[bool] = Field(default=False, description="是否人工请求")
    default_title: Optional[str] = Field(default=None, description="默认标题")
    extra_context: Optional[Dict[str, Any]] = Field(default=None, description="额外上下文")


class RuleCreateRequest(BaseModel):
    """创建规则请求"""
    rule_id: str = Field(..., description="规则唯一标识")
    rule_type: str = Field(..., description="规则类型: task_completion/time_interval/quality_threshold/risk_event/manual_request")
    name: str = Field(..., description="规则名称")
    description: Optional[str] = Field(default="", description="规则描述")
    priority: int = Field(default=2, description="优先级: 1=低, 2=中, 3=高")
    threshold: float = Field(default=60.0, description="触发阈值 0-100")
    enabled: bool = Field(default=True, description="是否启用")
    config: Optional[Dict[str, Any]] = Field(default=None, description="规则特定配置")


class APIResponse(BaseModel):
    """通用响应"""
    success: bool
    message: str
    data: Optional[Any] = None


# 懒加载服务
def get_service():
    try:
        from app.services.stable_record_service import StableRecordService
        return StableRecordService()
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"服务初始化失败: {str(e)}")


@router.get("", response_model=APIResponse)
async def list_records(
    limit: int = Query(default=20, description="返回数量"),
    task_id: Optional[str] = Query(default=None, description="按任务ID过滤")
):
    """列出稳定记录点"""
    service = get_service()
    records = service.list_records(limit=limit, task_id=task_id)

    return APIResponse(
        success=True,
        message=f"找到 {len(records)} 个记录点",
        data=[r.to_dict() for r in records]
    )


@router.get("/{record_id}", response_model=APIResponse)
async def get_record(record_id: str):
    """获取单个稳定记录点"""
    service = get_service()
    record = service.get_record(record_id)

    if not record:
        raise HTTPException(status_code=404, detail="记录点不存在")

    return APIResponse(
        success=True,
        message="获取成功",
        data=record.to_dict()
    )


@router.post("", response_model=APIResponse)
async def create_record(request: StableRecordCreateRequest):
    """手动创建稳定记录点"""
    service = get_service()

    record = service.create_record(
        title=request.title,
        status=request.status,
        node=request.node,
        reason=request.reason,
        trigger_rule="manual_api",
        confidence_score=100.0,
        remark=request.remark,
        task_id=request.task_id,
        task_code=request.task_code,
        extra_info=request.extra_info
    )

    return APIResponse(
        success=True,
        message="稳定记录点创建成功",
        data=record.to_dict()
    )


@router.post("/auto", response_model=APIResponse)
async def auto_create(request: AutoCreateRequest):
    """自动判断并创建稳定记录点"""
    service = get_service()

    # 构建上下文
    context = {
        "task_id": request.task_id,
        "task_code": request.task_code or "",
        "task_state": request.task_state or "",
        "task_progress": request.task_progress,
        "task_title": request.task_title or "",
        "ci_passed": request.ci_passed,
        "test_coverage": request.test_coverage,
        "bug_count": request.bug_count,
        "event_type": request.event_type or "",
        "message": request.message or "",
        "manual_request": request.manual_request,
    }

    if request.extra_context:
        context.update(request.extra_context)

    created, record = service.auto_create_if_needed(
        task_id=request.task_id,
        context=context,
        default_title=request.default_title
    )

    if created and record:
        return APIResponse(
            success=True,
            message="自动创建稳定记录点成功",
            data={
                "created": True,
                "record": record.to_dict(),
                "confidence_score": record.confidence_score,
                "trigger_rule": record.trigger_rule
            }
        )
    else:
        # 检查是否达到阈值
        should_create, confidence, rules = service.should_create_record(context)
        return APIResponse(
            success=True,
            message="未达到触发阈值，不需要创建稳定记录点",
            data={
                "created": False,
                "should_create": should_create,
                "confidence_score": round(confidence, 2),
                "triggered_rules": rules
            }
        )


@router.get("/rules", response_model=APIResponse)
async def list_rules():
    """列出所有判断规则"""
    service = get_service()

    rules_data = []
    for rule in service.rules:
        rules_data.append({
            "rule_id": rule.rule_id,
            "rule_type": rule.rule_type,
            "name": rule.name,
            "description": rule.description,
            "priority": rule.priority,
            "threshold": rule.threshold,
            "enabled": rule.enabled,
            "config": rule.config
        })

    return APIResponse(
        success=True,
        message=f"找到 {len(rules_data)} 个规则",
        data=rules_data
    )


@router.post("/rules", response_model=APIResponse)
async def add_rule(request: RuleCreateRequest):
    """添加自定义规则"""
    service = get_service()

    from app.services.stable_record_service import Rule, RuleType, RulePriority

    # 验证规则类型
    try:
        rule_type = RuleType(request.rule_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"无效的规则类型: {request.rule_type}, 可用类型: {[rt.value for rt in RuleType]}"
        )

    # 验证优先级
    if request.priority not in [1, 2, 3]:
        raise HTTPException(status_code=400, detail="优先级必须是 1, 2, 或 3")

    # 验证阈值
    if not 0 <= request.threshold <= 100:
        raise HTTPException(status_code=400, detail="阈值必须在 0-100 之间")

    rule = Rule(
        rule_id=request.rule_id,
        rule_type=rule_type,
        name=request.name,
        description=request.description or "",
        priority=RulePriority(request.priority),
        threshold=request.threshold,
        enabled=request.enabled,
        config=request.config or {}
    )

    service.add_custom_rule(rule)

    return APIResponse(
        success=True,
        message=f"规则 '{request.rule_id}' 添加成功",
        data={
            "rule_id": request.rule_id,
            "rule_type": request.rule_type,
            "name": request.name,
            "priority": request.priority,
            "threshold": request.threshold
        }
    )
