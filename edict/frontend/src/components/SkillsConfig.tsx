import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api, type Task } from '../api';
import { pickLocaleText, formatCount, type Locale } from '../i18n';
import PersistentAgentChat, { type ChatIntent, type DraftReview } from './PersistentAgentChat';

function normalizeAgentLabel(agentId: string, agentLabel: string) {
  if (agentId === 'admin_specialist' || agentLabel === '管理专家' || agentLabel === '技能管理员') return '技能管理员';
  return agentLabel;
}

function buildSkillDraftReview(text: string, locale: Locale): DraftReview {
  const content = text.replace(/\s+/g, ' ').trim();
  if (!content) {
    return {
      ready: false,
      title: pickLocaleText(locale, '技能治理会话', 'Skill Governance Session'),
      summary: '',
      followUp: pickLocaleText(locale, '请先说明你希望技能管理员处理什么问题，例如技能新增、迁移、排障、整理、命名收口或批量挂载。', 'Please first explain what you want the Skill Manager to handle, such as adding skills, migration, troubleshooting, cleanup, naming normalization, or bulk attachment.'),
      missing: [pickLocaleText(locale, '需求目标', 'Request goal')],
    };
  }

  const missing: string[] = [];
  if (content.length < 18) missing.push(pickLocaleText(locale, '更具体的任务目标', 'a more specific task goal'));
  if (!/(影响|范围|涉及|目标|期望|结果|现状|问题|冲突|迁移|整理|排查|命名|挂载)/.test(content)) {
    missing.push(pickLocaleText(locale, '影响范围或现状说明', 'impact scope or current-state context'));
  }

  const title = pickLocaleText(locale, `请技能管理员处理：${content.slice(0, 42)}`, `Ask the Skill Manager to handle: ${content.slice(0, 42)}`);
  const summary = pickLocaleText(
    locale,
    `处理对象：技能管理员\n治理诉求：${content}\n执行要求：仅提交给技能管理员，不转给其他 Agent；先补问、后确认、再创建后台任务。`,
    `Handler: Skill Manager\nGovernance request: ${content}\nExecution rule: send only to the Skill Manager, ask follow-up questions first, then confirm before creating the backend task.`,
  );

  if (missing.length) {
    return {
      ready: false,
      title,
      summary,
      followUp: pickLocaleText(locale, `为避免信息不足，请再补充：${missing.join('、')}。`, `To avoid insufficient information, please also add ${missing.join(', ')}.`),
      missing,
    };
  }

  return {
    ready: true,
    title,
    summary,
    followUp: pickLocaleText(locale, '信息已足够，可以创建任务。', 'The information is sufficient and the task can be created now.'),
  };
}

