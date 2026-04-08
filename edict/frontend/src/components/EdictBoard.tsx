import { useMemo, useState, type FormEvent } from 'react';
import { useStore, getPipeStatus, stateLabel, deptColor, isArchived, isEdict, getSchedulerSummary, DEPTS } from '../store';
import { api, type Task, type CollabAgentBusyEntry, type CreateTaskPayload } from '../api';
import { pickLocaleText } from '../i18n';

// 排序权重
const STATE_ORDER: Record<string, number> = {
  Doing: 0, Review: 1, Assigned: 2, ReviewCenter: 3, PlanCenter: 4,
  ControlCenter: 5, Inbox: 6, Blocked: 7, Next: 8, Done: 9, Cancelled: 10,
};

type QuickCreateForm = {
  title: string;
  org: string;
  owner: string;
  targetDept: string;
  priority: 'low' | 'normal' | 'high';
};

const DEFAULT_FORM: QuickCreateForm = {
  title: '',
  org: '总控中心',
  owner: '面板值守',
  targetDept: '',
  priority: 'normal',
};

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
  if (source === 'meeting') return '会议占用中';
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
    () => DEPTS.filter((dept) => dept.id !== 'control_center'),
    [],
  );

  const updateField = <K extends keyof QuickCreateForm>(key: K, value: QuickCreateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      toast(pickLocaleText(locale, '请先填写任务标题', 'Please enter a task title'), 'err');
      return;
    }

    const payload: CreateTaskPayload = {
      title,
      org: form.org,
      owner: form.owner.trim() || (locale === 'en' ? 'Dashboard Operator' : '面板值守'),
      priority: form.priority,
      ...(form.targetDept ? { targetDept: form.targetDept } : {}),
    };

    setSubmitting(true);
    try {
      const result = await api.createTask(payload);
      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '任务发布失败', 'Failed to create task'), 'err');
        return;
      }
      toast(
        result.message ||
          pickLocaleText(locale, '任务已发布到执行看板', 'Task has been created on the board'),
      );
      setForm(DEFAULT_FORM);
      onSubmitSuccess();
      onClose();
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-bg open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-id">{pickLocaleText(locale, '快速建任务', 'Quick Create Task')}</div>
        <div className="modal-title">{pickLocaleText(locale, '在面板内直接发布任务', 'Create and dispatch a task from the board')}</div>
        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginBottom: 18 }}>
          {pickLocaleText(
            locale,
            '适合临时加派、人工补录和控制台直接下发。提交后任务会进入现有调度链路，并同步全局忙碌状态。',
            'Use this for urgent assignment, manual intake, or direct operations dispatch. The task will enter the existing execution pipeline and update the global busy state after submission.',
          )}
        </div>

        <form className="auth-form two-col" onSubmit={handleSubmit}>
          <label className="auth-label auth-full">
            <span>{pickLocaleText(locale, '任务标题', 'Task Title')}</span>
            <input
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder={pickLocaleText(locale, '例如：整理本周版本发布说明并同步测试结论', 'Example: Prepare this week\'s release notes and sync QA conclusions')}
              autoFocus
            />
          </label>

          <label className="auth-label">
            <span>{pickLocaleText(locale, '进入节点', 'Entry Node')}</span>
            <select
              value={form.org}
              onChange={(e) => updateField('org', e.target.value)}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}
            >
              <option value="总控中心">{pickLocaleText(locale, '总控中心', 'Control Center')}</option>
              <option value="规划中心">{pickLocaleText(locale, '规划中心', 'Plan Center')}</option>
              <option value="评审中心">{pickLocaleText(locale, '评审中心', 'Review Center')}</option>
              <option value="调度中心">{pickLocaleText(locale, '调度中心', 'Dispatch Center')}</option>
            </select>
          </label>

          <label className="auth-label">
            <span>{pickLocaleText(locale, '优先级', 'Priority')}</span>
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
            <span>{pickLocaleText(locale, '发布人', 'Requester')}</span>
            <input
              value={form.owner}
              onChange={(e) => updateField('owner', e.target.value)}
              placeholder={pickLocaleText(locale, '例如：产品运营值守', 'Example: Product Operations Desk')}
            />
          </label>

          <label className="auth-label">
            <span>{pickLocaleText(locale, '目标执行角色（可选）', 'Target Execution Role (Optional)')}</span>
            <select
              value={form.targetDept}
              onChange={(e) => updateField('targetDept', e.target.value)}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}
            >
              <option value="">{pickLocaleText(locale, '自动分配', 'Auto assign')}</option>
              {targetOptions.map((dept) => (
                <option key={dept.id} value={dept.label}>{dept.emoji} {dept.label}</option>
              ))}
            </select>
          </label>

          <div className="auth-full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" className="btn-refresh" onClick={onClose} disabled={submitting}>
              {pickLocaleText(locale, '取消', 'Cancel')}
            </button>
            <button type="submit" className="auth-primary" disabled={submitting} style={{ width: 'auto', minWidth: 140 }}>
              {submitting ? pickLocaleText(locale, '发布中…', 'Creating...') : pickLocaleText(locale, '发布任务', 'Create Task')}
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
    () => DEPTS.filter((dept) => dept.id !== 'control_center'),
    [],
  );

  const updateField = <K extends keyof QuickCreateForm>(key: K, value: QuickCreateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      toast(pickLocaleText(locale, '请先填写任务标题', 'Please enter a task title'), 'err');
      return;
    }

    const payload: CreateTaskPayload = {
      title,
      org: form.org,
      owner: form.owner.trim() || (locale === 'en' ? 'Dashboard Operator' : '面板值守'),
      priority: form.priority,
      ...(form.targetDept ? { targetDept: form.targetDept } : {}),
    };

    setSubmitting(true);
    try {
      const result = await api.createTask(payload);
      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '任务发布失败', 'Failed to create task'), 'err');
        return;
      }
      toast(result.message || pickLocaleText(locale, '任务已发布到执行看板', 'Task has been created on the board'));
      setForm(DEFAULT_FORM);
      onSubmitSuccess();
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
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
            {pickLocaleText(locale, '直接发布任务', 'Publish Task Directly')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            {pickLocaleText(locale, '在任务看板顶部直接输入并下发任务，无需先打开弹窗。发布后会立即进入现有调度链路，并同步专家忙碌状态。', 'Create and dispatch tasks directly from the top of the board without opening a modal. Submitted tasks enter the current workflow immediately and update global agent occupancy.')}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 2fr) repeat(4, minmax(140px, 1fr)) auto', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '任务标题', 'Task Title')}</span>
          <input
            value={form.title}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder={pickLocaleText(locale, '例如：整理本周版本发布说明并同步测试结论', 'Example: Prepare this week\'s release notes and sync QA conclusions')}
            style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '进入节点', 'Entry Node')}</span>
          <select value={form.org} onChange={(e) => updateField('org', e.target.value)} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}>
            <option value="总控中心">{pickLocaleText(locale, '总控中心', 'Control Center')}</option>
            <option value="规划中心">{pickLocaleText(locale, '规划中心', 'Plan Center')}</option>
            <option value="评审中心">{pickLocaleText(locale, '评审中心', 'Review Center')}</option>
            <option value="调度中心">{pickLocaleText(locale, '调度中心', 'Dispatch Center')}</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '优先级', 'Priority')}</span>
          <select value={form.priority} onChange={(e) => updateField('priority', e.target.value as QuickCreateForm['priority'])} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}>
            <option value="low">{pickLocaleText(locale, '低', 'Low')}</option>
            <option value="normal">{pickLocaleText(locale, '中', 'Normal')}</option>
            <option value="high">{pickLocaleText(locale, '高', 'High')}</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '发布人', 'Requester')}</span>
          <input value={form.owner} onChange={(e) => updateField('owner', e.target.value)} placeholder={pickLocaleText(locale, '例如：产品运营值守', 'Example: Product Operations Desk')} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '目标执行角色', 'Target Role')}</span>
          <select value={form.targetDept} onChange={(e) => updateField('targetDept', e.target.value)} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)', padding: '11px 12px', outline: 'none' }}>
            <option value="">{pickLocaleText(locale, '自动分配', 'Auto assign')}</option>
            {targetOptions.map((dept) => (
              <option key={dept.id} value={dept.label}>{dept.emoji} {dept.label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="auth-primary" disabled={submitting} style={{ width: 'auto', minWidth: 140, height: 44 }}>
          {submitting ? pickLocaleText(locale, '发布中…', 'Creating...') : pickLocaleText(locale, '发布任务', 'Create Task')}
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
        toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
      }
    } else if (action === 'resume') {
      try {
        const r = await api.taskAction(task.id, 'resume', locale === 'en' ? 'Resume execution' : '恢复执行');
        if (r.ok) { toast(r.message || pickLocaleText(locale, '已恢复', 'Resumed')); loadAll(); }
        else toast(r.error || pickLocaleText(locale, '操作失败', 'Action failed'), 'err');
      } catch {
        toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
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
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
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
            {pickLocaleText(locale, '当前', 'Current')}: <b style={{ color: deptColor(curStage.dept) }}>{curStage.dept} · {curStage.action}</b>
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
          <span style={{ color: 'var(--muted)', fontSize: 10 }}>{locale === 'en' ? `Round ${task.review_round} review` : `第 ${task.review_round} 轮磋商`}</span>
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
            {busyLead.state === 'paused' ? '⏸' : '⚙️'} {pickLocaleText(locale, '全局占用', 'Global Occupancy')}
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
            <button className="mini-act" onClick={(e) => handleAction('stop', e)}>{pickLocaleText(locale, '⏸ 叫停', '⏸ Pause')}</button>
            <button className="mini-act danger" onClick={(e) => handleAction('cancel', e)}>{pickLocaleText(locale, '🚫 取消', '🚫 Cancel')}</button>
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
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
  };

  const handleScan = async () => {
    try {
      const r = await api.schedulerScan();
      if (r.ok) toast(locale === 'en' ? `🧭 Control scan completed: ${r.count || 0} action(s)` : `🧭 总控巡检完成：${r.count || 0} 个动作`);
      else toast(r.error || pickLocaleText(locale, '巡检失败', 'Scan failed'), 'err');
      loadAll();
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
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
        <button className="ab-scan" onClick={handleScan}>{pickLocaleText(locale, '🧭 总控巡检', '🧭 Control Scan')}</button>
      </div>

      <InlineQuickCreatePanel onSubmitSuccess={() => loadAll()} />

      <div className="edict-grid">
        {visibleTasks.length === 0 ? (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            {pickLocaleText(locale, '暂无任务单', 'No tasks yet')}<br />
            <small style={{ fontSize: 11, marginTop: 6, display: 'block', color: 'var(--muted)' }}>
              {pickLocaleText(locale, '你可以从面板内直接发布任务，或等待外部渠道同步后进入现有协作流程。', 'You can create a task directly from the board or wait for external channels to sync tasks into the pipeline.')}
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
