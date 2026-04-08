import React from 'react';
import { PIPE, useStore, getPipeStatus, stateLabel, deptColor, isArchived, isEdict, getSchedulerSummary } from '../store';
import { api, type Task } from '../api';
import { pickLocaleText } from '../i18n';

// 排序权重
const STATE_ORDER: Record<string, number> = {
  Doing: 0, Review: 1, Assigned: 2, ReviewCenter: 3, PlanCenter: 4,
  ControlCenter: 5, Inbox: 6, Blocked: 7, Next: 8, Done: 9, Cancelled: 10,
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

function EdictCard({ task }: { task: Task }) {
  const locale = useStore((s) => s.locale);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

  const hb = task.heartbeat || { status: 'unknown', label: '⚪' };
  const stCls = 'st-' + (task.state || '');
  const deptCls = 'dt-' + (task.org || '').replace(/\s/g, '');
  const pipeStatus = getPipeStatus(task, locale);
  const curStage = PIPE.find((_, i) => pipeStatus[i].status === 'active');
  const todos = task.todos || [];
  const todoDone = todos.filter((x) => x.status === 'completed').length;
  const todoTotal = todos.length;
  const canStop = !['Done', 'Blocked', 'Cancelled'].includes(task.state);
  const canResume = ['Blocked', 'Cancelled'].includes(task.state);
  const archived = isArchived(task);
  const isBlocked = task.block && task.block !== '无' && task.block !== '-';
  const schedSummary = getSchedulerSummary(task, locale);

  const handleAction = async (action: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (action === 'stop' || action === 'cancel') {
      // Use confirm dialog via store (will implement with ConfirmDialog)
      const reason = prompt(action === 'stop'
        ? pickLocaleText(locale, '请输入叫停原因：', 'Enter a reason to pause this task:')
        : pickLocaleText(locale, '请输入取消原因：', 'Enter a reason to cancel this task:'));
      if (reason === null) return;
      try {
        const r = await api.taskAction(task.id, action, reason);
        if (r.ok) { toast(r.message || pickLocaleText(locale, '操作成功', 'Action completed')); loadAll(); }
        else toast(r.error || pickLocaleText(locale, '操作失败', 'Action failed'), 'err');
      } catch { toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err'); }
    } else if (action === 'resume') {
      try {
        const r = await api.taskAction(task.id, 'resume', locale === 'en' ? 'Resume execution' : '恢复执行');
        if (r.ok) { toast(r.message || pickLocaleText(locale, '已恢复', 'Resumed')); loadAll(); }
        else toast(r.error || pickLocaleText(locale, '操作失败', 'Action failed'), 'err');
      } catch { toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err'); }
    }
  };

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await api.archiveTask(task.id, !task.archived);
      if (r.ok) { toast(r.message || pickLocaleText(locale, '操作成功', 'Action completed')); loadAll(); }
      else toast(r.error || pickLocaleText(locale, '操作失败', 'Action failed'), 'err');
    } catch { toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err'); }
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
  const taskFilter = useStore((s) => s.taskFilter);
  const setTaskFilter = useStore((s) => s.setTaskFilter);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

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

  const handleArchiveAll = async () => {
      if (!confirm(pickLocaleText(locale, '将所有已完成或已取消的任务单移入归档？', 'Move all completed or cancelled tasks into archive?'))) return;

    try {
      const r = await api.archiveAllDone();
      if (r.ok) { toast(locale === 'en' ? `📦 ${r.count || 0} task(s) archived` : `📦 ${r.count || 0} 个任务单已归档`); loadAll(); }
      else toast(r.error || pickLocaleText(locale, '批量归档失败', 'Bulk archive failed'), 'err');
    } catch { toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err'); }
  };

  const handleScan = async () => {
    try {
      const r = await api.schedulerScan();
      if (r.ok) toast(locale === 'en' ? `🧭 Control scan completed: ${r.count || 0} action(s)` : `🧭 总控巡检完成：${r.count || 0} 个动作`);
      else toast(r.error || pickLocaleText(locale, '巡检失败', 'Scan failed'), 'err');
      loadAll();
    } catch { toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err'); }
  };

  return (
    <div>
      {/* Archive Bar */}
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
        {unArchivedDone.length > 0 && (
          <button className="ab-btn" onClick={handleArchiveAll}>{pickLocaleText(locale, '📦 一键归档', '📦 Archive All')}</button>
        )}
        <span className="ab-count">
          {locale === 'en' ? `Active ${activeEdicts.length} · Archived ${archivedEdicts.length} · Total ${allEdicts.length}` : `活跃 ${activeEdicts.length} · 归档 ${archivedEdicts.length} · 共 ${allEdicts.length}`}
        </span>
        <button className="ab-scan" onClick={handleScan}>{pickLocaleText(locale, '🧭 总控巡检', '🧭 Control Scan')}</button>
      </div>

      {/* Grid */}
      <div className="edict-grid">
        {visibleTasks.length === 0 ? (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            {pickLocaleText(locale, '暂无任务单', 'No tasks yet')}<br />
            <small style={{ fontSize: 11, marginTop: 6, display: 'block', color: 'var(--muted)' }}>
              {pickLocaleText(locale, '通过飞书提交任务后，会先进入总控中心预处理，再转入后续协作流程', 'After a task is submitted, it first enters the control center for preprocessing before moving into the collaboration pipeline')}
            </small>
          </div>
        ) : (
          visibleTasks.map((t) => <EdictCard key={t.id} task={t} />)
        )}
      </div>
    </div>
  );
}
