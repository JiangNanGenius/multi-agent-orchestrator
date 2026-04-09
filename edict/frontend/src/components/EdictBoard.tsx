import { type FormEvent, useMemo, useState } from 'react';
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
  owner: '面板值守',
  autoAssign: true,
  targetDepts: [],
  priority: 'normal',
};

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
    owner: form.owner.trim() || (locale === 'en' ? 'Dashboard Operator' : '面板值守'),
    priority: form.priority,
    ...(form.autoAssign || !normalizedTargets.length
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
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '协助处理的人（可选）', 'Helpers (Optional)')}</span>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`chip ${form.autoAssign ? 'ok' : ''}`}
          onClick={() => onModeChange(true)}
          style={{ cursor: 'pointer' }}
        >
          {pickLocaleText(locale, '自动分配', 'Auto assign')}
        </button>
        <button
          type="button"
          className={`chip ${!form.autoAssign ? 'ok' : ''}`}
          onClick={() => onModeChange(false)}
          style={{ cursor: 'pointer' }}
        >
          {pickLocaleText(locale, '指定助手', 'Choose assistants')}
        </button>
      </div>
      {!form.autoAssign ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {targetOptions.map((dept) => {
            const active = form.targetDepts.includes(dept.id);
            return (
              <button
                key={dept.id}
                type="button"
                className="chip"
                onClick={() => onToggleTarget(dept.id)}
                style={{
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
      ) : null}
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
        {form.autoAssign
          ? pickLocaleText(locale, '当前为自动安排，我们会根据内容选择合适的处理人。', 'Auto assignment is on. The system will choose suitable assistants based on the task.')
          : form.targetDepts.length
            ? pickLocaleText(locale, `已指定 ${form.targetDepts.length} 位处理助手：${form.targetDepts.map((id) => targetOptions.find((item) => item.id === id)?.label || id).join('、')}`, `Selected ${form.targetDepts.length} assistant(s): ${form.targetDepts.map((id) => targetOptions.find((item) => item.id === id)?.label || id).join(', ')}`)
            : pickLocaleText(locale, '请至少选择一位处理人，或切回自动安排。', 'Select at least one assistant, or switch back to auto assignment.')}
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

function renderBusyStateLabel(entry: CollabAgentBusyEntry): string {
  const source = entry.occupancy_kind || entry.source_type || '';
  if (source === 'task_active') return '任务执行中';
  if (source === 'task_reserved') return '任务预占中';
  if (source === 'task_paused') return '任务暂停中';
  if (source === 'task_blocked') return '任务阻塞中';
  if (source === 'meeting') return '协作处理中';
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
    if (!form.autoAssign && !form.targetDepts.length) {
      toast(pickLocaleText(locale, '请至少选择一位处理助手，或切回自动安排', 'Select at least one assistant, or switch back to auto assignment'), 'err');
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
            '你只需要填写内容和紧急程度，我们会为你安排合适的人继续处理。',
            'Fill in the request and urgency, and we will arrange the right people to continue the work.',
          )}
        </div>

        <form className="auth-form two-col" onSubmit={handleSubmit}>
          <label className="auth-label auth-full">
              <span>{pickLocaleText(locale, '事项标题', 'Title')}</span>
            <input
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder={pickLocaleText(locale, '例如：整理本周发布说明并同步测试结论', 'Example: Prepare this week\'s release notes and sync test conclusions')}
              autoFocus
            />
          </label>

          <label className="auth-label">
              <span>{pickLocaleText(locale, '分配方式', 'Assignment')}</span>
            <input
              value={pickLocaleText(locale, '系统自动安排', 'Automatic Assignment')}
              readOnly
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'rgba(106,239,154,0.08)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}
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
              placeholder={pickLocaleText(locale, '例如：产品运营值守', 'Example: Product Operations Desk')}
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
    if (!form.autoAssign && !form.targetDepts.length) {
      toast(pickLocaleText(locale, '请至少选择一位处理助手，或切回自动安排', 'Select at least one assistant, or switch back to auto assignment'), 'err');
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
    <form
      onSubmit={handleSubmit}
      style={{
        marginBottom: 16,
        padding: 16,
        borderRadius: 18,
        border: '1px solid var(--line)',
        background: 'linear-gradient(135deg, rgba(92,123,255,0.08), rgba(76,195,138,0.06))',
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
            {pickLocaleText(locale, '快速发布任务', 'Quick Task Launch')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            {pickLocaleText(locale, '你可以直接在这里写下待办事项，系统会按优先级与目标助手继续安排后续步骤。', 'Describe the task here and the system will continue routing it by priority and selected assistants.')}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 2fr) repeat(4, minmax(140px, 1fr)) auto', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '事项标题', 'Title')}</span>
          <input
            value={form.title}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder={pickLocaleText(locale, '例如：整理本周版本发布说明并同步测试结论', 'Example: Prepare this week\'s release notes and sync QA conclusions')}
            style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '处理方式', 'Handling Mode')}</span>
          <input value={pickLocaleText(locale, '自动安排', 'Automatic Assignment')} readOnly style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'rgba(106,239,154,0.08)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }} />
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
          <input value={form.owner} onChange={(e) => updateField('owner', e.target.value)} placeholder={pickLocaleText(locale, '例如：产品运营值守', 'Example: Product Operations Desk')} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }} />
        </label>
        <div style={{ display: 'grid', gap: 6, minWidth: 280 }}>
          <TargetExpertSelector
            locale={locale}
            form={form}
            targetOptions={targetOptions}
            onModeChange={handleModeChange}
            onToggleTarget={toggleTargetDept}
          />
        </div>
        <button type="submit" className="auth-primary" disabled={submitting} style={{ width: 'auto', minWidth: 140, height: 44 }}>
          {submitting ? pickLocaleText(locale, '发布中…', 'Publishing...') : pickLocaleText(locale, '发布任务', 'Publish Task')}
        </button>
      </div>
    </form>
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
    ? `${renderBusyStateLabel(busyLead)} · ${busyNames.join('、')}`
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
        ? pickLocaleText(locale, '轻量任务', 'Lightweight')
        : pickLocaleText(locale, '标准任务', 'Standard'),
      color: lightweight ? '#67e8a5' : '#cbd5e1',
      bg: lightweight ? '#0f2219' : 'rgba(148,163,184,0.10)',
      border: lightweight ? '#4cc38a44' : 'rgba(148,163,184,0.25)',
    });
  }

  if (projectSizeEstimate >= 50 || storageTier === 'cold') {
    workspaceChips.push({
      text: projectSizeEstimate >= 50
        ? pickLocaleText(locale, `超大任务 · ${projectSizeEstimate.toFixed(projectSizeEstimate >= 100 ? 0 : 1)}GB`, `Large Task · ${projectSizeEstimate.toFixed(projectSizeEstimate >= 100 ? 0 : 1)}GB`)
        : pickLocaleText(locale, '冷盘任务', 'Cold-tier Task'),
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
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [checkingProgress, setCheckingProgress] = useState(false);
  const [lastCheck, setLastCheck] = useState<ProgressCheckRecord | null>(null);
  const [checkHistory, setCheckHistory] = useState<ProgressCheckRecord[]>(() => loadProgressCheckHistory());

  const tasks = liveStatus?.tasks || [];
  const allEdicts = tasks.filter(isEdict);
  const activeEdicts = allEdicts.filter((t) => !isArchived(t));
  const archivedEdicts = allEdicts.filter((t) => isArchived(t));

  let visibleTasks: Task[];
  if (taskFilter === 'active') visibleTasks = activeEdicts;
  else if (taskFilter === 'archived') visibleTasks = archivedEdicts;
  else visibleTasks = allEdicts;

  visibleTasks.sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9));

  const unArchivedDone = allEdicts.filter((t) => !t.archived && ['Done', 'Cancelled'].includes(t.state));
  const taskBusyMap = (collabAgentBusyData?.busy || []).reduce<Record<string, CollabAgentBusyEntry[]>>((acc, entry) => {
    const taskId = entry.task_id || '';
    if (!taskId) return acc;
    if (!acc[taskId]) acc[taskId] = [];
    acc[taskId].push(entry);
    return acc;
  }, {});

  const handleArchiveAll = async () => {
    if (!confirm(pickLocaleText(locale, '将所有已完成或已取消的任务单移入归档？', 'Move all completed or cancelled tasks into archive?'))) return;

    try {
      const r = await api.archiveAllDone();
      if (r.ok) { toast(locale === 'en' ? `📦 ${r.count || 0} task(s) archived` : `📦 ${r.count || 0} 个任务单已归档`); loadAll(); }
      else toast(r.error || pickLocaleText(locale, '批量归档失败', 'Bulk archive failed'), 'err');
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

  return (
    <div>
      <div className="archive-bar">
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
        <button className="ab-btn" onClick={() => setShowQuickCreate(true)}>
          {pickLocaleText(locale, '＋ 高级发布', '+ Advanced Create')}
        </button>
        {unArchivedDone.length > 0 && (
          <button className="ab-btn" onClick={handleArchiveAll}>{pickLocaleText(locale, '📦 一键归档', '📦 Archive All')}</button>
        )}
        <span className="ab-count">
          {locale === 'en' ? `Active ${activeEdicts.length} · Archived ${archivedEdicts.length} · Total ${allEdicts.length}` : `活跃 ${activeEdicts.length} · 归档 ${archivedEdicts.length} · 共 ${allEdicts.length}`}
        </span>
        <button className="ab-scan" onClick={handleScan} disabled={checkingProgress}>{checkingProgress ? pickLocaleText(locale, '检查中…', 'Checking...') : pickLocaleText(locale, '检查进度', 'Check Progress')}</button>
      </div>

      <InlineQuickCreatePanel onSubmitSuccess={() => loadAll()} />

      {(checkingProgress || lastCheck || checkHistory.length > 0) ? (
        <div style={{ marginBottom: 16, padding: 16, borderRadius: 18, border: '1px solid var(--line)', background: 'var(--panel2)', display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{pickLocaleText(locale, '检查进度', 'Progress Check')}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginTop: 4 }}>
                {pickLocaleText(locale, '这里会显示最近一次检查结果，以及最近几次自动整理出的跟进记录。', 'This area shows the latest progress check and the recent follow-up records collected from checks.')}
              </div>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.1fr)', gap: 12 }}>
            <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{pickLocaleText(locale, '本次结果', 'Latest Result')}</div>
                <span className={`chip ${lastCheck?.ok ? 'ok' : ''}`}>{checkingProgress ? pickLocaleText(locale, '检查中…', 'Checking...') : lastCheck ? formatCheckTime(locale, lastCheck.checkedAt) : pickLocaleText(locale, '等待检查', 'Waiting for a check')}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>
                {checkingProgress ? '...' : String(lastCheck?.count || 0)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                {checkingProgress
                  ? pickLocaleText(locale, '正在查看当前事项是否有需要继续跟进、重新安排或提醒处理的地方。', 'Checking whether any item needs follow-up, re-arrangement, or extra attention.')
                  : lastCheck?.ok
                    ? ((lastCheck.count || 0) > 0
                      ? pickLocaleText(locale, `最近一次检查发现 ${lastCheck.count} 条需要继续跟进的事项。`, `The latest check found ${lastCheck.count} item(s) that need follow-up.`)
                      : pickLocaleText(locale, '最近一次检查未发现需要额外处理的事项。', 'The latest check found no item that needs extra handling.'))
                    : (lastCheck?.error || pickLocaleText(locale, '最近一次检查未成功完成。', 'The latest check did not complete successfully.'))}
              </div>
              {lastCheck?.actions?.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {lastCheck.actions.slice(0, 3).map((item, index) => (
                    <div key={`${item.taskId}-${index}`} style={{ fontSize: 12, lineHeight: 1.7, padding: '10px 12px', borderRadius: 12, background: 'rgba(122,162,255,0.08)', border: '1px solid rgba(122,162,255,0.14)' }}>
                      {describeProgressAction(locale, item)}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{pickLocaleText(locale, '最近记录', 'Recent History')}</div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pickLocaleText(locale, `保留最近 ${Math.min(checkHistory.length || 8, 8)} 次`, `Keep the latest ${Math.min(checkHistory.length || 8, 8)} checks`)}</span>
              </div>
              {checkHistory.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>{pickLocaleText(locale, '还没有历史记录。完成一次检查后，这里会自动保留摘要。', 'No history yet. After a check is completed, a summary will be kept here automatically.')}</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {checkHistory.map((record) => (
                    <div key={record.id} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', display: 'grid', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{formatCheckTime(locale, record.checkedAt)}</div>
                        <span className={`chip ${record.ok ? 'ok' : ''}`}>{record.ok ? pickLocaleText(locale, `${record.count} 条需跟进`, `${record.count} to follow up`) : pickLocaleText(locale, '未完成', 'Incomplete')}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
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
        </div>
      ) : null}

      <div className="edict-grid">
        {visibleTasks.length === 0 ? (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            {pickLocaleText(locale, '暂无任务单', 'No tasks yet')}<br />
            <small style={{ fontSize: 11, marginTop: 6, display: 'block', color: 'var(--muted)' }}>
              {pickLocaleText(locale, '你可以直接从看板发布新任务，或通过提示词中心、搜索面板等入口把需求送入同一协作流程。', 'You can launch a task directly from the board, or send work into the same workflow through the Prompt Center or the search panel.')}
            </small>
          </div>
        ) : (
          visibleTasks.map((t) => <EdictCard key={t.id} task={t} busyEntries={taskBusyMap[t.id] || []} />)
        )}
      </div>

      {showQuickCreate && (
        <QuickCreateTaskModal
          onClose={() => setShowQuickCreate(false)}
          onSubmitSuccess={() => loadAll()}
        />
      )}
    </div>
  );
}
