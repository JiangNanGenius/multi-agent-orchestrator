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
      title: pickLocaleText(locale, '成员调整沟通', 'Team Update Conversation'),
      summary: '',
      followUp: pickLocaleText(locale, '请先说明你希望这里帮助处理哪类调整：新增成员，还是移除后续加入的成员；并补充对象、原因、限制和期望结果。', 'Please first explain what kind of team update you need: add a member or remove a later-added member; also include the target, reason, constraints, and expected result.'),
      missing: [pickLocaleText(locale, '调整类型', 'update type')],
    };
  }

  const wantAdd = /(新增|增加|添加|新设|补充|add)/i.test(content);
  const wantDelete = /(删除|移除|撤销|remove|delete)/i.test(content);
  const missing: string[] = [];

  if (!wantAdd && !wantDelete) missing.push(pickLocaleText(locale, '明确是新增还是移除', 'whether this is an addition or a removal'));
  if (content.length < 16) missing.push(pickLocaleText(locale, '更具体的对象与原因', 'a more specific target and reason'));
  if (!/(原因|理由|职责|规则|影响|约束|保留|删除|新增|期望|结果)/.test(content)) {
    missing.push(pickLocaleText(locale, '调整原因或限制条件', 'the reason or constraints for the update'));
  }

  const title = pickLocaleText(locale, `请帮我处理成员调整：${content.slice(0, 40)}`, `Please help with this team update: ${content.slice(0, 40)}`);
  const summary = pickLocaleText(
    locale,
    `处理入口：成员调整\n调整诉求：${content}\n注意事项：默认成员不可删除；如需移除，只能移除后续加入的成员；请先补问并形成确认摘要，再正式创建处理单。`,
    `Entry: Team update\nRequest: ${content}\nNotes: default members cannot be removed; if this is a removal, only later-added members may be removed; ask follow-up questions first, then create a confirmed request.`,
  );

  if (missing.length) {
    return {
      ready: false,
      title,
      summary,
      followUp: pickLocaleText(locale, `为避免误删或误加，请再补充：${missing.join('、')}。`, `To avoid removing or adding the wrong member, please also add ${missing.join(', ')}.`),
      missing,
    };
  }

  return {
    ready: true,
    title,
    summary,
    followUp: pickLocaleText(locale, '信息已足够，可以正式创建处理单。', 'The information is sufficient and the request can be created now.'),
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
      labelZh: '新增成员',
      labelEn: 'Add Member',
      prefillZh: '我需要新增一位协作成员。请先确认成员名称、负责范围、加入原因，以及是否会影响现有分工。',
      prefillEn: 'I need to add a team member. Please first confirm the member name, responsibility scope, reason for joining, and whether existing assignments will be affected.',
      helperZh: '适用于补充新成员、填补能力空缺或明确分工范围。',
      helperEn: 'Use this when adding a new member, filling a gap, or clarifying responsibilities.',
    },
    {
      key: 'remove-expert',
      labelZh: '移除后加成员',
      labelEn: 'Remove Added Member',
      prefillZh: '我需要移除一位后续加入的成员。请先确认成员名称或编号、移除原因、是否需要交接负责内容，以及默认成员不可删除这一限制。',
      prefillEn: 'I need to remove a later-added member. Please first confirm the member name or ID, reason for removal, whether work should be handed over, and the rule that default members cannot be removed.',
      helperZh: '适用于撤销后续加入的成员，同时保留默认成员。',
      helperEn: 'Use this when removing a later-added member while keeping default members unchanged.',
    },
    {
      key: 'adjust-boundary',
      labelZh: '调整分工',
      labelEn: 'Adjust Responsibilities',
      prefillZh: '我需要调整成员分工。请先确认涉及哪些成员、当前冲突或重叠点、希望调整成什么样，以及是否需要同步调整后续安排。',
      prefillEn: 'I need to adjust team responsibilities. Please first confirm which members are involved, the current conflict or overlap, the target arrangement, and whether follow-up assignments should also be updated.',
      helperZh: '适用于优化分工、处理职责重叠与重新安排协作。',
      helperEn: 'Use this for improving team responsibilities, resolving overlap, and reorganizing collaboration.',
    },
  ];

  if (!agentsOverviewData?.agents) {
    return <div className="empty">{pickLocaleText(locale, '⚠️ 当前暂时无法加载成员信息', '⚠️ Team information is temporarily unavailable')}</div>;
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
              {pickLocaleText(locale, 'Agent 管理总览', 'Agent Management Overview')}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
              {pickLocaleText(locale, '查看 Agent 表现并处理成员调整', 'Review Agent Performance and Team Updates')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.75, maxWidth: 760 }}>
              {pickLocaleText(
                locale,
                '这个页面聚焦于 Agent 表现、贡献情况与成员调整，不承担全局动态监看职责。需要新增成员、移除后加成员或调整分工时，都可以从这里发起；默认成员会被自动保护，不能在这里误删。现在该入口已升级为可持续记录的聊天窗口，支持刷新后继续查看。',
                'This page focuses on agent performance, contribution details, and team updates instead of global monitoring. When you need to add a member, remove a later-added member, or adjust responsibilities, you can start here. Default members are automatically protected from accidental removal. The entry now uses a persistent chat window that can be restored after refresh.',
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
              ? pickLocaleText(locale, '收起成员调整窗口', 'Hide Team Update Window')
              : pickLocaleText(locale, '打开成员调整窗口', 'Open Team Update Window')}
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
          <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }}>{pickLocaleText(locale, '其余成员待命', 'Other members are on standby')}</span>
        </div>
      )}

      <div className="off-kpi">
        <div className="kpi">
          <div className="kpi-v" style={{ color: 'var(--acc)' }}>{agents.length}</div>
          <div className="kpi-l">{pickLocaleText(locale, '协作成员总数', 'Team Members')}</div>
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
            <div className="empty">{pickLocaleText(locale, '选择左侧成员查看详情', 'Select a member on the left to view details')}</div>
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
            headerKickerZh="成员调整窗口"
            headerKickerEn="Team Update Window"
            headerTitleZh="按既定规则提交成员调整"
            headerTitleEn="Submit Team Updates by Established Rules"
            headerDescZh="这里替代原来的一次性弹窗。你可以先在草稿会话中补充背景、对象、原因与限制；系统会先追问并生成确认摘要，确认后再正式创建处理单。创建后，进展记录会持续保留，因此即使刷新网页，也能继续查看。"
            headerDescEn="This replaces the original one-shot dialog. You can first add background, targets, reasons, and constraints in a draft session; the system will ask follow-up questions and generate a confirmation summary before creating the request. Once created, progress records are preserved so the work can still be reviewed after a page refresh."
            handlerNoteZh="此入口只用于成员调整，并会自动保护默认成员不被误删。"
            handlerNoteEn="This entry is only for team updates and automatically protects default members from accidental removal."
            introZh="这里采用“聊天草稿 + 处理进展记录”的双层结构。草稿阶段的最近会话会保存在本地，已创建事项的进展则持续写入记录，因此即便刷新页面，也能从左侧会话列表恢复历史。"
            introEn="This view uses a dual-layer model of draft chat plus progress history. Recent draft sessions are kept locally, while created requests continue writing progress records so history can be restored even after a page refresh."
            draftLabelZh="成员调整草稿会话"
            draftLabelEn="Team Update Draft Session"
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
              org: pickLocaleText(locale, '整体协调', 'Overview Coordination'),
              owner: pickLocaleText(locale, '协作成员页', 'Team Page'),
              targetDept: curatorLabel,
              priority: 'normal',
              templateId: 'expert_roster_dialog',
              params: {
                entry: 'agent-overview',
                message: draftText.trim(),
                confirmationSummary: review.summary,
                immutableRule: pickLocaleText(locale, '默认成员不可删除', 'Default members cannot be removed'),
                targetAgentId: 'expert_curator',
                targetAgentLabel: curatorLabel,
              },
            })}
            appendTaskMessage={(taskId, text) => api.taskAppendMessage(taskId, 'expert_curator', text)}
            renderSidebar={({ locale: currentLocale, review: currentReview }) => (
              <>
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(currentLocale, '可移除成员范围', 'Removable Member Scope')}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, marginBottom: removableExperts.length ? 10 : 0 }}>
                    {pickLocaleText(currentLocale, '移除操作只适用于后续加入的成员。下方列表仅用于帮助你描述对象，正式提交前仍会进入确认摘要。', 'Removal is allowed only for later-added members. The list below helps you describe the target, and the request will still go through a confirmation summary before submission.')}
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
                      {pickLocaleText(currentLocale, '当前没有可移除的后加成员。', 'There are no removable added members at the moment.')}
                    </div>
                  )}
                </div>
                <div style={{ background: currentReview.ready ? 'rgba(83,183,255,.12)' : 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(currentLocale, '提交提示', 'Submission Notes')}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                    {currentReview.ready
                      ? pickLocaleText(currentLocale, '信息已经达到提交标准。确认创建事项后，左侧会话列表会开始保留本次调整记录。', 'The information meets the submission standard. After confirmation, the session list on the left will start retaining this update history.')
                      : pickLocaleText(currentLocale, '建议补充调整类型、对象、原因与限制，避免误删默认成员或形成模糊请求。', 'Please add the update type, target, reason, and constraints to avoid removing default members by mistake or creating an unclear request.')}
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
    { l: pickLocaleText(locale, '内容输入', 'Input Content'), v: o.tokens_in, color: '#6a9eff' },
    { l: pickLocaleText(locale, '内容输出', 'Output Content'), v: o.tokens_out, color: '#a07aff' },
    { l: pickLocaleText(locale, '历史复用', 'History Reuse'), v: o.cache_read, color: '#2ecc8a' },
    { l: pickLocaleText(locale, '记录写入', 'Record Saving'), v: o.cache_write, color: '#f5c842' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 40 }}>{o.emoji}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{meta.title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {meta.subtitle}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            🏅 {meta.rank} · {locale === 'en' ? `Score ${o.merit_score}` : `评分 ${o.merit_score}`}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`hb ${hb.status}`} style={{ marginBottom: 4 }}>{heartbeatLabel(hb.status, hb.label, locale)}</div>
          {o.last_active && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{locale === 'en' ? `Active ${o.last_active}` : `活跃 ${o.last_active}`}</div>}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            {locale === 'en' ? `${o.sessions} conversations · ${o.messages} messages` : `${o.sessions} 段对话 · ${o.messages} 条消息`}
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
        <div style={{ display: 'flex', gap: 10 }}>
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
