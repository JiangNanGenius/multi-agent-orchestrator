import { useEffect } from 'react';
import { useStore, DEPTS, isEdict, stateLabel, getSchedulerSummary, deptMeta } from '../store';
import { api, type OfficialInfo } from '../api';
import { pickLocaleText } from '../i18n';

export default function MonitorPanel() {
  const locale = useStore((s) => s.locale);
  const liveStatus = useStore((s) => s.liveStatus);
  const agentsStatusData = useStore((s) => s.agentsStatusData);
  const agentsOverviewData = useStore((s) => s.agentsOverviewData);
  const loadAgentsStatus = useStore((s) => s.loadAgentsStatus);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    loadAgentsStatus();
  }, [loadAgentsStatus]);

  const tasks = liveStatus?.tasks || [];
  const activeTasks = tasks.filter((t) => isEdict(t) && t.state !== 'Done' && t.state !== 'Next');

  // Build agent map
  const agentMap: Record<string, OfficialInfo> = {};
  if (agentsOverviewData?.agents) {
    agentsOverviewData.agents.forEach((o) => { agentMap[o.id] = o; });
  }

  // Agent wake
  const handleWake = async (agentId: string) => {
    try {
      const r = await api.agentWake(agentId);
      toast(r.message || pickLocaleText(locale, '唤醒指令已发出', 'Wake command sent'));
      setTimeout(() => loadAgentsStatus(), 30000);
    } catch { toast(pickLocaleText(locale, '唤醒失败', 'Wake action failed'), 'err'); }
  };

  const handleWakeAll = async () => {
    if (!agentsStatusData) return;
    const toWake = agentsStatusData.agents.filter(
      (a) => a.status !== 'running' && a.status !== 'unconfigured'
    );
    if (!toWake.length) { toast(pickLocaleText(locale, '所有 Agent 均已在线', 'All agents are already online')); return; }
    toast(locale === 'en' ? `Waking ${toWake.length} agent(s)...` : `正在唤醒 ${toWake.length} 个 Agent...`);
    for (const a of toWake) {
      try { await api.agentWake(a.id); } catch { /* ignore */ }
    }
    toast(locale === 'en' ? `${toWake.length} wake command(s) sent; status will refresh in 30s` : `${toWake.length} 个唤醒指令已发出，30秒后刷新状态`);
    setTimeout(() => loadAgentsStatus(), 30000);
  };

  // Agent Status Panel
  const asData = agentsStatusData;
  const filtered = asData?.agents || [];
  const running = filtered.filter((a) => a.status === 'running').length;
  const idle = filtered.filter((a) => a.status === 'idle').length;
  const offline = filtered.filter((a) => a.status === 'offline').length;
  const unconf = filtered.filter((a) => a.status === 'unconfigured').length;
  const gw = asData?.gateway;
  const gwCls = gw?.probe ? 'ok' : gw?.alive ? 'warn' : 'err';

  return (
    <div>
      {/* Agent Status Panel */}
      {asData && asData.ok && (
        <div className="as-panel">
          <div className="as-header">
            <span className="as-title">{pickLocaleText(locale, '🔌 Agent 在线状态', '🔌 Agent Status')}</span>
            <span className={`as-gw ${gwCls}`}>Gateway: {gw?.status || pickLocaleText(locale, '未知', 'Unknown')}</span>
            <button className="btn-refresh" onClick={() => loadAgentsStatus()} style={{ marginLeft: 8 }}>
              {pickLocaleText(locale, '🔄 刷新', '🔄 Refresh')}
            </button>
            {(offline + unconf > 0) && (
              <button className="btn-refresh" onClick={handleWakeAll} style={{ marginLeft: 4, borderColor: 'var(--warn)', color: 'var(--warn)' }}>
                {pickLocaleText(locale, '⚡ 全部唤醒', '⚡ Wake All')}
              </button>
            )}
          </div>
          <div className="as-grid">
            {filtered.map((a) => {
              const canWake = a.status !== 'running' && a.status !== 'unconfigured' && gw?.alive;
              return (
                <div key={a.id} className="as-card" title={`${deptMeta(a.id, locale).role || a.role} · ${locale === 'en' ? (a.status === 'running' ? 'Running' : a.status === 'idle' ? 'Idle' : a.status === 'offline' ? 'Offline' : a.status === 'unconfigured' ? 'Unconfigured' : a.statusLabel) : a.statusLabel}`}>
                  <div className={`as-dot ${a.status}`} />
                  <div style={{ fontSize: 22 }}>{a.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{deptMeta(a.id, locale).label || a.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{deptMeta(a.id, locale).role || a.role}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{locale === 'en' ? (a.status === 'running' ? 'Running' : a.status === 'idle' ? 'Idle' : a.status === 'offline' ? 'Offline' : a.status === 'unconfigured' ? 'Unconfigured' : a.statusLabel) : a.statusLabel}</div>
                  {a.lastActive ? (
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>⏰ {a.lastActive}</div>
                  ) : (
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{pickLocaleText(locale, '无活动记录', 'No activity yet')}</div>
                  )}
                  {canWake && (
                    <button className="as-wake-btn" onClick={(e) => { e.stopPropagation(); handleWake(a.id); }}>
                      {pickLocaleText(locale, '⚡ 唤醒', '⚡ Wake')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="as-summary">
            <span><span className="as-dot running" style={{ position: 'static', width: 8, height: 8 }} /> {locale === 'en' ? `${running} running` : `${running} 运行中`}</span>
            <span><span className="as-dot idle" style={{ position: 'static', width: 8, height: 8 }} /> {locale === 'en' ? `${idle} idle` : `${idle} 待命`}</span>
            {offline > 0 && <span><span className="as-dot offline" style={{ position: 'static', width: 8, height: 8 }} /> {locale === 'en' ? `${offline} offline` : `${offline} 离线`}</span>}
            {unconf > 0 && <span><span className="as-dot unconfigured" style={{ position: 'static', width: 8, height: 8 }} /> {locale === 'en' ? `${unconf} unconfigured` : `${unconf} 未配置`}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>
              {locale === 'en' ? `Checked at ${(asData.checkedAt || '').substring(11, 19)}` : `检测于 ${(asData.checkedAt || '').substring(11, 19)}`}
            </span>
          </div>
        </div>
      )}

      {/* Duty Grid */}
      <div className="duty-grid">
        {DEPTS.map((d) => {
          const myTasks = activeTasks.filter((t) => t.org === d.label);
          const isActive = myTasks.some((t) => t.state === 'Doing');
          const isBlocked = myTasks.some((t) => t.state === 'Blocked');
          const off = agentMap[d.id];
          const hb = off?.heartbeat || { status: 'idle', label: '⚪' };
          const dotCls = isBlocked ? 'blocked' : isActive ? 'busy' : hb.status === 'active' ? 'active' : 'idle';
          const statusText = isBlocked
            ? pickLocaleText(locale, '⚠️ 阻塞', '⚠️ Blocked')
            : isActive
              ? pickLocaleText(locale, '⚙️ 执行中', '⚙️ Running')
              : hb.status === 'active'
                ? pickLocaleText(locale, '🟢 活跃', '🟢 Active')
                : pickLocaleText(locale, '⚪ 候命', '⚪ Idle');
          const cardCls = isBlocked ? 'blocked-card' : isActive ? 'active-card' : '';
          const panelMeta = deptMeta(d.id, locale);

          return (
            <div key={d.id} className={`duty-card ${cardCls}`}>
              <div className="dc-hdr">
                <span className="dc-emoji">{d.emoji}</span>
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
                  myTasks.map((t) => (
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
                  ))
                ) : (
                  <div className="dc-idle">
                    <span style={{ fontSize: 20 }}>🪭</span>
                    <span>{pickLocaleText(locale, '候命中', 'Standing by')}</span>
                  </div>
                )}
              </div>
              <div className="dc-footer">
                <span className="dc-model">🤖 {off?.model_short || pickLocaleText(locale, '待配置', 'Not configured')}</span>
                {off?.last_active && <span className="dc-la">⏰ {off.last_active}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
