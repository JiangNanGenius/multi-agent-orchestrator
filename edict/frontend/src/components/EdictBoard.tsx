import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { useStore, getPipeStatus, stateLabel, deptColor, isArchived, isEdict, getSchedulerSummary, DEPTS } from '../store';
import { api, type Task, type CollabAgentBusyEntry, type CreateTaskPayload, type ScanAction } from '../api';
import { pickLocaleText, type Locale } from '../i18n';

// 排序权重
const STATE_ORDER: Record<string, number> = {
  Doing: 0, Review: 1, Assigned: 2, ReviewCenter: 3, PlanCenter: 4,
  ControlCenter: 5, Inbox: 6, Blocked: 7, Next: 8, Done: 9, Cancelled: 10,
};

type QuickCreateForm = {
  title: string;
  owner: string;
  autoAssign: boolean;
  targetDepts: string[];
  priority: 'low' | 'normal' | 'high';
};

const EXECUTION_TARGET_IDS = new Set([
  'docs_specialist',
  'data_specialist',
  'code_specialist',
  'audit_specialist',
  'deploy_specialist',
  'admin_specialist',
  'expert_curator',
  'search_specialist',
]);

const DEFAULT_FORM: QuickCreateForm = {
  title: '',
  owner: '',
  autoAssign: true,
  targetDepts: [],
  priority: 'normal',
};

type DemoTaskLike = Task & {
  templateId?: string;
  templateParams?: Record<string, unknown>;
};

function isReleaseDemoNoiseTask(task: Task): boolean {
  const meta = task as DemoTaskLike;
  const params = meta.templateParams && typeof meta.templateParams === 'object'
    ? meta.templateParams
    : {};
  const entry = typeof params.entry === 'string' ? params.entry : '';
  const title = String(meta.title || '');

  return meta.id === 'JJC-20260408-001'
    || title.includes('示例任务：验证持久化聊天会话窗口与刷新恢复')
    || (meta.templateId === 'skills_config_dialog' && entry === 'demo-board');
}


type ProgressCheckRecord = {
  id: string;
  ok: boolean;
  checkedAt: string;
  count: number;
  actions: ScanAction[];
  error?: string;
};

const PROGRESS_CHECK_HISTORY_KEY = 'edict-progress-check-history';

function loadProgressCheckHistory(): ProgressCheckRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PROGRESS_CHECK_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveProgressCheckHistory(records: ProgressCheckRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROGRESS_CHECK_HISTORY_KEY, JSON.stringify(records.slice(0, 8)));
  } catch {
    // ignore storage errors
  }
}

function normalizeCheckAction(locale: Locale, action?: string) {
  const key = String(action || '').trim().toLowerCase();
  if (locale === 'en') {
    if (key.includes('retry')) return 'retry follow-up';
    if (key.includes('escalate')) return 'raise for extra attention';
    if (key.includes('rollback')) return 'roll back to a stable step';
    if (key.includes('dispatch') || key.includes('assign')) return 're-arrange handling';
    if (key.includes('scan')) return 'run a check';
    return key ? key.replace(/_/g, ' ') : 'continue follow-up';
  }
  if (key.includes('retry')) return '再次跟进';
  if (key.includes('escalate')) return '提醒优先处理';
  if (key.includes('rollback')) return '回到稳定步骤';
  if (key.includes('dispatch') || key.includes('assign')) return '重新安排';
  if (key.includes('scan')) return '执行检查';
  return key ? key.replace(/_/g, ' ') : '继续跟进';
}

function formatCheckTime(locale: Locale, raw?: string) {
  if (!raw) return locale === 'en' ? 'Just now' : '刚刚';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return locale === 'en'
    ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function describeProgressAction(locale: Locale, item: ScanAction) {
  const taskPart = item.taskId ? (locale === 'en' ? `Item ${item.taskId}` : `事项 ${item.taskId}`) : pickLocaleText(locale, '一条事项', 'One item');
  const actionPart = normalizeCheckAction(locale, item.action);
  const nextPart = item.to || item.toState;
  const waitPart = Number(item.stalledSec || 0) > 0
    ? pickLocaleText(locale, ` · 已等待 ${Math.round(Number(item.stalledSec || 0))} 秒`, ` · waited ${Math.round(Number(item.stalledSec || 0))}s`)
    : '';
  return `${taskPart} · ${actionPart}${nextPart ? pickLocaleText(locale, ` · 下一步 ${nextPart}`, ` · next ${nextPart}`) : ''}${waitPart}`;
}

function buildTaskPayload(locale: Locale, form: QuickCreateForm): CreateTaskPayload {
  const normalizedTargets = Array.from(new Set(form.targetDepts.map((item) => item.trim()).filter(Boolean)));
  return {
    title: form.title.trim(),
    org: pickLocaleText(locale, '系统安排', 'System Assignment'),
    owner: form.owner.trim() || (locale === 'en' ? 'Workspace Desk' : '工作台值守'),
    priority: form.priority,
    ...(!normalizedTargets.length
      ? {}
      : {
          targetDept: normalizedTargets[0],
          targetDepts: normalizedTargets,
        }),
  };
}

function TargetExpertSelector({
  locale,
  form,
  targetOptions,
  onModeChange,
  onToggleTarget,
}: {
  locale: Locale;
  form: QuickCreateForm;
  targetOptions: Array<{ id: string; label: string; emoji: string }>;
  onModeChange: (autoAssign: boolean) => void;
  onToggleTarget: (deptId: string) => void;
}) {
  return (
      <div style={{ display: 'grid', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '协助处理的 Agent（可选）', 'Supporting Agents (Optional)')}</span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
            gap: 8,
          }}
        >
          {targetOptions.map((dept) => {
            const active = form.targetDepts.includes(dept.id);
            return (
              <button
                key={dept.id}
                type="button"
                className="chip"
                onClick={() => onToggleTarget(dept.id)}
                style={{
                  width: '100%',
                  minHeight: 44,
                  justifyContent: 'center',
                  textAlign: 'center',
                  lineHeight: 1.35,
                  whiteSpace: 'normal',
                  padding: '10px 8px',
                  cursor: 'pointer',
                  borderColor: active ? 'var(--acc)' : 'var(--line)',
                  color: active ? 'var(--acc)' : 'var(--text)',
                  background: active ? 'rgba(122,162,255,0.14)' : 'transparent',
                }}
              >
                {dept.emoji} {dept.label} {active ? '✓' : ''}
              </button>
            );
          })}
        </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
        {form.targetDepts.length
          ? pickLocaleText(locale, `已选择 ${form.targetDepts.length} 个协助处理的 Agent：${form.targetDepts.map((id) => targetOptions.find((item) => item.id === id)?.label || id).join('、')}。系统仍会自动安排流程，但会优先参考这些 Agent。`, `Selected ${form.targetDepts.length} supporting agent(s): ${form.targetDepts.map((id) => targetOptions.find((item) => item.id === id)?.label || id).join(', ')}. Routing stays automatic, but these agents will be prioritized as collaborators.`)
          : pickLocaleText(locale, '不指定也可以，系统会自动安排；如果你已有明确协助对象，可在这里补充。', 'You can leave this empty and let the system route automatically. If you already know which agents should help, add them here.')}
      </div>
    </div>
  );
}

