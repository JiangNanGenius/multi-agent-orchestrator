import { useEffect, useMemo, useState } from 'react';
import { useStore, stateLabel, deptMeta, normalizeAgentId } from '../store';
import { api } from '../api';
import { pickLocaleText, type Locale } from '../i18n';
import ModelConfig from './ModelConfig';
import PersistentAgentChat, { type ChatIntent, type DraftReview } from './PersistentAgentChat';

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
const PRESET_EXPERT_IDS = new Set([
  'control_center',
  'plan_center',
  'review_center',
  'dispatch_center',
  'docs_specialist',
  'data_specialist',
  'code_specialist',
  'audit_specialist',
  'deploy_specialist',
  'admin_specialist',
  'search_specialist',
  'expert_curator',
]);

const AGENT_MANAGEMENT_INTENTS: ChatIntent[] = [
  {
    key: 'adjust-roster',
    labelZh: '调整编组',
    labelEn: 'Adjust Roster',
    prefillZh: '我想调整 Agent 编组、职责分工与默认协作关系，请先帮我梳理影响范围。',
    prefillEn: 'I want to adjust the agent roster, role split, and default collaboration relationships. Please outline the impact first.',
  },
  {
    key: 'recover-entry',
    labelZh: '恢复入口',
    labelEn: 'Restore Entry',
    prefillZh: '我需要恢复或补齐 Agent 管理入口、会话能力与关联配置，请先确认缺口。',
    prefillEn: 'I need to restore or complete the agent management entry, conversation flow, and related configuration. Confirm the gaps first.',
  },
  {
    key: 'sync-config',
    labelZh: '同步配置',
    labelEn: 'Sync Configuration',
    prefillZh: '我想检查 Agent 的模型分配、权限边界与当前配置是否一致，请整理成处理请求。',
    prefillEn: 'I want to check whether model allocation, permission boundaries, and current agent configuration are aligned. Turn it into an actionable request.',
  },
];

function buildAgentDraftReview(draftText: string, locale: Locale): DraftReview {
  const clean = draftText.replace(/\s+/g, ' ').trim();
  const missing: string[] = [];
  if (!clean) {
    missing.push(pickLocaleText(locale, '请先说明要处理的 Agent 管理事项。', 'Please describe the agent management request first.'));
  }
  if (!/agent|成员|角色|编组|模型|权限|职责|入口|会话/i.test(clean)) {
    missing.push(pickLocaleText(locale, '补充涉及的 Agent、角色或入口范围。', 'Add the affected agents, roles, or entry scope.'));
  }
  if (!/调整|新增|移除|恢复|配置|分配|同步|查看|校准|修复|optimi|restore|adjust|update|sync|remove|add/i.test(clean)) {
    missing.push(pickLocaleText(locale, '补充希望执行的动作，例如恢复、调整、同步或修复。', 'Add the intended action, such as restore, adjust, sync, or fix.'));
  }

  const title = clean
    ? clean.split(/[。！？!?\.\n]/)[0].slice(0, 42)
    : pickLocaleText(locale, '新的 Agent 管理请求', 'New agent management request');

  return {
    ready: missing.length === 0,
    title,
    summary: clean || pickLocaleText(locale, '等待补充 Agent 管理目标。', 'Waiting for agent management details.'),
    followUp: missing.length
      ? missing.join('；')
      : pickLocaleText(locale, '信息已足够，可以创建 Agent 管理任务。', 'The details are sufficient to create an agent management task.'),
    missing,
  };
}

