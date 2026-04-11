import { useMemo } from 'react';
import { useStore, isEdict, isArchived, getTaskScheduler, getSchedulerSummary, stateLabel } from '../store';
import { api, type Task, type WorkspaceNotification, type RiskControlState } from '../api';
import { pickLocaleText } from '../i18n';

function isAutomationRemark(remark: string): boolean {
  return remark.includes('自动') || remark.includes('重试') || remark.includes('升级') || remark.includes('回滚') || remark.includes('调度');
}

function collectAutomationLogs(tasks: Task[], locale: 'zh' | 'en' = 'zh') {
  return tasks
    .flatMap((task) =>
      (task.flow_log || [])
        .filter((item) => isAutomationRemark(item.remark || ''))
        .map((item) => ({
          taskId: task.id,
          title: task.title || (locale === 'en' ? '(Untitled)' : '(无标题)'),
          at: item.at || '',
          from: item.from || (locale === 'en' ? 'System Arrangement' : '系统安排'),
          to: item.to || task.org || '—',
          remark: item.remark || '',
          state: task.state || '',
        }))
    )
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 18);
}

function collectBoardNotices(tasks: Task[]) {
  return tasks
    .flatMap((task) => {
      const workspace = task.workspace || {};
      const notifications = (task.workspaceNotifications || workspace.notifications || []) as WorkspaceNotification[];
      return notifications.map((item, index) => ({
        taskId: task.id,
        title: task.title || '(Untitled)',
        index,
        notification: item,
      }));
    })
    .sort((a, b) => String(b.notification?.created_at || '').localeCompare(String(a.notification?.created_at || '')))
    .slice(0, 8);
}

function collectRiskApprovals(tasks: Task[]) {
  return tasks
    .map((task) => {
      const workspace = task.workspace || {};
      const risk = (task.workspaceRiskControl || workspace.risk_control || {}) as RiskControlState;
      return { task, risk };
    })
    .filter(({ risk }) => Boolean(risk?.requires_user_confirmation || risk?.approval_status === 'pending' || risk?.status === 'pending'))
    .slice(0, 8);
}