function MiniPipe({ task }: { task: Task }) {
  const locale = useStore((s) => s.locale);
  const stages = getPipeStatus(task, locale);
  return (
    <div className="ec-pipe">
      {stages.map((s, i) => (
        <span key={s.key} style={{ display: 'contents' }}>
          <div className={`ep-node ${s.status}`}>
            <div className="ep-icon">{s.icon}</div>
            <div className="ep-name">{s.dept}</div>
          </div>
          {i < stages.length - 1 && <div className="ep-arrow">›</div>}
        </span>
      ))}
    </div>
  );
}

function renderBusyStateLabel(entry: CollabAgentBusyEntry, locale: Locale): string {
  const source = entry.occupancy_kind || entry.source_type || '';
  if (locale === 'en') {
    if (source === 'task_active') return 'Task running';
    if (source === 'task_reserved') return 'Task reserved';
    if (source === 'task_paused') return 'Task paused';
    if (source === 'task_blocked') return 'Task blocked';
    if (source === 'meeting' || source === 'meeting_reserved') return entry.state === 'reserved' ? 'Queued for collaboration' : 'In collaboration';
    if (source === 'chat') return 'In discussion';
    return entry.label || 'Busy';
  }
  if (source === 'task_active') return '任务执行中';
  if (source === 'task_reserved') return '任务预占中';
  if (source === 'task_paused') return '任务暂停中';
  if (source === 'task_blocked') return '任务阻塞中';
  if (source === 'meeting' || source === 'meeting_reserved') return entry.state === 'reserved' ? '等待协作' : '协作处理中';
  if (source === 'chat') return '讨论占用中';
  return entry.label || '忙碌中';
}

function QuickCreateTaskModal({
  onClose,
  onSubmitSuccess,
}: {
  onClose: () => void;
  onSubmitSuccess: () => void;
}) {
  const locale = useStore((s) => s.locale);
  const toast = useStore((s) => s.toast);
  const [form, setForm] = useState<QuickCreateForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  const targetOptions = useMemo(
    () => DEPTS.filter((dept) => EXECUTION_TARGET_IDS.has(dept.id)),
    [],
  );

  const updateField = <K extends keyof QuickCreateForm>(key: K, value: QuickCreateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleModeChange = (autoAssign: boolean) => {
    setForm((prev) => ({
      ...prev,
      autoAssign,
      targetDepts: autoAssign ? [] : prev.targetDepts,
    }));
  };

  const toggleTargetDept = (deptId: string) => {
    setForm((prev) => {
      const exists = prev.targetDepts.includes(deptId);
      const next = exists ? prev.targetDepts.filter((item) => item !== deptId) : [...prev.targetDepts, deptId];
      return {
        ...prev,
        autoAssign: false,
        targetDepts: next,
      };
    });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      toast(pickLocaleText(locale, '请先填写任务标题', 'Please enter a task title'), 'err');
      return;
    }
    const payload: CreateTaskPayload = buildTaskPayload(locale, form);

    setSubmitting(true);
    try {
      const result = await api.createTask(payload);
      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '提交失败', 'Failed to submit'), 'err');
        return;
      }
      toast(
        result.message ||
          pickLocaleText(locale, '已收到，稍后会继续为你处理', 'Received. We will continue shortly.'),
      );
      setForm(DEFAULT_FORM);
      onSubmitSuccess();
      onClose();
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-bg open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-id">{pickLocaleText(locale, '添加事项', 'Add Item')}</div>
        <div className="modal-title">{pickLocaleText(locale, '系统会为你继续安排', 'We will arrange the next steps for you')}</div>
        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginBottom: 18 }}>
          {pickLocaleText(
            locale,
            '你只需要填写内容和紧急程度，系统会自动安排流程；如果你已有明确的协助处理 Agent，也可以一并补充。',
            'Fill in the request and urgency. The workflow stays automatic, and you can optionally name supporting agents if you already know who should help.',
          )}
        </div>

        <form className="auth-form two-col" onSubmit={handleSubmit}>
          <label className="auth-label auth-full">
              <span>{pickLocaleText(locale, '事项标题', 'Title')}</span>
            <input
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
                placeholder={pickLocaleText(locale, '请输入任务标题', 'Enter task title')}
              autoFocus
            />
          </label>

          <label className="auth-label">
              <span>{pickLocaleText(locale, '紧急程度', 'Urgency')}</span>
            <select
              value={form.priority}
              onChange={(e) => updateField('priority', e.target.value as QuickCreateForm['priority'])}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}
            >
              <option value="low">{pickLocaleText(locale, '低', 'Low')}</option>
              <option value="normal">{pickLocaleText(locale, '中', 'Normal')}</option>
              <option value="high">{pickLocaleText(locale, '高', 'High')}</option>
            </select>
          </label>

          <label className="auth-label">
              <span>{pickLocaleText(locale, '发起人', 'Requester')}</span>
            <input
              value={form.owner}
              onChange={(e) => updateField('owner', e.target.value)}
                placeholder={pickLocaleText(locale, '请输入发起人', 'Enter requester')}
            />
          </label>

          <div className="auth-label auth-full">
            <TargetExpertSelector
              locale={locale}
              form={form}
              targetOptions={targetOptions}
              onModeChange={handleModeChange}
              onToggleTarget={toggleTargetDept}
            />
          </div>

          <div className="auth-full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" className="btn-refresh" onClick={onClose} disabled={submitting}>
              {pickLocaleText(locale, '取消', 'Cancel')}
            </button>
            <button type="submit" className="auth-primary" disabled={submitting} style={{ width: 'auto', minWidth: 140 }}>
              {submitting ? pickLocaleText(locale, '提交中…', 'Submitting...') : pickLocaleText(locale, '添加事项', 'Add Item')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InlineQuickCreatePanel({ onSubmitSuccess }: { onSubmitSuccess: () => void }) {
  const locale = useStore((s) => s.locale);
  const toast = useStore((s) => s.toast);
  const [form, setForm] = useState<QuickCreateForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  const targetOptions = useMemo(
    () => DEPTS.filter((dept) => EXECUTION_TARGET_IDS.has(dept.id)),
    [],
  );

  const updateField = <K extends keyof QuickCreateForm>(key: K, value: QuickCreateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleTargetDept = (deptId: string) => {
    setForm((prev) => {
      const exists = prev.targetDepts.includes(deptId);
      const next = exists ? prev.targetDepts.filter((item) => item !== deptId) : [...prev.targetDepts, deptId];
      return {
        ...prev,
        targetDepts: next,
      };
    });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      toast(pickLocaleText(locale, '请先填写任务标题', 'Please enter a task title'), 'err');
      return;
    }
    const payload: CreateTaskPayload = buildTaskPayload(locale, form);

    setSubmitting(true);
    try {
      const result = await api.createTask(payload);
      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '提交失败', 'Failed to submit'), 'err');
        return;
      }
      toast(result.message || pickLocaleText(locale, '已收到，马上为你继续处理', 'Received. We will continue handling it shortly.'));
      setForm(DEFAULT_FORM);
      onSubmitSuccess();
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
      <form
        onSubmit={handleSubmit}
        style={{
          padding: 16,
          borderRadius: 18,
          border: '1px solid var(--line)',
          background: 'linear-gradient(135deg, rgba(92,123,255,0.08), rgba(76,195,138,0.06))',
          display: 'grid',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
            {pickLocaleText(locale, '发布任务', 'Publish Task')}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '事项标题', 'Title')}</span>
            <input
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder={pickLocaleText(locale, '请输入任务标题', 'Enter task title')}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '紧急程度', 'Urgency')}</span>
            <select value={form.priority} onChange={(e) => updateField('priority', e.target.value as QuickCreateForm['priority'])} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}>
              <option value="low">{pickLocaleText(locale, '低', 'Low')}</option>
              <option value="normal">{pickLocaleText(locale, '中', 'Normal')}</option>
              <option value="high">{pickLocaleText(locale, '高', 'High')}</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '发起人', 'Requester')}</span>
            <input value={form.owner} onChange={(e) => updateField('owner', e.target.value)} placeholder={pickLocaleText(locale, '请输入发起人', 'Enter requester')} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }} />
          </label>
          <div style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
            <TargetExpertSelector
              locale={locale}
              form={form}
              targetOptions={targetOptions}
              onModeChange={() => undefined}
              onToggleTarget={toggleTargetDept}
            />
          </div>
          <button type="submit" className="auth-primary" disabled={submitting} style={{ width: '100%', minWidth: 0, height: 44, gridColumn: '1 / -1' }}>
            {submitting ? pickLocaleText(locale, '发布中…', 'Publishing...') : pickLocaleText(locale, '发布任务', 'Publish Task')}
          </button>
        </div>
      </form>

    </div>
  );
}

