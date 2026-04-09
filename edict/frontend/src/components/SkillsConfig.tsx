import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api, type Task } from '../api';
import { pickLocaleText, formatCount, type Locale } from '../i18n';
import PersistentAgentChat, { type ChatIntent, type DraftReview } from './PersistentAgentChat';

function normalizeAgentLabel(agentId: string, agentLabel: string) {
  if (agentId === 'admin_specialist' || agentLabel === '管理专家' || agentLabel === '技能管理员') return '功能整理助手';
  return agentLabel;
}

function buildSkillDraftReview(text: string, locale: Locale): DraftReview {
  const content = text.replace(/\s+/g, ' ').trim();
  if (!content) {
    return {
      ready: false,
      title: pickLocaleText(locale, '功能调整沟通', 'Feature Update Conversation'),
      summary: '',
      followUp: pickLocaleText(locale, '请先说明你希望这里帮助处理什么功能事项，例如新增、迁移、排查、整理、命名统一或批量补充。', 'Please first explain what kind of feature update you need here, such as adding, migrating, troubleshooting, organizing, naming cleanup, or bulk setup.'),
      missing: [pickLocaleText(locale, '需求目标', 'Request goal')],
    };
  }

  const missing: string[] = [];
  if (content.length < 18) missing.push(pickLocaleText(locale, '更具体的任务目标', 'a more specific task goal'));
  if (!/(影响|范围|涉及|目标|期望|结果|现状|问题|冲突|迁移|整理|排查|命名|挂载)/.test(content)) {
    missing.push(pickLocaleText(locale, '影响范围或现状说明', 'impact scope or current-state context'));
  }

  const title = pickLocaleText(locale, `请帮我处理功能相关事项：${content.slice(0, 42)}`, `Please help with this feature request: ${content.slice(0, 42)}`);
  const summary = pickLocaleText(
    locale,
    `处理对象：功能整理助手\n需求内容：${content}\n处理方式：先补充信息、再确认摘要，确认后再正式创建处理单。`,
    `Handler: Feature Assistant\nRequest: ${content}\nProcess: gather missing information first, confirm the summary, and then create the request.`,
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
      label: pickLocaleText(locale, '🏛️ 可用功能', '🏛️ Available Features'),
      count: agentConfig?.agents?.reduce((n, a) => n + (a.skills?.length || 0), 0) || 0,
    },
    {
      key: 'manager' as const,
      label: pickLocaleText(locale, '🗂️ 功能协助', '🗂️ Feature Help'),
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
      setSkillModal({ agentId, name: skillName, content: pickLocaleText(locale, '❌ 当前连接失败，请稍后再试', '❌ Connection failed. Please try again later.'), path: '' });
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
        toast(pickLocaleText(locale, `✅ 已将 ${formData.name} 添加给 ${addForm.agentLabel}`, `✅ ${formData.name} has been added to ${addForm.agentLabel}`), 'ok');
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
              {pickLocaleText(locale, '功能中心', 'Feature Center')}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
              {pickLocaleText(locale, '查看可用功能与新增入口', 'View Available Features & Add New Ones')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, maxWidth: 760 }}>
              {pickLocaleText(locale, '此处用于查看各成员当前可用的功能，并为指定成员添加新功能。若需要迁移、整理、排查或统一调整，请切换到“功能协助”提交。', 'Use this view to check the features currently available to each member and add new ones. For migration, cleanup, troubleshooting, or broader changes, switch to Feature Help.')}
            </div>
          </div>
          <button
            onClick={() => setActiveTab('manager')}
            style={{ padding: '10px 18px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}
          >
            {pickLocaleText(locale, '前往功能协助', 'Open Feature Help')}
          </button>
        </div>
      </div>
      <div className="skills-grid">
        {agentConfig.agents.map((ag) => (
          <div className="sk-card" key={ag.id}>
            <div className="sk-hdr">
              <span className="sk-emoji">{ag.emoji || '🏛️'}</span>
              <span className="sk-name">{normalizeAgentLabel(ag.id, ag.label)}</span>
              <span className="sk-cnt">{formatCount(locale, (ag.skills || []).length, '功能', 'feature(s)')}</span>
            </div>
            <div className="sk-list">
              {!(ag.skills || []).length ? (
                <div className="sk-empty">{pickLocaleText(locale, '暂无功能', 'No features yet')}</div>
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
                {pickLocaleText(locale, '＋ 添加新功能', '＋ Add New Feature')}
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
      labelZh: '新增功能',
      labelEn: 'Add New Feature',
      prefillZh: '我需要新增一个功能。请先确认要添加给哪位成员、功能名称、用途说明、适用条件，以及是否需要替换旧入口。',
      prefillEn: 'I need to add a feature. Please first confirm which member should receive it, the feature name, its purpose, when it should be used, and whether an older entry should be replaced.',
      helperZh: '适用于新增功能，并明确归属对象与使用条件。',
      helperEn: 'Use this for adding a feature and clarifying who it belongs to and when it should be used.',
    },
    {
      key: 'migrate-skill',
      labelZh: '功能迁移',
      labelEn: 'Move a Feature',
      prefillZh: '我需要处理功能迁移。请先确认迁移前后归属、兼容方式、旧入口是否停用，以及受影响的成员范围。',
      prefillEn: 'I need to handle a feature migration. Please first confirm the source and destination ownership, compatibility approach, whether the old entry should be retired, and which members are affected.',
      helperZh: '适用于功能归属调整、入口收口与兼容迁移。',
      helperEn: 'Use this for changing feature ownership, consolidating entry points, and compatibility migration.',
    },
    {
      key: 'troubleshoot-skill',
      labelZh: '功能排查',
      labelEn: 'Fix a Feature Issue',
      prefillZh: '我需要排查功能问题。请先确认异常现象、影响范围、复现方式、最近相关变化，以及希望恢复到什么状态。',
      prefillEn: 'I need to troubleshoot a feature issue. Please first confirm the symptom, impact scope, reproduction path, recent changes, and the state you want to restore.',
      helperZh: '适用于功能冲突、失效或触发异常等问题。',
      helperEn: 'Use this for feature conflicts, failures, or abnormal triggering behavior.',
    },
    {
      key: 'cleanup-skill',
      labelZh: '功能整理',
      labelEn: 'Organize Features',
      prefillZh: '我需要整理现有功能。请先确认要梳理的成员范围、重复项或命名问题、保留规则，以及最终希望形成的结构。',
      prefillEn: 'I need to clean up existing features. Please first confirm the target members, duplicate or naming issues, retention rules, and the desired final structure.',
      helperZh: '适用于重复功能清理、命名收口与结构整理。',
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
      headerKickerZh="功能整理窗口"
      headerKickerEn="Feature Assistant Window"
      headerTitleZh="统一提交功能调整事项"
      headerTitleEn="Submit Feature Requests Centrally"
      headerDescZh="这里替代原来的功能页签。入口已改为持续记录的沟通窗口：整理草稿时可以先补充信息再确认摘要，确认后再创建处理单；创建后记录会持续保留，刷新后也能继续查看与追溯。"
      headerDescEn="This replaces the former feature tab. The entry now uses a persistent chat window: during the draft stage you can provide more context and confirm a summary before creating the request; once created, the progress record is preserved and can still be reviewed after refresh."
      handlerNoteZh="该入口只用于功能相关事项，不会跳转到其他处理入口。"
      handlerNoteEn="This entry is dedicated to feature-related requests and will not redirect to other handlers."
      introZh="这里采用“沟通草稿 + 处理进展记录”的双层结构。你可以先描述目标、现状、影响范围与期望结果；系统会先追问并生成确认摘要，确认后才正式创建处理单。"
      introEn="This view uses a dual-layer model of conversation draft plus progress records. Start by describing the goal, current state, impact scope, and expected result; the system will ask follow-up questions and generate a confirmation summary before creating the request."
      draftLabelZh="功能整理草稿"
      draftLabelEn="Feature Conversation Draft"
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
        org: pickLocaleText(locale, '整体协调', 'Overview Coordination'),
        owner: pickLocaleText(locale, '功能设置页', 'Feature Settings Page'),
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
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(currentLocale, '提交前检查', 'Before You Submit')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {review.ready
                ? pickLocaleText(currentLocale, '已具备提交条件：目标明确、现状已描述、范围或影响已说明。', 'Ready to submit: the goal is clear, the current situation is described, and the scope or impact is covered.')
                : pickLocaleText(currentLocale, '建议至少补充三类信息：要处理什么、当前问题是什么、期望最终变成什么。', 'Please add at least three pieces of information: what should be handled, what the current problem is, and what final result you want.')}
            </div>
          </div>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(currentLocale, '记录保存说明', 'Saved Record Notes')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
              {pickLocaleText(currentLocale, '草稿期会在浏览器本地保存最近沟通和未发送内容；一旦确认创建任务，后续记录会持续保留，刷新后可从左侧记录列表继续查看。', 'During the draft stage, recent conversations and unsent text are stored locally in the browser. Once the request is confirmed, later records are kept and can be reopened from the list after refresh.')}
            </div>
          </div>
        </>
      )}
    />
  ) : (
    <div className="empty">{pickLocaleText(locale, '当前无法打开功能整理窗口，请稍后再试', 'The feature assistant window is unavailable right now. Please try again later.')}</div>
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
                {pickLocaleText(locale, `为 ${addForm.agentLabel} 添加功能`, `Add feature to ${addForm.agentLabel}`)}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, marginBottom: 18 }}>{pickLocaleText(locale, '＋ 新增功能', '＋ New Feature')}</div>            <div
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
                <b style={{ color: 'var(--text)' }}>📋 {pickLocaleText(locale, '填写建议', 'Writing Tips')}</b>
                <br />
                {pickLocaleText(locale, '• 名称尽量简短清晰，方便后续识别', '• Keep the name short and clear so it is easy to recognize later')}
                <br />
                {pickLocaleText(locale, '• 保存后会自动生成对应说明文件', '• A matching description file will be created automatically after saving')}
                <br />
                {pickLocaleText(locale, '• 建议把用途和触发条件写清楚，便于后续维护', '• Clearly describe the purpose and trigger conditions to make later maintenance easier')}
              </div>

              <form onSubmit={submitAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '功能名称', 'Feature Name')}</label>
                  <input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData((s) => ({ ...s, name: e.target.value }))}
                    placeholder={pickLocaleText(locale, '例如：内容搜索', 'For example: content search')}
                    style={{ width: '100%', padding: '11px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '描述', 'Description')}</label>
                  <textarea
                    rows={4}
                    value={formData.desc}
                    onChange={(e) => setFormData((s) => ({ ...s, desc: e.target.value }))}
                    placeholder={pickLocaleText(locale, '说明这个功能的作用与适用场景', 'Explain what this feature is for and when it should be used')}
                    style={{ width: '100%', padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{pickLocaleText(locale, '使用条件', 'When to Use')}</label>
                  <textarea
                    rows={3}
                    value={formData.trigger}
                    onChange={(e) => setFormData((s) => ({ ...s, trigger: e.target.value }))}
                    placeholder={pickLocaleText(locale, '说明在什么情况下适合使用这个功能', 'Describe when this feature should be used')}
                    style={{ width: '100%', padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-g" onClick={() => setAddForm(null)} style={{ padding: '8px 18px' }}>
                    {pickLocaleText(locale, '取消', 'Cancel')}
                  </button>
                  <button type="submit" disabled={submitting || !formData.name.trim()} style={{ padding: '8px 18px', background: 'var(--acc)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                    {submitting ? pickLocaleText(locale, '⟳ 添加中…', '⟳ Adding...') : pickLocaleText(locale, '添加功能', 'Add Feature')}
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
