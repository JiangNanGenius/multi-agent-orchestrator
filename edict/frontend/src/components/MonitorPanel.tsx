import { useEffect, useMemo } from 'react';
import { useStore, DEPTS, isEdict, stateLabel, getSchedulerSummary, deptMeta, normalizeAgentId } from '../store';
import { api, type OfficialInfo, type CollabAgentBusyEntry } from '../api';
import { pickLocaleText } from '../i18n';

function renderBusySummary(entry: CollabAgentBusyEntry | undefined, locale: string): string {
  if (!entry) return '';
  const kind = entry.occupancy_kind || entry.source_type || '';
  if (locale === 'en') {
    if (kind === 'task_active') return 'Task running';
    if (kind === 'task_reserved') return 'Task reserved';
    if (kind === 'task_paused') return 'Task paused';
    if (kind === 'task_blocked') return 'Task blocked';
    if (kind === 'meeting') return 'In meeting';
    if (kind === 'chat') return 'In discussion';
    return entry.label || 'Busy';
  }
  if (kind === 'task_active') return '正在处理';
  if (kind === 'task_reserved') return '即将开始';
  if (kind === 'task_paused') return '暂时停下';
  if (kind === 'task_blocked') return '暂时卡住';
  if (kind === 'meeting') return '正在沟通';
  if (kind === 'chat') return '正在讨论';
  return entry.label || '暂时忙碌';
}

