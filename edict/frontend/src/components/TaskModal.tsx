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
  main: '总控中心',
  control_center: '总控中心',
  plan_center: '规划中心',
  review_center: '评审中心',
  dispatch_center: '调度中心',
  code_specialist: '代码专家',
  deploy_specialist: '部署专家',
  data_specialist: '数据专家',
  docs_specialist: '文案专家',
  audit_specialist: '审计专家',
  admin_specialist: '管理专家',
  search_specialist: '搜索专家',
};

const NEXT_LABELS: Record<string, string> = {
  ControlCenter: '转入规划中心拆解',
  PlanCenter: '转入评审中心核验',
  ReviewCenter: '转入调度中心派发',
  Assigned: '开始执行',
  Doing: '进入汇总复核',
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
  return remark.includes('自动') || remark.includes('重试') || remark.includes('升级') || remark.includes('回滚') || remark.includes('调度');
}

function renderBusyOrigin(entry: CollabAgentBusyEntry): string {
  const kind = entry.occupancy_kind || entry.source_type || '';
  if (kind === 'task_active') return '任务执行中';
  if (kind === 'task_reserved') return '任务预占中';
  if (kind === 'task_paused') return '任务暂停中';
  if (kind === 'task_blocked') return '任务阻塞中';
  if (kind === 'meeting') return '会议占用中';
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
      toast('服务器连接失败', 'err');
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
      toast('服务器连接失败', 'err');
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
      toast('服务器连接失败', 'err');
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
        toast('服务器连接失败', 'err');
      }
      return;
    }
    const labels: Record<string, string> = { retry: '重试', escalate: '升级', rollback: '回滚' };
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
      toast('服务器连接失败', 'err');
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
        toast(r.message || '自动化配置已保存', 'ok');
        setSchedDirty(false);
        await fetchSched();
        loadAll();
      } else {
        toast(r.error || '保存失败', 'err');
      }
    } catch {
      toast('服务器连接失败', 'err');
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
                <div className="cs-action">当前阶段：{activeStage.action}</div>
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
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, color: '#67e8a5' }}>全局占用 · 当前任务</div>
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
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>全局繁忙提醒</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    当前系统中仍有 {crossBusyEntries.length} 个专家被会议或跨任务协作占用；如需临时拉会或改派，可优先避开这些专家。
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Scheduler state */}
          <div className="sched-section">
            <div className="sched-head">
              <span className="sched-title">🧭 协调中心调度</span>
              <span className="sched-status">
                {sched ? `${sched.enabled === false ? '已禁用' : '运行中'} · 阈值 ${sched.stallThresholdSec || 180}s` : '加载中...'}
              </span>
            </div>
            <div className="sched-grid">
              <div className="sched-kpi"><div className="k">停滞时长</div><div className="v">{fmtStalled(stalledSec)}</div></div>
              <div className="sched-kpi"><div className="k">重试次数</div><div className="v">{sched?.retryCount || 0}/{sched?.maxRetry ?? '—'}</div></div>
              <div className="sched-kpi"><div className="k">升级级别</div><div className="v">{!sched?.escalationLevel ? '无' : sched.escalationLevel === 1 ? '评审中心' : '调度中心'}</div></div>
              <div className="sched-kpi"><div className="k">派发状态</div><div className="v">{sched?.lastDispatchStatus || 'idle'}</div></div>
            </div>
            {sched && (
              <div className="sched-line">
                {sched.lastProgressAt && <span>最近进展 {(sched.lastProgressAt || '').replace('T', ' ').substring(0, 19)}</span>}
                {sched.lastDispatchAt && <span>最近派发 {(sched.lastDispatchAt || '').replace('T', ' ').substring(0, 19)}</span>}
                <span>自动回滚 {sched.autoRollback === false ? '关闭' : '开启'}</span>
                <span>最大回滚 {sched.maxRollback ?? 3} 次</span>
                {sched.lastDispatchAgent && <span>目标 {normalizeDeptLabel(AGENT_LABELS[sched.lastDispatchAgent] || sched.lastDispatchAgent)}</span>}
              </div>
            )}
            <div className="sched-form">
              <div className="sched-form-grid">
                <label className="sched-field sched-switch">
                  <span className="sched-field-top">
                    <span className="sched-label">启用自动托管</span>
                    <input type="checkbox" checked={!!schedForm.enabled} onChange={(e) => handleSchedField('enabled', e.target.checked)} />
                  </span>
                  <span className="sched-help">关闭后，当前任务将跳过自动扫描、自动重试与自动升级。</span>
                </label>
                <label className="sched-field sched-switch">
                  <span className="sched-field-top">
                    <span className="sched-label">自动回滚</span>
                    <input type="checkbox" checked={!!schedForm.autoRollback} onChange={(e) => handleSchedField('autoRollback', e.target.checked)} />
                  </span>
                  <span className="sched-help">当任务多次停滞后，允许系统恢复到最近稳定快照。</span>
                </label>
                <label className="sched-field">
                  <span className="sched-label">停滞阈值（秒）</span>
                  <input className="sched-input" type="number" min={60} step={60} value={schedForm.stallThresholdSec} onChange={(e) => handleSchedField('stallThresholdSec', Number(e.target.value || 60))} />
                  <span className="sched-help">建议不低于 60 秒，用于判定任务多久未推进即视为停滞。</span>
                </label>
                <label className="sched-field">
                  <span className="sched-label">最大重试次数</span>
                  <input className="sched-input" type="number" min={0} step={1} value={schedForm.maxRetry} onChange={(e) => handleSchedField('maxRetry', Number(e.target.value || 0))} />
                  <span className="sched-help">达到上限后，系统会转入升级协调或回滚流程。</span>
                </label>
                <label className="sched-field">
                  <span className="sched-label">最大回滚次数</span>
                  <input className="sched-input" type="number" min={0} step={1} value={schedForm.maxRollback} onChange={(e) => handleSchedField('maxRollback', Number(e.target.value || 0))} />
                  <span className="sched-help">仅在开启自动回滚后生效，超出上限将自动挂起等待人工处理。</span>
                </label>
                <div className="sched-field sched-snapshot">
                  <span className="sched-label">稳定快照</span>
                  <div className="sched-snapshot-box">
                    <div>状态：{sched?.snapshot?.state || '—'}</div>
                    <div>节点：{normalizeDeptLabel(sched?.snapshot?.org || '') || '—'}</div>
                    <div>保存时间：{sched?.snapshot?.savedAt ? sched.snapshot.savedAt.replace('T', ' ').substring(0, 19) : '—'}</div>
                    <div>备注：{sched?.snapshot?.note || '—'}</div>
                  </div>
                </div>
              </div>
              <div className="sched-actions sched-actions-config">
                <button className="sched-btn primary" disabled={!schedDirty || schedSaving} onClick={saveSchedConfig}>{schedSaving ? '保存中...' : '💾 保存自动化配置'}</button>
                <button className="sched-btn" disabled={!schedDirty || schedSaving} onClick={resetSchedForm}>还原改动</button>
              </div>
            </div>
            <div className="sched-actions">
              <button className="sched-btn" onClick={() => doSchedAction('retry')}>🔁 重试派发</button>
              <button className="sched-btn warn" onClick={() => doSchedAction('escalate')}>📣 升级协调</button>
              <button className="sched-btn danger" onClick={() => doSchedAction('rollback')}>↩️ 回滚稳定点</button>
              <button className="sched-btn" onClick={() => doSchedAction('scan')}>🔍 立即扫描</button>
            </div>
            {automationFlow.length > 0 && (
              <div className="auto-inline-log">
                <div className="m-sec-label" style={{ marginBottom: 8 }}>自动动作日志（{automationFlow.length} 条）</div>
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
                <div className="mr-label">当前执行节点</div>
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
              <div className="m-sec-label">流转日志（{flowLog.length} 条）</div>
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
  if (data.relatedAgents && data.relatedAgents.length > 1) agentParts.push(`${data.relatedAgents.length}个 Agent`);
  if (data.lastActive) agentParts.push(`最后活跃: ${data.lastActive}`);

  // Phase durations
  const phaseDurations = data.phaseDurations || [];
  const maxDur = Math.max(...phaseDurations.map((p) => p.durationSec || 1), 1);
  const phaseColors: Record<string, string> = {
    '任务入口': '#eab308', '总控中心': '#f97316', '规划中心': '#3b82f6', '评审中心': '#8b5cf6',
    '调度中心': '#10b981', '执行团队': '#06b6d4', '文案专家': '#ec4899', '数据专家': '#f59e0b',
    '代码专家': '#ef4444', '合规专家': '#6366f1', '部署专家': '#14b8a6', 'Agent管理专家': '#d946ef',
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
          <span style={{ fontSize: 11, fontWeight: 600 }}>📈 资源消耗</span>
          {rs.totalTokens != null && <span style={{ fontSize: 11, color: 'var(--muted)' }}>🔢 {rs.totalTokens.toLocaleString()} tokens</span>}
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
              {data.message || data.error || 'Agent 尚未上报进展（等待 Agent 调用 progress 命令）'}
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
