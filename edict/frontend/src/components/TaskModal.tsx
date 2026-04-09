import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore, getPipeStatus, deptColor, stateLabel, STATE_LABEL, normalizeDeptLabel, normalizeFlowRemark } from '../store';
import { api } from '../api';
import type {
  Task,
  TaskActivityData,
  SchedulerStateData,
  SchedulerInfo,
  ActivityEntry,
  TodoItem,
  PhaseDuration,
  CollabAgentBusyEntry,
} from '../api';

const AGENT_LABELS: Record<string, string> = {
  main: '总览协调',
  control_center: '总览协调',
  plan_center: '方案整理',
  review_center: '结果检查',
  dispatch_center: '安排处理',
  code_specialist: '功能助手',
  deploy_specialist: '上线助手',
  data_specialist: '数据助手',
  docs_specialist: '内容助手',
  audit_specialist: '核对助手',
  admin_specialist: '功能整理助手',
  search_specialist: '搜索助手',
};

const NEXT_LABELS: Record<string, string> = {
  ControlCenter: '转入方案整理',
  PlanCenter: '转入结果检查',
  ReviewCenter: '转入安排处理',
  Assigned: '开始处理',
  Doing: '进入结果整理',
  Review: '完成交付',
};

function fmtStalled(sec: number): string {
  const v = Math.max(0, sec);
  if (v < 60) return `${v}秒`;
  if (v < 3600) return `${Math.floor(v / 60)}分${v % 60}秒`;
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  return `${h}小时${m}分`;
}

function fmtActivityTime(ts: number | string | undefined): string {
  if (!ts) return '';
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }
  if (typeof ts === 'string' && ts.length >= 19) return ts.substring(11, 19);
  return String(ts).substring(0, 8);
}

function fmtDateTime(ts?: string): string {
  if (!ts) return '—';
  return ts.replace('T', ' ').substring(0, 19);
}

