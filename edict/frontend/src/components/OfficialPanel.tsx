import { useEffect } from 'react';
import { useStore, stateLabel, deptMeta, normalizeAgentId } from '../store';
import { pickLocaleText, type Locale } from '../i18n';

function officialMeta(id: string, locale: Locale, role: string, label: string, rank: string) {
  const normalizedId = normalizeAgentId(id);
  const meta = deptMeta(normalizedId, locale);
  if (!meta || meta.label === normalizedId) {
    return { title: role || label || id, subtitle: label || role || '', rank };
  }
  return { title: meta.label, subtitle: meta.role, rank: meta.rank };
}

function heartbeatLabel(status: string | undefined, fallback: string, locale: Locale): string {
  if (locale !== 'en') return fallback;
  if (status === 'active') return '🟢 Active';
  if (status === 'idle') return '⚪ Idle';
  if (status === 'offline') return '⚫ Offline';
  if (status === 'running') return '⚙️ Running';
  return fallback;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function AgentOverviewPanel() {
  const locale = useStore((s) => s.locale);
  const agentsOverviewData = useStore((s) => s.agentsOverviewData);
  const selectedAgent = useStore((s) => s.selectedAgent);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const loadAgentsOverview = useStore((s) => s.loadAgentsOverview);
  const setModalTaskId = useStore((s) => s.setModalTaskId);

  useEffect(() => {
    loadAgentsOverview();
  }, [loadAgentsOverview]);

  if (!agentsOverviewData?.agents) {
    return <div className="empty">{pickLocaleText(locale, '⚠️ 请确保本地服务器已启动', '⚠️ Please make sure the local server is running')}</div>;
  }

  const agents = agentsOverviewData.agents;
  const totals = agentsOverviewData.totals || { tasks_done: 0, cost_cny: 0 };
  const maxTk = Math.max(...agents.map((o) => o.tokens_in + o.tokens_out + o.cache_read + o.cache_write), 1);

  // Active agents
  const alive = agents.filter((o) => o.heartbeat?.status === 'active');

  // Selected agent detail
  const sel = agents.find((o) => o.id === (selectedAgent || agents[0]?.id));
  const selId = sel?.id || agents[0]?.id;

  return (
    <div>
      {/* Activity banner */}
      {alive.length > 0 && (
        <div className="off-activity">
          <span>{pickLocaleText(locale, '🟢 当前活跃：', '🟢 Active now:')}</span>
          {alive.map((o) => {
            const meta = officialMeta(o.id, locale, o.role, o.label, o.rank);
            return <span key={o.id} style={{ fontSize: 12 }}>{o.emoji} {meta.title}</span>;
          })}
          <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }}>{pickLocaleText(locale, '其余 Agent 待命', 'Other agents are on standby')}</span>
        </div>
      )}

      {/* KPI Row */}
      <div className="off-kpi">
        <div className="kpi">
          <div className="kpi-v" style={{ color: 'var(--acc)' }}>{agents.length}</div>
          <div className="kpi-l">{pickLocaleText(locale, '在线 Agent', 'Online Agents')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ color: '#f5c842' }}>{totals.tasks_done || 0}</div>
          <div className="kpi-l">{pickLocaleText(locale, '累计完成任务', 'Completed Tasks')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ color: (totals.cost_cny || 0) > 20 ? 'var(--warn)' : 'var(--ok)' }}>
            ¥{totals.cost_cny || 0}
          </div>
          <div className="kpi-l">{pickLocaleText(locale, '累计费用（含缓存）', 'Total Cost (incl. cache)')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ fontSize: 16, paddingTop: 4 }}>{agentsOverviewData.top_agent || '—'}</div>
          <div className="kpi-l">{pickLocaleText(locale, '贡献最高', 'Top Contributor')}</div>
        </div>
      </div>

      {/* Layout: Ranklist + Detail */}
      <div className="off-layout">
        {/* Left: Ranklist */}
        <div className="off-ranklist">
          <div className="orl-hdr">{pickLocaleText(locale, '贡献排行', 'Contribution Ranking')}</div>
          {agents.map((o) => {
            const hb = o.heartbeat || { status: 'idle' };
            const meta = officialMeta(o.id, locale, o.role, o.label, o.rank);
            return (
              <div
                key={o.id}
                className={`orl-item${selId === o.id ? ' selected' : ''}`}
                onClick={() => setSelectedAgent(o.id)}
              >
                <span style={{ minWidth: 24, textAlign: 'center' }}>
                  {o.merit_rank <= 3 ? MEDALS[o.merit_rank - 1] : '#' + o.merit_rank}
                </span>
                <span>{o.emoji}</span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{meta.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{meta.subtitle}</div>
                </span>
                <span style={{ fontSize: 11 }}>{locale === 'en' ? `${o.merit_score} pts` : `${o.merit_score}分`}</span>
                <span className={`dc-dot ${hb.status}`} style={{ width: 8, height: 8 }} />
              </div>
            );
          })}
        </div>

        {/* Right: Detail */}
        <div className="off-detail">
          {sel ? (
            <AgentDetail agent={sel} maxTk={maxTk} onOpenTask={setModalTaskId} locale={locale} />
          ) : (
            <div className="empty">{pickLocaleText(locale, '选择左侧 Agent 查看详情', 'Select an agent on the left to view details')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentDetail({
  agent: o,
  maxTk,
  onOpenTask,
  locale,
}: {
  agent: NonNullable<ReturnType<typeof useStore.getState>['agentsOverviewData']>['agents'][0];
  maxTk: number;
  onOpenTask: (id: string) => void;
  locale: Locale;
}) {
  const hb = o.heartbeat || { status: 'idle', label: '⚪ 待命' };
  const totTk = o.tokens_in + o.tokens_out + o.cache_read + o.cache_write;
  const participatedTasks = o.participated_tasks || [];

  const meta = officialMeta(o.id, locale, o.role, o.label, o.rank);
  const tkBars = [
    { l: pickLocaleText(locale, '输入', 'Input'), v: o.tokens_in, color: '#6a9eff' },
    { l: pickLocaleText(locale, '输出', 'Output'), v: o.tokens_out, color: '#a07aff' },
    { l: pickLocaleText(locale, '缓存读', 'Cache Read'), v: o.cache_read, color: '#2ecc8a' },
    { l: pickLocaleText(locale, '缓存写', 'Cache Write'), v: o.cache_write, color: '#f5c842' },
  ];

  return (
    <div>
      {/* Hero */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 40 }}>{o.emoji}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{meta.title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {meta.subtitle} · <span style={{ color: 'var(--acc)' }}>{o.model_short || o.model}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            🏅 {meta.rank} · {locale === 'en' ? `Contribution ${o.merit_score}` : `贡献分 ${o.merit_score}`}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`hb ${hb.status}`} style={{ marginBottom: 4 }}>{heartbeatLabel(hb.status, hb.label, locale)}</div>
          {o.last_active && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{locale === 'en' ? `Active ${o.last_active}` : `活跃 ${o.last_active}`}</div>}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            {locale === 'en' ? `${o.sessions} sessions · ${o.messages} messages` : `${o.sessions} 个会话 · ${o.messages} 条消息`}
          </div>
        </div>
      </div>

      {/* Merit Stats */}
      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">{pickLocaleText(locale, '贡献统计', 'Contribution Stats')}</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ok)' }}>{o.tasks_done}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{pickLocaleText(locale, '完成任务', 'Completed')}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--warn)' }}>{o.tasks_active}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{pickLocaleText(locale, '执行中', 'In Progress')}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--acc)' }}>{o.flow_participations}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{pickLocaleText(locale, '流转参与', 'Workflow Participations')}</div>
          </div>
        </div>
      </div>

      {/* Token Bars */}
      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">{pickLocaleText(locale, 'Token 消耗', 'Token Usage')}</div>
        {tkBars.map((b) => (
          <div key={b.l} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ color: 'var(--muted)' }}>{b.l}</span>
              <span>{b.v.toLocaleString()}</span>
            </div>
            <div style={{ height: 6, background: '#0e1320', borderRadius: 3 }}>
              <div style={{ height: '100%', width: `${maxTk > 0 ? Math.round((b.v / maxTk) * 100) : 0}%`, background: b.color, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Cost */}
      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">{pickLocaleText(locale, '累计费用', 'Total Cost')}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <span style={{ fontSize: 12, color: o.cost_cny > 10 ? 'var(--danger)' : o.cost_cny > 3 ? 'var(--warn)' : 'var(--ok)' }}>
            <b>¥{o.cost_cny}</b> {pickLocaleText(locale, '人民币', 'CNY')}
          </span>
          <span style={{ fontSize: 12 }}><b>${o.cost_usd}</b> {pickLocaleText(locale, '美元', 'USD')}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{locale === 'en' ? `Total ${totTk.toLocaleString()} tokens` : `总计 ${totTk.toLocaleString()} tokens`}</span>
        </div>
      </div>

      {/* Participated Tasks */}
      <div>
        <div className="sec-title">{locale === 'en' ? `Participated Tasks (${participatedTasks.length})` : `参与任务（${participatedTasks.length} 个）`}</div>
        {participatedTasks.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>{pickLocaleText(locale, '暂无任务记录', 'No task records yet')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {participatedTasks.map((e) => (
              <div
                key={e.id}
                style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--line)' }}
                onClick={() => onOpenTask(e.id)}
              >
                <span style={{ fontSize: 10, color: 'var(--acc)', fontWeight: 700 }}>{e.id}</span>
                <span style={{ flex: 1, fontSize: 12 }}>{e.title.substring(0, 35)}</span>
                <span className={`tag st-${e.state}`} style={{ fontSize: 10 }}>{stateLabel(e as never, locale)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
