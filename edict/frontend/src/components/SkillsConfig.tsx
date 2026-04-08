import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api, type ActivityEntry, type RemoteSkillItem } from '../api';
import { pickLocaleText, formatCount } from '../i18n';

const COMMUNITY_SOURCES = [
  {
    label: 'obra/superpowers',
    emoji: '⚡',
    stars: '66.9k',
    descZh: '完整开发工作流技能集',
    descEn: 'Complete development workflow skill set',
    official: false,
    skills: [
      { name: 'brainstorming', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/brainstorming/SKILL.md' },
      { name: 'test-driven-development', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/test-driven-development/SKILL.md' },
      { name: 'systematic-debugging', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/systematic-debugging/SKILL.md' },
      { name: 'subagent-driven-development', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/subagent-driven-development/SKILL.md' },
      { name: 'writing-plans', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/writing-plans/SKILL.md' },
      { name: 'executing-plans', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/executing-plans/SKILL.md' },
      { name: 'requesting-code-review', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/requesting-code-review/SKILL.md' },
      { name: 'root-cause-tracing', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/root-cause-tracing/SKILL.md' },
      { name: 'verification-before-completion', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/verification-before-completion/SKILL.md' },
      { name: 'dispatching-parallel-agents', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/dispatching-parallel-agents/SKILL.md' },
    ],
  },
  {
    label: 'anthropics/skills',
    emoji: '🏛️',
    stars: 'Official',
    descZh: 'Anthropic 官方技能库',
    descEn: 'Official Anthropic skills library',
    official: true,
    skills: [
      { name: 'docx', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/docx/SKILL.md' },
      { name: 'pdf', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md' },
      { name: 'xlsx', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/xlsx/SKILL.md' },
      { name: 'pptx', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/pptx/SKILL.md' },
      { name: 'mcp-builder', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md' },
      { name: 'frontend-design', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md' },
      { name: 'web-artifacts-builder', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/web-artifacts-builder/SKILL.md' },
      { name: 'webapp-testing', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md' },
      { name: 'algorithmic-art', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/algorithmic-art/SKILL.md' },
      { name: 'canvas-design', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/canvas-design/SKILL.md' },
    ],
  },
  {
    label: 'ComposioHQ/awesome-claude-skills',
    emoji: '🌐',
    stars: '39.2k',
    descZh: '100+ 社区精选技能',
    descEn: '100+ community-curated skills',
    official: false,
    skills: [
      { name: 'github-integration', url: 'https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/github-integration/SKILL.md' },
      { name: 'data-analysis', url: 'https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/data-analysis/SKILL.md' },
      { name: 'code-review', url: 'https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/code-review/SKILL.md' },
    ],
  },
] as const;

export default function SkillsConfig() {
  const locale = useStore((s) => s.locale);
  const agentConfig = useStore((s) => s.agentConfig);
  const loadAgentConfig = useStore((s) => s.loadAgentConfig);
  const toast = useStore((s) => s.toast);

  const [skillModal, setSkillModal] = useState<{ agentId: string; name: string; content: string; path: string } | null>(null);
  const [addForm, setAddForm] = useState<{ agentId: string; agentLabel: string } | null>(null);
  const [formData, setFormData] = useState({ name: '', desc: '', trigger: '' });
  const [submitting, setSubmitting] = useState(false);

  const [activeTab, setActiveTab] = useState<'local' | 'remote'>('local');

  const [remoteSkills, setRemoteSkills] = useState<RemoteSkillItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [addRemoteForm, setAddRemoteForm] = useState(false);
  const [remoteFormData, setRemoteFormData] = useState({ agentId: '', skillName: '', sourceUrl: '', description: '' });
  const [remoteSubmitting, setRemoteSubmitting] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [removingSkill, setRemovingSkill] = useState<string | null>(null);
  const [quickPickSource, setQuickPickSource] = useState<(typeof COMMUNITY_SOURCES)[number] | null>(null);
  const [quickPickAgent, setQuickPickAgent] = useState('');
  const [commandForm, setCommandForm] = useState<{ agentId: string; agentLabel: string } | null>(null);
  const [commandText, setCommandText] = useState('');
  const [commandSubmitting, setCommandSubmitting] = useState(false);
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandStatus, setCommandStatus] = useState('');
  const [commandTaskId, setCommandTaskId] = useState('');
  const [commandActivity, setCommandActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    loadAgentConfig();
  }, [loadAgentConfig]);

  useEffect(() => {
    if (activeTab === 'remote') loadRemoteSkills();
  }, [activeTab]);

  const tabItems = useMemo(() => [
    {
      key: 'local' as const,
      label: pickLocaleText(locale, '🏛️ 本地技能', '🏛️ Local Skills'),
      count: agentConfig?.agents?.reduce((n, a) => n + (a.skills?.length || 0), 0) || 0,
    },
    {
      key: 'remote' as const,
      label: pickLocaleText(locale, '🌐 社区技能', '🌐 Community Skills'),
      count: remoteSkills.length,
    },
  ], [agentConfig?.agents, locale, remoteSkills.length]);

  const loadRemoteSkills = async () => {
    setRemoteLoading(true);
    try {
      const r = await api.remoteSkillsList();
      if (r.ok) setRemoteSkills(r.remoteSkills || []);
      else toast(r.error || pickLocaleText(locale, '社区技能列表加载失败', 'Failed to load community skills'), 'err');
    } catch {
      toast(pickLocaleText(locale, '社区技能列表加载失败', 'Failed to load community skills'), 'err');
    }
    setRemoteLoading(false);
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
      setSkillModal({ agentId, name: skillName, content: pickLocaleText(locale, '❌ 服务器连接失败', '❌ Server connection failed'), path: '' });
    }
  };

  const openAddForm = (agentId: string, agentLabel: string) => {
    setAddForm({ agentId, agentLabel });
    setFormData({ name: '', desc: '', trigger: '' });
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm || !formData.name) return;
    setSubmitting(true);
    try {
      const r = await api.addSkill(addForm.agentId, formData.name, formData.desc, formData.trigger);
      if (r.ok) {
        toast(pickLocaleText(locale, `✅ 技能 ${formData.name} 已添加到 ${addForm.agentLabel}`, `✅ Skill ${formData.name} added to ${addForm.agentLabel}`), 'ok');
        setAddForm(null);
        loadAgentConfig();
      } else {
        toast(r.error || pickLocaleText(locale, '添加失败', 'Failed to add skill'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
    setSubmitting(false);
  };

  const submitAddRemote = async (e: React.FormEvent) => {
    e.preventDefault();
    const { agentId, skillName, sourceUrl, description } = remoteFormData;
    if (!agentId || !skillName || !sourceUrl) return;
    setRemoteSubmitting(true);
    try {
      const r = await api.addRemoteSkill(agentId, skillName, sourceUrl, description);
      if (r.ok) {
        const targetLabel = normalizeAgentLabel(agentId, (agentConfig?.agents || []).find((ag) => ag.id === agentId)?.label || agentId);
        toast(pickLocaleText(locale, `✅ 社区技能 ${skillName} 已添加到 ${targetLabel}`, `✅ Community skill ${skillName} added to ${targetLabel}`), 'ok');
        setAddRemoteForm(false);
        setRemoteFormData({ agentId: '', skillName: '', sourceUrl: '', description: '' });
        loadRemoteSkills();
        loadAgentConfig();
      } else {
        toast(r.error || pickLocaleText(locale, '添加失败', 'Failed to add skill'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
    setRemoteSubmitting(false);
  };

  const handleUpdate = async (skill: RemoteSkillItem) => {
    const key = `${skill.agentId}/${skill.skillName}`;
    setUpdatingSkill(key);
    try {
      const r = await api.updateRemoteSkill(skill.agentId, skill.skillName);
      if (r.ok) {
        toast(pickLocaleText(locale, `✅ 技能 ${skill.skillName} 已更新`, `✅ Skill ${skill.skillName} updated`), 'ok');
        loadRemoteSkills();
      } else {
        toast(r.error || pickLocaleText(locale, '更新失败', 'Update failed'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
    setUpdatingSkill(null);
  };

  const handleRemove = async (skill: RemoteSkillItem) => {
    const key = `${skill.agentId}/${skill.skillName}`;
    setRemovingSkill(key);
    try {
      const r = await api.removeRemoteSkill(skill.agentId, skill.skillName);
      if (r.ok) {
        toast(pickLocaleText(locale, `🗑️ 技能 ${skill.skillName} 已移除`, `🗑️ Skill ${skill.skillName} removed`), 'ok');
        loadRemoteSkills();
        loadAgentConfig();
      } else {
        toast(r.error || pickLocaleText(locale, '移除失败', 'Remove failed'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
    setRemovingSkill(null);
  };

  const handleQuickImport = async (skillUrl: string, skillName: string) => {
    if (!quickPickAgent) {
      toast(pickLocaleText(locale, '请先选择处理节点', 'Please choose a target node first'), 'err');
      return;
    }
    try {
      const r = await api.addRemoteSkill(quickPickAgent, skillName, skillUrl, '');
      if (r.ok) {
        toast(`✅ ${skillName} → ${normalizeAgentLabel(quickPickAgent, (agentConfig?.agents || []).find((ag) => ag.id === quickPickAgent)?.label || quickPickAgent)}`, 'ok');
        loadRemoteSkills();
        loadAgentConfig();
      } else {
        toast(r.error || pickLocaleText(locale, '导入失败', 'Import failed'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
  };

  const summarizeActivity = (entry: ActivityEntry): string => {
    if (entry.text) return entry.text;
    if (entry.remark) return entry.remark;
    if (entry.output) return entry.output;
    if (entry.thinking) return entry.thinking;
    if (entry.tool) return `${pickLocaleText(locale, '工具调用：', 'Tool Call: ')}${entry.tool}`;
    if (entry.from || entry.to) return `${entry.from || '—'} → ${entry.to || '—'}`;
    return pickLocaleText(locale, '暂无摘要', 'No summary');
  };

  const loadCommandActivity = async (taskId: string) => {
    if (!taskId) {
      setCommandActivity([]);
      return;
    }
    setCommandLoading(true);
    try {
      const r = await api.taskActivity(taskId);
      if (r.ok) setCommandActivity(r.activity || []);
      else setCommandActivity([]);
    } catch {
      setCommandActivity([]);
    }
    setCommandLoading(false);
  };

  const normalizeAgentLabel = (agentId: string, agentLabel: string) => {
    if (agentId === 'admin_specialist' || agentLabel === '管理专家' || agentLabel === '技能管理员') return '技能管理员';
    return agentLabel;
  };

  const getSkillManagerTarget = () => {
    const agents = agentConfig?.agents || [];
    const preferred = agents.find((ag) => ag.id === 'admin_specialist');
    if (preferred) {
      return {
        agentId: preferred.id,
        agentLabel: normalizeAgentLabel(preferred.id, preferred.label),
      };
    }
    const fallback = agents[0];
    if (!fallback) return null;
    return { agentId: fallback.id, agentLabel: normalizeAgentLabel(fallback.id, fallback.label) };
  };

  const openCommandForm = (agentId: string, agentLabel: string) => {
    setCommandForm({ agentId, agentLabel: normalizeAgentLabel(agentId, agentLabel) });
    setCommandText('');
    setCommandStatus('');
    setCommandTaskId('');
    setCommandActivity([]);
  };

  const openSkillManagerCommandForm = () => {
    const target = getSkillManagerTarget();
    if (target) openCommandForm(target.agentId, target.agentLabel);
  };

  const submitCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandForm || !commandText.trim()) return;
    setCommandSubmitting(true);
    try {
      const taskTitle = pickLocaleText(
        locale,
        `请 ${commandForm.agentLabel} 处理：${commandText.trim().slice(0, 48)}`,
        `Ask ${commandForm.agentLabel} to handle: ${commandText.trim().slice(0, 48)}`,
      );
      const r = await api.createTask({
        title: taskTitle,
        org: pickLocaleText(locale, '总控中心', 'Control Center'),
        owner: pickLocaleText(locale, '技能配置中心', 'Skills Config Center'),
        targetDept: commandForm.agentLabel,
        priority: 'normal',
        templateId: 'skills_config_dialog',
        params: {
          entry: 'skills-config',
          message: commandText.trim(),
          targetAgentId: commandForm.agentId,
          targetAgentLabel: commandForm.agentLabel,
        },
      });
      if (r.ok && r.taskId) {
        const msg = pickLocaleText(locale, `后台任务已创建：${r.taskId}`, `Background task created: ${r.taskId}`);
        setCommandStatus(msg);
        setCommandTaskId(r.taskId);
        toast(msg, 'ok');
        setCommandText('');
        setCommandActivity([]);
        setTimeout(() => loadCommandActivity(r.taskId || ''), 1500);
      } else {
        const err = r.error || pickLocaleText(locale, '后台任务创建失败', 'Failed to create background task');
        setCommandStatus(err);
        toast(err, 'err');
      }
    } catch {
      const err = pickLocaleText(locale, '服务器连接失败', 'Server connection failed');
      setCommandStatus(err);
      toast(err, 'err');
    }
    setCommandSubmitting(false);
  };

  if (!agentConfig?.agents) {
    return <div className="empty">{pickLocaleText(locale, '无法加载', 'Unable to load')}</div>;
  }

  const localPanel = (
    <div>
      <div
        style={{
          marginBottom: 18,
          background: 'linear-gradient(135deg, rgba(42,68,127,.32), rgba(20,28,48,.72))',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.05em', marginBottom: 6 }}>
              {pickLocaleText(locale, '技能管理', 'Skill Management')}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
              {pickLocaleText(locale, '向技能管理员提交任务', 'Submit a task to the Skill Manager')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, maxWidth: 760 }}>
              {pickLocaleText(locale, '这里可以用自然语言提交技能管理相关任务，并查看最近动态。', 'Use natural language here to submit skill-management tasks and review recent updates.')}
            </div>
          </div>
          <button
            onClick={openSkillManagerCommandForm}
            style={{ padding: '10px 18px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}
          >
            {pickLocaleText(locale, '提交任务', 'Submit Task')}
          </button>
        </div>
      </div>
      <div className="skills-grid">
        {agentConfig.agents.map((ag) => (
          <div className="sk-card" key={ag.id}>
            <div className="sk-hdr">
              <span className="sk-emoji">{ag.emoji || '🏛️'}</span>
              <span className="sk-name">{normalizeAgentLabel(ag.id, ag.label)}</span>
              <span className="sk-cnt">{formatCount(locale, (ag.skills || []).length, '技能', 'skill(s)')}</span>
            </div>
            <div className="sk-list">
              {!(ag.skills || []).length ? (
                <div className="sk-empty">{pickLocaleText(locale, '暂无技能', 'No skills yet')}</div>
              ) : (
                (ag.skills || []).map((sk) => (
                  <div className="sk-item" key={sk.name} onClick={() => openSkill(ag.id, sk.name)}>
                    <span className="si-name">📦 {sk.name}</span>
                    <span className="si-desc">{sk.description || pickLocaleText(locale, '无描述', 'No description')}</span>
                    <span className="si-arrow">›</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <div className="sk-add" onClick={() => openAddForm(ag.id, normalizeAgentLabel(ag.id, ag.label))} style={{ flex: 1 }}>
                {pickLocaleText(locale, '＋ 添加技能', '＋ Add Skill')}
              </div>
              <button
                onClick={() => openCommandForm(ag.id, normalizeAgentLabel(ag.id, ag.label))}
                style={{ padding: '10px 12px', background: 'transparent', color: 'var(--acc)', border: '1px solid var(--acc)', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
              >
                {pickLocaleText(locale, '提交任务', 'Submit Task')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const remotePanel = (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          style={{ padding: '8px 18px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          onClick={() => { setAddRemoteForm(true); setQuickPickSource(null); }}
        >
          {pickLocaleText(locale, '＋ 添加社区技能', '＋ Add Community Skill')}
        </button>
        <button
          style={{ padding: '8px 14px', background: 'transparent', color: 'var(--acc)', border: '1px solid var(--acc)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
          onClick={loadRemoteSkills}
        >
          {pickLocaleText(locale, '⟳ 刷新列表', '⟳ Refresh List')}
        </button>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>
          {pickLocaleText(locale, `共 ${remoteSkills.length} 个社区技能`, `${remoteSkills.length} community skill(s)`)}
        </span>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', marginBottom: 10 }}>
          {pickLocaleText(locale, '🌐 社区来源 — 一键导入', '🌐 Community Sources — One-Click Import')}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {COMMUNITY_SOURCES.map((src) => (
            <div
              key={src.label}
              onClick={() => setQuickPickSource(quickPickSource?.label === src.label ? null : src)}
              style={{
                padding: '8px 14px',
                background: quickPickSource?.label === src.label ? '#0d1f45' : 'var(--panel)',
                border: `1px solid ${quickPickSource?.label === src.label ? 'var(--acc)' : 'var(--line)'}`,
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: 12,
                transition: 'all .15s',
              }}
            >
              <span style={{ marginRight: 6 }}>{src.emoji}</span>
              <b style={{ color: 'var(--text)' }}>{src.label}</b>
              <span style={{ marginLeft: 6, color: '#f0b429', fontSize: 11 }}>★ {src.official ? pickLocaleText(locale, '官方', 'Official') : src.stars}</span>
              <span style={{ marginLeft: 8, color: 'var(--muted)' }}>{locale === 'en' ? src.descEn : src.descZh}</span>
            </div>
          ))}
        </div>

        {quickPickSource && (
          <div style={{ marginTop: 14, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{pickLocaleText(locale, '添加到：', 'Add to:')}</span>
              <select
                value={quickPickAgent}
                onChange={(e) => setQuickPickAgent(e.target.value)}
                style={{ padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', fontSize: 12 }}
              >
                <option value="">{pickLocaleText(locale, '— 选择接收方 —', '— Select destination —')}</option>
                {agentConfig.agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>{ag.emoji} {normalizeAgentLabel(ag.id, ag.label)}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {quickPickSource.skills.map((sk) => {
                const alreadyAdded = remoteSkills.some((r) => r.skillName === sk.name && r.agentId === quickPickAgent);
                return (
                  <div
                    key={sk.name}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', background: 'var(--panel2)', borderRadius: 8,
                      border: '1px solid var(--line)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>📦 {sk.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', wordBreak: 'break-all', maxWidth: 180 }}>{sk.url.split('/').slice(-2).join('/')}</div>
                    </div>
                    {alreadyAdded ? (
                      <span style={{ fontSize: 10, color: '#4caf88', fontWeight: 600 }}>{pickLocaleText(locale, '✓ 已导入', '✓ Imported')}</span>
                    ) : (
                      <button
                        onClick={() => handleQuickImport(sk.url, sk.name)}
                        style={{ padding: '4px 10px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}
                      >
                        {pickLocaleText(locale, '导入', 'Import')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {remoteLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>{pickLocaleText(locale, '⟳ 加载中…', '⟳ Loading...')}</div>
      ) : remoteSkills.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', background: 'var(--panel)', borderRadius: 12, border: '1px dashed var(--line)' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🌐</div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>{pickLocaleText(locale, '尚无社区技能', 'No community skills yet')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{pickLocaleText(locale, '从社区来源快速导入，或手动添加 URL', 'Import from community sources or add a URL manually')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {remoteSkills.map((sk) => {
            const key = `${sk.agentId}/${sk.skillName}`;
            const isUpdating = updatingSkill === key;
            const isRemoving = removingSkill === key;
            const agInfo = agentConfig.agents.find((a) => a.id === sk.agentId);
            return (
              <div
                key={key}
                style={{
                  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 18px',
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>📦 {sk.skillName}</span>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 999,
                      background: sk.status === 'valid' ? '#0d3322' : '#3d1111',
                      color: sk.status === 'valid' ? '#4caf88' : '#ff5270',
                      fontWeight: 600,
                    }}>
                      {sk.status === 'valid' ? pickLocaleText(locale, '✓ 有效', '✓ Valid') : pickLocaleText(locale, '✗ 文件丢失', '✗ Missing File')}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--panel2)', padding: '2px 8px', borderRadius: 6 }}>
                      {agInfo?.emoji} {normalizeAgentLabel(agInfo?.id || sk.agentId, agInfo?.label || sk.agentId)}
                    </span>
                  </div>
                  {sk.description && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{sk.description}</div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span>🔗 <a href={sk.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--acc)', textDecoration: 'none' }}>{sk.sourceUrl.length > 60 ? sk.sourceUrl.slice(0, 60) + '…' : sk.sourceUrl}</a></span>
                    <span>📅 {sk.lastUpdated ? sk.lastUpdated.slice(0, 10) : sk.addedAt?.slice(0, 10)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => openSkill(sk.agentId, sk.skillName)}
                    style={{ padding: '6px 12px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}
                  >
                    {pickLocaleText(locale, '查看', 'View')}
                  </button>
                  <button
                    onClick={() => handleUpdate(sk)}
                    disabled={isUpdating}
                    style={{ padding: '6px 12px', background: 'transparent', color: 'var(--acc)', border: '1px solid var(--acc)', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}
                  >
                    {isUpdating ? '⟳' : pickLocaleText(locale, '更新', 'Update')}
                  </button>
                  <button
                    onClick={() => handleRemove(sk)}
                    disabled={isRemoving}
                    style={{ padding: '6px 12px', background: 'transparent', color: '#ff5270', border: '1px solid #ff5270', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}
                  >
                    {isRemoving ? '⟳' : pickLocaleText(locale, '删除', 'Delete')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
        {tabItems.map((t) => (
          <div
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 18px', cursor: 'pointer', fontSize: 13, borderRadius: '8px 8px 0 0',
              fontWeight: activeTab === t.key ? 700 : 400,
              background: activeTab === t.key ? 'var(--panel)' : 'transparent',
              color: activeTab === t.key ? 'var(--text)' : 'var(--muted)',
              border: activeTab === t.key ? '1px solid var(--line)' : '1px solid transparent',
              borderBottom: activeTab === t.key ? '1px solid var(--panel)' : '1px solid transparent',
              position: 'relative', bottom: -1,
              transition: 'all .15s',
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: '#1a2040', color: 'var(--acc)' }}>
                {t.count}
              </span>
            )}
          </div>
        ))}
      </div>

      {activeTab === 'local' ? localPanel : remotePanel}

      {skillModal && (
        <div className="modal-bg open" onClick={() => setSkillModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSkillModal(null)}>✕</button>
            <div className="modal-body">
              <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>
                {normalizeAgentLabel(skillModal.agentId, (agentConfig.agents.find((ag) => ag.id === skillModal.agentId)?.label) || skillModal.agentId)}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>📦 {skillModal.name}</div>
              <div className="sk-modal-body">
                <div className="sk-md" style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7 }}>
                  {skillModal.content}
                </div>
                {skillModal.path && (
                  <div className="sk-path" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 12 }}>
                    {pickLocaleText(locale, '路径：', 'Path: ')}{skillModal.path}
                  </div>
                )}
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
                {pickLocaleText(locale, `为 ${addForm.agentLabel} 添加技能`, `Add skill to ${addForm.agentLabel}`)}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 18 }}>{pickLocaleText(locale, '＋ 新增技能', '＋ New Skill')}</div>

              <div
                style={{
                  background: 'var(--panel2)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 18,
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: 'var(--muted)',
                }}
              >
                <b style={{ color: 'var(--text)' }}>📋 {pickLocaleText(locale, '技能规范说明', 'Skill Guidelines')}</b>
                <br />
                {pickLocaleText(locale, '• 技能名称使用', '• Use a skill name in ')}<b style={{ color: 'var(--text)' }}>{pickLocaleText(locale, '小写英文 + 连字符', 'lowercase English + hyphens')}</b>
                <br />
                {pickLocaleText(locale, '• 创建后会生成模板文件 SKILL.md', '• A template SKILL.md file will be created automatically')}
                <br />
                {pickLocaleText(locale, '• 当对应处理方收到相关任务时，技能可', '• The skill can be ')}<b style={{ color: 'var(--text)' }}>{pickLocaleText(locale, '自动激活', 'auto-activated')}</b>{pickLocaleText(locale, '', ' when the assigned worker receives matching tasks')}
              </div>

              <form onSubmit={submitAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    {pickLocaleText(locale, '技能名称', 'Skill Name')} <span style={{ color: '#ff5270' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={pickLocaleText(locale, '如 data-analysis, code-review', 'e.g. data-analysis, code-review')}
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))
                    }
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '技能描述', 'Skill Description')}</label>
                  <input
                    type="text"
                    placeholder={pickLocaleText(locale, '一句话说明用途', 'One-line description of the purpose')}
                    value={formData.desc}
                    onChange={(e) => setFormData((p) => ({ ...p, desc: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '触发条件（可选）', 'Trigger Condition (Optional)')}</label>
                  <input
                    type="text"
                    placeholder={pickLocaleText(locale, '何时激活此技能', 'When this skill should be activated')}
                    value={formData.trigger}
                    onChange={(e) => setFormData((p) => ({ ...p, trigger: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button type="button" className="btn btn-g" onClick={() => setAddForm(null)} style={{ padding: '8px 20px' }}>
                    {pickLocaleText(locale, '取消', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{ padding: '8px 20px', fontSize: 13, background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
                  >
                    {submitting ? pickLocaleText(locale, '⟳ 创建中…', '⟳ Creating...') : pickLocaleText(locale, '📦 创建技能', '📦 Create Skill')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {commandForm && (
        <div className="modal-bg open" onClick={() => setCommandForm(null)}>
          <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setCommandForm(null)}>✕</button>
            <div className="modal-body">
              <div style={{ fontSize: 11, color: '#7cc7ff', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>
                {pickLocaleText(locale, '任务入口', 'Task Entry')}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 18 }}>
                {pickLocaleText(locale, `向 ${commandForm.agentLabel} 提交任务`, `Submit a task to ${commandForm.agentLabel}`)}
              </div>

              <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 18, fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                {pickLocaleText(locale, '这里统一通过任务来处理，并可通过任务动态回看执行过程，便于追踪与留痕。', 'Tasks created here are handled through the unified task flow, and you can review the execution through task updates for better traceability.')}
              </div>

              <form onSubmit={submitCommand} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '交由谁处理', 'Handled by')}</label>
                  <select
                    value={commandForm.agentId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      const nextAgent = agentConfig.agents.find((ag) => ag.id === nextId);
                      if (!nextAgent) return;
                      setCommandForm({ agentId: nextAgent.id, agentLabel: normalizeAgentLabel(nextAgent.id, nextAgent.label) });
                      setCommandStatus('');
                      setCommandTaskId('');
                      setCommandActivity([]);
                    }}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', fontSize: 13 }}
                  >
                    {agentConfig.agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>{ag.emoji} {normalizeAgentLabel(ag.id, ag.label)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '任务内容', 'Task Content')}</label>
                  <textarea
                    required
                    rows={5}
                    placeholder={pickLocaleText(locale, '例如：请检查你当前可用的技能，并为“技能管理”相关需求给出执行方案、改动范围与验证步骤。', 'For example: inspect your currently available skills and provide an execution plan, change scope, and verification steps for a skill-management request.')}
                    value={commandText}
                    onChange={(e) => setCommandText(e.target.value)}
                    style={{ width: '100%', padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                  />
                </div>
                {commandStatus && (
                  <div style={{ fontSize: 12, color: commandStatus.includes('失败') || commandStatus.toLowerCase().includes('failed') ? '#ff5270' : '#4caf88', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
                    {commandStatus}
                  </div>
                )}
                {commandTaskId && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--panel2)', border: '1px dashed var(--line)', borderRadius: 8, padding: '10px 12px' }}>
                    {pickLocaleText(locale, '当前任务：', 'Current Task: ')}<b style={{ color: 'var(--text)' }}>{commandTaskId}</b>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => loadCommandActivity(commandTaskId)}
                    style={{ padding: '8px 14px', background: 'transparent', color: 'var(--acc)', border: '1px solid var(--acc)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
                  >
                    {pickLocaleText(locale, '刷新动态', 'Refresh Updates')}
                  </button>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" className="btn btn-g" onClick={() => setCommandForm(null)} style={{ padding: '8px 20px' }}>{pickLocaleText(locale, '关闭', 'Close')}</button>
                    <button
                      type="submit"
                      disabled={commandSubmitting || !commandText.trim()}
                      style={{ padding: '8px 20px', fontSize: 13, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
                    >
                      {commandSubmitting ? pickLocaleText(locale, '⟳ 创建中…', '⟳ Creating...') : pickLocaleText(locale, '创建任务', 'Create Task')}
                    </button>
                  </div>
                </div>
              </form>

              <div style={{ marginTop: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '最近动态', 'Recent Updates')}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pickLocaleText(locale, '用于确认任务是否已创建并开始执行', 'Use this to verify that the task was created and has started execution')}</div>
                </div>
                {commandLoading ? (
                  <div style={{ textAlign: 'center', padding: '26px 0', color: 'var(--muted)', fontSize: 12 }}>{pickLocaleText(locale, '⟳ 正在读取任务动态…', '⟳ Loading task activity...')}</div>
                ) : commandActivity.length === 0 ? (
                  <div style={{ background: 'var(--panel2)', border: '1px dashed var(--line)', borderRadius: 10, padding: 16, color: 'var(--muted)', fontSize: 12 }}>
                    {pickLocaleText(locale, '当前还没有读取到任务动态。请先创建后台任务，或在创建后稍等几秒再刷新。', 'No task activity was retrieved yet. Please create a background task first, or wait a few seconds after creation and refresh again.')}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
                    {commandActivity.slice(-12).reverse().map((item, idx) => (
                      <div key={`${String(item.at || idx)}-${idx}`} style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{item.kind || pickLocaleText(locale, '动态更新', 'Update')}</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{String(item.at || '')}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                          {summarizeActivity(item)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {addRemoteForm && (
        <div className="modal-bg open" onClick={() => setAddRemoteForm(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setAddRemoteForm(false)}>✕</button>
            <div className="modal-body">
              <div style={{ fontSize: 11, color: '#a07aff', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>
                {pickLocaleText(locale, '社区技能', 'Community Skills')}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 18 }}>{pickLocaleText(locale, '🌐 添加社区技能', '🌐 Add Community Skill')}</div>

              <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 18, fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                {pickLocaleText(locale, '支持 GitHub Raw URL，如：', 'GitHub Raw URLs are supported, for example:')}<br />
                <code style={{ color: 'var(--acc)', fontSize: 10 }}>https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/brainstorming/SKILL.md</code>
              </div>

              <form onSubmit={submitAddRemote} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '添加到', 'Add to')} <span style={{ color: '#ff5270' }}>*</span></label>
                  <select
                    required
                    value={remoteFormData.agentId}
                    onChange={(e) => setRemoteFormData((p) => ({ ...p, agentId: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', fontSize: 13 }}
                  >
                    <option value="">{pickLocaleText(locale, '— 选择接收方 —', '— Select destination —')}</option>
                    {agentConfig.agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>{ag.emoji} {normalizeAgentLabel(ag.id, ag.label)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '技能名称', 'Skill Name')} <span style={{ color: '#ff5270' }}>*</span></label>
                  <input
                    type="text"
                    required
                    placeholder={pickLocaleText(locale, '如 brainstorming, code-review', 'e.g. brainstorming, code-review')}
                    value={remoteFormData.skillName}
                    onChange={(e) => setRemoteFormData((p) => ({ ...p, skillName: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '源 URL', 'Source URL')} <span style={{ color: '#ff5270' }}>*</span></label>
                  <input
                    type="url"
                    required
                    placeholder="https://raw.githubusercontent.com/..."
                    value={remoteFormData.sourceUrl}
                    onChange={(e) => setRemoteFormData((p) => ({ ...p, sourceUrl: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', fontSize: 12, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '描述（可选）', 'Description (Optional)')}</label>
                  <input
                    type="text"
                    placeholder={pickLocaleText(locale, '一句话说明用途', 'One-line description of the purpose')}
                    value={remoteFormData.description}
                    onChange={(e) => setRemoteFormData((p) => ({ ...p, description: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button type="button" className="btn btn-g" onClick={() => setAddRemoteForm(false)} style={{ padding: '8px 20px' }}>{pickLocaleText(locale, '取消', 'Cancel')}</button>
                  <button
                    type="submit"
                    disabled={remoteSubmitting}
                    style={{ padding: '8px 20px', fontSize: 13, background: '#a07aff', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
                  >
                    {remoteSubmitting ? pickLocaleText(locale, '⟳ 下载中…', '⟳ Downloading...') : pickLocaleText(locale, '🌐 添加社区技能', '🌐 Add Community Skill')}
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