function shortText(text?: string, max = 140): string {
  if (!text) return '—';
  const clean = String(text).trim();
  if (!clean) return '—';
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function toneColor(status?: string): string {
  const value = (status || '').toLowerCase();
  if (['ok', 'healthy', 'active', 'hot', 'reported', 'success'].includes(value)) return '#22c55e';
  if (['warn', 'warning', 'stale', 'recommended', 'cold', 'archived', 'pending'].includes(value)) return '#f59e0b';
  if (['error', 'failed', 'disabled', 'blocked'].includes(value)) return '#ef4444';
  return '#94a3b8';
}

function buildSchedulerForm(scheduler?: SchedulerInfo | null): Required<Pick<SchedulerInfo, 'enabled' | 'stallThresholdSec' | 'maxRetry' | 'autoRollback' | 'maxRollback'>> {
  return {
    enabled: scheduler?.enabled !== false,
    stallThresholdSec: Math.max(60, Number(scheduler?.stallThresholdSec || 600)),
    maxRetry: Math.max(0, Number(scheduler?.maxRetry ?? scheduler?.retryCount ?? 2)),
    autoRollback: scheduler?.autoRollback !== false,
    maxRollback: Math.max(0, Number(scheduler?.maxRollback ?? 3)),
  };
}

function isAutomationFlowRemark(remark: string): boolean {
  return remark.includes('自动') || remark.includes('重试') || remark.includes('升级') || remark.includes('恢复') || remark.includes('安排');
}

function renderBusyOrigin(entry: CollabAgentBusyEntry): string {
  const kind = entry.occupancy_kind || entry.source_type || '';
  if (kind === 'task_active') return '任务执行中';
  if (kind === 'task_reserved') return '任务预占中';
  if (kind === 'task_paused') return '任务暂停中';
  if (kind === 'task_blocked') return '任务阻塞中';
  if (kind === 'meeting') return '协作处理中';
  if (kind === 'chat') return '讨论占用中';
  return entry.label || '忙碌中';
}

export default function TaskModal() {
  const modalTaskId = useStore((s) => s.modalTaskId);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const liveStatus = useStore((s) => s.liveStatus);
  const loadAll = useStore((s) => s.loadAll);
  const toast = useStore((s) => s.toast);
  const collabAgentBusyData = useStore((s) => s.collabAgentBusyData);

  const [activityData, setActivityData] = useState<TaskActivityData | null>(null);
  const [schedData, setSchedData] = useState<SchedulerStateData | null>(null);
  const [schedForm, setSchedForm] = useState(buildSchedulerForm());
  const [schedDirty, setSchedDirty] = useState(false);
  const [schedSaving, setSchedSaving] = useState(false);
  const laTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const task = liveStatus?.tasks?.find((t) => t.id === modalTaskId) || null;

  const fetchActivity = useCallback(async () => {
    if (!modalTaskId) return;
    try {
      const d = await api.taskActivity(modalTaskId);
      setActivityData(d);
    } catch {
      setActivityData(null);
    }
  }, [modalTaskId]);

  const fetchSched = useCallback(async () => {
    if (!modalTaskId) return;
    try {
      const d = await api.schedulerState(modalTaskId);
      setSchedData(d);
    } catch {
      setSchedData(null);
    }
  }, [modalTaskId]);

  useEffect(() => {
    if (!modalTaskId || !task) return;
    fetchActivity();
    fetchSched();

    const isDone = ['Done', 'Cancelled'].includes(task.state);
    if (!isDone) {
      laTimerRef.current = setInterval(() => {
        fetchActivity();
        fetchSched();
      }, 4000);
    }

    return () => {
      if (laTimerRef.current) {
        clearInterval(laTimerRef.current);
        laTimerRef.current = null;
      }
    };
  }, [modalTaskId, task?.state, fetchActivity, fetchSched]);

  // scroll log on new entries
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activityData?.activity?.length]);

  useEffect(() => {
    if (!schedDirty) {
      setSchedForm(buildSchedulerForm(schedData?.scheduler));
    }
  }, [schedData, schedDirty]);

  useEffect(() => {
    setSchedDirty(false);
  }, [modalTaskId]);

  if (!modalTaskId || !task) return null;

  const close = () => setModalTaskId(null);

  const stages = getPipeStatus(task);
  const activeStage = stages.find((s) => s.status === 'active');
  const hb = task.heartbeat || { status: 'unknown' as const, label: '⚪ 无数据' };
  const flowLog = task.flow_log || [];
  const automationFlow = flowLog.filter((fl) => isAutomationFlowRemark(fl.remark || '')).slice().reverse();
  const todos = task.todos || [];
  const todoDone = todos.filter((x) => x.status === 'completed').length;
  const todoTotal = todos.length;
  const canStop = !['Done', 'Blocked', 'Cancelled'].includes(task.state);
  const canResume = ['Blocked', 'Cancelled'].includes(task.state);
  const taskBusyEntries = (collabAgentBusyData?.busy || []).filter((entry) => entry.task_id === task.id);
  const crossBusyEntries = (collabAgentBusyData?.busy || []).filter((entry) => entry.agent_id && entry.task_id !== task.id && entry.source_type !== 'task');
  const workspace = task.workspace || {};
  const taskPolicy = task.workspaceTaskPolicy || workspace.task_policy || {};
  const refreshState = task.workspaceNewRefresh || workspace.new_refresh || {};
  const watchdog = task.workspaceWatchdog || workspace.watchdog || {};
  const notifications = task.workspaceNotifications || workspace.notifications || [];
  const riskControl = task.workspaceRiskControl || workspace.risk_control || {};
  const feishuReporting = task.workspaceFeishuReporting || workspace.feishu_reporting || {};
  const linkedTasks = task.workspaceLinkedTasks || workspace.linked_tasks || [];
  const unreadNotifications = notifications.filter((item) => !item.read).length;
  const workspacePath = task.workspaceActualPath || workspace.actual_workspace_path || task.workspacePath || workspace.path || '';
  const archiveStatus = task.workspaceArchiveStatus || workspace.archive_status || 'hot';
  const coldArchivePath = task.workspaceColdArchivePath || workspace.cold_archive_path || '';
  const reactivationTargetPath = task.workspaceReactivationTargetPath || workspace.reactivation_target_path || '';
  const archiveTone = String(archiveStatus || '').toLowerCase();
  const isColdArchived = archiveTone.includes('cold') || archiveTone.includes('archive') || !!coldArchivePath;
  const refreshRecommended = !!(task.workspaceRefreshRecommended || workspace.refresh_recommended || refreshState.recommended);
  const summaryText = task.workspaceLatestSummary || workspace.latest_summary || refreshState.latest_summary_excerpt || '';
  const handoffText = task.workspaceLatestHandoff || workspace.latest_handoff || refreshState.latest_handoff_excerpt || '';
  const workspaceFiles = [
    { label: 'README', path: task.workspaceReadmePath || workspace.readme_path || '' },
    { label: 'TODO', path: task.workspaceTodoPath || workspace.todo_path || '' },
    { label: 'TASK_RECORD', path: task.workspaceTaskRecordPath || workspace.taskrecord_path || '' },
    { label: 'HANDOFF', path: task.workspaceHandoffPath || workspace.handoff_path || '' },
    { label: 'LINKS', path: task.workspaceLinksPath || workspace.links_path || '' },
    { label: 'STATUS', path: task.workspaceStatusPath || workspace.status_path || '' },
    { label: 'latest_context', path: workspace.context_latest_path || '' },
    { label: 'resume_export', path: workspace.resume_export_path || '' },
  ].filter((item) => item.path);
  const workspaceDirectories = [
    { label: 'ledger', path: workspace.ledger_dir || '' },
    { label: 'context', path: workspace.context_dir || '' },
    { label: 'snapshots', path: workspace.snapshots_dir || '' },
    { label: 'exports', path: workspace.exports_dir || '' },
    { label: 'artifacts', path: workspace.artifacts_dir || '' },
    { label: 'agent_notes', path: workspace.agent_notes_dir || '' },
  ].filter((item) => item.path);

  const copyWorkspaceValue = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast(`已复制${label}路径`, 'ok');
    } catch {
      toast(`复制${label}路径失败`, 'err');
    }
  };

  const handleWorkspaceArchive = async () => {
    if (!confirm(`确定将 ${task.id} 的工作区迁入冷归档吗？`)) return;
    try {
      const r = await api.archiveWorkspace(task.id);
      if (r.ok) {
        toast(r.message || '任务工作区已迁入冷归档', 'ok');
        await fetchActivity();
        await fetchSched();
        loadAll();
      } else {
        toast(r.error || '冷归档失败', 'err');
      }
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    }
  };

  const handleWorkspaceReactivate = async () => {
    if (!confirm(`确定重新激活 ${task.id} 的工作区并回迁到热盘吗？`)) return;
    try {
      const r = await api.reactivateWorkspace(task.id, true);
      if (r.ok) {
        toast(r.message || '任务工作区已重新激活', 'ok');
        await fetchActivity();
        await fetchSched();
        loadAll();
      } else {
        toast(r.error || '重新激活失败', 'err');
      }
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    }
  };

  const handleCreateWorkspaceNotification = async () => {
    const title = prompt('请输入通知标题：', `任务 ${task.id} 提醒`);
    if (title === null) return;
    const message = prompt('请输入通知内容：', task.title || '请关注当前任务状态变化');
    if (message === null) return;
    try {
      const r = await api.createWorkspaceNotification(task.id, {
        title: title || `任务 ${task.id} 提醒`,
        message: message || '请关注当前任务状态变化',
        source: 'dashboard',
        kind: 'board_notice',
        severity: 'info',
      });
      if (r.ok) {
        toast(r.message || '已写入工作区通知', 'ok');
        await fetchActivity();
        await fetchSched();
        loadAll();
      } else {
        toast(r.error || '通知写入失败', 'err');
      }
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    }
  };

  const handleRiskDecision = async (approvalStatus: 'approved' | 'rejected') => {
    const label = approvalStatus === 'approved' ? '通过' : '拒绝';
    const reason = prompt(`请输入${label}原因：`, riskControl.summary || '');
    if (reason === null) return;
    try {
      const r = await api.updateWorkspaceRiskControl(task.id, {
        status: approvalStatus === 'approved' ? 'approved' : (riskControl.status || 'blocked'),
        level: riskControl.level || 'high',
        summary: riskControl.summary || '高风险操作待确认',
        requested_by: riskControl.requested_by || 'unknown',
        requires_user_confirmation: false,
        confirmation_channel: riskControl.confirmation_channel || 'dashboard',
        approval_status: approvalStatus,
        approval_reason: reason || `${label}风险操作`,
        approved_by: 'dashboard',
        operations: Array.isArray(riskControl.operations) ? riskControl.operations : [],
      });
      if (r.ok) {
        toast(r.message || `已${label}风险操作请求`, 'ok');
        await fetchActivity();
        await fetchSched();
        loadAll();
      } else {
        toast(r.error || `${label}失败`, 'err');
      }
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    }
  };

  const doTaskAction = async (action: string, reason: string) => {
    try {
      const r = await api.taskAction(task.id, action, reason);
      if (r.ok) {
        toast(r.message || '操作成功', 'ok');
        loadAll();
        close();
      } else {
        toast(r.error || '操作失败', 'err');
      }
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    }
  };

  const doReview = async (action: string) => {
    const labels: Record<string, string> = { approve: '通过', reject: '退回' };
    const comment = prompt(`${labels[action]} ${task.id}\n\n请输入批注（可留空）：`);
    if (comment === null) return;
    try {
      const r = await api.reviewAction(task.id, action, comment || '');
      if (r.ok) {
        toast(`✅ ${task.id} 已${labels[action]}`, 'ok');
        loadAll();
        close();
      } else {
        toast(r.error || '操作失败', 'err');
      }
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    }
  };

  const doAdvance = async () => {
    const next = NEXT_LABELS[task.state] || '下一步';
    const comment = prompt(`⏩ 手动推进 ${task.id}\n当前: ${task.state} → 下一步: ${next}\n\n请输入说明（可留空）：`);
    if (comment === null) return;
    try {
      const r = await api.advanceState(task.id, comment || '');
      if (r.ok) {
        toast(`⏩ ${r.message}`, 'ok');
        loadAll();
        close();
      } else {
        toast(r.error || '推进失败', 'err');
      }
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    }
  };

  const doSchedAction = async (action: string) => {
    if (action === 'scan') {
      try {
        const r = await api.schedulerScan(180);
        if (r.ok) toast(`🔍 扫描完成：${r.count || 0} 个动作`, 'ok');
        else toast(r.error || '扫描失败', 'err');
        fetchSched();
      } catch {
        toast('当前连接失败，请稍后再试', 'err');
      }
      return;
    }
    const labels: Record<string, string> = { retry: '重试', escalate: '加强协助', rollback: '恢复' };
    const reason = prompt(`请输入${labels[action]}原因（可留空）：`);
    if (reason === null) return;
    const handlers: Record<string, (id: string, r: string) => Promise<{ ok: boolean; message?: string; error?: string }>> = {
      retry: api.schedulerRetry,
      escalate: api.schedulerEscalate,
      rollback: api.schedulerRollback,
    };
    try {
      const r = await handlers[action](task.id, reason);
      if (r.ok) toast(r.message || '操作成功', 'ok');
      else toast(r.error || '操作失败', 'err');
      fetchSched();
      loadAll();
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    }
  };

  const handleSchedField = (key: keyof typeof schedForm, value: boolean | number) => {
    setSchedDirty(true);
    setSchedForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveSchedConfig = async () => {
    setSchedSaving(true);
    try {
      const payload: SchedulerInfo = {
        enabled: !!schedForm.enabled,
        stallThresholdSec: Math.max(60, Number(schedForm.stallThresholdSec || 600)),
        maxRetry: Math.max(0, Number(schedForm.maxRetry || 0)),
        autoRollback: !!schedForm.autoRollback,
        maxRollback: Math.max(0, Number(schedForm.maxRollback || 0)),
      };
      const r = await api.schedulerConfig(task.id, payload);
      if (r.ok) {
        toast(r.message || '自动处理设置已保存', 'ok');
        setSchedDirty(false);
        await fetchSched();
        loadAll();
      } else {
        toast(r.error || '保存失败', 'err');
      }
    } catch {
      toast('当前连接失败，请稍后再试', 'err');
    } finally {
      setSchedSaving(false);
    }
  };

  const resetSchedForm = () => {
    setSchedDirty(false);
    setSchedForm(buildSchedulerForm(schedData?.scheduler));
  };

  const handleStop = () => {
    const reason = prompt('请输入叫停原因（可留空）：');
    if (reason === null) return;
    doTaskAction('stop', reason);
  };

  const handleCancel = () => {
    if (!confirm(`确定要取消 ${task.id} 吗？`)) return;
    const reason = prompt('请输入取消原因（可留空）：');
    if (reason === null) return;
    doTaskAction('cancel', reason);
  };

  // Scheduler state
  const sched = schedData?.scheduler;
  const stalledSec = schedData?.stalledSec || 0;

  return (
    <div className="modal-bg open" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close}>✕</button>
        <div className="modal-body">
          <div className="modal-id">{task.id}</div>
          <div className="modal-title">{task.title || '(无标题)'}</div>

          {/* Current Stage Banner */}
          {activeStage && (
            <div className="cur-stage">
              <div className="cs-icon">{activeStage.icon}</div>
              <div className="cs-info">
                <div className="cs-dept" style={{ color: deptColor(activeStage.dept) }}>{activeStage.dept}</div>
                <div className="cs-action">当前环节：{activeStage.action}</div>
              </div>
              <span className={`hb ${hb.status} cs-hb`}>{hb.label}</span>
            </div>
          )}

          {/* Pipeline */}
          <div className="m-pipe">
            {stages.map((s, i) => (
              <div className="mp-stage" key={s.key}>
                <div className={`mp-node ${s.status}`}>
                  {s.status === 'done' && <div className="mp-done-tick">✓</div>}
                  <div className="mp-icon">{s.icon}</div>
                  <div className="mp-dept" style={s.status === 'active' ? { color: 'var(--acc)' } : s.status === 'done' ? { color: 'var(--ok)' } : {}}>
                    {s.dept}
                  </div>
                  <div className="mp-action">{s.action}</div>
                </div>
                {i < stages.length - 1 && (
                  <div className="mp-arrow" style={s.status === 'done' ? { color: 'var(--ok)', opacity: 0.6 } : {}}>→</div>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            当前流程会根据这条任务的实际流转动态生成；如遇回退、补充步骤、改派、重试或升级，链路会随之更新。
          </div>

          {/* Action Buttons */}
          <div className="task-actions">
            {canStop && (
              <>
                <button className="btn-action btn-stop" onClick={handleStop}>⏸ 叫停任务</button>
                <button className="btn-action btn-cancel" onClick={handleCancel}>🚫 取消任务</button>
              </>
            )}
            {canResume && (
              <button className="btn-action btn-resume" onClick={() => doTaskAction('resume', '恢复执行')}>▶️ 恢复执行</button>
            )}
            {['Review', 'ReviewCenter'].includes(task.state) && (
              <>
                <button className="btn-action" style={{ background: '#2ecc8a22', color: '#2ecc8a', border: '1px solid #2ecc8a44' }} onClick={() => doReview('approve')}>✅ 通过评审</button>
                <button className="btn-action" style={{ background: '#ff527022', color: '#ff5270', border: '1px solid #ff527044' }} onClick={() => doReview('reject')}>🚫 退回修订</button>
              </>
            )}
            {['Pending', 'ControlCenter', 'PlanCenter', 'ReviewCenter', 'Assigned', 'Doing', 'Review', 'Next'].includes(task.state) && (
              <button className="btn-action" style={{ background: '#7c5cfc18', color: '#7c5cfc', border: '1px solid #7c5cfc44' }} onClick={doAdvance}>⏩ 推进到下一步</button>
            )}
          </div>

          {(taskBusyEntries.length > 0 || crossBusyEntries.length > 0) && (
            <div style={{ marginTop: 14, marginBottom: 10, display: 'grid', gap: 8 }}>
              {taskBusyEntries.length > 0 && (
                <div style={{ border: '1px solid #4cc38a44', background: '#0f2219', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, color: '#67e8a5' }}>当前任务占用情况</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {taskBusyEntries.map((entry) => (
                      <div key={`${entry.agent_id}-${entry.updated_at}`} style={{ minWidth: 160, border: '1px solid #4cc38a33', borderRadius: 12, padding: '8px 10px', background: '#10271d' }}>
                        <div style={{ fontWeight: 700 }}>{entry.emoji} {entry.name}</div>
                        <div style={{ fontSize: 12, color: '#67e8a5', marginTop: 4 }}>{renderBusyOrigin(entry)}</div>
                        {entry.reason && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{entry.reason}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {crossBusyEntries.length > 0 && (
                <div style={{ border: '1px solid #6b728044', background: '#141821', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>成员忙碌提醒</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    当前仍有 {crossBusyEntries.length} 位成员正忙于讨论或其他事项；如需临时发起沟通或重新安排，可优先避开这些成员。
                  </div>
                </div>
              )}
            </div>
          )}

          {(task.taskCode || workspacePath || refreshRecommended || task.workspaceTaskKind || linkedTasks.length > 0 || summaryText || handoffText || watchdog.status || notifications.length > 0 || riskControl.status || feishuReporting.enabled) && (
            <div className="m-section" style={{ marginTop: 14 }}>
              <div className="m-sec-label">任务工作区与续接信息</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>任务代号</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>{task.taskCode || workspace.task_code || '—'}</div>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>任务策略</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>{task.workspaceTaskKind || workspace.task_kind || (taskPolicy.lightweight ? 'lightweight' : 'standard')}</div>
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>{taskPolicy.archive_strategy || taskPolicy.mode || taskPolicy.reactivation_mode || '按标准工作区策略处理'}</div>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>存储位置</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>{task.workspaceStorageTier || workspace.storage_tier || 'hot'} / {task.workspaceProcessingLocation || workspace.processing_location || 'hot'}</div>
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>归档：{archiveStatus}</div>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>/new 建议</div>
                  <div style={{ marginTop: 4, fontWeight: 700, color: refreshRecommended ? '#f59e0b' : '#22c55e' }}>{refreshRecommended ? '建议新开续接' : '当前可直接续接'}</div>
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>{refreshState.reason || refreshState.trigger || '根据上下文窗口、待办和日志规模综合判断'}</div>
                </div>
              </div>

              {workspacePath && (
                <div className="m-row" style={{ gridTemplateColumns: '84px 1fr auto', marginBottom: 10, alignItems: 'start' }}>
                  <div className="mr-label">工作区路径</div>
                  <div className="mr-val"><code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{workspacePath}</code></div>
                  <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={() => copyWorkspaceValue(workspacePath, '工作区')}>复制</button>
                </div>
              )}

              {(workspacePath || coldArchivePath || reactivationTargetPath) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {!isColdArchived && workspacePath && (
                    <button className="sched-btn" style={{ padding: '8px 12px' }} onClick={handleWorkspaceArchive}>📦 冷归档工作区</button>
                  )}
                  {(isColdArchived || reactivationTargetPath) && (
                    <button className="sched-btn" style={{ padding: '8px 12px' }} onClick={handleWorkspaceReactivate}>♻️ 重新激活到热盘</button>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>
                    {isColdArchived ? '当前任务已具备冷归档/回迁条件，可直接发起重新激活。' : '可将当前工作区迁入冷归档；后续需要时再回迁到热盘继续处理。'}
                  </div>
                </div>
              )}

              {(workspaceFiles.length > 0 || workspaceDirectories.length > 0 || coldArchivePath || reactivationTargetPath) && (
                <div style={{ display: 'grid', gap: 10, marginBottom: 10 }}>
                  {workspaceFiles.length > 0 && (
                    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>工作区文件入口</div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {workspaceFiles.map((item) => (
                          <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8, alignItems: 'center' }}>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.label}</div>
                            <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}>{item.path}</code>
                            <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={() => copyWorkspaceValue(item.path, item.label)}>复制</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(workspaceDirectories.length > 0 || coldArchivePath || reactivationTargetPath) && (
                    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>账本与归档入口</div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {workspaceDirectories.map((item) => (
                          <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8, alignItems: 'center' }}>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.label}</div>
                            <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}>{item.path}</code>
                            <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={() => copyWorkspaceValue(item.path, item.label)}>复制</button>
                          </div>
                        ))}
                        {coldArchivePath && (
                          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8, alignItems: 'center' }}>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>cold_archive</div>
                            <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}>{coldArchivePath}</code>
                            <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={() => copyWorkspaceValue(coldArchivePath, '冷归档')}>复制</button>
                          </div>
                        )}
                        {reactivationTargetPath && (
                          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8, alignItems: 'center' }}>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>reactivation</div>
                            <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}>{reactivationTargetPath}</code>
                            <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={() => copyWorkspaceValue(reactivationTargetPath, '回迁目标')}>复制</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 10 }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>看门狗状态</div>
                    <span style={{ fontSize: 11, color: toneColor(watchdog.status), fontWeight: 700 }}>{watchdog.status || 'unknown'}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    上次巡检：{fmtDateTime(watchdog.last_scan_at)}
                    <br />
                    建议动作：{watchdog.recommended_action || '—'}
                    <br />
                    原因：{watchdog.reason || watchdog.note || '—'}
                  </div>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>工作区通知</div>
                    <span style={{ fontSize: 11, color: unreadNotifications > 0 ? '#f59e0b' : toneColor(notifications.length ? 'ok' : 'pending'), fontWeight: 700 }}>
                      {notifications.length ? `${notifications.length} 条 / 未读 ${unreadNotifications}` : '暂无通知'}
                    </span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    最新来源：{notifications[0]?.source || '—'}
                    <br />
                    最近通知：{notifications[0]?.created_at ? fmtDateTime(notifications[0]?.created_at) : '—'}
                    <br />
                    摘要：{shortText(notifications[0]?.title || notifications[0]?.message || '当前暂无工作区通知', 80)}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={handleCreateWorkspaceNotification}>发送提醒</button>
                  </div>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>风险确认链路</div>
                    <span style={{ fontSize: 11, color: toneColor(riskControl.approval_status || riskControl.status || 'pending'), fontWeight: 700 }}>{riskControl.approval_status || riskControl.status || 'not-set'}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    风险级别：{riskControl.level || '—'}
                    <br />
                    请求方：{riskControl.requested_by || '—'}
                    <br />
                    摘要：{shortText(riskControl.summary || '暂无待确认风险操作', 80)}
                  </div>
                  {riskControl.requires_user_confirmation && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      <button className="sched-btn warn" onClick={() => handleRiskDecision('approved')}>通过确认</button>
                      <button className="sched-btn danger" onClick={() => handleRiskDecision('rejected')}>拒绝执行</button>
                    </div>
                  )}
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>飞书汇报</div>
                    <span style={{ fontSize: 11, color: toneColor(feishuReporting.last_report_status || (feishuReporting.enabled ? 'enabled' : 'disabled')), fontWeight: 700 }}>{feishuReporting.last_report_status || (feishuReporting.enabled ? 'enabled' : 'disabled')}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    节点：{feishuReporting.last_report_stage || '—'}
                    <br />
                    最近汇报：{fmtDateTime(feishuReporting.last_report_at)}
                    <br />
                    结果：{shortText(feishuReporting.last_report_message || (feishuReporting.webhook_configured ? '已配置 webhook' : '未配置 webhook'), 80)}
                  </div>
                </div>
              </div>

              {notifications.length > 0 && (
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)', marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>通知明细</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {notifications.slice(0, 4).map((item, index) => (
                      <div key={`${item.id || item.created_at || 'notice'}-${index}`} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: 12 }}>{item.title || item.kind || '通知'}</div>
                          <span style={{ fontSize: 11, color: toneColor(item.severity || (item.read ? 'ok' : 'warning')) }}>{item.severity || (item.read ? '已读' : '未读')}</span>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{shortText(item.message, 180)}</div>
                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>{item.source || 'system'} · {fmtDateTime(item.created_at)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(summaryText || handoffText) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 10 }}>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>最新摘要</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>{shortText(summaryText, 220)}</div>
                  </div>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>续接提示</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>{shortText(handoffText, 220)}</div>
                  </div>
                </div>
              )}

              {(refreshState.updated_at || typeof refreshState.pending_todo_count === 'number' || typeof refreshState.progress_log_entries === 'number' || linkedTasks.length > 0) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>续接判断信号</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                      更新时间：{fmtDateTime(refreshState.updated_at)}
                      <br />
                      待开始 / 进行中 / 已完成：{refreshState.pending_todo_count ?? '—'} / {refreshState.in_progress_todo_count ?? '—'} / {refreshState.completed_todo_count ?? '—'}
                      <br />
                      进展日志 / 流转日志：{refreshState.progress_log_entries ?? '—'} / {refreshState.flow_log_entries ?? '—'}
                    </div>
                  </div>
                  {linkedTasks.length > 0 && (
                    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>关联任务</div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {linkedTasks.slice(0, 4).map((item, index) => (
                          <div key={`${item.task_id || item.task_code || item.title || 'linked'}-${index}`} style={{ fontSize: 12, color: 'var(--muted)' }}>
                            <strong style={{ color: 'var(--text)' }}>{item.task_code || item.task_id || '未命名任务'}</strong>
                            <span style={{ margin: '0 6px', color: 'var(--muted)' }}>·</span>
                            <span>{item.relation || '关联'}</span>
                            {item.title && <span style={{ marginLeft: 6 }}>— {item.title}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Scheduler state */}
          <div className="sched-section">
            <div className="sched-head">
              <span className="sched-title">🧭 自动处理设置</span>
              <span className="sched-status">
                {sched ? `${sched.enabled === false ? '未开启' : '已开启'} · 阈值 ${sched.stallThresholdSec || 180} 秒` : '加载中...'}
              </span>
            </div>
            <div className="sched-grid">
              <div className="sched-kpi"><div className="k">停滞时长</div><div className="v">{fmtStalled(stalledSec)}</div></div>
              <div className="sched-kpi"><div className="k">重试次数</div><div className="v">{sched?.retryCount || 0}/{sched?.maxRetry ?? '—'}</div></div>
                  <div className="sched-kpi"><div className="k">协助等级</div><div className="v">{!sched?.escalationLevel ? '常规' : sched.escalationLevel === 1 ? '加强核对' : '进一步协助'}</div></div>
                  <div className="sched-kpi"><div className="k">当前处理状态</div><div className="v">{sched?.lastDispatchStatus || '待处理'}</div></div>
            </div>
            {sched && (
              <div className="sched-line">
                {sched.lastProgressAt && <span>最近进展 {(sched.lastProgressAt || '').replace('T', ' ').substring(0, 19)}</span>}
                {sched.lastDispatchAt && <span>最近安排 {(sched.lastDispatchAt || '').replace('T', ' ').substring(0, 19)}</span>}
                <span>自动恢复 {sched.autoRollback === false ? '关闭' : '开启'}</span>
                <span>最多恢复 {sched.maxRollback ?? 3} 次</span>
                {sched.lastDispatchAgent && <span>当前由 {normalizeDeptLabel(AGENT_LABELS[sched.lastDispatchAgent] || sched.lastDispatchAgent)} 处理</span>}
              </div>
            )}
            <div className="sched-form">
              <div className="sched-form-grid">
                <label className="sched-field sched-switch">
                  <span className="sched-field-top">
                    <span className="sched-label">启用自动处理</span>
                    <input type="checkbox" checked={!!schedForm.enabled} onChange={(e) => handleSchedField('enabled', e.target.checked)} />
                  </span>
                  <span className="sched-help">关闭后，当前任务将跳过自动检查、自动重试与自动提升关注。</span>
                </label>
                <label className="sched-field sched-switch">
                  <span className="sched-field-top">
                    <span className="sched-label">自动恢复</span>
                    <input type="checkbox" checked={!!schedForm.autoRollback} onChange={(e) => handleSchedField('autoRollback', e.target.checked)} />
                  </span>
                  <span className="sched-help">当事项多次停滞后，允许系统恢复到最近稳定状态。</span>
                </label>
                <label className="sched-field">
                  <span className="sched-label">停滞阈值（秒）</span>
                  <input className="sched-input" type="number" min={60} step={60} value={schedForm.stallThresholdSec} onChange={(e) => handleSchedField('stallThresholdSec', Number(e.target.value || 60))} />
                  <span className="sched-help">建议不低于 60 秒，用于判定任务多久未推进即视为停滞。</span>
                </label>
                <label className="sched-field">
                  <span className="sched-label">最大重试次数</span>
                  <input className="sched-input" type="number" min={0} step={1} value={schedForm.maxRetry} onChange={(e) => handleSchedField('maxRetry', Number(e.target.value || 0))} />
                  <span className="sched-help">达到上限后，系统会转入加强协助或自动恢复流程。</span>
                </label>
                <label className="sched-field">
                  <span className="sched-label">最大恢复次数</span>
                  <input className="sched-input" type="number" min={0} step={1} value={schedForm.maxRollback} onChange={(e) => handleSchedField('maxRollback', Number(e.target.value || 0))} />
                  <span className="sched-help">仅在开启自动恢复后生效，超出上限后将暂停等待人工处理。</span>
                </label>
                <div className="sched-field sched-snapshot">
                  <span className="sched-label">稳定记录点</span>
                  <div className="sched-snapshot-box">
                    <div>状态：{sched?.snapshot?.state || '—'}</div>
                    <div>节点：{normalizeDeptLabel(sched?.snapshot?.org || '') || '—'}</div>
                    <div>保存时间：{sched?.snapshot?.savedAt ? sched.snapshot.savedAt.replace('T', ' ').substring(0, 19) : '—'}</div>
                    <div>备注：{sched?.snapshot?.note || '—'}</div>
                  </div>
                </div>
              </div>
              <div className="sched-actions sched-actions-config">
                  <button className="sched-btn primary" disabled={!schedDirty || schedSaving} onClick={saveSchedConfig}>{schedSaving ? '保存中...' : '💾 保存设置'}</button>
                <button className="sched-btn" disabled={!schedDirty || schedSaving} onClick={resetSchedForm}>还原改动</button>
              </div>
            </div>
            <div className="sched-actions">
              <button className="sched-btn" onClick={() => doSchedAction('retry')}>🔁 重新安排</button>
              <button className="sched-btn warn" onClick={() => doSchedAction('escalate')}>📣 提升关注</button>
              <button className="sched-btn danger" onClick={() => doSchedAction('rollback')}>↩️ 恢复到稳定状态</button>
              <button className="sched-btn" onClick={() => doSchedAction('scan')}>🔍 立即检查</button>
            </div>
            {automationFlow.length > 0 && (
              <div className="auto-inline-log">
                <div className="m-sec-label" style={{ marginBottom: 8 }}>自动处理记录（{automationFlow.length} 条）</div>
                <div className="auto-inline-list">
                  {automationFlow.slice(0, 8).map((fl, i) => (
                    <div className="auto-inline-item" key={`${fl.at || 't'}-${i}`}>
                      <div className="auto-inline-time">{fl.at ? fl.at.replace('T', ' ').substring(5, 19) : '—'}</div>
                      <div className="auto-inline-main">
                        <div className="auto-inline-route">
                          <span style={{ color: deptColor(fl.from || '') }}>{normalizeDeptLabel(fl.from || '')}</span>
                          <span style={{ color: 'var(--muted)' }}> → </span>
                          <span style={{ color: deptColor(fl.to || '') }}>{normalizeDeptLabel(fl.to || '') || '当前节点'}</span>
                        </div>
                        <div className="auto-inline-remark">{normalizeFlowRemark(fl.remark || '')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Todo List */}
          {todoTotal > 0 && (
            <TodoSection todos={todos} todoDone={todoDone} todoTotal={todoTotal} />
          )}

          {/* Basic Info */}
          <div className="m-section">
            <div className="m-rows">
              <div className="m-row">
                <div className="mr-label">状态</div>
                <div className="mr-val">
                  <span className={`tag st-${task.state}`}>{stateLabel(task)}</span>
                  {(task.review_round || 0) > 0 && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>共磋商 {task.review_round} 轮</span>}
                </div>
              </div>
              <div className="m-row">
                <div className="mr-label">当前处理成员</div>
                <div className="mr-val"><span className={`tag dt-${(normalizeDeptLabel(task.org || '') || '').replace(/\s/g, '')}`}>{normalizeDeptLabel(task.org || '') || '—'}</span></div>
              </div>
              {task.eta && task.eta !== '-' && (
                <div className="m-row"><div className="mr-label">预计完成</div><div className="mr-val">{task.eta}</div></div>
              )}
              {task.block && task.block !== '无' && task.block !== '-' && (
                <div className="m-row"><div className="mr-label" style={{ color: 'var(--danger)' }}>阻塞项</div><div className="mr-val" style={{ color: 'var(--danger)' }}>{task.block}</div></div>
              )}
              {task.now && task.now !== '-' && (
                <div className="m-row" style={{ gridColumn: '1/-1' }}>
                  <div className="mr-label">当前进展</div>
                  <div className="mr-val" style={{ fontWeight: 400, fontSize: 12 }}>{task.now}</div>
                </div>
              )}
              {task.ac && (
                <div className="m-row" style={{ gridColumn: '1/-1' }}>
                  <div className="mr-label">验收标准</div>
                  <div className="mr-val" style={{ fontWeight: 400, fontSize: 12 }}>{task.ac}</div>
                </div>
              )}
            </div>
          </div>

          {/* Flow Log */}
          {flowLog.length > 0 && (
            <div className="m-section">
              <div className="m-sec-label">处理记录（{flowLog.length} 条）</div>
              <div className="fl-timeline">
                {flowLog.map((fl, i) => {
                  const col = deptColor(fl.from || '');
                  return (
                    <div className="fl-item" key={i}>
                      <div className="fl-time">{fl.at ? fl.at.substring(11, 16) : ''}</div>
                      <div className="fl-dot" style={{ background: col }} />
                      <div className="fl-content">
                        <div className="fl-who">
                          <span className="from" style={{ color: col }}>{normalizeDeptLabel(fl.from || '')}</span>
                          <span style={{ color: 'var(--muted)' }}> → </span>
                          <span className="to" style={{ color: deptColor(fl.to || '') }}>{normalizeDeptLabel(fl.to || '')}</span>
                        </div>
                        <div className="fl-rem">{normalizeFlowRemark(fl.remark || '')}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Output */}
          {task.output && task.output !== '-' && task.output !== '' && (
            <div className="m-section">
              <div className="m-sec-label">产出物</div>
              <code>{task.output}</code>
            </div>
          )}

          {/* Live Activity */}
          <LiveActivitySection data={activityData} isDone={['Done', 'Cancelled'].includes(task.state)} logRef={logRef} />
        </div>
      </div>
    </div>
  );
}

function TodoSection({ todos, todoDone, todoTotal }: { todos: TodoItem[]; todoDone: number; todoTotal: number }) {
  return (
    <div className="todo-section">
      <div className="todo-header">
        <div className="m-sec-label" style={{ marginBottom: 0, border: 'none', padding: 0 }}>
          子任务清单（{todoDone}/{todoTotal}）
        </div>
        <div className="todo-progress">
          <div className="todo-bar">
            <div className="todo-bar-fill" style={{ width: `${Math.round((todoDone / todoTotal) * 100)}%` }} />
          </div>
          <span>{Math.round((todoDone / todoTotal) * 100)}%</span>
        </div>
      </div>
      <div className="todo-list">
        {todos.map((td) => {
          const ico = td.status === 'completed' ? '✅' : td.status === 'in-progress' ? '🔄' : '⬜';
          const stLabel = td.status === 'completed' ? '已完成' : td.status === 'in-progress' ? '进行中' : '待开始';
          const stCls = td.status === 'completed' ? 's-done' : td.status === 'in-progress' ? 's-progress' : 's-notstarted';
          const itemCls = td.status === 'completed' ? 'done' : '';
          return (
            <div className={`todo-item ${itemCls}`} key={td.id}>
              <div className="t-row">
                <span className="t-icon">{ico}</span>
                <span className="t-id">#{td.id}</span>
                <span className="t-title">{td.title}</span>
                <span className={`t-status ${stCls}`}>{stLabel}</span>
              </div>
              {td.detail && <div className="todo-detail">{td.detail}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveActivitySection({
  data,
  isDone,
  logRef,
}: {
  data: TaskActivityData | null;
  isDone: boolean;
  logRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (!data) return null;

  const activity = data.activity || [];
  const isActive = (() => {
    if (!activity.length) return false;
    const last = activity[activity.length - 1];
    if (!last.at) return false;
    const ts = typeof last.at === 'number' ? last.at : new Date(last.at).getTime();
    return Date.now() - ts < 300000;
  })();

  const agentParts: string[] = [];
  if (data.agentLabel) agentParts.push(normalizeDeptLabel(data.agentLabel));
   if (data.relatedAgents && data.relatedAgents.length > 1) agentParts.push(`${data.relatedAgents.length}位参与成员`);
  if (data.lastActive) agentParts.push(`最后活跃: ${data.lastActive}`);

  // Phase durations
  const phaseDurations = data.phaseDurations || [];
  const maxDur = Math.max(...phaseDurations.map((p) => p.durationSec || 1), 1);
  const phaseColors: Record<string, string> = {
    '任务入口': '#eab308', '总览协调': '#f97316', '方案整理': '#3b82f6', '结果检查': '#8b5cf6',
    '安排处理': '#10b981', '处理中': '#06b6d4', '内容助手': '#ec4899', '数据助手': '#f59e0b',
    '功能助手': '#ef4444', '核对助手': '#6366f1', '上线助手': '#14b8a6', '能力整理助手': '#d946ef',
  };

  // Todos summary
  const ts = data.todosSummary;

  // Resource summary
  const rs = data.resourceSummary;

  // Group non-flow activity by agent
  const flowItems = activity.filter((a) => a.kind === 'flow');
  const nonFlow = activity.filter((a) => a.kind !== 'flow');
  const grouped = new Map<string, ActivityEntry[]>();
  nonFlow.forEach((a) => {
    const key = a.agent || 'unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(a);
  });

  return (
    <div className="la-section">
      <div className="la-header">
        <span className="la-title">
          <span className={`la-dot${isActive ? '' : ' idle'}`} />
          {isDone ? '执行回顾' : '实时动态'}
        </span>
        <span className="la-agent">{agentParts.join(' · ') || '加载中...'}</span>
      </div>

      {/* Phase Bars */}
      {phaseDurations.length > 0 && (
        <div style={{ padding: '4px 0 8px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>⏱ 阶段耗时</span>
            {data.totalDuration && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>总耗时 {data.totalDuration}</span>}
          </div>
          {phaseDurations.map((p, i) => {
            const pct = Math.max(5, Math.round(((p.durationSec || 1) / maxDur) * 100));
            const color = phaseColors[p.phase] || '#6b7280';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0', fontSize: 11 }}>
                <span style={{ minWidth: 48, color: 'var(--muted)', textAlign: 'right' }}>{normalizeDeptLabel(p.phase)}</span>
                <div style={{ flex: 1, height: 14, background: 'var(--panel)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, opacity: p.ongoing ? 0.6 : 0.85 }} />
                </div>
                <span style={{ minWidth: 60, fontSize: 10, color: 'var(--muted)' }}>
                  {p.durationText}
                  {p.ongoing && <span style={{ fontSize: 9, color: '#60a5fa' }}> ●进行中</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Todos Progress */}
      {ts && (
        <div style={{ padding: '4px 0 8px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>📊 执行进度</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: ts.percent >= 100 ? '#22c55e' : ts.percent >= 50 ? '#60a5fa' : 'var(--text)' }}>{ts.percent}%</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>✅{ts.completed} 🔄{ts.inProgress} ⬜{ts.notStarted} / 共{ts.total}项</span>
          </div>
          <div style={{ height: 8, background: 'var(--panel)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${ts.total ? (ts.completed / ts.total) * 100 : 0}%`, background: '#22c55e', transition: 'width .3s' }} />
            <div style={{ width: `${ts.total ? (ts.inProgress / ts.total) * 100 : 0}%`, background: '#3b82f6', transition: 'width .3s' }} />
          </div>
        </div>
      )}

      {/* Resource Summary */}
      {rs && (rs.totalTokens || rs.totalCost) && (
        <div style={{ padding: '4px 0 8px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>📈 处理量</span>
          {rs.totalTokens != null && <span style={{ fontSize: 11, color: 'var(--muted)' }}>🔢 {rs.totalTokens.toLocaleString()} 处理单位</span>}
          {rs.totalCost != null && <span style={{ fontSize: 11, color: 'var(--muted)' }}>💰 ${rs.totalCost.toFixed(4)}</span>}
          {rs.totalElapsedSec != null && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              ⏳ {rs.totalElapsedSec >= 60 ? `${Math.floor(rs.totalElapsedSec / 60)}分` : ''}{rs.totalElapsedSec % 60}秒
            </span>
          )}
        </div>
      )}

      {/* Activity Log */}
      <div className="la-log" ref={logRef as React.RefObject<HTMLDivElement>}>
        {/* Flow entries */}
        {flowItems.length > 0 && (
          <div className="la-flow-wrap">
            {flowItems.map((a, i) => (
              <div className="la-entry la-tool" key={`flow-${i}`}>
                <span className="la-icon">📋</span>
                <span className="la-body"><b>{a.from}</b> → <b>{a.to}</b>　{a.remark || ''}</span>
                <span className="la-time">{fmtActivityTime(a.at)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Grouped entries */}
        {grouped.size > 0 ? (
          <div className="la-groups">
            {Array.from(grouped.entries()).map(([agent, items]) => {
              const label = AGENT_LABELS[agent] || agent || '未标识';
              const last = items[items.length - 1];
              const lastTime = last?.at ? fmtActivityTime(last.at) : '--:--:--';
              return (
                <div className="la-group" key={agent}>
                  <div className="la-group-hd">
                    <span className="name">{label}</span>
                    <span>最近更新 {lastTime}</span>
                  </div>
                  <div className="la-group-bd">
                    {items.map((a, i) => (
                      <ActivityEntryView key={i} entry={a} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          !flowItems.length && (
            <div className="la-empty">
              {data.message || data.error || '当前还没有进度回流，请稍后刷新查看。'}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ActivityEntryView({ entry: a }: { entry: ActivityEntry }) {
  const time = fmtActivityTime(a.at);
  const agBadge = a.agent ? (
    <span style={{ fontSize: 9, color: 'var(--muted)', background: 'var(--panel)', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>
      {AGENT_LABELS[a.agent] || a.agent}
    </span>
  ) : null;

  if (a.kind === 'progress') {
    return (
      <div className="la-entry la-assistant">
        <span className="la-icon">🔄</span>
        <span className="la-body">{agBadge}<b>当前进展：</b>{a.text}</span>
        <span className="la-time">{time}</span>
      </div>
    );
  }

  if (a.kind === 'todos') {
    const items = a.items || [];
    const diffMap = new Map<string, { type: string; from?: string; to?: string }>();
    if (a.diff) {
      (a.diff.changed || []).forEach((c) => diffMap.set(c.id, { type: 'changed', from: c.from, to: c.to }));
      (a.diff.added || []).forEach((c) => diffMap.set(c.id, { type: 'added' }));
    }
    return (
      <div className="la-entry" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{agBadge}📝 执行计划</div>
        {items.map((td) => {
          const icon = td.status === 'completed' ? '✅' : td.status === 'in-progress' ? '🔄' : '⬜';
          const d = diffMap.get(String(td.id));
          const style: React.CSSProperties = td.status === 'completed'
            ? { opacity: 0.5, textDecoration: 'line-through' }
            : td.status === 'in-progress'
              ? { color: '#60a5fa', fontWeight: 'bold' }
              : {};
          return (
            <div key={td.id} style={style}>
              {icon} {td.title}
              {d && d.type === 'changed' && d.to === 'completed' && <span style={{ color: '#22c55e', fontSize: 9, marginLeft: 4 }}>✨刚完成</span>}
              {d && d.type === 'changed' && d.to !== 'completed' && <span style={{ color: '#f59e0b', fontSize: 9, marginLeft: 4 }}>↻{d.from}→{d.to}</span>}
              {d && d.type === 'added' && <span style={{ color: '#3b82f6', fontSize: 9, marginLeft: 4 }}>🆕新增</span>}
            </div>
          );
        })}
        {a.diff?.removed?.map((r) => (
          <div key={r.id} style={{ opacity: 0.4, textDecoration: 'line-through' }}>🗑 {r.title}</div>
        ))}
      </div>
    );
  }

  if (a.kind === 'assistant') {
    return (
      <>
        {a.thinking && (
          <div className="la-entry la-thinking">
            <span className="la-icon">💭</span>
            <span className="la-body">{agBadge}{a.thinking}</span>
            <span className="la-time">{time}</span>
          </div>
        )}
        {a.tools?.map((tc, i) => (
          <div className="la-entry la-tool" key={i}>
            <span className="la-icon">🔧</span>
            <span className="la-body">{agBadge}<span className="la-tool-name">{tc.name}</span><span className="la-trunc">{tc.input_preview || ''}</span></span>
            <span className="la-time">{time}</span>
          </div>
        ))}
        {a.text && (
          <div className="la-entry la-assistant">
            <span className="la-icon">🤖</span>
            <span className="la-body">{agBadge}{a.text}</span>
            <span className="la-time">{time}</span>
          </div>
        )}
      </>
    );
  }

  if (a.kind === 'tool_result') {
    const ok = a.exitCode === 0 || a.exitCode === null || a.exitCode === undefined;
    return (
      <div className={`la-entry la-tool-result ${ok ? 'ok' : 'err'}`}>
        <span className="la-icon">{ok ? '✅' : '❌'}</span>
        <span className="la-body">{agBadge}<span className="la-tool-name">{a.tool || ''}</span>{a.output ? a.output.substring(0, 150) : ''}</span>
        <span className="la-time">{time}</span>
      </div>
    );
  }

  if (a.kind === 'user') {
    return (
      <div className="la-entry la-user">
        <span className="la-icon">📥</span>
        <span className="la-body">{agBadge}{a.text || ''}</span>
        <span className="la-time">{time}</span>
      </div>
    );
  }

  return null;
}
