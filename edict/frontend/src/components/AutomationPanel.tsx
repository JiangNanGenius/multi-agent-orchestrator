import { useMemo } from 'react';
import { useStore, isEdict, isArchived, getTaskScheduler, getSchedulerSummary, stateLabel } from '../store';
import { api, type Task } from '../api';
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
          from: item.from || (locale === 'en' ? 'Control Center Dispatch' : '总控中心调度'),
          to: item.to || task.org || '—',
          remark: item.remark || '',
          state: task.state || '',
        }))
    )
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 18);
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
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
  };

  return (
    <div className="auto-page">
      <div className="auto-hero">
        <div>
          <div className="auto-title">{pickLocaleText(locale, '自动化中心', 'Automation Center')}</div>
          <div className="auto-subtitle">{pickLocaleText(locale, '集中查看任务级自动托管覆盖率、风险任务分布与最近自动动作记录。', 'View task-level automation coverage, risk distribution, and recent automated actions in one place.')}</div>
        </div>
        <button className="btn-refresh" onClick={handleScan}>{pickLocaleText(locale, '🧭 立即巡检', '🧭 Run Scan')}</button>
      </div>

      <div className="auto-kpi-grid">
        <div className="auto-kpi-card">
          <div className="auto-kpi-label">{pickLocaleText(locale, '活跃任务', 'Active Tasks')}</div>
          <div className="auto-kpi-value">{summary.total}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '当前参与流转的任务单总数', 'Total number of tasks currently in workflow')}</div>
        </div>
        <div className="auto-kpi-card ok">
          <div className="auto-kpi-label">{pickLocaleText(locale, '自动托管启用', 'Automation Enabled')}</div>
          <div className="auto-kpi-value">{summary.enabled}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '已纳入自动扫描与自动动作策略', 'Included in automated scans and action policies')}</div>
        </div>
        <div className="auto-kpi-card muted">
          <div className="auto-kpi-label">{pickLocaleText(locale, '人工托管', 'Manual Control')}</div>
          <div className="auto-kpi-value">{summary.disabled}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '当前跳过自动扫描，仅人工处理', 'Currently excluded from scans and handled manually')}</div>
        </div>
        <div className="auto-kpi-card warn">
          <div className="auto-kpi-label">{pickLocaleText(locale, '自动重试中', 'Auto Retrying')}</div>
          <div className="auto-kpi-value">{summary.retrying}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '已触发至少一次自动重试', 'Tasks that have triggered at least one auto retry')}</div>
        </div>
        <div className="auto-kpi-card danger">
          <div className="auto-kpi-label">{pickLocaleText(locale, '升级协调', 'Escalated')}</div>
          <div className="auto-kpi-value">{summary.escalated}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '已升级至评审或调度中心', 'Escalated to review or dispatch center')}</div>
        </div>
        <div className="auto-kpi-card danger">
          <div className="auto-kpi-label">{pickLocaleText(locale, '回滚记录', 'Rollbacks')}</div>
          <div className="auto-kpi-value">{summary.rolledBack}</div>
          <div className="auto-kpi-desc">{pickLocaleText(locale, '已发生自动回滚的任务数量', 'Tasks that have triggered automated rollback')}</div>
        </div>
      </div>

      <div className="auto-rule-panel">
        <div className="auto-section-title">{pickLocaleText(locale, '规则中心（初版）', 'Rule Center (Initial)')}</div>
        <div className="auto-rule-grid">
          <div className="auto-rule-card">
            <div className="auto-rule-name">{pickLocaleText(locale, '规则 01 · 任务级自动托管', 'Rule 01 · Task-Level Automation')}</div>
            <div className="auto-rule-desc">{pickLocaleText(locale, '每个任务可单独决定是否启用自动扫描、自动重试、升级协调与自动回滚。这一层已经在任务详情中可编辑。', 'Each task can independently enable scans, retries, escalations, and rollbacks. This layer is editable in task details.')}</div>
            <div className="auto-rule-meta">{locale === 'en' ? `Covered tasks: ${summary.enabled}/${summary.total}` : `覆盖任务：${summary.enabled}/${summary.total}`}</div>
          </div>
          <div className="auto-rule-card">
            <div className="auto-rule-name">{pickLocaleText(locale, '规则 02 · 停滞自动重试', 'Rule 02 · Stall Auto Retry')}</div>
            <div className="auto-rule-desc">{pickLocaleText(locale, '任务超过各自停滞阈值后，会先进入自动重试；超过最大重试次数后再升级协调或回滚。', 'Once a task exceeds its stall threshold, it enters auto retry first; after max retries it escalates or rolls back.')}</div>
            <div className="auto-rule-meta">{locale === 'en' ? `Matched now: ${summary.retrying} task(s)` : `当前命中：${summary.retrying} 个任务`}</div>
          </div>
          <div className="auto-rule-card">
            <div className="auto-rule-name">{pickLocaleText(locale, '规则 03 · 分级升级协调', 'Rule 03 · Tiered Escalation')}</div>
            <div className="auto-rule-desc">{pickLocaleText(locale, '当重试无效时，系统会先升级评审中心，再升级调度中心，降低长时间卡死风险。', 'When retries fail, the system escalates to the review center first and then the dispatch center to reduce long stalls.')}</div>
            <div className="auto-rule-meta">{locale === 'en' ? `Matched now: ${summary.escalated} task(s)` : `当前命中：${summary.escalated} 个任务`}</div>
          </div>
          <div className="auto-rule-card">
            <div className="auto-rule-name">{pickLocaleText(locale, '规则 04 · 稳定快照回滚', 'Rule 04 · Snapshot Rollback')}</div>
            <div className="auto-rule-desc">{pickLocaleText(locale, '开启自动回滚后，任务在多轮升级后仍无法恢复时，可退回到最近稳定节点，等待重新派发。', 'With rollback enabled, tasks that still cannot recover after multiple escalations can return to the latest stable snapshot and wait for redispatch.')}</div>
            <div className="auto-rule-meta">{locale === 'en' ? `Matched now: ${summary.rolledBack} task(s)` : `当前命中：${summary.rolledBack} 个任务`}</div>
          </div>
        </div>
      </div>

      <div className="auto-layout">
        <div className="auto-panel">
          <div className="auto-section-title">{pickLocaleText(locale, '重点观察任务', 'Priority Watch Tasks')}</div>
          <div className="auto-task-list">
            {hotTasks.length === 0 ? (
              <div className="empty">{pickLocaleText(locale, '暂无需要重点观察的自动化任务', 'No automation tasks currently need priority attention')}</div>
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
                      <span>{locale === 'en' ? `Escalation ${sched?.escalationLevel || 0}` : `升级 ${sched?.escalationLevel || 0}`}</span>
                      <span>{locale === 'en' ? `Rollback ${sched?.rollbackCount || 0}/${sched?.maxRollback ?? 3}` : `回滚 ${sched?.rollbackCount || 0}/${sched?.maxRollback ?? 3}`}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="auto-panel">
          <div className="auto-section-title">{pickLocaleText(locale, '近期自动动作日志', 'Recent Automation Logs')}</div>
          <div className="auto-log-list">
            {recentLogs.length === 0 ? (
              <div className="empty">{pickLocaleText(locale, '当前还没有自动动作记录', 'No automation actions have been recorded yet')}</div>
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
