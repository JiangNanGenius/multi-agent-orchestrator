"""AgentOrchestrator 配置管理 — 从环境变量加载所有配置。"""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings
from sqlalchemy.engine.url import make_url


class Settings(BaseSettings):
    # ── Postgres ──
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "agentorchestrator"
    postgres_user: str = "agentorchestrator"
    postgres_password: str = "agentorchestrator_secret_change_me"
    database_url_override: str | None = Field(default=None, alias="DATABASE_URL")

    # ── MySQL Event Bus ──
    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_db: str = "agentorchestrator"
    mysql_user: str = "agentorchestrator"
    mysql_password: str = "agentorchestrator_secret_change_me"
    mysql_url_override: str | None = Field(default=None, alias="MYSQL_URL")

    # ── Server ──
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    port: int = 8000
    secret_key: str = "change-me-in-production"
    debug: bool = False

    # ── OpenClaw ──
    openclaw_gateway_url: str = "http://localhost:18789"
    openclaw_bin: str = "openclaw"
    openclaw_project_dir: str | None = None

    # ── Legacy 兼容 ──
    legacy_data_dir: str = "../data"
    legacy_tasks_file: str = "../data/tasks_source.json"

    # ── 调度参数 ──
    stall_threshold_sec: int = 180
    max_dispatch_retry: int = 3
    dispatch_timeout_sec: int = 300
    heartbeat_interval_sec: int = 30
    scheduler_scan_interval_seconds: int = 60

    # ── 上下文窗口管理 ──
    context_window_enabled: bool = True
    context_window_soft_limit_chars: int = 24000
    context_window_hard_limit_chars: int = 32000
    context_window_archive_keep_chars: int = 12000
    context_window_warning_ratio: float = 0.75
    context_window_critical_ratio: float = 0.9
    context_window_archive_dir: str = "../data/context_archive"
    context_window_include_progress_limit: int = 5
    context_window_include_flow_limit: int = 10
    context_window_enable_continuation_hint: bool = True

    # ── 任务工作区与冷热分层 ──
    task_workspace_hot_root: str = "task_workspaces"
    task_workspace_cold_root: str = "cold_task_archives/openclaw_task_archives"
    task_workspace_huge_project_threshold_gb: int = 50
    task_workspace_reactivate_to_hot: bool = True

    # ── 看门狗巡检 ──
    workspace_watchdog_enabled: bool = True
    workspace_watchdog_stale_minutes: int = 30
    workspace_watchdog_missing_file_repair: bool = True
    workspace_watchdog_auto_refresh_mark: bool = True
    workspace_watchdog_feishu_webhook: str = ""

    # ── 消息通知 ──
    notification_enabled: bool = True
    default_dispatch_channel: str = "feishu"
    feishu_report_webhook: str = ""
    feishu_report_enabled: bool = False
    feishu_report_agents: str = "control_center,plan_center,review_center,dispatch_center,watchdog"
    feishu_report_events: str = "task.created,task.state.changed,task.progress.appended,task.workspace.archive.confirmed,task.workspace.reactivated.confirmed,task.watchdog.sync"
    feishu_report_include_summary_only: bool = True
    feishu_report_max_content_chars: int = 1200

    @property
    def database_url(self) -> str:
        if self.database_url_override:
            return self.database_url_override
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def database_url_sync(self) -> str:
        """同步 URL，供 Alembic 使用。"""
        if self.database_url_override:
            url = make_url(self.database_url_override)
            drivername = url.drivername.split("+", 1)[0]
            return str(url.set(drivername=drivername))
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def mysql_url(self) -> str:
        if self.mysql_url_override:
            return self.mysql_url_override
        return (
            f"mysql+aiomysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_db}"
        )

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "env_prefix": "",
        "alias_generator": None,
        "populate_by_name": True,
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