function EdictCard({ task, busyEntries }: { task: Task; busyEntries: CollabAgentBusyEntry[] }) {
  const locale = useStore((s) => s.locale);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

  const hb = task.heartbeat || { status: 'unknown', label: '⚪' };
  const stCls = 'st-' + (task.state || '');
  const deptCls = 'dt-' + (task.org || '').replace(/\s/g, '');
  const pipeStatus = getPipeStatus(task, locale);
  const curStage = pipeStatus.find((stage) => stage.status === 'active') || pipeStatus[pipeStatus.length - 1] || null;
  const todos = task.todos || [];
  const todoDone = todos.filter((x) => x.status === 'completed').length;
  const todoTotal = todos.length;
  const canStop = !['Done', 'Blocked', 'Cancelled'].includes(task.state);
  const canResume = ['Blocked', 'Cancelled'].includes(task.state);
  const archived = isArchived(task);
  const isBlocked = task.block && task.block !== '无' && task.block !== '-';
  const schedSummary = getSchedulerSummary(task, locale);
  const busyNames = busyEntries.map((entry) => entry.name).filter(Boolean);
  const busyLead = busyEntries[0] || null;
  const busySummary = busyLead
    ? `${renderBusyStateLabel(busyLead, locale)} · ${busyNames.join(locale === 'en' ? ', ' : '、')}`
    : '';
  const workspace = task.workspace || {};
  const taskPolicy = task.workspaceTaskPolicy || workspace.task_policy || {};
  const refreshState = task.workspaceNewRefresh || workspace.new_refresh || {};
  const watchdog = task.workspaceWatchdog || workspace.watchdog || {};
  const feishuReporting = task.workspaceFeishuReporting || workspace.feishu_reporting || {};
  const refreshRecommended = !!(task.workspaceRefreshRecommended || workspace.refresh_recommended || refreshState.recommended);
  const projectSizeEstimate = Number(task.workspaceProjectSizeEstimateGb || workspace.project_size_gb_estimate || 0);
  const archiveStatus = task.workspaceArchiveStatus || workspace.archive_status || '';
  const storageTier = task.workspaceStorageTier || workspace.storage_tier || '';
  const reactivationTarget = task.workspaceReactivationTargetPath || workspace.reactivation_target_path || '';
  const workspaceChips: Array<{ text: string; color: string; bg: string; border: string }> = [];

  if (task.taskCode) {
    workspaceChips.push({
      text: `#${task.taskCode}`,
      color: 'var(--acc)',
      bg: 'rgba(122,162,255,0.10)',
      border: 'rgba(122,162,255,0.28)',
    });
  }

  if (task.workspaceTaskKind || taskPolicy.lightweight) {
    const kind = task.workspaceTaskKind || workspace.task_kind || (taskPolicy.lightweight ? 'lightweight' : 'standard');
    const lightweight = kind === 'lightweight' || !!taskPolicy.lightweight;
    workspaceChips.push({
      text: lightweight
        ? pickLocaleText(locale, '轻型', 'Lite')
        : pickLocaleText(locale, '标准', 'Standard'),
      color: lightweight ? '#67e8a5' : '#cbd5e1',
      bg: lightweight ? '#0f2219' : 'rgba(148,163,184,0.10)',
      border: lightweight ? '#4cc38a44' : 'rgba(148,163,184,0.25)',
    });
  }

  if (projectSizeEstimate >= 50 || storageTier === 'cold') {
    workspaceChips.push({
      text: projectSizeEstimate >= 50
        ? pickLocaleText(locale, `大体量 · ${projectSizeEstimate.toFixed(projectSizeEstimate >= 100 ? 0 : 1)}GB`, `Large · ${projectSizeEstimate.toFixed(projectSizeEstimate >= 100 ? 0 : 1)}GB`)
        : pickLocaleText(locale, '归档层', 'Archive Tier'),
      color: '#60a5fa',
      bg: 'rgba(59,130,246,0.12)',
      border: 'rgba(59,130,246,0.30)',
    });
  }

  if (archiveStatus && archiveStatus !== 'hot') {
    workspaceChips.push({
      text: `${pickLocaleText(locale, '归档', 'Archive')} · ${archiveStatus}`,
      color: archiveStatus.includes('cold') || archiveStatus.includes('archive') ? '#f59e0b' : '#cbd5e1',
      bg: archiveStatus.includes('cold') || archiveStatus.includes('archive') ? 'rgba(245,158,11,0.12)' : 'rgba(148,163,184,0.10)',
      border: archiveStatus.includes('cold') || archiveStatus.includes('archive') ? 'rgba(245,158,11,0.30)' : 'rgba(148,163,184,0.25)',
    });
  }

  if (reactivationTarget) {
    workspaceChips.push({
      text: pickLocaleText(locale, '可回迁', 'Reactivatable'),
      color: '#38bdf8',
      bg: 'rgba(56,189,248,0.10)',
      border: 'rgba(56,189,248,0.30)',
    });
  }

  if (refreshRecommended) {
    workspaceChips.push({
      text: pickLocaleText(locale, '建议 /new', 'Recommend /new'),
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(245,158,11,0.30)',
    });
  }

  if (watchdog.status) {
    const isHealthy = ['ok', 'healthy', 'active'].includes(String(watchdog.status).toLowerCase());
    workspaceChips.push({
      text: `${pickLocaleText(locale, '看门狗', 'Watchdog')} · ${watchdog.status}`,
      color: isHealthy ? '#22c55e' : '#f59e0b',
      bg: isHealthy ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.12)',
      border: isHealthy ? 'rgba(34,197,94,0.28)' : 'rgba(245,158,11,0.30)',
    });
  }

  if (feishuReporting.enabled || feishuReporting.last_report_status) {
    const reportOk = ['success', 'reported', 'ok'].includes(String(feishuReporting.last_report_status || '').toLowerCase());
    workspaceChips.push({
      text: `${pickLocaleText(locale, '汇报', 'Report')} · ${feishuReporting.last_report_status || pickLocaleText(locale, '已启用', 'Enabled')}`,
      color: reportOk ? '#22c55e' : '#c084fc',
      bg: reportOk ? 'rgba(34,197,94,0.10)' : 'rgba(192,132,252,0.12)',
      border: reportOk ? 'rgba(34,197,94,0.28)' : 'rgba(192,132,252,0.30)',
    });
  }

  const handleAction = async (action: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (action === 'stop' || action === 'cancel') {
      const reason = prompt(action === 'stop'
        ? pickLocaleText(locale, '请输入叫停原因：', 'Enter a reason to pause this task:')
        : pickLocaleText(locale, '请输入取消原因：', 'Enter a reason to cancel this task:'));
      if (reason === null) return;
      try {
        const r = await api.taskAction(task.id, action, reason);
        if (r.ok) { toast(r.message || pickLocaleText(locale, '操作成功', 'Action completed')); loadAll(); }
        else toast(r.error || pickLocaleText(locale, '操作失败', 'Action failed'), 'err');
      } catch {
        toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
      }
    } else if (action === 'resume') {
      try {
        const r = await api.taskAction(task.id, 'resume', locale === 'en' ? 'Resume execution' : '恢复执行');
        if (r.ok) { toast(r.message || pickLocaleText(locale, '已恢复', 'Resumed')); loadAll(); }
        else toast(r.error || pickLocaleText(locale, '操作失败', 'Action failed'), 'err');
      } catch {
        toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
      }
    }
  };

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await api.archiveTask(task.id, !task.archived);
      if (r.ok) { toast(r.message || pickLocaleText(locale, '操作成功', 'Action completed')); loadAll(); }
      else toast(r.error || pickLocaleText(locale, '操作失败', 'Action failed'), 'err');
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    }
  };

  return (
    <div
      className={`edict-card${archived ? ' archived' : ''}`}
      onClick={() => setModalTaskId(task.id)}
    >
      <MiniPipe task={task} />
      <div className="ec-id">{task.id}</div>
      <div className="ec-title">{task.title || pickLocaleText(locale, '(无标题)', '(Untitled)')}</div>
      <div className="ec-meta">
        <span className={`tag ${stCls}`}>{stateLabel(task, locale)}</span>
        {task.org && <span className={`tag ${deptCls}`}>{task.org}</span>}
        {curStage && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {pickLocaleText(locale, '当前进展', 'Current Progress')}: <b style={{ color: deptColor(curStage.dept) }}>{curStage.dept} · {curStage.action}</b>
          </span>
        )}
      </div>
      {task.now && task.now !== '-' && (
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 6 }}>
          {task.now.substring(0, 80)}
        </div>
      )}
      {(task.review_round || 0) > 0 && (
        <div style={{ fontSize: 11, marginBottom: 6 }}>
          {Array.from({ length: task.review_round || 0 }, (_, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                background: i < (task.review_round || 0) - 1 ? '#1a3a6a22' : 'var(--acc)22',
                border: `1px solid ${i < (task.review_round || 0) - 1 ? '#2a4a8a' : 'var(--acc)'}`,
                fontSize: 9, textAlign: 'center', lineHeight: '13px', marginRight: 2,
                color: i < (task.review_round || 0) - 1 ? '#4a6aaa' : 'var(--acc)',
              }}
            >
              {i + 1}
            </span>
          ))}
          <span style={{ color: 'var(--muted)', fontSize: 10 }}>{locale === 'en' ? `Round ${task.review_round} discussion` : `第 ${task.review_round} 轮讨论`}</span>
        </div>
      )}
      {todoTotal > 0 && (
        <div className="ec-todo-bar">
          <span>📋 {todoDone}/{todoTotal}</span>
          <div className="ec-todo-track">
            <div className="ec-todo-fill" style={{ width: `${Math.round((todoDone / todoTotal) * 100)}%` }} />
          </div>
          <span>{todoDone === todoTotal ? pickLocaleText(locale, '✅ 全部完成', '✅ Completed') : pickLocaleText(locale, '🔄 进行中', '🔄 In progress')}</span>
        </div>
      )}
      <div className={`ec-scheduler-chip ${schedSummary.tone}`}>
        <div className="ec-scheduler-label">{schedSummary.icon} {schedSummary.label}</div>
        <div className="ec-scheduler-detail">{schedSummary.detail}</div>
      </div>
      {workspaceChips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {workspaceChips.map((chip, index) => (
            <span
              key={`${chip.text}-${index}`}
              style={{
                fontSize: 10,
                lineHeight: 1.2,
                padding: '5px 8px',
                borderRadius: 999,
                border: `1px solid ${chip.border}`,
                background: chip.bg,
                color: chip.color,
                fontWeight: 700,
              }}
            >
              {chip.text}
            </span>
          ))}
        </div>
      )}
      {busyLead && (
        <div
          className="ec-scheduler-chip"
          style={{
            marginTop: 8,
            borderColor: busyLead.state === 'paused' ? '#f6c17755' : '#4cc38a44',
            background: busyLead.state === 'paused' ? '#2a2112' : '#0f2219',
          }}
        >
          <div className="ec-scheduler-label">
            {busyLead.state === 'paused' ? '⏸' : '📝'} {pickLocaleText(locale, '当前情况', 'Current Status')}
          </div>
          <div className="ec-scheduler-detail">{busySummary}</div>
          {busyLead.reason && (
            <div className="ec-scheduler-detail" style={{ marginTop: 4, opacity: 0.9 }}>
              {busyLead.reason}
            </div>
          )}
        </div>
      )}
      <div className="ec-footer">
        <span className={`hb ${hb.status}`}>{hb.label}</span>
        {isBlocked && (
          <span className="tag" style={{ borderColor: '#ff527044', color: 'var(--danger)', background: '#200a10' }}>
            🚫 {task.block}
          </span>
        )}
        {task.eta && task.eta !== '-' && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>📅 {task.eta}</span>
        )}
      </div>
      <div className="ec-actions" onClick={(e) => e.stopPropagation()}>
        {canStop && (
          <>
            <button className="mini-act" onClick={(e) => handleAction('stop', e)}>{pickLocaleText(locale, '⏸ 暂停处理', '⏸ Pause')}</button>
            <button className="mini-act danger" onClick={(e) => handleAction('cancel', e)}>{pickLocaleText(locale, '🚫 结束任务', '🚫 Cancel')}</button>
          </>
        )}
        {canResume && (
          <button className="mini-act" onClick={(e) => handleAction('resume', e)}>{pickLocaleText(locale, '▶ 恢复', '▶ Resume')}</button>
        )}
        {archived && !task.archived && (
          <button className="mini-act" onClick={handleArchive}>{pickLocaleText(locale, '📦 归档', '📦 Archive')}</button>
        )}
        {task.archived && (
          <button className="mini-act" onClick={handleArchive}>{pickLocaleText(locale, '📤 取消归档', '📤 Unarchive')}</button>
        )}
      </div>
    </div>
  );
}