function collectQuickTaskRecords(tasks: Task[], locale: 'zh' | 'en' = 'zh') {
  return tasks
    .filter((task) => {
      const orgTrace = [task.org, task.currentDept, task.targetDept, ...(task.targetDepts || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const controlledByHub = orgTrace.includes('总控') || orgTrace.includes('control');
      const shortFlow = (task.flow_log?.length || 0) <= 2;
      const noDispatch = !(task.targetDept || task.targetDepts?.length);
      const lightweight = Boolean(task.workspaceTaskPolicy?.lightweight);
      return Boolean(lightweight || (controlledByHub && (shortFlow || noDispatch)));
    })
    .map((task) => {
      const latest = [...(task.flow_log || [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
      return {
        taskId: task.id,
        title: task.title || (locale === 'en' ? '(Untitled)' : '(无标题)'),
        at: latest?.at || task.updatedAt || task.now || '',
        detail:
          latest?.remark ||
          (locale === 'en'
            ? 'Handled directly by the control center without dispatching to another team.'
            : '由总控中心直接处理，未再分发到其他团队。'),
        owner: task.currentDept || task.org || (locale === 'en' ? 'Control Center' : '总控中心'),
        state: task.state || '',
      };
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 10);
}

export default function AutomationPanel() {
  const locale = useStore((s) => s.locale);
  const liveStatus = useStore((s) => s.liveStatus);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

  const tasks = (liveStatus?.tasks || []).filter((t) => isEdict(t) && !isArchived(t));

  const summary = useMemo(() => {
    let enabled = 0;
    let disabled = 0;
    let retrying = 0;
    let escalated = 0;
    let rolledBack = 0;
    let healthy = 0;

    tasks.forEach((task) => {
      const sched = getTaskScheduler(task);
      const view = getSchedulerSummary(task, locale);
      if (!sched || sched.enabled === false) disabled += 1;
      else enabled += 1;
      if ((sched?.retryCount || 0) > 0) retrying += 1;
      if ((sched?.escalationLevel || 0) > 0) escalated += 1;
      if ((sched?.rollbackCount || 0) > 0) rolledBack += 1;
      if (view.tone === 'ok') healthy += 1;
    });

    return { total: tasks.length, enabled, disabled, retrying, escalated, rolledBack, healthy };
  }, [tasks, locale]);

  const hotTasks = useMemo(() => {
    return [...tasks]
      .sort((a, b) => {
        const sa = getTaskScheduler(a);
        const sb = getTaskScheduler(b);
        const score = (s?: ReturnType<typeof getTaskScheduler>) =>
          Number((s?.rollbackCount || 0) > 0) * 100 +
          Number((s?.escalationLevel || 0) > 0) * 10 +
          Number(s?.retryCount || 0);
        return score(sb) - score(sa);
      })
      .slice(0, 10);
  }, [tasks]);

  const recentLogs = useMemo(() => collectAutomationLogs(tasks, locale), [tasks, locale]);
  const boardNotices = useMemo(() => collectBoardNotices(tasks), [tasks]);
  const pendingRiskApprovals = useMemo(() => collectRiskApprovals(tasks), [tasks]);
  const quickTaskRecords = useMemo(() => collectQuickTaskRecords(tasks, locale), [tasks, locale]);

  const handleScan = async () => {
    try {
      const r = await api.schedulerScan(180);
      if (r.ok) {
        toast(locale === 'en' ? `🧭 Automation scan completed: ${r.count || 0} action(s)` : `🧭 自动巡检完成：${r.count || 0} 个动作`, 'ok');
        loadAll();
      } else {
        toast(r.error || pickLocaleText(locale, '巡检失败', 'Scan failed'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    }
  };

  return (
    <div className="auto-page">
      <div className="auto-hero">
        <div>
          <div className="auto-title">{pickLocaleText(locale, '自动处理概览', 'Auto Handling Overview')}</div>
          <div className="auto-subtitle">{pickLocaleText(locale, '查看自动处理、风险和系统记录。', 'View auto handling, risks, and system logs.')}</div>
        </div>
        <button className="btn-refresh" onClick={handleScan}>{pickLocaleText(locale, '🧭 立即巡检', '🧭 Run Scan')}</button>
      </div>

      <div className="auto-kpi-grid">
        <div className="auto-kpi-card">
          <div className="auto-kpi-label">{pickLocaleText(locale, '活跃任务', 'Active Tasks')}</div>
          <div className="auto-kpi-value">{summary.total}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '当前仍在处理流程中的任务总数', 'Total number of tasks currently in progress')}</div>
        </div>
        <div className="auto-kpi-card ok">
          <div className="auto-kpi-label">{pickLocaleText(locale, '自动处理已开启', 'Auto Handling Enabled')}</div>
          <div className="auto-kpi-value">{summary.enabled}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '已纳入自动检查与自动处理规则', 'Included in automated checks and handling rules')}</div>
        </div>
        <div className="auto-kpi-card muted">
          <div className="auto-kpi-label">{pickLocaleText(locale, '手动处理', 'Manual Handling')}</div>
          <div className="auto-kpi-value">{summary.disabled}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '当前不参与自动检查，仅保留手动处理', 'Currently excluded from auto checks and handled manually')}</div>
        </div>
        <div className="auto-kpi-card warn">
          <div className="auto-kpi-label">{pickLocaleText(locale, '自动重试中', 'Auto Retrying')}</div>
          <div className="auto-kpi-value">{summary.retrying}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '已触发至少一次自动重试', 'Tasks that have triggered at least one auto retry')}</div>
        </div>
        <div className="auto-kpi-card danger">
          <div className="auto-kpi-label">{pickLocaleText(locale, '已提升关注', 'Escalated')}</div>
          <div className="auto-kpi-value">{summary.escalated}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '已进入更高优先级的协调处理', 'Moved into higher-priority coordinated handling')}</div>
        </div>
        <div className="auto-kpi-card danger">
          <div className="auto-kpi-label">{pickLocaleText(locale, '恢复记录', 'Recoveries')}</div>
          <div className="auto-kpi-value">{summary.rolledBack}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '已触发自动恢复的事项数量', 'Items that have triggered automatic recovery')}</div>
        </div>
        <div className="auto-kpi-card warn">
          <div className="auto-kpi-label">{pickLocaleText(locale, '看板通知', 'Board Notices')}</div>
          <div className="auto-kpi-value">{boardNotices.length}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '工作区写回后在看板集中展示的提醒条目', 'Reminder items written back from workspaces and displayed centrally on the board')}</div>
        </div>
        <div className="auto-kpi-card danger">
          <div className="auto-kpi-label">{pickLocaleText(locale, '待确认风险', 'Pending Risk Approvals')}</div>
          <div className="auto-kpi-value">{pendingRiskApprovals.length}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '需要总控或看板代用户确认的高风险操作', 'High-risk operations waiting for control center or board-side confirmation')}</div>
        </div>
      </div>

      <div className="auto-rule-panel">
        <div className="auto-section-title">{pickLocaleText(locale, '处理规则', 'Handling Rules')}</div>
        <div className="auto-rule-grid">
          <div className="auto-rule-card">
            <div className="auto-rule-name">{pickLocaleText(locale, '自动处理 · 基础设置', 'Automatic Handling · Basic Setup')}</div>
            <div className="auto-rule-desc">{pickLocaleText(locale, '每个事项都可以单独决定是否启用自动检查、自动重试、重点协助与自动恢复，这些设置都可在详情中调整。', 'Each item can decide whether to enable automatic checks, retries, extra assistance, and automatic recovery, and these settings can be adjusted in the details view.')}</div>
            <div className="auto-rule-meta">{locale === 'en' ? `Enabled items: ${summary.enabled}/${summary.total}` : `已开启事项：${summary.enabled}/${summary.total}`}</div>
          </div>
          <div className="auto-rule-card">
            <div className="auto-rule-name">{pickLocaleText(locale, '自动跟进 · 停滞后重试', 'Automatic Follow-up · Retry After Stalling')}</div>
            <div className="auto-rule-desc">{pickLocaleText(locale, '当事项停滞超过阈值时，系统会先自动重试；如果多次尝试仍无进展，再进入更强的协助或恢复步骤。', 'When an item stays stalled beyond its threshold, the system retries automatically first. If repeated attempts still bring no progress, it moves to stronger assistance or recovery steps.')}</div>
            <div className="auto-rule-meta">{locale === 'en' ? `Now following up on: ${summary.retrying} item(s)` : `当前自动跟进：${summary.retrying} 个事项`}</div>
          </div>
          <div className="auto-rule-card">
            <div className="auto-rule-name">{pickLocaleText(locale, '重点协助 · 逐级加强处理', 'Extra Assistance · Step-by-Step Support')}</div>
            <div className="auto-rule-desc">{pickLocaleText(locale, '当多次重试仍无进展时，系统会逐步加强协助力度并安排进一步处理，以减少长时间卡住的风险。', 'When repeated retries still bring no progress, the system increases the level of assistance step by step and arranges further handling to reduce the risk of long stalls.')}</div>
            <div className="auto-rule-meta">{locale === 'en' ? `Receiving extra support: ${summary.escalated} item(s)` : `当前加强协助：${summary.escalated} 个事项`}</div>
          </div>
          <div className="auto-rule-card">
            <div className="auto-rule-name">{pickLocaleText(locale, '自动恢复 · 返回最近稳定状态', 'Automatic Recovery · Return to the Latest Stable State')}</div>
            <div className="auto-rule-desc">{pickLocaleText(locale, '开启自动恢复后，事项在多轮处理后仍无法恢复时，可返回最近稳定状态，等待新的处理安排。', 'With automatic recovery enabled, items that still cannot recover after multiple handling rounds can return to the latest stable state and wait for a new arrangement.')}</div>
            <div className="auto-rule-meta">{locale === 'en' ? `Recovered automatically: ${summary.rolledBack} item(s)` : `已自动恢复：${summary.rolledBack} 个事项`}</div>
          </div>
        </div>
      </div>

      <div className="auto-layout">
        <div className="auto-panel">
          <div className="auto-section-title">{pickLocaleText(locale, '看板通知中心', 'Board Notification Center')}</div>
          <div className="auto-log-list">
            {boardNotices.length === 0 ? (
              <div className="empty">{pickLocaleText(locale, '暂无工作区通知', 'No workspace notifications')}</div>
            ) : (
              boardNotices.map((entry) => (
                <div key={`${entry.taskId}-${entry.notification?.id || entry.index}`} className="auto-log-item" onClick={() => setModalTaskId(entry.taskId)}>
                  <div className="auto-log-time">{entry.notification?.created_at ? entry.notification.created_at.replace('T', ' ').substring(5, 19) : '—'}</div>
                  <div className="auto-log-main">
                    <div className="auto-log-title">{entry.taskId} · {entry.notification?.title || entry.notification?.kind || pickLocaleText(locale, '通知', 'Notice')}</div>
                    <div className="auto-log-desc">{entry.notification?.source || 'system'} · {entry.notification?.message || pickLocaleText(locale, '暂无内容', 'No details')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="auto-panel">
          <div className="auto-section-title">{pickLocaleText(locale, '待确认风险操作', 'Pending Risk Confirmations')}</div>
          <div className="auto-log-list">
            {pendingRiskApprovals.length === 0 ? (
              <div className="empty">{pickLocaleText(locale, '当前没有待确认的高风险操作', 'No pending high-risk operations')}</div>
            ) : (
              pendingRiskApprovals.map(({ task, risk }) => (
                <div key={`${task.id}-${risk.updated_at || risk.summary || 'risk'}`} className="auto-log-item" onClick={() => setModalTaskId(task.id)}>
                  <div className="auto-log-time">{risk.updated_at ? risk.updated_at.replace('T', ' ').substring(5, 19) : '—'}</div>
                  <div className="auto-log-main">
                    <div className="auto-log-title">{task.id} · {risk.level || 'risk'} · {risk.approval_status || risk.status || 'pending'}</div>
                    <div className="auto-log-desc">{risk.summary || pickLocaleText(locale, '待用户确认', 'Waiting for user confirmation')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="auto-panel">
          <div className="auto-section-title">{pickLocaleText(locale, '重点观察任务', 'Priority Watch Tasks')}</div>
          <div className="auto-task-list">
            {hotTasks.length === 0 ? (
              <div className="empty">{pickLocaleText(locale, '暂无需要重点关注的任务', 'No tasks currently need priority attention')}</div>
            ) : (
              hotTasks.map((task) => {
                const sched = getTaskScheduler(task);
                const view = getSchedulerSummary(task, locale);
                return (
                  <div key={task.id} className="auto-task-card" onClick={() => setModalTaskId(task.id)}>
                    <div className="auto-task-top">
                      <div>
                        <div className="auto-task-id">{task.id}</div>
                        <div className="auto-task-title">{task.title || pickLocaleText(locale, '(无标题)', '(Untitled)')}</div>
                      </div>
                      <span className={`tag st-${task.state}`}>{stateLabel(task, locale)}</span>
                    </div>
                    <div className={`ec-scheduler-chip ${view.tone}`}>
                      <div className="ec-scheduler-label">{view.icon} {view.label}</div>
                      <div className="ec-scheduler-detail">{view.detail}</div>
                    </div>
                    <div className="auto-task-meta">
                      <span>{locale === 'en' ? `Threshold ${sched?.stallThresholdSec || 600}s` : `阈值 ${sched?.stallThresholdSec || 600}s`}</span>
                      <span>{locale === 'en' ? `Retry ${sched?.retryCount || 0}/${sched?.maxRetry ?? 2}` : `重试 ${sched?.retryCount || 0}/${sched?.maxRetry ?? 2}`}</span>
                      <span>{locale === 'en' ? `Extra support ${sched?.escalationLevel || 0}` : `额外协助 ${sched?.escalationLevel || 0}`}</span>
                      <span>{locale === 'en' ? `Recovery ${sched?.rollbackCount || 0}/${sched?.maxRollback ?? 3}` : `恢复 ${sched?.rollbackCount || 0}/${sched?.maxRollback ?? 3}`}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="auto-panel">
          <div className="auto-section-title">{pickLocaleText(locale, '快速任务记录', 'Quick Task Records')}</div>
          <div className="auto-log-list">
            {quickTaskRecords.length === 0 ? (
              <div className="empty">{pickLocaleText(locale, '暂无直办任务记录', 'No direct task records')}</div>
            ) : (
              quickTaskRecords.map((entry, idx) => (
                <div key={`${entry.taskId}-${idx}`} className="auto-log-item" onClick={() => setModalTaskId(entry.taskId)}>
                  <div className="auto-log-time">{entry.at ? entry.at.replace('T', ' ').substring(5, 19) : '—'}</div>
                  <div className="auto-log-main">
                    <div className="auto-log-title">{entry.taskId} · {entry.title}</div>
                    <div className="auto-log-desc">{entry.owner} · {entry.detail.replace(/^🧭\s*/, '')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="auto-panel">
          <div className="auto-section-title">{pickLocaleText(locale, '任务处理记录', 'Task Handling Logs')}</div>
          <div className="auto-log-list">
            {recentLogs.length === 0 ? (
              <div className="empty">{pickLocaleText(locale, '暂无系统处理记录', 'No system action logs')}</div>
            ) : (
              recentLogs.map((log, idx) => (
                <div key={`${log.taskId}-${idx}`} className="auto-log-item" onClick={() => setModalTaskId(log.taskId)}>
                  <div className="auto-log-time">{log.at ? log.at.replace('T', ' ').substring(5, 19) : '—'}</div>
                  <div className="auto-log-main">
                    <div className="auto-log-title">{log.taskId} · {log.title}</div>
                    <div className="auto-log-desc">{log.from} → {log.to} · {log.remark.replace(/^🧭\s*/, '')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
