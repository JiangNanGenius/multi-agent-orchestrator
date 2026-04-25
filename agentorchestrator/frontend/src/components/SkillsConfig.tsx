import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api, type CollabAgentBusyEntry, type RemoteSkillItem } from '../api';
import PersistentAgentChat from './PersistentAgentChat';
import { pickLocaleText, formatCount } from '../i18n';

function normalizeAgentLabel(agentId: string, agentLabel: string) {
  if (agentId === 'admin_specialist' || agentLabel === '管理专家' || agentLabel === '技能管理员') return '技能管理助手';
  return agentLabel;
}

function formatTimeLabel(value?: string, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderBusyStateLabel(entry: CollabAgentBusyEntry, locale: string) {
  const source = entry.occupancy_kind || entry.source_type || '';
  if (locale === 'en') {
    if (source === 'task_active') return 'Handling a task';
    if (source === 'task_reserved') return 'Reserved for a task';
    if (source === 'task_paused') return 'Paused task';
    if (source === 'task_blocked') return 'Blocked task';
    if (source === 'meeting') return entry.state === 'reserved' ? 'Waiting for collaboration' : 'In collaboration';
    if (source === 'chat') return 'In discussion';
    return entry.label || 'Busy';
  }
  if (source === 'task_active') return '任务处理中';
  if (source === 'task_reserved') return '任务待接入';
  if (source === 'task_paused') return '任务已暂停';
  if (source === 'task_blocked') return '任务阻塞';
  if (source === 'meeting') return entry.state === 'reserved' ? '等待协作' : '协作处理中';
  if (source === 'chat') return '讨论占用中';
  return entry.label || '忙碌中';
}

type GlobalSkillRow = {
  key: string;
  name: string;
  agentId: string;
  agentLabel: string;
  description: string;
  hasLocal: boolean;
  hasRemote: boolean;
  remoteStatus: string;
  sourceUrl: string;
  localPath: string;
  updatedAt: string;
  addedAt: string;
  canInspect: boolean;
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 12px',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
};

export default function SkillsConfig() {
  const locale = useStore((s) => s.locale);
  const agentConfig = useStore((s) => s.agentConfig);
  const loadAgentConfig = useStore((s) => s.loadAgentConfig);
  const toast = useStore((s) => s.toast);

  const [skillModal, setSkillModal] = useState<{ agentId: string; name: string; content: string; path: string } | null>(null);
  const [addForm, setAddForm] = useState<{ agentId: string; agentLabel: string } | null>(null);
  const [formData, setFormData] = useState({ name: '', desc: '', trigger: '' });
  const [submitting, setSubmitting] = useState(false);
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkillItem[]>([]);
  const [remoteSkillsLoading, setRemoteSkillsLoading] = useState(false);
  const [remoteSkillsError, setRemoteSkillsError] = useState('');
  const [busyEntries, setBusyEntries] = useState<CollabAgentBusyEntry[]>([]);
  const [busyLoading, setBusyLoading] = useState(false);
  const [busyError, setBusyError] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'local' | 'remote'>('all');
  const [keyword, setKeyword] = useState('');
  const [governancePanelOpen, setGovernancePanelOpen] = useState(false);

  const loadRemoteSkills = async () => {
    setRemoteSkillsLoading(true);
    setRemoteSkillsError('');
    try {
      const result = await api.remoteSkillsList();
      if (result.ok) {
        setRemoteSkills(result.remoteSkills || []);
        setRemoteSkillsError('');
      } else {
        setRemoteSkills([]);
        setRemoteSkillsError(result.error || pickLocaleText(locale, '来源列表暂时无法读取', 'Unable to load sources right now'));
      }
    } catch {
      setRemoteSkills([]);
      setRemoteSkillsError(pickLocaleText(locale, '来源列表读取失败', 'Failed to load sources'));
    }
    setRemoteSkillsLoading(false);
  };

  const loadBusyState = async () => {
    setBusyLoading(true);
    setBusyError('');
    try {
      const result = await api.globalAgentBusy();
      if (result.ok) {
        setBusyEntries(result.busy || []);
        setBusyError('');
      } else {
        setBusyEntries([]);
        setBusyError(result.error || pickLocaleText(locale, '忙碌状态暂时无法读取', 'Unable to load busy state right now'));
      }
    } catch {
      setBusyEntries([]);
      setBusyError(pickLocaleText(locale, '忙碌状态读取失败', 'Failed to load busy state'));
    }
    setBusyLoading(false);
  };

  useEffect(() => {
    loadAgentConfig();
    void loadRemoteSkills();
    void loadBusyState();
  }, [loadAgentConfig]);

  const getSkillManagerTarget = () => {
    const agents = agentConfig?.agents || [];
    const preferred = agents.find((ag) => ag.id === 'admin_specialist');
    if (preferred) {
      return {
        agentId: preferred.id,
        agentLabel: normalizeAgentLabel(preferred.id, preferred.label),
        emoji: preferred.emoji || '🗂️',
      };
    }
    const firstAgent = agents[0];
    if (!firstAgent) return null;
    return {
      agentId: firstAgent.id,
      agentLabel: normalizeAgentLabel(firstAgent.id, firstAgent.label),
      emoji: firstAgent.emoji || '🗂️',
    };
  };

  const skillManagerTarget = getSkillManagerTarget();
  const totalLocalSkills = useMemo(() => agentConfig?.agents?.reduce((n, a) => n + (a.skills?.length || 0), 0) || 0, [agentConfig?.agents]);
  const agentsWithoutSkills = useMemo(() => agentConfig?.agents?.filter((ag) => !(ag.skills || []).length).length || 0, [agentConfig?.agents]);
  const managerBusy = useMemo(
    () => busyEntries.find((entry) => entry.agent_id === skillManagerTarget?.agentId) || null,
    [busyEntries, skillManagerTarget?.agentId],
  );

  const governanceIntents = useMemo(() => [
    {
      key: 'add-skill',
      labelZh: '新增 Skill',
      labelEn: 'Add Skill',
      prefillZh: '我想为某个 Agent 新增一个 Skill，请先帮我明确目标 Agent、功能范围、触发方式和来源。',
      prefillEn: 'I want to add a new skill for an agent. Please help me clarify the target agent, functional scope, trigger mode, and source first.',
      helperZh: '新增、挂载、补齐。',
      helperEn: 'Add, mount, or fill gaps.',
    },
    {
      key: 'governance-cleanup',
      labelZh: '管理收口',
      labelEn: 'Management Cleanup',
      prefillZh: '我需要整理 Skill 命名、去重、归类或迁移，请先帮我梳理现状和风险。',
      prefillEn: 'I need to clean up skill naming, deduplication, categorization, or migration. Please help me assess the current state and risks first.',
      helperZh: '改名、合并、去重。',
      helperEn: 'Rename, merge, or deduplicate.',
    },
    {
      key: 'source-review',
      labelZh: '来源巡检',
      labelEn: 'Source Review',
      prefillZh: '我想检查远程 Skill 来源、覆盖范围和异常记录，请帮我整理成一个 Skill 管理请求。',
      prefillEn: 'I want to inspect remote skill sources, coverage, and anomaly records. Please turn that into a skill management request.',
      helperZh: '来源、覆盖、同步。',
      helperEn: 'Sources, coverage, and sync.',
    },
  ], []);

  const buildGovernanceReview = (draftText: string) => {
    const clean = draftText.trim();
    const missing: string[] = [];
    if (!clean) {
      missing.push(pickLocaleText(locale, '请先描述你的 Skill 管理目标。', 'Please describe your skill management goal first.'));
    }
    if (!/agent|代理|专家|对象|目标/i.test(clean)) {
      missing.push(pickLocaleText(locale, '补充目标 Agent 或管理对象。', 'Add the target agent or management object.'));
    }
    if (!/skill|技能|功能|来源|仓库|命名|迁移|去重|同步/i.test(clean)) {
      missing.push(pickLocaleText(locale, '补充本次动作类型：新增、迁移、命名、来源或清理。', 'Add the action type: adding, migration, naming, sources, or cleanup.'));
    }
    return {
      ready: clean.length >= 18,
      title: clean ? clean.slice(0, 40) : pickLocaleText(locale, 'Skill 管理请求', 'Skill management request'),
      summary: clean || pickLocaleText(locale, '请先补充 Skill 管理需求。', 'Please add the skill management request first.'),
      followUp: missing.length
        ? pickLocaleText(locale, '先补齐目标对象、动作类型和预期结果。', 'Add the target object, action type, and expected result first.')
        : pickLocaleText(locale, '信息已足够，可直接创建会话。', 'Ready to create the session.'),
      missing,
    };
  };

  const createGovernanceTask = async (draftText: string, review: { title: string; summary: string }) => {
    const title = `${pickLocaleText(locale, 'Skill 管理｜', 'Skill Management | ')}${(review.title || draftText || '').slice(0, 48)}`;
    return api.createTask({
      title,
      org: pickLocaleText(locale, 'Skill 管理工作台', 'Skill Management Workbench'),
      targetDept: skillManagerTarget?.agentId || 'admin_specialist',
      priority: 'normal',
      params: {
        source: 'skill_management_workbench',
        summary: review.summary || draftText,
      },
    });
  };

  const appendGovernanceTaskMessage = async (taskId: string, text: string) => {
    return api.taskAppendMessage(taskId, skillManagerTarget?.agentId || 'admin_specialist', text);
  };

  const openSkill = async (agentId: string, skillName: string) => {
    setSkillModal({ agentId, name: skillName, content: pickLocaleText(locale, '⟳ 加载中…', '⟳ Loading...'), path: '' });
    try {
      const r = await api.skillContent(agentId, skillName);
      if (r.ok) {
        setSkillModal({ agentId, name: skillName, content: r.content || '', path: r.path || '' });
      } else {
        setSkillModal({ agentId, name: skillName, content: `❌ ${r.error || pickLocaleText(locale, '无法读取', 'Unable to read')}`, path: '' });
      }
    } catch {
      setSkillModal({ agentId, name: skillName, content: pickLocaleText(locale, '❌ 当前连接失败，请稍后再试', '❌ Connection failed. Please try again later.'), path: '' });
    }
  };

  const openAddForm = (agentId: string, agentLabel: string) => {
    setAddForm({ agentId, agentLabel });
    setFormData({ name: '', desc: '', trigger: '' });
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm || !formData.name.trim()) return;
    setSubmitting(true);
    try {
      const r = await api.addSkill(addForm.agentId, formData.name.trim(), formData.desc.trim(), formData.trigger.trim());
      if (r.ok) {
        toast(pickLocaleText(locale, `✅ 已将 ${formData.name.trim()} 添加给 ${addForm.agentLabel}`, `✅ ${formData.name.trim()} has been added to ${addForm.agentLabel}`), 'ok');
        setAddForm(null);
        loadAgentConfig();
      } else {
        toast(r.error || pickLocaleText(locale, '添加失败', 'Failed to add the feature'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    }
    setSubmitting(false);
  };

  const groupedSkills = useMemo<GlobalSkillRow[]>(() => {
    const map = new Map<string, GlobalSkillRow>();
    (agentConfig?.agents || []).forEach((agent) => {
      (agent.skills || []).forEach((skill) => {
        const key = `${agent.id}::${skill.name}`;
        map.set(key, {
          key,
          name: skill.name,
          agentId: agent.id,
          agentLabel: normalizeAgentLabel(agent.id, agent.label),
          description: skill.description || '',
          hasLocal: true,
          hasRemote: false,
          remoteStatus: '',
          sourceUrl: '',
          localPath: '',
          updatedAt: '',
          addedAt: '',
          canInspect: true,
        });
      });
    });

    remoteSkills.forEach((item) => {
      const agentLabel = normalizeAgentLabel(item.agentId, (agentConfig?.agents || []).find((ag) => ag.id === item.agentId)?.label || item.agentId);
      const key = `${item.agentId}::${item.skillName}`;
      const prev = map.get(key);
      map.set(key, {
        key,
        name: item.skillName,
        agentId: item.agentId,
        agentLabel,
        description: prev?.description || item.description || '',
        hasLocal: prev?.hasLocal || Boolean(item.localPath),
        hasRemote: true,
        remoteStatus: item.status || prev?.remoteStatus || '',
        sourceUrl: item.sourceUrl || prev?.sourceUrl || '',
        localPath: item.localPath || prev?.localPath || '',
        updatedAt: item.lastUpdated || prev?.updatedAt || '',
        addedAt: item.addedAt || prev?.addedAt || '',
        canInspect: prev?.canInspect || Boolean(item.localPath),
      });
    });

    return Array.from(map.values()).sort((a, b) => {
      const agentCompare = a.agentLabel.localeCompare(b.agentLabel, 'zh-Hans-CN');
      if (agentCompare !== 0) return agentCompare;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [agentConfig?.agents, remoteSkills]);

  const visibleSkills = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return groupedSkills.filter((item) => {
      if (selectedAgentId !== 'all' && item.agentId !== selectedAgentId) return false;
      if (sourceFilter === 'local' && !item.hasLocal) return false;
      if (sourceFilter === 'remote' && !item.hasRemote) return false;
      if (!normalizedKeyword) return true;
      return `${item.name} ${item.agentLabel} ${item.description}`.toLowerCase().includes(normalizedKeyword);
    });
  }, [groupedSkills, keyword, selectedAgentId, sourceFilter]);

  const quickAddTarget = useMemo(() => {
    const selected = (agentConfig?.agents || []).find((ag) => ag.id === selectedAgentId);
    if (selected) {
      return {
        agentId: selected.id,
        agentLabel: normalizeAgentLabel(selected.id, selected.label),
      };
    }
    if (skillManagerTarget) {
      return {
        agentId: skillManagerTarget.agentId,
        agentLabel: skillManagerTarget.agentLabel,
      };
    }
    const firstAgent = agentConfig?.agents?.[0];
    if (!firstAgent) return null;
    return {
      agentId: firstAgent.id,
      agentLabel: normalizeAgentLabel(firstAgent.id, firstAgent.label),
    };
  }, [agentConfig?.agents, selectedAgentId, skillManagerTarget]);

  const governanceSection = (
    <section
      className="skills-governance-card"
      style={{
        padding: 20,
        borderRadius: 24,
        border: '1px solid rgba(122,162,255,0.18)',
        background: 'linear-gradient(180deg, rgba(17,22,36,0.96), rgba(12,18,30,0.92))',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.16)',
        display: 'grid',
        gap: 14,
      }}
    >
      <div className="skills-governance-card__header" style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 8, maxWidth: 760 }}>
          <div className="ec-id">{pickLocaleText(locale, '会话', 'Conversation')}</div>
          <div style={{ fontSize: 20, fontWeight: 850, lineHeight: 1.18 }}>{pickLocaleText(locale, 'Skill 管理', 'Skill Management')}</div>
          {governancePanelOpen ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.72 }}>
              {pickLocaleText(locale, '桌面端会话区已展开，可直接发起 Skill 新增、来源巡检与治理收口请求。', 'The desktop conversation area is open, so you can directly start skill additions, source reviews, and governance cleanup requests.')}
            </div>
          ) : null}
        </div>
        <div className="skills-governance-card__meta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
          <span className="chip">{skillManagerTarget ? `${skillManagerTarget.emoji} ${skillManagerTarget.agentLabel}` : pickLocaleText(locale, '未配置负责人', 'No owner configured')}</span>
          <span
            className="chip"
            style={{
              borderColor: busyLoading ? 'rgba(122,162,255,0.5)' : (managerBusy ? 'rgba(255,120,120,0.5)' : 'rgba(76,195,138,0.5)'),
              color: busyLoading ? '#9db7ff' : (managerBusy ? '#ff9a9a' : '#7ff0a8'),
              background: busyLoading ? 'rgba(122,162,255,0.12)' : (managerBusy ? 'rgba(255,120,120,0.12)' : 'rgba(76,195,138,0.12)'),
            }}
          >
            {busyLoading
              ? pickLocaleText(locale, '状态同步中', 'Syncing status')
              : (managerBusy ? pickLocaleText(locale, '忙碌中', 'Busy') : pickLocaleText(locale, '空闲', 'Idle'))}
          </span>
          <button
            type="button"
            className="skills-governance-card__toggle"
            onClick={() => setGovernancePanelOpen((value) => !value)}
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              border: '1px solid rgba(122,162,255,0.28)',
              background: governancePanelOpen ? 'rgba(122,162,255,0.16)' : 'rgba(255,255,255,0.04)',
              color: 'var(--text)',
              fontWeight: 700,
              cursor: 'pointer',
              minWidth: 112,
              boxShadow: governancePanelOpen ? '0 12px 28px rgba(122,162,255,0.16)' : 'none',
            }}
          >
            {governancePanelOpen
              ? pickLocaleText(locale, '收起面板', 'Collapse Panel')
              : pickLocaleText(locale, '展开面板', 'Expand Panel')}
          </button>
        </div>
      </div>

      {governancePanelOpen ? (
        <>
          <div className="skills-governance-card__actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className="ab-btn"
              onClick={() => {
                if (quickAddTarget) openAddForm(quickAddTarget.agentId, quickAddTarget.agentLabel);
                else toast(pickLocaleText(locale, '当前未发现可用的 Skill 管理入口。', 'No available skill management target is currently configured.'), 'err');
              }}
            >
              {pickLocaleText(locale, '新增 Skill', 'Add Skill')}
            </button>
            <button
              className="ab-scan"
              onClick={() => {
                void loadRemoteSkills();
                void loadBusyState();
              }}
              disabled={remoteSkillsLoading || busyLoading}
            >
              {remoteSkillsLoading || busyLoading ? pickLocaleText(locale, '刷新中…', 'Refreshing...') : pickLocaleText(locale, '刷新状态', 'Refresh Status')}
            </button>
          </div>

          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            {busyError
              ? busyError
              : managerBusy
                ? `${renderBusyStateLabel(managerBusy, locale)} · ${managerBusy.task_title || managerBusy.topic || pickLocaleText(locale, '当前有进行中的处理', 'There is an active handling task')}`
                : pickLocaleText(locale, '当前空闲，可直接发起 Skill 管理请求。', 'Currently idle and ready for skill management.')}
          </div>

          <PersistentAgentChat
            storageKey="agentorchestrator-skills-governance-chat"
            agentId={skillManagerTarget?.agentId || 'admin_specialist'}
            agentLabel={skillManagerTarget?.agentLabel || pickLocaleText(locale, '技能管理助手', 'Skills Manager Assistant')}
            agentEmoji={skillManagerTarget?.emoji || '🎯'}
            accentColor="rgba(122,162,255,0.42)"
            accentSoft="rgba(122,162,255,0.10)"
            headerKickerZh="Skill 管理"
            headerKickerEn="Skill Management"
            headerTitleZh="Skill 管理"
            headerTitleEn="Skill Management"
            headerDescZh=""
            headerDescEn=""
            handlerNoteZh=""
            handlerNoteEn=""
            introZh="输入你的 Skill 管理需求"
            introEn="Enter your skill management request"
            draftLabelZh="需求"
            draftLabelEn="Request"
            taskFilter={(task) => {
              const joined = `${task.currentDept || ''} ${task.targetDept || ''} ${task.org || ''} ${task.title || ''}`.toLowerCase();
              return joined.includes((skillManagerTarget?.agentId || 'admin_specialist').toLowerCase()) || joined.includes('skill');
            }}
            intents={governanceIntents}
            buildDraftReview={(draftText) => buildGovernanceReview(draftText)}
            createTask={createGovernanceTask}
            appendTaskMessage={appendGovernanceTaskMessage}
            renderSidebar={() => null}
          />
        </>
      ) : null}
    </section>
  );

  if (!agentConfig?.agents) {
    return <div className="empty">{pickLocaleText(locale, '无法加载', 'Unable to load')}</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>

      <section className="skills-global-card" style={{ padding: 18, borderRadius: 22, border: '1px solid var(--line)', background: 'var(--panel)', display: 'grid', gap: 14 }}>
        <div className="skills-global-card__header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="ec-id">{pickLocaleText(locale, '全局技能', 'Global Skills')}</div>
            <div style={{ fontSize: 20, fontWeight: 850, marginTop: 6 }}>{pickLocaleText(locale, '所有 Agent 的技能汇总', 'All agent skills in one view')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span className="chip">{pickLocaleText(locale, `总计 ${groupedSkills.length}`, `Total ${groupedSkills.length}`)}</span>
            <span className="chip">{pickLocaleText(locale, `本地 ${totalLocalSkills}`, `Local ${totalLocalSkills}`)}</span>
            <span className="chip">{pickLocaleText(locale, `远程 ${groupedSkills.filter((item) => item.hasRemote).length}`, `Remote ${groupedSkills.filter((item) => item.hasRemote).length}`)}</span>
            <span className={`chip ${agentsWithoutSkills > 0 ? 'warn' : 'ok'}`}>{pickLocaleText(locale, `待补 ${agentsWithoutSkills}`, `Pending ${agentsWithoutSkills}`)}</span>
          </div>
        </div>

        <div className="skills-global-card__filters" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div className="ec-id">{pickLocaleText(locale, 'Agent', 'Agent')}</div>
            <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} style={fieldStyle}>
              <option value="all">{pickLocaleText(locale, '全部 Agent', 'All agents')}</option>
              {agentConfig.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{normalizeAgentLabel(agent.id, agent.label)}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div className="ec-id">{pickLocaleText(locale, '来源', 'Source')}</div>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | 'local' | 'remote')} style={fieldStyle}>
              <option value="all">{pickLocaleText(locale, '全部来源', 'All sources')}</option>
              <option value="local">{pickLocaleText(locale, '仅本地', 'Local only')}</option>
              <option value="remote">{pickLocaleText(locale, '仅远程', 'Remote only')}</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <div className="ec-id">{pickLocaleText(locale, '搜索', 'Search')}</div>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={pickLocaleText(locale, '按技能名或 Agent 筛选', 'Filter by skill or agent')}
              style={fieldStyle}
            />
          </label>

        </div>

        {remoteSkillsError ? <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.7 }}>{remoteSkillsError}</div> : null}

        {visibleSkills.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {visibleSkills.map((item) => (
              <div key={item.key} style={{ padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📦 {item.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>{item.agentLabel}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {item.hasLocal ? <span className="chip">{pickLocaleText(locale, '本地', 'Local')}</span> : null}
                    {item.hasRemote ? <span className={`chip ${item.remoteStatus === 'valid' ? 'ok' : 'warn'}`}>{item.remoteStatus ? `${pickLocaleText(locale, '远程', 'Remote')} · ${item.remoteStatus}` : pickLocaleText(locale, '远程', 'Remote')}</span> : null}
                    {(item.updatedAt || item.addedAt) ? <span className="chip">{formatTimeLabel(item.updatedAt || item.addedAt)}</span> : null}
                  </div>
                </div>

                {item.description ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>{item.description}</div>
                ) : null}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.7, wordBreak: 'break-word' }}>
                    {item.sourceUrl
                      ? `${pickLocaleText(locale, '来源：', 'Source: ')}${item.sourceUrl}`
                      : (item.localPath ? `${pickLocaleText(locale, '路径：', 'Path: ')}${item.localPath}` : pickLocaleText(locale, '本地技能', 'Local skill'))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="ab-scan" onClick={() => openSkill(item.agentId, item.name)} disabled={!item.canInspect}>
                      {pickLocaleText(locale, '查看内容', 'View Content')}
                    </button>
                    {item.sourceUrl ? (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="ab-btn" style={{ textDecoration: 'none', textAlign: 'center' }}>
                        {pickLocaleText(locale, '打开来源', 'Open Source')}
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: 18, borderRadius: 18, border: '1px dashed rgba(255,255,255,0.12)', color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
            {pickLocaleText(locale, '当前筛选条件下没有技能记录。', 'No skill matches the current filters.')}
          </div>
        )}
      </section>

      {governanceSection}

      {skillModal && (
        <div className="modal-bg open" onClick={() => setSkillModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSkillModal(null)}>✕</button>
            <div className="modal-body">
              <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>
                {normalizeAgentLabel(skillModal.agentId, (agentConfig.agents.find((ag) => ag.id === skillModal.agentId)?.label) || skillModal.agentId)}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>📦 {skillModal.name}</div>
              {skillModal.path ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, wordBreak: 'break-word' }}>
                  {pickLocaleText(locale, '路径：', 'Path: ')}{skillModal.path}
                </div>
              ) : null}
              <div className="sk-modal-body">
                <div className="sk-md" style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7 }}>
                  {skillModal.content}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {addForm && (
        <div className="modal-bg open" onClick={() => setAddForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setAddForm(null)}>✕</button>
            <div className="modal-body">
              <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>
                {pickLocaleText(locale, `新增到 ${addForm.agentLabel}`, `Add to ${addForm.agentLabel}`)}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, marginBottom: 18 }}>{pickLocaleText(locale, '新增 Skill', 'Add Skill')}</div>

              <form onSubmit={submitAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '名称', 'Name')}</label>
                  <input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData((s) => ({ ...s, name: e.target.value }))}
                    placeholder={pickLocaleText(locale, '例如：内容搜索', 'For example: content search')}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '描述', 'Description')}</label>
                  <textarea
                    rows={4}
                    value={formData.desc}
                    onChange={(e) => setFormData((s) => ({ ...s, desc: e.target.value }))}
                    placeholder={pickLocaleText(locale, '说明功能用途与适用场景', 'Describe the purpose and use case')}
                    style={{ ...fieldStyle, padding: '12px 14px', resize: 'vertical', lineHeight: 1.7 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '触发条件', 'When to Use')}</label>
                  <textarea
                    rows={3}
                    value={formData.trigger}
                    onChange={(e) => setFormData((s) => ({ ...s, trigger: e.target.value }))}
                    placeholder={pickLocaleText(locale, '说明在什么情况下调用', 'Describe when it should be called')}
                    style={{ ...fieldStyle, padding: '12px 14px', resize: 'vertical', lineHeight: 1.7 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-g" onClick={() => setAddForm(null)} style={{ padding: '8px 18px' }}>
                    {pickLocaleText(locale, '取消', 'Cancel')}
                  </button>
                  <button type="submit" disabled={submitting || !formData.name.trim()} style={{ padding: '8px 18px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                    {submitting ? pickLocaleText(locale, '⟳ 添加中…', '⟳ Adding...') : pickLocaleText(locale, '添加', 'Add')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