export default function EdictBoard() {
  const locale = useStore((s) => s.locale);
  const liveStatus = useStore((s) => s.liveStatus);
  const collabAgentBusyData = useStore((s) => s.collabAgentBusyData);
  const taskFilter = useStore((s) => s.taskFilter);
  const setTaskFilter = useStore((s) => s.setTaskFilter);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [checkingProgress, setCheckingProgress] = useState(false);
  const [lastCheck, setLastCheck] = useState<ProgressCheckRecord | null>(null);
  const [checkHistory, setCheckHistory] = useState<ProgressCheckRecord[]>(() => loadProgressCheckHistory());

  const tasks = liveStatus?.tasks || [];
  const allEdicts = tasks.filter((task) => isEdict(task) && !isReleaseDemoNoiseTask(task));
  const activeEdicts = allEdicts.filter((t) => !isArchived(t));
  const archivedEdicts = allEdicts.filter((t) => isArchived(t));

  let visibleTasks: Task[];
  if (taskFilter === 'active') visibleTasks = activeEdicts;
  else if (taskFilter === 'archived') visibleTasks = archivedEdicts;
  else visibleTasks = allEdicts;

  visibleTasks.sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9));

  const runningCount = activeEdicts.filter((t) => ['Doing', 'Review', 'Assigned', 'ControlCenter', 'ReviewCenter', 'PlanCenter'].includes(t.state)).length;
  const blockedCount = activeEdicts.filter((t) => t.state === 'Blocked').length;
  const attentionTasks = activeEdicts.filter((t) => ['Blocked', 'Review', 'ReviewCenter'].includes(t.state) || !!String(t.block || '').trim());
  const attentionCount = attentionTasks.length;
  const completedCount = allEdicts.filter((t) => ['Done', 'Cancelled'].includes(t.state)).length;
  const completionRate = allEdicts.length ? Math.round((completedCount / allEdicts.length) * 100) : 0;
  const busyAgentCount = new Set((collabAgentBusyData?.busy || []).map((entry) => entry.agent_id || entry.name || '').filter(Boolean)).size;

  const unArchivedDone = allEdicts.filter((t) => !t.archived && ['Done', 'Cancelled'].includes(t.state));
  const spotlightTasks = activeEdicts.slice(0, 4);
  const runningTasks = activeEdicts.filter((t) => ['Doing', 'Assigned', 'PlanCenter', 'ControlCenter'].includes(t.state)).slice(0, 4);
  const recentDoneTasks = allEdicts.filter((t) => ['Done', 'Cancelled'].includes(t.state)).slice(0, 4);
  const integratedHistoryTasks = (taskFilter === 'archived' ? archivedEdicts : archivedEdicts.slice(0, 6)).sort((a, b) => {
    const aTime = new Date(a.updatedAt || 0).getTime();
    const bTime = new Date(b.updatedAt || 0).getTime();
    return bTime - aTime;
  });
  const singleTaskMode = allEdicts.length === 1;
  const primaryTask = spotlightTasks[0] || visibleTasks[0] || null;

  const heroMetrics = [
    {
      label: pickLocaleText(locale, '活跃执行', 'Active Execution'),
      value: String(runningCount),
      detail: singleTaskMode
        ? pickLocaleText(locale, '当前仅保留一条主任务，版面改为紧凑聚焦', 'A single active mission is kept in focus with a compact layout')
        : pickLocaleText(locale, '仍在推进中的任务与流程', 'Tasks and flows still in motion'),
    },
    {
      label: pickLocaleText(locale, '阻塞风险', 'Blocked Risk'),
      value: String(blockedCount),
      detail: pickLocaleText(locale, '需要立即催办或改派的事项', 'Items that may need intervention or rerouting'),
    },
    {
      label: pickLocaleText(locale, '协同占用', 'Busy Agents'),
      value: String(busyAgentCount),
      detail: pickLocaleText(locale, '当前正参与任务或讨论的 Agent', 'Agents currently occupied by work or discussions'),
    },
    {
      label: pickLocaleText(locale, '完成率', 'Completion Rate'),
      value: `${completionRate}%`,
      detail: pickLocaleText(locale, `累计 ${completedCount}/${allEdicts.length || 0} 已结束`, `${completedCount}/${allEdicts.length || 0} completed overall`),
    },
  ];

  const singleTaskActionLabel = taskFilter === 'all'
    ? pickLocaleText(locale, '只看当前任务', 'Focus Current Task')
    : pickLocaleText(locale, '查看全部列表', 'View Full List');

  const taskBusyMap = (collabAgentBusyData?.busy || []).reduce<Record<string, CollabAgentBusyEntry[]>>((acc, entry) => {
    const taskId = entry.task_id || '';
    if (!taskId) return acc;
    if (!acc[taskId]) acc[taskId] = [];
    acc[taskId].push(entry);
    return acc;
  }, {});

  const openTask = (taskId: string) => setModalTaskId(taskId);

  const handleArchiveAll = async () => {
    if (!confirm(pickLocaleText(locale, '将所有已完成或已取消的任务单移入归档？', 'Move all completed or cancelled tasks into archive?'))) return;

    try {
      const r = await api.archiveAllDone();
      if (r.ok) {
        toast(locale === 'en' ? `📦 ${r.count || 0} task(s) archived` : `📦 ${r.count || 0} 个任务单已归档`);
        loadAll();
      } else {
        toast(r.error || pickLocaleText(locale, '批量归档失败', 'Bulk archive failed'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    }
  };

  const handleScan = async () => {
    setCheckingProgress(true);
    try {
      const r = await api.schedulerScan();
      const record: ProgressCheckRecord = {
        id: `${Date.now()}`,
        ok: !!r.ok,
        checkedAt: r.checkedAt || new Date().toISOString(),
        count: Number(r.count ?? r.actions?.length ?? 0),
        actions: Array.isArray(r.actions) ? r.actions : [],
        error: r.ok ? undefined : (r.error || pickLocaleText(locale, '检查失败', 'Check failed')),
      };
      setLastCheck(record);
      setCheckHistory((prev) => {
        const next = [record, ...prev].slice(0, 8);
        saveProgressCheckHistory(next);
        return next;
      });
      if (r.ok) {
        const nextCount = Number(r.count ?? r.actions?.length ?? 0);
        toast(
          nextCount > 0
            ? pickLocaleText(locale, `已完成检查，发现 ${nextCount} 条需要继续跟进的事项`, `Check completed. ${nextCount} item(s) need follow-up`)
            : pickLocaleText(locale, '已完成检查，当前没有需要继续处理的事项', 'Check completed. No extra follow-up is needed right now'),
        );
      } else {
        toast(record.error || pickLocaleText(locale, '检查失败', 'Check failed'), 'err');
      }
      loadAll();
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    } finally {
      setCheckingProgress(false);
    }
  };

  const renderTaskStrip = (task: Task, tone: 'default' | 'danger' | 'success' = 'default', layout: 'default' | 'compact' = 'default') => {
    const stateTone = tone === 'danger'
      ? 'rgba(255,82,112,0.08)'
      : tone === 'success'
        ? 'rgba(46,204,138,0.08)'
        : 'rgba(106,158,255,0.08)';
    const compact = layout === 'compact';
    const taskBusyEntries = taskBusyMap[task.id] || [];
    const taskBusyNames = taskBusyEntries.map((entry) => entry.name).filter(Boolean);
    const collaborationSummary = taskBusyNames.length > 0
      ? pickLocaleText(locale, `当前协同：${taskBusyNames.join('、')}`, `Collaborating: ${taskBusyNames.join(', ')}`)
      : task.currentDept
        ? pickLocaleText(locale, `当前处理环节：${task.currentDept}`, `Current step: ${task.currentDept}`)
        : pickLocaleText(locale, '处理中', 'In progress');
    const metaItems = [
      task.org,
      task.currentDept && task.currentDept !== task.org ? task.currentDept : '',
      task.eta && task.eta !== '-' ? `📅 ${task.eta}` : '',
    ].filter(Boolean);

    return (
      <button
        key={task.id}
        type="button"
        className={`mission-board__task-strip${compact ? ' mission-board__task-strip--compact' : ''}`}
        onClick={() => openTask(task.id)}
        style={{
          width: '100%',
          textAlign: 'left',
          display: 'grid',
          gap: compact ? 6 : 8,
          padding: compact ? '12px 14px' : '14px 16px',
          borderRadius: compact ? 14 : 16,
          border: '1px solid rgba(255,255,255,0.08)',
          background: stateTone,
          color: 'var(--text)',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700 }}>{task.id}</div>
          <span className={`tag st-${task.state}`}>{stateLabel(task, locale)}</span>
        </div>
        <div style={{ fontSize: compact ? 13 : 14, fontWeight: 700, lineHeight: 1.55 }}>{task.title || pickLocaleText(locale, '(无标题)', '(Untitled)')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: compact ? 1.55 : 1.7 }}>
          {task.now && task.now !== '-'
            ? task.now.slice(0, compact ? 72 : 96)
            : pickLocaleText(locale, '打开任务详情。', 'Open task details.')}
        </div>
        <div className="mission-board__task-collab">
          <span className="mission-board__task-collab-label">{pickLocaleText(locale, '协同摘要', 'Collab')}</span>
          <span className="mission-board__task-collab-value">{collaborationSummary}</span>
        </div>
        {metaItems.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {metaItems.map((item) => (
              <span
                key={`${task.id}-${item}`}
                style={{
                  fontSize: 10,
                  lineHeight: 1.2,
                  padding: '4px 8px',
                  borderRadius: 999,
                  border: '1px solid rgba(148,163,184,0.24)',
                  background: 'rgba(15,23,42,0.42)',
                  color: 'var(--text-soft)',
                }}
              >
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </button>
    );
  };

  return (
    <div className={`mission-board${singleTaskMode ? ' mission-board--single' : ''}`}>
      <div className={`mission-board__hero-shell${singleTaskMode ? ' mission-board__hero-shell--single' : ''}`}>
        <section className="mission-board__hero-panel">
          <div className="mission-board__hero-copy">
            <div className="mission-board__hero-brand">
              <div className="mission-board__hero-logo mission-board__hero-logo--section" aria-hidden="true"><LayoutDashboard size={20} /></div>
              <div>
                <div className="ec-id">{pickLocaleText(locale, singleTaskMode ? '任务详情' : '今日态势', singleTaskMode ? 'Task Detail' : 'Today Overview')}</div>
                <div className="mission-board__hero-title">
                  {pickLocaleText(
                    locale,
                    singleTaskMode ? '当前任务' : '当前任务态势',
                    singleTaskMode ? 'Current Task' : 'Current Mission Snapshot',
                  )}
                </div>
              </div>
            </div>
          </div>

          {singleTaskMode ? (
            <div
              style={{
                display: 'grid',
                gap: 12,
                padding: 14,
                borderRadius: 18,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                {[
                  {
                    label: pickLocaleText(locale, '发布', 'Publish'),
                    detail: pickLocaleText(locale, '新建任务', 'New task'),
                  },
                  {
                    label: pickLocaleText(locale, '进入', 'Enter'),
                    detail: pickLocaleText(locale, '打开当前任务', 'Open current task'),
                  },
                  {
                    label: pickLocaleText(locale, '检查', 'Check'),
                    detail: pickLocaleText(locale, '查看状态', 'Check status'),
                  },
                  {
                    label: pickLocaleText(locale, '处置', 'Handle'),
                    detail: pickLocaleText(locale, '继续处理', 'Continue handling'),
                  },
                ].map((item) => (
                  <div key={item.label} className="mission-board__metric-card" style={{ minHeight: 0 }}>
                    <div className="mission-board__metric-label">{item.label}</div>
                    <div className="mission-board__metric-detail" style={{ marginTop: 8 }}>{item.detail}</div>
                  </div>
                ))}
              </div>
              <div className="mission-board__quick-create" style={{ marginTop: 0 }}>
                <InlineQuickCreatePanel onSubmitSuccess={() => loadAll()} />
              </div>
            </div>
          ) : (
            <>
              <div className="mission-board__metric-grid">
                {heroMetrics.map((item) => (
                  <div key={item.label} className="mission-board__metric-card">
                    <div className="mission-board__metric-label">{item.label}</div>
                    <div className="mission-board__metric-value">{item.value}</div>
                    <div className="mission-board__metric-detail">{item.detail}</div>
                  </div>
                ))}
              </div>

              <div className="mission-board__quick-create">
                <InlineQuickCreatePanel onSubmitSuccess={() => loadAll()} />
              </div>
            </>
          )}
        </section>

        <section className={`mission-board__workspace-panel${singleTaskMode ? ' mission-board__workspace-panel--single' : ''}`}>
          <div className="mission-board__panel-topline">
            <div>
              <div className="ec-id">{pickLocaleText(locale, singleTaskMode ? '当前任务' : '最近工作区', singleTaskMode ? 'Current Task' : 'Recent Workspaces')}</div>
              <div className="mission-board__panel-title">
                {pickLocaleText(
                  locale,
                  singleTaskMode ? '当前任务' : '任务列表',
                  singleTaskMode ? 'Current task' : 'Task list',
                )}
              </div>
            </div>
          </div>


          {singleTaskMode && primaryTask ? (
            <div className="mission-board__focus-summary">
              <span className="chip ok">{pickLocaleText(locale, '当前唯一任务', 'Only Active Task')}</span>
              <span className={`tag st-${primaryTask.state}`}>{stateLabel(primaryTask, locale)}</span>
              {primaryTask.org ? <span className="chip">{primaryTask.org}</span> : null}
              {attentionCount > 0 ? <span className="chip err">{pickLocaleText(locale, `待处置 ${attentionCount}`, `${attentionCount} need handling`)}</span> : null}
            </div>
          ) : null}

          <div className={`mission-board__workspace-list${singleTaskMode ? ' mission-board__workspace-list--single' : ''}`}>
            {spotlightTasks.length > 0
              ? (singleTaskMode && primaryTask
                ? renderTaskStrip(primaryTask, ['Blocked', 'Review', 'ReviewCenter'].includes(primaryTask.state) ? 'danger' : 'default', 'compact')
                : spotlightTasks.map((task) => renderTaskStrip(task, ['Blocked', 'Review', 'ReviewCenter'].includes(task.state) ? 'danger' : 'default')))
              : (
                <div className="empty" style={{ padding: 18 }}>
                  {pickLocaleText(locale, '暂无进行中任务', 'No active task')}
                </div>
              )}
          </div>

          <div className={`mission-board__workspace-actions${singleTaskMode ? ' mission-board__workspace-actions--single' : ''}`}>
            {singleTaskMode && primaryTask ? <button className="ab-btn active" onClick={() => openTask(primaryTask.id)}>{pickLocaleText(locale, '进入当前任务', 'Open Current Task')}</button> : null}
            <button className="ab-scan" onClick={handleScan} disabled={checkingProgress}>{checkingProgress ? pickLocaleText(locale, '检查中…', 'Checking...') : pickLocaleText(locale, '检查进度', 'Check Progress')}</button>
            {singleTaskMode ? (
              <button className="ab-btn" onClick={unArchivedDone.length > 0 ? handleArchiveAll : () => setTaskFilter(taskFilter === 'all' ? 'active' : 'all')}>
                {unArchivedDone.length > 0
                  ? pickLocaleText(locale, '处置已完成项', 'Handle Completed Items')
                  : singleTaskActionLabel}
              </button>
            ) : (
              <button className="ab-btn" onClick={() => setTaskFilter('active')}>
                {pickLocaleText(locale, '只看活跃任务', 'Show Active Only')}
              </button>
            )}
          </div>
        </section>
      </div>

      {!singleTaskMode ? (
        <section className="mission-board__lane-shell">
          <div className="mission-board__section-topline">
            <div>
              <div className="ec-id">{pickLocaleText(locale, '执行分区', 'Execution Lanes')}</div>
              <div className="mission-board__section-title">{pickLocaleText(locale, '按状态查看任务', 'Browse tasks by status')}</div>
            </div>
            <div className="archive-bar mission-board__filter-bar" style={{ margin: 0 }}>
              <span className="ab-label">{pickLocaleText(locale, '筛选:', 'Filter:')}</span>
              {(['active', 'archived', 'all'] as const).map((f) => (
                <button
                  key={f}
                  className={`ab-btn ${taskFilter === f ? 'active' : ''}`}
                  onClick={() => setTaskFilter(f)}
                >
                  {f === 'active' ? pickLocaleText(locale, '活跃', 'Active') : f === 'archived' ? pickLocaleText(locale, '归档', 'Archived') : pickLocaleText(locale, '全部', 'All')}
                </button>
              ))}
              {unArchivedDone.length > 0 ? <button className="ab-btn" onClick={handleArchiveAll}>{pickLocaleText(locale, '📦 一键归档', '📦 Archive All')}</button> : null}
            </div>
          </div>

          <div className="mission-board__lane-grid">
            <div className="mission-board__lane mission-board__lane--danger">
              <div className="mission-board__lane-head">
                <div className="mission-board__lane-title">{pickLocaleText(locale, '优先关注', 'Priority Attention')}</div>
                <span className="chip err">{attentionCount}</span>
              </div>
              <div className="mission-board__lane-text">{pickLocaleText(locale, '需要优先处理', 'Needs attention')}</div>
              <div className="mission-board__lane-list">
                {attentionTasks.length > 0
                  ? attentionTasks.slice(0, 4).map((task) => renderTaskStrip(task, 'danger'))
                  : <div className="empty" style={{ padding: 18 }}>{pickLocaleText(locale, '暂无重点事项', 'No priority item')}</div>}
              </div>
            </div>

            <div className="mission-board__lane mission-board__lane--primary">
              <div className="mission-board__lane-head">
                <div className="mission-board__lane-title">{pickLocaleText(locale, '推进中', 'In Motion')}</div>
                <span className="chip ok">{runningTasks.length}</span>
              </div>
              <div className="mission-board__lane-text">{pickLocaleText(locale, '当前进行中', 'Currently active')}</div>
              <div className="mission-board__lane-list">
                {runningTasks.length > 0
                  ? runningTasks.map((task) => renderTaskStrip(task))
                  : <div className="empty" style={{ padding: 18 }}>{pickLocaleText(locale, '暂无进行中任务', 'No active task')}</div>}
              </div>
            </div>

            <div className="mission-board__lane mission-board__lane--success">
              <div className="mission-board__lane-head">
                <div className="mission-board__lane-title">{pickLocaleText(locale, '最近完成', 'Recently Completed')}</div>
                <span className="chip ok">{recentDoneTasks.length}</span>
              </div>
              <div className="mission-board__lane-text">{pickLocaleText(locale, '最近结束', 'Recently finished')}</div>
              <div className="mission-board__lane-list">
                {recentDoneTasks.length > 0
                  ? recentDoneTasks.map((task) => renderTaskStrip(task, 'success'))
                  : <div className="empty" style={{ padding: 18 }}>{pickLocaleText(locale, '暂无已完成任务', 'No completed task')}</div>}
              </div>
            </div>
          </div>
        </section>
      ) : attentionCount > 0 ? (
        <section className="mission-board__lane-shell" style={{ paddingTop: 18, paddingBottom: 18 }}>
          <div className="mission-board__section-topline" style={{ marginBottom: 12 }}>
            <div>
              <div className="ec-id">{pickLocaleText(locale, '待处置事项', 'Items Requiring Handling')}</div>
              <div className="mission-board__section-title">{pickLocaleText(locale, '当前待处理', 'Pending now')}</div>
            </div>
          </div>
          <div className="mission-board__workspace-list mission-board__workspace-list--single">
            {attentionTasks.slice(0, 4).map((task) => renderTaskStrip(task, 'danger', 'compact'))}
          </div>
        </section>
      ) : null}

      {(checkingProgress || lastCheck || checkHistory.length > 0) ? (
        <section className="mission-board__insight-shell">
          <div className="mission-board__section-topline">
            <div>
              <div className="ec-id">{pickLocaleText(locale, '进度检查', 'Progress Check')}</div>
              <div className="mission-board__section-title">{pickLocaleText(locale, '最近检查记录', 'Recent checks')}</div>
            </div>
            {checkHistory.length > 0 ? (
              <button
                className="chip"
                onClick={() => {
                  setCheckHistory([]);
                  saveProgressCheckHistory([]);
                  setLastCheck(null);
                }}
                style={{ cursor: 'pointer' }}
              >
                {pickLocaleText(locale, '清空记录', 'Clear History')}
              </button>
            ) : null}
          </div>

          <div className="mission-board__insight-grid">
            <div className="mission-board__insight-card">
              <div className="mission-board__insight-head">
                <div className="mission-board__insight-title">{pickLocaleText(locale, '本次结果', 'Latest Result')}</div>
                <span className={`chip ${lastCheck?.ok ? 'ok' : ''}`}>{checkingProgress ? pickLocaleText(locale, '检查中…', 'Checking...') : lastCheck ? formatCheckTime(locale, lastCheck.checkedAt) : pickLocaleText(locale, '等待检查', 'Waiting for a check')}</span>
              </div>
              <div className="mission-board__insight-value">{checkingProgress ? '...' : String(lastCheck?.count || 0)}</div>
              <div className="mission-board__insight-text">
                {checkingProgress
                  ? pickLocaleText(locale, '正在查看当前事项是否有需要继续跟进、重新安排或提醒处理的地方。', 'Checking whether any item needs follow-up, re-arrangement, or extra attention.')
                  : lastCheck
                    ? ((lastCheck.count || 0) > 0
                      ? pickLocaleText(locale, `最近一次检查发现 ${lastCheck.count} 条需要继续跟进的事项。`, `The latest check found ${lastCheck.count} item(s) that need follow-up.`)
                      : pickLocaleText(locale, '最近一次检查未发现需要额外处理的事项。', 'The latest check found no item that needs extra handling.'))
                    : pickLocaleText(locale, '运行一次检查后，这里会显示整理摘要。', 'Run a check once and the summary will appear here.')}
              </div>
              {lastCheck?.actions?.length ? (
                <div className="mission-board__action-note-list">
                  {lastCheck.actions.slice(0, 3).map((item, index) => (
                    <div key={`${item.taskId}-${index}`} className="mission-board__action-note">
                      {describeProgressAction(locale, item)}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mission-board__insight-card">
              <div className="mission-board__insight-head">
                <div className="mission-board__insight-title">{pickLocaleText(locale, '最近记录', 'Recent History')}</div>
                <span className="mission-board__hint-text">{pickLocaleText(locale, `保留最近 ${Math.min(checkHistory.length || 8, 8)} 次`, `Keep the latest ${Math.min(checkHistory.length || 8, 8)} checks`)}</span>
              </div>
              {checkHistory.length === 0 ? (
                <div className="mission-board__insight-text">{pickLocaleText(locale, '还没有历史记录。完成一次检查后，这里会自动保留摘要。', 'No history yet. After a check is completed, a summary will be kept here automatically.')}</div>
              ) : (
                <div className="mission-board__history-list">
                  {checkHistory.map((record) => (
                    <div key={record.id} className="mission-board__history-item">
                      <div className="mission-board__history-head">
                        <div className="mission-board__history-time">{formatCheckTime(locale, record.checkedAt)}</div>
                        <span className={`chip ${record.ok ? 'ok' : ''}`}>{record.ok ? pickLocaleText(locale, `${record.count} 条需跟进`, `${record.count} to follow up`) : pickLocaleText(locale, '未完成', 'Incomplete')}</span>
                      </div>
                      <div className="mission-board__insight-text">
                        {record.ok
                          ? ((record.actions || []).length
                            ? describeProgressAction(locale, record.actions[0])
                            : pickLocaleText(locale, '当次检查没有发现需要额外处理的事项。', 'No extra action was needed in that check.'))
                          : (record.error || pickLocaleText(locale, '该次检查未成功完成。', 'That check did not complete successfully.'))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section className={`mission-board__catalog-shell${visibleTasks.length === 1 ? ' mission-board__catalog-shell--single' : ''}`}>
        <div className="mission-board__section-topline">
          <div>
            <div className="ec-id">{pickLocaleText(locale, visibleTasks.length === 1 ? '当前任务卡' : '完整任务列表', visibleTasks.length === 1 ? 'Current Task Card' : 'Full Mission Grid')}</div>
            <div className="mission-board__section-title">{pickLocaleText(locale, visibleTasks.length === 1 ? '任务详情' : '任务列表', visibleTasks.length === 1 ? 'Task Details' : 'Task List')}</div>
          </div>
          <div className="mission-board__hint-text">
            {locale === 'en' ? `Active ${activeEdicts.length} · Archived ${archivedEdicts.length} · Total ${allEdicts.length}` : `活跃 ${activeEdicts.length} · 归档 ${archivedEdicts.length} · 共 ${allEdicts.length}`}
          </div>
        </div>

        <div className={`edict-grid${visibleTasks.length === 1 ? ' edict-grid--single' : ''}`}>
          {visibleTasks.length === 0 ? (
            <div className="empty" style={{ gridColumn: '1/-1' }}>
              {pickLocaleText(locale, '暂无任务单', 'No tasks yet')}<br />
              <small style={{ fontSize: 11, marginTop: 6, display: 'block', color: 'var(--muted)' }}>
                {pickLocaleText(locale, '可在上方新建任务。', 'Create a task above.')}
              </small>
            </div>
          ) : (
            visibleTasks.map((t) => <EdictCard key={t.id} task={t} busyEntries={taskBusyMap[t.id] || []} />)
          )}
        </div>
      </section>

      <section className="mission-board__catalog-shell">
        <div className="mission-board__section-topline">
          <div>
            <div className="ec-id">{pickLocaleText(locale, '历史任务整合区', 'Integrated Task History')}</div>
            <div className="mission-board__section-title">{pickLocaleText(locale, '历史任务', 'Task History')}</div>
          </div>
          <div className="archive-bar mission-board__filter-bar" style={{ margin: 0 }}>
            <span className="ab-label">{pickLocaleText(locale, '历史视图:', 'History View:')}</span>
            <button className={`ab-btn ${taskFilter === 'archived' ? 'active' : ''}`} onClick={() => setTaskFilter(taskFilter === 'archived' ? 'all' : 'archived')}>
              {taskFilter === 'archived' ? pickLocaleText(locale, '返回综合视图', 'Back to Combined View') : pickLocaleText(locale, '查看全部归档', 'View All Archived')}
            </button>
            {taskFilter !== 'active' ? <button className="ab-btn" onClick={() => setTaskFilter('active')}>{pickLocaleText(locale, '回到活跃任务', 'Back to Active')}</button> : null}
          </div>
        </div>

        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.8, marginBottom: 14 }}>
          {pickLocaleText(locale, '这里聚合已归档、已完成或已取消的历史任务，方便回看结果、恢复上下文和继续复盘，而不会破坏上方详细任务卡在单任务模式下的紧凑高度。', 'This section gathers archived, completed, or cancelled work for review, context recovery, and retrospective follow-up without disturbing the compact card height used above in single-task mode.')}
        </div>

        <div className={`mission-board__workspace-list${singleTaskMode ? ' mission-board__workspace-list--single' : ''}`}>
          {integratedHistoryTasks.length > 0 ? (
            integratedHistoryTasks.map((task) => renderTaskStrip(task, 'success', singleTaskMode ? 'compact' : 'default'))
          ) : (
            <div className="empty" style={{ padding: 18 }}>
              {pickLocaleText(locale, '当前没有历史任务。', 'There is no task history yet.')}
            </div>
          )}
        </div>
      </section>

      {showQuickCreate && (
        <QuickCreateTaskModal
          onClose={() => setShowQuickCreate(false)}
          onSubmitSuccess={() => loadAll()}
        />
      )}
    </div>
  );
}