export default function SkillsConfig() {
  const locale = useStore((s) => s.locale);
  const agentConfig = useStore((s) => s.agentConfig);
  const loadAgentConfig = useStore((s) => s.loadAgentConfig);
  const toast = useStore((s) => s.toast);

  const [skillModal, setSkillModal] = useState<{ agentId: string; name: string; content: string; path: string } | null>(null);
  const [addForm, setAddForm] = useState<{ agentId: string; agentLabel: string } | null>(null);
  const [formData, setFormData] = useState({ name: '', desc: '', trigger: '' });
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'local' | 'manager'>('local');

  useEffect(() => {
    loadAgentConfig();
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
    return null;
  };

  const skillManagerTarget = getSkillManagerTarget();

  const tabItems = useMemo(() => [
    {
      key: 'local' as const,
      label: pickLocaleText(locale, '🏛️ 本地技能', '🏛️ Local Skills'),
      count: agentConfig?.agents?.reduce((n, a) => n + (a.skills?.length || 0), 0) || 0,
    },
    {
      key: 'manager' as const,
      label: pickLocaleText(locale, '🗂️ 技能管理员会话窗口', '🗂️ Skill Manager Session Window'),
      count: 1,
    },
  ], [agentConfig?.agents, locale]);

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
              {pickLocaleText(locale, '本地技能名册与分发', 'Local Skills Registry & Distribution')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, maxWidth: 760 }}>
              {pickLocaleText(locale, '此处用于查看各 Agent 已挂载的本地技能，并为指定 Agent 新增技能。若需要治理、迁移、整理或排障，请切换到“技能管理员会话窗口”统一提交。', 'Use this view to inspect the local skills attached to each agent and add new skills. For governance, migration, cleanup, or troubleshooting requests, switch to the Skill Manager session window for unified submission.')}
            </div>
          </div>
          <button
            onClick={() => setActiveTab('manager')}
            style={{ padding: '10px 18px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}
          >
            {pickLocaleText(locale, '前往技能管理员会话窗口', 'Open Skill Manager Session Window')}
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const intents: ChatIntent[] = [
    {
      key: 'add-skill',
      labelZh: '新增技能',
      labelEn: 'Add Skill',
      prefillZh: '我需要技能管理员新增一个技能。请先确认要挂载到哪个 Agent、技能名称、用途描述、触发条件，以及是否需要迁移旧入口。',
      prefillEn: 'I need the Skill Manager to add a new skill. Please first confirm the target agent, skill name, purpose, trigger condition, and whether any legacy entry needs to be migrated.',
      helperZh: '适用于新增技能、定义挂载目标与触发条件。',
      helperEn: 'Use this for adding a skill and defining its target agent and trigger conditions.',
    },
    {
      key: 'migrate-skill',
      labelZh: '技能迁移',
      labelEn: 'Skill Migration',
      prefillZh: '我需要技能管理员处理技能迁移。请先确认迁移前后归属、兼容策略、旧入口是否下线，以及受影响的 Agent 范围。',
      prefillEn: 'I need the Skill Manager to handle a skill migration. Please first confirm the source and destination ownership, compatibility strategy, whether the old entry should be retired, and which agents are affected.',
      helperZh: '适用于技能归属调整、入口收口与兼容迁移。',
      helperEn: 'Use this for changing skill ownership, consolidating entry points, and compatibility migration.',
    },
    {
      key: 'troubleshoot-skill',
      labelZh: '技能排障',
      labelEn: 'Skill Troubleshooting',
      prefillZh: '我需要技能管理员排查技能问题。请先确认异常现象、影响范围、复现方式、最近相关改动，以及期望恢复标准。',
      prefillEn: 'I need the Skill Manager to troubleshoot a skill issue. Please first confirm the symptom, impact scope, reproduction path, recent related changes, and expected recovery criteria.',
      helperZh: '适用于技能冲突、失效、命中异常等问题。',
      helperEn: 'Use this for skill conflicts, failures, or abnormal triggering behavior.',
    },
    {
      key: 'cleanup-skill',
      labelZh: '技能整理',
      labelEn: 'Skill Cleanup',
      prefillZh: '我需要技能管理员整理现有技能。请先确认要梳理的 Agent 范围、重复项或命名问题、保留规则，以及最终希望形成的结构。',
      prefillEn: 'I need the Skill Manager to clean up existing skills. Please first confirm the target agents, duplicate or naming issues, retention rules, and the desired final structure.',
      helperZh: '适用于重复技能清理、命名收口与结构整理。',
      helperEn: 'Use this for duplicate cleanup, naming normalization, and structural consolidation.',
    },
  ];

  const managerPanel = skillManagerTarget ? (
    <PersistentAgentChat
      storageKey="edict-skill-manager-chat"
      agentId={skillManagerTarget.agentId}
      agentLabel={skillManagerTarget.agentLabel}
      agentEmoji={skillManagerTarget.emoji}
      accentColor="#c79bff"
      accentSoft="rgba(155, 89, 182, 0.12)"
      headerKickerZh="技能管理员会话窗口"
      headerKickerEn="Skill Manager Session Window"
      headerTitleZh="统一提交技能治理任务"
      headerTitleEn="Submit Skill Governance Tasks Centrally"
      headerDescZh="这里替代原来的社区技能页签。入口已改为持久化聊天窗口：草稿阶段允许先问后提炼摘要，确认后再创建任务；任务创建后会以 taskId 绑定活动流，支持刷新恢复、后台挂起与历史追溯。"
      headerDescEn="This replaces the former community skills tab. The entry is now a persistent chat window: the draft stage allows follow-up questions and confirmation summaries before task creation; once created, the activity stream is bound to the task ID and supports refresh recovery, background suspension, and traceable history."
      handlerNoteZh="该入口只会把任务交给技能管理员，不会分流给其他 Agent。"
      handlerNoteEn="This entry always routes the task to the Skill Manager only and never to other agents."
      introZh="为了留痕与回放，这里以“聊天草稿 + 后台任务活动流”双层结构工作。你可以先描述目标、现状、影响范围与期望结果；系统会先追问并生成确认摘要，确认后才正式落库创建任务。"
      introEn="For traceability and replay, this view uses a dual-layer model of draft chat plus backend task activity stream. Start by describing the goal, current state, impact scope, and expected result; the system will ask follow-up questions and produce a confirmation summary before creating the task."
      draftLabelZh="技能管理员草稿会话"
      draftLabelEn="Skill Manager Draft Session"
      taskFilter={(task: Task) => {
        const anyTask = task as Task & { templateId?: string; templateParams?: Record<string, string> };
        return anyTask.templateId === 'skills_config_dialog'
          || anyTask.targetDept === skillManagerTarget.agentLabel
          || anyTask.templateParams?.targetAgentId === skillManagerTarget.agentId;
      }}
      intents={intents}
      buildDraftReview={buildSkillDraftReview}
      createTask={async (draftText, review) => api.createTask({
        title: review.title,
        org: pickLocaleText(locale, '总控中心', 'Control Center'),
        owner: pickLocaleText(locale, '技能配置中心', 'Skills Config Center'),
        targetDept: skillManagerTarget.agentLabel,
        priority: 'normal',
        templateId: 'skills_config_dialog',
        params: {
          entry: 'skills-config',
          message: draftText.trim(),
          confirmationSummary: review.summary,
          targetAgentId: skillManagerTarget.agentId,
          targetAgentLabel: skillManagerTarget.agentLabel,
        },
      })}
      appendTaskMessage={(taskId, text) => api.taskAppendMessage(taskId, skillManagerTarget.agentId, text)}
      renderSidebar={({ locale: currentLocale, review }) => (
        <>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(currentLocale, '提交检查项', 'Submission Checklist')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {review.ready
                ? pickLocaleText(currentLocale, '已具备提交条件：目标明确、现状已描述、范围或影响已说明。', 'Submission conditions are satisfied: the goal is clear, the current state is described, and the scope or impact is covered.')
                : pickLocaleText(currentLocale, '建议至少补充三类信息：要处理什么、当前问题是什么、期望最终变成什么。', 'Please provide at least three kinds of information: what should be handled, what the current problem is, and what the desired final result should be.')}
            </div>
          </div>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(currentLocale, '持久化规则', 'Persistence Rules')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
              {pickLocaleText(currentLocale, '草稿期会在浏览器本地保存最近会话和未发送内容；一旦确认创建任务，后续记录以任务活动流为主，刷新后可从左侧会话列表恢复。', 'During the draft phase, recent sessions and unsent text are stored locally in the browser. Once the task is confirmed, the subsequent records are stored primarily in the task activity stream and can be restored from the session list after refresh.')}
            </div>
          </div>
        </>
      )}
    />
  ) : (
    <div className="empty">{pickLocaleText(locale, '未找到技能管理员，无法打开会话窗口', 'Skill Manager not found, unable to open the session window')}</div>
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

      {activeTab === 'local' ? localPanel : managerPanel}

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
                {pickLocaleText(locale, '• 描述和触发条件建议写清楚，便于后续统一治理', '• Keep the description and trigger condition clear for future governance')}
              </div>

              <form onSubmit={submitAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '技能名称', 'Skill Name')}</label>
                  <input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData((s) => ({ ...s, name: e.target.value }))}
                    placeholder={pickLocaleText(locale, '例如：web-scraper', 'For example: web-scraper')}
                    style={{ width: '100%', padding: '11px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '描述', 'Description')}</label>
                  <textarea
                    rows={4}
                    value={formData.desc}
                    onChange={(e) => setFormData((s) => ({ ...s, desc: e.target.value }))}
                    placeholder={pickLocaleText(locale, '说明这个技能的作用与适用场景', 'Explain what this skill does and when to use it')}
                    style={{ width: '100%', padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '触发条件', 'Trigger Condition')}</label>
                  <textarea
                    rows={3}
                    value={formData.trigger}
                    onChange={(e) => setFormData((s) => ({ ...s, trigger: e.target.value }))}
                    placeholder={pickLocaleText(locale, '说明何时应该使用这个技能', 'Describe when this skill should be used')}
                    style={{ width: '100%', padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-g" onClick={() => setAddForm(null)} style={{ padding: '8px 18px' }}>
                    {pickLocaleText(locale, '取消', 'Cancel')}
                  </button>
                  <button type="submit" disabled={submitting || !formData.name.trim()} style={{ padding: '8px 18px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                    {submitting ? pickLocaleText(locale, '⟳ 创建中…', '⟳ Creating...') : pickLocaleText(locale, '创建技能', 'Create Skill')}
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
