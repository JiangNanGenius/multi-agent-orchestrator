import { useEffect, useMemo, useState } from 'react';
import { api, type Task } from '../api';
import { useStore, stateLabel, deptMeta, normalizeAgentId } from '../store';
import { pickLocaleText, type Locale } from '../i18n';
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

function buildRosterDraftReview(text: string, locale: Locale): DraftReview {
  const content = text.replace(/\s+/g, ' ').trim();
  if (!content) {
    return {
      ready: false,
      title: pickLocaleText(locale, '专家编组治理会话', 'Expert Curation Governance Session'),
      summary: '',
      followUp: pickLocaleText(locale, '请先说明你希望专家编组官执行哪类动作：新增专家，还是删除后续增设的专家；并补充对象、理由、约束和期望结果。', 'Please first explain what action you want the Expert Curator to take: add an expert or remove a later-added expert; also include the target, rationale, constraints, and expected result.'),
      missing: [pickLocaleText(locale, '治理动作', 'governance action')],
    };
  }

  const wantAdd = /(新增|增加|添加|新设|补充|add)/i.test(content);
  const wantDelete = /(删除|移除|撤销|remove|delete)/i.test(content);
  const missing: string[] = [];

  if (!wantAdd && !wantDelete) missing.push(pickLocaleText(locale, '明确是新增还是删除', 'whether this is an addition or a removal'));
  if (content.length < 16) missing.push(pickLocaleText(locale, '更具体的对象与理由', 'a more specific target and rationale'));
  if (!/(原因|理由|职责|规则|影响|约束|保留|删除|新增|期望|结果)/.test(content)) {
    missing.push(pickLocaleText(locale, '治理理由或约束', 'the governance rationale or constraints'));
  }

  const title = pickLocaleText(locale, `请专家编组官处理：${content.slice(0, 40)}`, `Ask the Expert Curator to handle: ${content.slice(0, 40)}`);
  const summary = pickLocaleText(
    locale,
    `处理对象：专家编组官\n治理诉求：${content}\n约束规则：预置专家不得删除；如为删除，仅允许删除后续增设专家；请先补问并形成确认摘要，再创建后台治理任务。`,
    `Handler: Expert Curator\nGovernance request: ${content}\nConstraint rules: preset experts cannot be deleted; if this is a removal, only later-added experts may be removed; ask follow-up questions and produce a confirmation summary before creating the backend governance task.`,
  );

  if (missing.length) {
    return {
      ready: false,
      title,
      summary,
      followUp: pickLocaleText(locale, `为避免误删或误建，请再补充：${missing.join('、')}。`, `To avoid removing or creating the wrong expert, please also add ${missing.join(', ')}.`),
      missing,
    };
  }

  return {
    ready: true,
    title,
    summary,
    followUp: pickLocaleText(locale, '信息已足够，可以创建治理任务。', 'The information is sufficient and the governance task can be created now.'),
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

  const curatorMeta = deptMeta('expert_curator', locale);
  const curatorLabel = curatorMeta.label;
  const curatorEmoji = agents.find((agent) => normalizeAgentId(agent.id) === 'expert_curator')?.emoji || '🧭';

  const rosterIntents: ChatIntent[] = [
    {
      key: 'add-expert',
      labelZh: '新增专家',
      labelEn: 'Add Expert',
      prefillZh: '我需要专家编组官按既定规则新增专家。请先确认专家名称、职责边界、纳入名册的原因、预期接入规则，以及是否需要影响既有分工。',
      prefillEn: 'I need the Expert Curator to add an expert by established rules. Please first confirm the expert name, responsibility boundaries, reason for adding to the roster, expected routing rules, and whether existing responsibilities will be affected.',
      helperZh: '适用于新设专家、补足能力短板或明确职责边界。',
      helperEn: 'Use this when creating a new expert, filling a capability gap, or clarifying responsibility boundaries.',
    },
    {
      key: 'remove-expert',
      labelZh: '删除增设专家',
      labelEn: 'Remove Added Expert',
      prefillZh: '我需要专家编组官按既定规则删除一个后续增设的专家。请先确认专家名称或 ID、删除原因、是否需要迁移职责，以及预置专家不可删除这一约束。',
      prefillEn: 'I need the Expert Curator to remove a later-added expert by established rules. Please first confirm the expert name or ID, rationale for removal, whether responsibilities need to be migrated, and the constraint that preset experts cannot be deleted.',
      helperZh: '适用于撤销后续增设专家，并保留系统预置角色。',
      helperEn: 'Use this when removing a later-added expert while preserving preset system roles.',
    },
    {
      key: 'adjust-boundary',
      labelZh: '调整职责边界',
      labelEn: 'Adjust Responsibility Boundaries',
      prefillZh: '我需要专家编组官调整专家职责边界。请先确认涉及哪些专家、当前冲突或重叠点、调整目标，以及是否需要同步更新路由规则。',
      prefillEn: 'I need the Expert Curator to adjust responsibility boundaries. Please first confirm which experts are involved, the current conflict or overlap, the target state after adjustment, and whether routing rules should also be updated.',
      helperZh: '适用于名册结构优化、职责重叠治理与分工重整。',
      helperEn: 'Use this for roster optimization, overlap governance, and responsibility realignment.',
    },
  ];

  if (!agentsOverviewData?.agents) {
    return <div className="empty">{pickLocaleText(locale, '⚠️ 请确保本地服务器已启动', '⚠️ Please make sure the local server is running')}</div>;
  }

  return (
    <div>
      <div
        style={{
          marginBottom: 18,
          background: 'linear-gradient(135deg, rgba(19,41,84,.78), rgba(15,24,44,.92))',
          border: '1px solid rgba(123, 224, 255, 0.24)',
          borderRadius: 18,
          padding: 18,
          boxShadow: '0 20px 40px rgba(0, 0, 0, .22)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: '#7be0ff', fontWeight: 700, letterSpacing: '.06em', marginBottom: 6 }}>
              {pickLocaleText(locale, 'AGENT 名册治理', 'AGENT ROSTER GOVERNANCE')}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
              {pickLocaleText(locale, '贡献详情与专家编组入口', 'Contribution Details & Expert Roster Entry')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, maxWidth: 820 }}>
              {pickLocaleText(
                locale,
                '这个页面聚焦于 Agent 名册、贡献画像与治理动作，不承担全局在线监控职责。新增或删除增设专家时，请统一提交给“专家编组官”；预置专家会被系统自动保护，不能从这里发起删除。现在该入口已升级为可持久化聊天会话窗口，支持刷新恢复与后台追踪。',
                'This page focuses on the agent roster, contribution profiles, and governance actions instead of global runtime monitoring. When you need to add or remove an extra expert, submit the request to the Expert Curator here. Preset experts are automatically protected and cannot be removed from this entry. The entry is now upgraded to a persistent chat session that supports refresh recovery and background tracking.',
              )}
            </div>
          </div>
          <button
            onClick={() => setRosterOpen((v) => !v)}
            style={{
              padding: '10px 18px',
              background: 'linear-gradient(135deg, #53b7ff, #7be0ff)',
              color: '#03111f',
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: 13,
              whiteSpace: 'nowrap',
              boxShadow: '0 10px 24px rgba(83,183,255,.24)',
            }}
          >
            {rosterOpen
              ? pickLocaleText(locale, '收起专家编组官会话窗口', 'Hide Expert Curator Session Window')
              : pickLocaleText(locale, '打开专家编组官会话窗口', 'Open Expert Curator Session Window')}
          </button>
        </div>
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
          <div className="kpi-l">{pickLocaleText(locale, '纳入名册 Agent', 'Rostered Agents')}</div>
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
            <div className="empty">{pickLocaleText(locale, '选择左侧 Agent 查看详情', 'Select an agent on the left to view details')}</div>
          )}
        </div>
      </div>

      {rosterOpen && (
        <div style={{ marginTop: 18 }}>
          <PersistentAgentChat
            storageKey="edict-expert-curator-chat"
            agentId="expert_curator"
            agentLabel={curatorLabel}
            agentEmoji={curatorEmoji}
            accentColor="#53b7ff"
            accentSoft="rgba(83, 183, 255, 0.12)"
            headerKickerZh="专家编组官会话窗口"
            headerKickerEn="Expert Curator Session Window"
            headerTitleZh="按既定规则提交专家治理任务"
            headerTitleEn="Submit Expert Governance Tasks by Established Rules"
            headerDescZh="这里替代原来的一次性治理弹窗。你可以先在草稿会话中补充背景、对象、理由与约束；系统会先追问并生成确认摘要，确认后再创建后台治理任务。任务创建后，活动流将绑定 taskId 持久化保存，因此可以挂到后台执行，并在刷新网页后继续恢复查看。"
            headerDescEn="This replaces the original one-shot governance dialog. You can first add background, targets, rationale, and constraints in a draft session; the system will ask follow-up questions and generate a confirmation summary before creating the backend governance task. Once created, the activity stream is persisted with the task ID, so the work can continue in the background and be restored after a page refresh."
            handlerNoteZh="此入口只会把治理任务交给专家编组官，并自动保护预置专家不被误删。"
            handlerNoteEn="This entry always routes governance tasks to the Expert Curator and automatically protects preset experts from accidental deletion."
            introZh="这里采用“聊天草稿 + 后台任务活动流”双层结构。草稿阶段的最近会话会保存在本地，已创建任务的执行记录则持续写入活动流，因此即便刷新页面，也能从左侧会话列表恢复历史记录。"
            introEn="This view uses a dual-layer model of draft chat plus backend task activity stream. Recent draft sessions are kept locally, while created tasks continue writing to the activity stream, so history can be restored from the session list even after a page refresh."
            draftLabelZh="专家编组官草稿会话"
            draftLabelEn="Expert Curator Draft Session"
            taskFilter={(task: Task) => {
              const anyTask = task as Task & { templateId?: string; templateParams?: Record<string, string> };
              return anyTask.templateId === 'expert_roster_dialog'
                || anyTask.targetDept === curatorLabel
                || anyTask.templateParams?.targetAgentId === 'expert_curator';
            }}
            intents={rosterIntents}
            buildDraftReview={buildRosterDraftReview}
            createTask={async (draftText, review) => api.createTask({
              title: review.title,
              org: pickLocaleText(locale, '总控中心', 'Control Center'),
              owner: pickLocaleText(locale, 'Agent 页面', 'Agent Workspace'),
              targetDept: curatorLabel,
              priority: 'normal',
              templateId: 'expert_roster_dialog',
              params: {
                entry: 'agent-overview',
                message: draftText.trim(),
                confirmationSummary: review.summary,
                immutableRule: pickLocaleText(locale, '预置专家不得删除', 'Preset experts cannot be deleted'),
                targetAgentId: 'expert_curator',
                targetAgentLabel: curatorLabel,
              },
            })}
            appendTaskMessage={(taskId, text) => api.taskAppendMessage(taskId, 'expert_curator', text)}
            renderSidebar={({ locale: currentLocale, review: currentReview }) => (
              <>
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(currentLocale, '可删除专家范围', 'Removable Expert Scope')}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, marginBottom: removableExperts.length ? 10 : 0 }}>
                    {pickLocaleText(currentLocale, '删除动作只允许作用于后续增设专家。下方列表仅用于帮助你描述对象，真正提交前仍会进入确认摘要。', 'Removal is allowed only for later-added experts. The list below helps you describe the target, but the request will still go through a confirmation summary before submission.')}
                  </div>
                  {removableExperts.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {removableExperts.map((agent) => {
                        const meta = officialMeta(agent.id, currentLocale, agent.role, agent.label, agent.rank);
                        return (
                          <span key={agent.id} style={{ fontSize: 11, padding: '5px 9px', borderRadius: 999, background: 'rgba(83,183,255,.12)', color: '#7be0ff', border: '1px solid rgba(83,183,255,.22)' }}>
                            {agent.emoji} {meta.title}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                      {pickLocaleText(currentLocale, '当前没有可删除的增设专家。', 'There are no removable added experts at the moment.')}
                    </div>
                  )}
                </div>
                <div style={{ background: currentReview.ready ? 'rgba(83,183,255,.12)' : 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(currentLocale, '提交提示', 'Submission Notes')}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                    {currentReview.ready
                      ? pickLocaleText(currentLocale, '信息已经达到提交标准。确认创建任务后，左侧会话列表会开始按 taskId 沉淀治理历史。', 'The information meets the submission standard. After confirmation, the left-side session list will retain governance history by task ID.')
                      : pickLocaleText(currentLocale, '建议补充动作类型、治理对象、理由与约束，避免误删预置专家或形成模糊治理单。', 'Please add the action type, governance target, rationale, and constraints to avoid removing preset experts by mistake or creating an ambiguous governance ticket.')}
                  </div>
                </div>
              </>
            )}
          />
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
    { l: pickLocaleText(locale, '输入', 'Input'), v: o.tokens_in, color: '#6a9eff' },
    { l: pickLocaleText(locale, '输出', 'Output'), v: o.tokens_out, color: '#a07aff' },
    { l: pickLocaleText(locale, '缓存读', 'Cache Read'), v: o.cache_read, color: '#2ecc8a' },
    { l: pickLocaleText(locale, '缓存写', 'Cache Write'), v: o.cache_write, color: '#f5c842' },
  ];

  return (
    <div>
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