export default function AgentOverviewPanel() {
  const locale = useStore((s) => s.locale);
  const agentsOverviewData = useStore((s) => s.agentsOverviewData);
  const selectedAgent = useStore((s) => s.selectedAgent);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const loadAgentsOverview = useStore((s) => s.loadAgentsOverview);
  const setModalTaskId = useStore((s) => s.setModalTaskId);

  const [rosterOpen, setRosterOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);

  useEffect(() => {
    loadAgentsOverview();
  }, [loadAgentsOverview]);

  const agents = agentsOverviewData?.agents || [];
  const totals = agentsOverviewData?.totals || { tasks_done: 0, cost_cny: 0 };
  const maxTk = Math.max(...agents.map((o) => o.tokens_in + o.tokens_out + o.cache_read + o.cache_write), 1);
  const alive = agents.filter((o) => o.heartbeat?.status === 'active');
  const sel = agents.find((o) => o.id === (selectedAgent || agents[0]?.id));
  const selId = sel?.id || agents[0]?.id;

  const removableExperts = useMemo(
    () => agents.filter((agent) => !PRESET_EXPERT_IDS.has(normalizeAgentId(agent.id))),
    [agents],
  );
  const managerMeta = deptMeta('admin_specialist', locale);
  const managerLabel = managerMeta.label === 'admin_specialist'
    ? pickLocaleText(locale, '管理专家', 'Management Specialist')
    : managerMeta.label;

  if (!agentsOverviewData?.agents) {
    return <div className="empty">{pickLocaleText(locale, '⚠️ 当前暂时无法加载 Agent 信息', '⚠️ Agent information is temporarily unavailable')}</div>;
  }

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          background: 'linear-gradient(135deg, rgba(19,41,84,.78), rgba(15,24,44,.92))',
          border: '1px solid rgba(123, 224, 255, 0.24)',
          borderRadius: 16,
          padding: 16,
          boxShadow: '0 14px 28px rgba(0, 0, 0, .18)',
        }}
      >
          <div>
            <div style={{ fontSize: 11, color: '#7be0ff', fontWeight: 700, letterSpacing: '.06em', marginBottom: 4 }}>
              {pickLocaleText(locale, 'Agent 管理', 'Agent Management')}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.15 }}>
              {pickLocaleText(locale, '查看表现与调整配置', 'Performance and Configuration')}
            </div>
          </div>

          <button
            onClick={() => setRosterOpen((v) => !v)}
            style={{
              padding: '9px 16px',
              background: 'linear-gradient(135deg, #53b7ff, #7be0ff)',
              color: '#03111f',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: 12.5,
              boxShadow: '0 8px 18px rgba(83,183,255,.2)',
            }}
          >
            {rosterOpen
              ? pickLocaleText(locale, '收起配置', 'Hide Config')
              : pickLocaleText(locale, '调整配置', 'Adjust Config')}
          </button>
        </div>

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

      <div className="off-kpi">
        <div className="kpi">
          <div className="kpi-v" style={{ color: 'var(--acc)' }}>{agents.length}</div>
          <div className="kpi-l">{pickLocaleText(locale, '协作 Agent 总数', 'Total Agents')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ color: '#f5c842' }}>{totals.tasks_done || 0}</div>
          <div className="kpi-l">{pickLocaleText(locale, '累计完成任务', 'Completed Tasks')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ color: (totals.cost_cny || 0) > 20 ? 'var(--warn)' : 'var(--ok)' }}>
            ¥{totals.cost_cny || 0}
          </div>
          <div className="kpi-l">{pickLocaleText(locale, '累计费用', 'Total Cost')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ fontSize: 16, paddingTop: 4 }}>{agentsOverviewData.top_agent || '—'}</div>
          <div className="kpi-l">{pickLocaleText(locale, '贡献最高', 'Top Contributor')}</div>
        </div>
      </div>

      <div className="off-layout">
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

        <div className="off-detail">
          {sel ? (
            <AgentDetail agent={sel} maxTk={maxTk} onOpenTask={setModalTaskId} locale={locale} />
          ) : (
            <div className="empty">{pickLocaleText(locale, '选择左侧 Agent 查看详情', 'Select an Agent on the left to view details')}</div>
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 24,
          border: '1px solid rgba(123, 224, 255, 0.16)',
          background: 'linear-gradient(180deg, rgba(18,24,38,0.92), rgba(11,16,28,0.88))',
          boxShadow: '0 22px 54px rgba(0, 0, 0, 0.15)',
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 6, maxWidth: 720 }}>
            <div style={{ fontSize: 11, color: '#7be0ff', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
              {pickLocaleText(locale, 'Agent 管理对话', 'Agent Management Chat')}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.18 }}>
              {pickLocaleText(locale, '通过管理对话发起角色调整与配置请求', 'Start roster and configuration requests through a dedicated management chat')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.66 }}>
              {chatPanelOpen
                ? pickLocaleText(locale, '对话区已恢复，支持直接创建 Agent 管理任务并在原任务上继续追问。', 'The conversation area is back so you can create agent-management tasks and continue follow-ups on the same task.')
                : pickLocaleText(locale, '桌面端会话区已改为更清晰的工作台结构。需要调整编组、角色职责或配置同步时，可直接从这里进入。', 'The desktop conversation area now uses a clearer workbench layout. Open it here whenever you need to adjust roster setup, role responsibilities, or configuration sync.')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
            <span className="chip ok">{managerLabel}</span>
            <button
              type="button"
              onClick={() => setChatPanelOpen((v) => !v)}
              style={{
                padding: '9px 13px',
                borderRadius: 12,
                border: '1px solid rgba(123, 224, 255, 0.28)',
                background: chatPanelOpen ? 'rgba(123,224,255,0.16)' : 'rgba(255,255,255,0.04)',
                color: 'var(--text)',
                fontWeight: 700,
                cursor: 'pointer',
                minWidth: 112,
                boxShadow: chatPanelOpen ? '0 12px 28px rgba(91, 198, 255, 0.16)' : 'none',
              }}
            >
              {chatPanelOpen
                ? pickLocaleText(locale, '收起面板', 'Collapse Panel')
                : pickLocaleText(locale, '展开面板', 'Expand Panel')}
            </button>
          </div>
        </div>

        {chatPanelOpen ? (
          <PersistentAgentChat
            storageKey="edict-agent-management-chat"
            agentId="admin_specialist"
            agentLabel={managerLabel}
            agentEmoji={managerMeta.emoji || '🧭'}
            accentColor="rgba(123,224,255,0.42)"
            accentSoft="rgba(123,224,255,0.10)"
            headerKickerZh="Agent 管理"
            headerKickerEn="Agent Management"
            headerTitleZh="Agent 管理"
            headerTitleEn="Agent Management"
            headerDescZh=""
            headerDescEn=""
            handlerNoteZh=""
            handlerNoteEn=""
            introZh="输入你的 Agent 管理需求"
            introEn="Enter your agent management request"
            draftLabelZh="需求"
            draftLabelEn="Request"
            taskFilter={(task) => {
              const joined = `${task.currentDept || ''} ${task.targetDept || ''} ${task.org || ''} ${task.title || ''}`.toLowerCase();
              return joined.includes('admin_specialist') || joined.includes('agent') || joined.includes('管理专家');
            }}
            intents={AGENT_MANAGEMENT_INTENTS}
            buildDraftReview={(draftText) => buildAgentDraftReview(draftText, locale)}
            createTask={async (draftText, review) => api.createTask({
              title: `${pickLocaleText(locale, 'Agent 管理', 'Agent Management')}：${review.title}`,
              org: pickLocaleText(locale, '总控中心', 'Control Center'),
              targetDept: 'admin_specialist',
              params: {
                request: draftText,
                summary: review.summary,
              },
            })}
            appendTaskMessage={(taskId, text) => api.taskAppendMessage(taskId, 'admin_specialist', text)}
            renderSidebar={() => null}
          />
        ) : (
          <div style={{ borderRadius: 16, border: '1px dashed rgba(123,224,255,0.24)', background: 'linear-gradient(180deg, rgba(123,224,255,0.08), rgba(123,224,255,0.03))', padding: 14, color: 'var(--muted)', fontSize: 12, lineHeight: 1.72 }}>
            {pickLocaleText(locale, '管理面板默认收起。点击右上角“展开面板”即可打开完整桌面工作台，并在左侧会话索引、中部记录区和右侧快捷入口之间联动操作。', 'The management panel is collapsed by default. Click “Expand Panel” in the top-right corner to open the full desktop workbench and work across the session rail, central record area, and right-side quick entries.')}
          </div>
        )}
      </div>

      {rosterOpen && (
        <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 15, padding: 16, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="chip ok">{pickLocaleText(locale, '入口：总控中心', 'Entry: Control Center')}</span>
              <span className="chip">{pickLocaleText(locale, '默认 Agent 不可删除', 'Default Agents are protected')}</span>
              <span className="chip">
                {removableExperts.length
                  ? pickLocaleText(locale, `可移除后加 Agent ${removableExperts.length}`, `${removableExperts.length} removable added agent(s)`)
                  : pickLocaleText(locale, '暂无可移除后加 Agent', 'No removable added agents')}
              </span>
            </div>
          </div>
          <ModelConfig embedded />
        </div>
      )}
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
    { l: pickLocaleText(locale, '内容输入', 'Input Content'), v: o.tokens_in, color: '#6a9eff' },
    { l: pickLocaleText(locale, '内容输出', 'Output Content'), v: o.tokens_out, color: '#a07aff' },
    { l: pickLocaleText(locale, '历史复用', 'History Reuse'), v: o.cache_read, color: '#2ecc8a' },
    { l: pickLocaleText(locale, '记录写入', 'Record Saving'), v: o.cache_write, color: '#f5c842' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ fontSize: 40 }}>{o.emoji}</div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{meta.title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {meta.subtitle}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            🏅 {meta.rank} · {locale === 'en' ? `Score ${o.merit_score}` : `评分 ${o.merit_score}`}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 160, marginLeft: 'auto' }}>
          <div className={`hb ${hb.status}`} style={{ marginBottom: 4 }}>{heartbeatLabel(hb.status, hb.label, locale)}</div>
          {o.last_active && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{locale === 'en' ? `Active ${o.last_active}` : `活跃 ${o.last_active}`}</div>}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            {locale === 'en' ? `${o.sessions} conversations · ${o.messages} messages` : `${o.sessions} 段对话 · ${o.messages} 条消息`}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">{pickLocaleText(locale, '贡献统计', 'Contribution Stats')}</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
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
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{pickLocaleText(locale, '协作参与', 'Collaboration Participations')}</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">{pickLocaleText(locale, '内容活跃度', 'Content Activity')}</div>
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

      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">{pickLocaleText(locale, '累计费用', 'Total Cost')}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: o.cost_cny > 10 ? 'var(--danger)' : o.cost_cny > 3 ? 'var(--warn)' : 'var(--ok)' }}>
            <b>¥{o.cost_cny}</b> {pickLocaleText(locale, '人民币', 'CNY')}
          </span>
          <span style={{ fontSize: 12 }}><b>${o.cost_usd}</b> {pickLocaleText(locale, '美元', 'USD')}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{locale === 'en' ? `Total activity ${totTk.toLocaleString()}` : `总活跃量 ${totTk.toLocaleString()}`}</span>
        </div>
      </div>

      <div>
        <div className="sec-title">{locale === 'en' ? `Participated Tasks (${participatedTasks.length})` : `参与任务（${participatedTasks.length} 个）`}</div>
        {participatedTasks.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>{pickLocaleText(locale, '暂无任务记录', 'No task records yet')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {participatedTasks.map((e) => (
              <div
                key={e.id}
                style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', border: '1px solid var(--line)', minWidth: 0 }}
                onClick={() => onOpenTask(e.id)}
              >
                <span style={{ fontSize: 10, color: 'var(--acc)', fontWeight: 700 }}>{e.id}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{e.title.substring(0, 35)}</span>
                <span className={`tag st-${e.state}`} style={{ fontSize: 10, marginLeft: 'auto' }}>{stateLabel(e as never, locale)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