export default function MonitorPanel() {
  const locale = useStore((s) => s.locale);
  const liveStatus = useStore((s) => s.liveStatus);
  const agentsStatusData = useStore((s) => s.agentsStatusData);
  const agentsOverviewData = useStore((s) => s.agentsOverviewData);
  const collabAgentBusyData = useStore((s) => s.collabAgentBusyData);
  const loadAgentsStatus = useStore((s) => s.loadAgentsStatus);
  const loadCollabBusy = useStore((s) => s.loadCollabBusy);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    loadAgentsStatus();
    loadCollabBusy();
  }, [loadAgentsStatus, loadCollabBusy]);

  const projectAgentIds = useMemo(() => new Set(DEPTS.map((d) => normalizeAgentId(d.id))), []);

  const tasks = liveStatus?.tasks || [];
  const activeTasks = tasks.filter((t) => isEdict(t) && t.state !== 'Done' && t.state !== 'Next');

  const agentMap: Record<string, OfficialInfo> = {};
  if (agentsOverviewData?.agents) {
    agentsOverviewData.agents.forEach((o) => {
      const normalizedId = normalizeAgentId(o.id);
      if (projectAgentIds.has(normalizedId)) agentMap[normalizedId] = o;
    });
  }

  const busyMap = (collabAgentBusyData?.busy || []).reduce<Record<string, CollabAgentBusyEntry[]>>((acc, entry) => {
    const normalizedId = normalizeAgentId(entry.agent_id);
    if (!projectAgentIds.has(normalizedId)) return acc;
    if (!acc[normalizedId]) acc[normalizedId] = [];
    acc[normalizedId].push({ ...entry, agent_id: normalizedId });
    return acc;
  }, {});

  const handleWake = async (agentId: string) => {
    try {
      const r = await api.agentWake(agentId);
      toast(r.message || pickLocaleText(locale, '唤醒指令已发出', 'Wake command sent'));
      setTimeout(() => loadAgentsStatus(), 30000);
    } catch {
      toast(pickLocaleText(locale, '唤醒失败', 'Wake action failed'), 'err');
    }
  };

  const filtered = (agentsStatusData?.agents || []).filter((a) => projectAgentIds.has(normalizeAgentId(a.id)));
  const running = filtered.filter((a) => a.status === 'running').length;
  const idle = filtered.filter((a) => a.status === 'idle').length;
  const offline = filtered.filter((a) => a.status === 'offline').length;
  const unconf = filtered.filter((a) => a.status === 'unconfigured').length;
  const gw = agentsStatusData?.gateway;
  const gwCls = gw?.probe ? 'ok' : gw?.alive ? 'warn' : 'err';

  const handleWakeAll = async () => {
    const toWake = filtered.filter((a) => a.status !== 'running' && a.status !== 'unconfigured');
    if (!toWake.length) {
      toast(pickLocaleText(locale, '相关助手当前都在线', 'All related assistants are already online'));
      return;
    }
    toast(locale === 'en' ? `Waking ${toWake.length} assistant(s)...` : `正在唤醒 ${toWake.length} 个相关助手...`);
    for (const a of toWake) {
      try {
        await api.agentWake(a.id);
      } catch {
        // ignore
      }
    }
    toast(locale === 'en' ? `${toWake.length} wake command(s) sent; status will refresh in 30s` : `${toWake.length} 个唤醒指令已发出，30 秒后刷新状态`);
    setTimeout(() => loadAgentsStatus(), 30000);
  };

  return (
    <div>
      <div
        style={{
          marginBottom: 18,
          background: 'linear-gradient(135deg, rgba(15,38,78,.88), rgba(12,18,33,.96))',
          border: '1px solid rgba(83, 183, 255, 0.18)',
          borderRadius: 18,
          padding: 18,
          boxShadow: '0 18px 40px rgba(0,0,0,.22)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: '#7be0ff', fontWeight: 700, letterSpacing: '.06em', marginBottom: 6 }}>
              {pickLocaleText(locale, '最新动态', 'Updates')}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
              {pickLocaleText(locale, '当前处理情况', 'Current Progress')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, maxWidth: 880 }}>
              {pickLocaleText(locale, '这里会显示当前事项相关的处理情况。你可以看到谁正在处理、谁暂时空闲、哪里卡住了，也可以在需要时提醒继续处理。', 'This page shows the current progress of your work. You can see what is in progress, what is idle, what is stuck, and send a reminder when needed.')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn-refresh" onClick={() => { loadAgentsStatus(); loadCollabBusy(); }}>
              {pickLocaleText(locale, '🔄 刷新', '🔄 Refresh')}
            </button>
            {(offline + unconf > 0) && (
              <button className="btn-refresh" onClick={handleWakeAll} style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
                {pickLocaleText(locale, '⚡ 提醒相关助手', '⚡ Remind Assistants')}
              </button>
            )}
          </div>
        </div>
      </div>

      {agentsStatusData && agentsStatusData.ok && (
        <div className="as-panel">
          <div className="as-header">
            <span className="as-title">{pickLocaleText(locale, '处理概览', 'Progress Overview')}</span>
            <span className={`as-gw ${gwCls}`}>{pickLocaleText(locale, '连接状态：', 'Connection: ')}{gw?.status || pickLocaleText(locale, '未知', 'Unknown')}</span>
          </div>
          <div className="as-grid">
            {filtered.map((a) => {
              const normalizedId = normalizeAgentId(a.id);
              const canWake = a.status !== 'running' && a.status !== 'unconfigured' && gw?.alive;
              const busyEntries = busyMap[normalizedId] || [];
              const busyLead = busyEntries[0];
              const meta = deptMeta(normalizedId, locale);
              return (
                <div key={normalizedId} className="as-card" title={`${meta.role || a.role} · ${locale === 'en' ? (a.status === 'running' ? 'Running' : a.status === 'idle' ? 'Idle' : a.status === 'offline' ? 'Offline' : a.status === 'unconfigured' ? 'Unconfigured' : a.statusLabel) : a.statusLabel}`}>
                  <div className={`as-dot ${a.status}`} />
                  <div className="as-card-head">
                    <div className="as-emoji">{meta.emoji || a.emoji}</div>
                    <div className="as-name">{meta.label || a.label}</div>
                    <div className="as-role">{meta.role || a.role}</div>
                    <div className="as-status-text">{locale === 'en' ? (a.status === 'running' ? 'Running' : a.status === 'idle' ? 'Idle' : a.status === 'offline' ? 'Offline' : a.status === 'unconfigured' ? 'Unconfigured' : a.statusLabel) : a.statusLabel}</div>
                  </div>
                  <div className="as-card-middle">
                    <div
                      className={`as-busy-box ${busyLead?.state === 'paused' ? 'paused' : busyLead ? 'busy' : 'idle'}`}
                    >
                      <div className="as-busy-title">
                        {busyLead ? renderBusySummary(busyLead, locale) : pickLocaleText(locale, '空闲', 'Idle')}
                      </div>
                      <div className="as-busy-subtitle">
                        {busyLead?.task_title || busyLead?.topic || pickLocaleText(locale, '等待任务', 'Waiting for task')}
                      </div>
                    </div>
                  </div>
                  <div className="as-card-foot">
                    {a.lastActive ? (
                      <div className="as-last-active">⏰ {a.lastActive}</div>
                    ) : (
                      <div className="as-last-active">{pickLocaleText(locale, '无活动记录', 'No activity yet')}</div>
                    )}
                    {canWake && (
                      <button className="as-wake-btn" onClick={(e) => { e.stopPropagation(); handleWake(a.id); }}>
                        {pickLocaleText(locale, '⚡ 提醒处理', '⚡ Remind')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="as-summary">
            <span><span className="as-dot running" style={{ position: 'static', width: 8, height: 8 }} /> {locale === 'en' ? `${running} active` : `${running} 处理中`}</span>
            <span><span className="as-dot idle" style={{ position: 'static', width: 8, height: 8 }} /> {locale === 'en' ? `${idle} idle` : `${idle} 空闲`}</span>
            {offline > 0 && <span><span className="as-dot offline" style={{ position: 'static', width: 8, height: 8 }} /> {locale === 'en' ? `${offline} offline` : `${offline} 离线`}</span>}
            {unconf > 0 && <span><span className="as-dot unconfigured" style={{ position: 'static', width: 8, height: 8 }} /> {locale === 'en' ? `${unconf} unconfigured` : `${unconf} 未配置`}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>
              {locale === 'en' ? `Updated at ${(agentsStatusData.checkedAt || '').substring(11, 19)}` : `更新于 ${(agentsStatusData.checkedAt || '').substring(11, 19)}`}
            </span>
          </div>
        </div>
      )}

      <div className="duty-grid">
        {DEPTS.map((d) => {
          const normalizedDeptId = normalizeAgentId(d.id);
          const myTasks = activeTasks.filter((t) => normalizeAgentId(t.org) === normalizedDeptId || normalizeAgentId(t.currentDept || '') === normalizedDeptId);
          const deptBusyEntries = busyMap[normalizedDeptId] || [];
          const taskBusyEntries = deptBusyEntries.filter((entry) => entry.source_type === 'task');
          const nonTaskBusyEntries = deptBusyEntries.filter((entry) => entry.source_type !== 'task');
          const isActive = myTasks.some((t) => t.state === 'Doing') || taskBusyEntries.some((entry) => entry.state === 'active');
          const isBlocked = myTasks.some((t) => t.state === 'Blocked') || taskBusyEntries.some((entry) => entry.state === 'paused');
          const off = agentMap[normalizedDeptId];
          const hb = off?.heartbeat || { status: 'idle', label: '⚪' };
          const dotCls = isBlocked ? 'blocked' : isActive ? 'busy' : hb.status === 'active' ? 'active' : 'idle';
          const statusText = isBlocked
            ? pickLocaleText(locale, '⚠️ 卡住', '⚠️ Stuck')
            : isActive
              ? pickLocaleText(locale, '🟢 处理中', '🟢 Working')
              : hb.status === 'active'
                ? pickLocaleText(locale, '🟢 活跃', '🟢 Active')
                : pickLocaleText(locale, '⚪ 空闲', '⚪ Idle');
          const cardCls = isBlocked ? 'blocked-card' : isActive ? 'active-card' : '';
          const panelMeta = deptMeta(normalizedDeptId, locale);

          return (
            <div key={normalizedDeptId} className={`duty-card ${cardCls}`}>
              <div className="dc-hdr">
                <span className="dc-emoji">{panelMeta.emoji}</span>
                <div className="dc-info">
                  <div className="dc-name">{panelMeta.label}</div>
                  <div className="dc-role">{panelMeta.role} · {panelMeta.rank}</div>
                </div>
                <div className="dc-status">
                  <span className={`dc-dot ${dotCls}`} />
                  <span>{statusText}</span>
                </div>
              </div>
              <div className="dc-body">
                {myTasks.length > 0 ? (
                  myTasks.map((t) => {
                    const taskBusy = taskBusyEntries.filter((entry) => entry.task_id === t.id);
                    const taskBusyLead = taskBusy[0];
                    return (
                      <div key={t.id} className="dc-task" onClick={() => setModalTaskId(t.id)}>
                        <div className="dc-task-id">{t.id}</div>
                        <div className="dc-task-title">{t.title || pickLocaleText(locale, '(无标题)', '(Untitled)')}</div>
                        {t.now && t.now !== '-' && (
                          <div className="dc-task-now">{t.now.substring(0, 70)}</div>
                        )}
                        <div className="dc-task-meta">
                          <span className={`tag st-${t.state}`}>{stateLabel(t, locale)}</span>
                          {t.block && t.block !== '无' && (
                            <span className="tag" style={{ borderColor: '#ff527044', color: 'var(--danger)' }}>🚫{t.block}</span>
                          )}
                        </div>
                        {taskBusyLead && (
                          <div className="ec-scheduler-chip" style={{ marginTop: 2, borderColor: taskBusyLead.state === 'paused' ? '#f6c17755' : '#4cc38a44', background: taskBusyLead.state === 'paused' ? '#2a2112' : '#0f2219' }}>
                            <div className="ec-scheduler-label">{taskBusyLead.state === 'paused' ? '⏸' : '📝'} {pickLocaleText(locale, '当前情况', 'Current Status')}</div>
                            <div className="ec-scheduler-detail">{renderBusySummary(taskBusyLead, locale)}</div>
                            {taskBusyLead.reason && <div className="ec-scheduler-detail">{taskBusyLead.reason}</div>}
                          </div>
                        )}
                        {(() => {
                          const sched = getSchedulerSummary(t, locale);
                          return (
                            <div className={`ec-scheduler-chip ${sched.tone}`} style={{ marginTop: 2 }}>
                              <div className="ec-scheduler-label">{sched.icon} {sched.label}</div>
                              <div className="ec-scheduler-detail">{sched.detail}</div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })
                ) : nonTaskBusyEntries.length > 0 ? (
                  nonTaskBusyEntries.map((entry) => (
                    <div key={`${entry.agent_id}-${entry.source_id || entry.updated_at}`} className="dc-task">
                      <div className="dc-task-id">{pickLocaleText(locale, '其他安排', 'Other Activity')}</div>
                      <div className="dc-task-title">{entry.topic || entry.task_title || pickLocaleText(locale, '协同处理', 'Shared Work')}</div>
                      <div className="dc-task-now">{renderBusySummary(entry, locale)}</div>
                      {entry.reason && (
                        <div className="dc-task-meta">
                          <span className="tag" style={{ borderColor: '#4cc38a44', color: '#67e8a5' }}>{entry.reason}</span>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="dc-idle">
                    <span style={{ fontSize: 20 }}>🪭</span>
                    <span>{pickLocaleText(locale, '当前空闲', 'Available now')}</span>
                  </div>
                )}
              </div>
              <div className="dc-footer">
                <span className="dc-model">{pickLocaleText(locale, '当前能力：', 'Current capability: ')}{off?.model_short || pickLocaleText(locale, '尚未准备好', 'Not ready')}</span>
                {off?.last_active && <span className="dc-la">⏰ {off.last_active}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
