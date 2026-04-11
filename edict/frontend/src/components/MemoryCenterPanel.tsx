import { useEffect, useMemo, useState } from 'react';
import { api, type AgentInfo, type Task, type WorkspaceFileContentResult } from '../api';
import { useStore } from '../store';
import { pickLocaleText } from '../i18n';

type MemoryTargetKind = 'global' | 'timeline' | 'agent';

type MemoryTarget = {
  id: string;
  path: string;
  label: string;
  subtitle: string;
  kind: MemoryTargetKind;
  agent?: AgentInfo;
};

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function formatTimeLabel(value: string, locale: 'zh' | 'en') {
  if (!value) return locale === 'en' ? 'Not updated yet' : '尚未更新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return locale === 'en'
    ? date.toLocaleString('en-US', { hour12: false })
    : date.toLocaleString('zh-CN', { hour12: false });
}

function formatTaskLabel(task: Task, locale: 'zh' | 'en') {
  const title = task.title || (locale === 'en' ? 'Untitled Task' : '未命名任务');
  return `${task.id} · ${title}`;
}

function buildTemplate(target: MemoryTarget, task: Task | null, locale: 'zh' | 'en') {
  const workspaceRoot = task?.workspaceActualPath || task?.workspacePath || '/workspace';
  const taskTitle = task?.title || (locale === 'en' ? 'Untitled Task' : '未命名任务');
  const taskId = task?.id || 'task';
  const updatedLine = locale === 'en' ? 'Updated At' : '更新时间';
  const nowLine = new Date().toISOString();

  if (target.kind === 'global' && target.path === 'AGENTS.md') {
    return locale === 'en'
      ? `# Shared Collaboration Memory\n\n> Shared rules, constraints, and handoff notes for the current workspace.\n\n## Bound Task\n- Task: ${taskId} · ${taskTitle}\n- Workspace: ${workspaceRoot}\n\n## Routing Rules\n- \n\n## Cross-Agent Constraints\n- \n\n## Handoff Notes\n- \n\n## Maintenance\n- ${updatedLine}: ${nowLine}\n`
      : `# 协作记忆\n\n> 用于记录当前工作区共享的协作规则、长期约束与交接信息。\n\n## 绑定任务\n- 任务：${taskId} · ${taskTitle}\n- 工作区：${workspaceRoot}\n\n## 路由规则\n- \n\n## 跨 Agent 约束\n- \n\n## 交接备注\n- \n\n## 维护\n- ${updatedLine}：${nowLine}\n`;
  }

  if (target.kind === 'global' && target.path === 'SOUL.md') {
    return locale === 'en'
      ? `# Workspace Soul\n\n> Describe identity, values, and non-negotiable principles for the workspace.\n\n## Identity\n- \n\n## Long-Term Values\n- \n\n## Preferred Collaboration Style\n- \n\n## Maintenance\n- ${updatedLine}: ${nowLine}\n`
      : `# 工作区 SOUL\n\n> 这里记录工作区的身份定位、价值观与不可违背的原则。\n\n## 身份定位\n- \n\n## 长期价值\n- \n\n## 协作风格\n- \n\n## 维护\n- ${updatedLine}：${nowLine}\n`;
  }

  if (target.kind === 'global' && target.path === 'USER.md') {
    return locale === 'en'
      ? `# User Memory\n\n> Record the user's stable preferences, communication style, and delivery habits.\n\n## Stable Preferences\n- \n\n## Communication Style\n- \n\n## Delivery Expectations\n- \n\n## Maintenance\n- ${updatedLine}: ${nowLine}\n`
      : `# 用户记忆\n\n> 这里记录用户稳定偏好、沟通方式与交付习惯。\n\n## 稳定偏好\n- \n\n## 沟通方式\n- \n\n## 交付预期\n- \n\n## 维护\n- ${updatedLine}：${nowLine}\n`;
  }

  if (target.kind === 'timeline') {
    return locale === 'en'
      ? `# Memory Timeline · ${todayStamp()}\n\n> Daily workspace notes for context continuity.\n\n## Task Snapshot\n- Task: ${taskId} · ${taskTitle}\n- Workspace: ${workspaceRoot}\n\n## New Signals\n- \n\n## Decisions and Changes\n- \n\n## Follow-up\n- \n\n## Maintenance\n- ${updatedLine}: ${nowLine}\n`
      : `# 记忆时间线 · ${todayStamp()}\n\n> 用于承接每日上下文、变化与后续动作。\n\n## 当前任务快照\n- 任务：${taskId} · ${taskTitle}\n- 工作区：${workspaceRoot}\n\n## 新信号\n- \n\n## 决策与变化\n- \n\n## 后续动作\n- \n\n## 维护\n- ${updatedLine}：${nowLine}\n`;
  }

  const agentLabel = target.agent?.label || target.label;
  const agentId = target.agent?.id || target.id;
  return locale === 'en'
    ? `# ${agentLabel} Memory\n\n> Agent-level long-term memory file.\n\n## Agent Profile\n- Agent ID: ${agentId}\n- Bound Task: ${taskId} · ${taskTitle}\n\n## Stable Strengths\n- \n\n## Routing Preferences\n- \n\n## Collaboration Constraints\n- \n\n## Maintenance\n- ${updatedLine}: ${nowLine}\n`
    : `# ${agentLabel} 记忆\n\n> 面向单个 Agent 的长期记忆文件。\n\n## Agent 档案\n- Agent ID：${agentId}\n- 绑定任务：${taskId} · ${taskTitle}\n\n## 稳定强项\n- \n\n## 路由偏好\n- \n\n## 协作约束\n- \n\n## 维护\n- ${updatedLine}：${nowLine}\n`;
}

export default function MemoryCenterPanel() {
  const locale = useStore((s) => s.locale);
  const agentConfig = useStore((s) => s.agentConfig);
  const liveStatus = useStore((s) => s.liveStatus);
  const toast = useStore((s) => s.toast);
  const modalTaskId = useStore((s) => s.modalTaskId);
  const setModalTaskId = useStore((s) => s.setModalTaskId);

  const [boundTaskId, setBoundTaskId] = useState('');
  const [timelineDate, setTimelineDate] = useState(todayStamp());
  const [selectedPath, setSelectedPath] = useState('');
  const [activeFile, setActiveFile] = useState<WorkspaceFileContentResult | null>(null);
  const [draft, setDraft] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [filePresence, setFilePresence] = useState<Record<string, boolean>>({});

  const tasks = useMemo(() => (liveStatus?.tasks || []).filter((task) => !!task.id), [liveStatus?.tasks]);
  const activeTasks = useMemo(
    () => tasks.filter((task) => !task.archived && !['Done', 'Cancelled'].includes(task.state)),
    [tasks],
  );

  const fallbackTaskId = useMemo(() => {
    if (boundTaskId && tasks.some((task) => task.id === boundTaskId)) return boundTaskId;
    if (modalTaskId && tasks.some((task) => task.id === modalTaskId)) return modalTaskId;
    return activeTasks[0]?.id || tasks[0]?.id || '';
  }, [activeTasks, boundTaskId, modalTaskId, tasks]);

  const currentTask = useMemo(
    () => tasks.find((task) => task.id === fallbackTaskId) || null,
    [fallbackTaskId, tasks],
  );

  useEffect(() => {
    if (!boundTaskId && fallbackTaskId) {
      setBoundTaskId(fallbackTaskId);
      return;
    }
    if (boundTaskId && !tasks.some((task) => task.id === boundTaskId)) {
      setBoundTaskId(fallbackTaskId);
    }
  }, [boundTaskId, fallbackTaskId, tasks]);

  const agents = agentConfig?.agents || [];
  const globalTargets = useMemo<MemoryTarget[]>(() => ([
    {
      id: 'global-agents',
      path: 'AGENTS.md',
      label: pickLocaleText(locale, '协作记忆', 'Shared Memory'),
      subtitle: pickLocaleText(locale, '共享规则、长期约束与交接备注', 'Shared rules, long-term constraints, and handoff notes'),
      kind: 'global',
    },
    {
      id: 'timeline-date',
      path: `memory/${timelineDate}.md`,
      label: pickLocaleText(locale, '记忆时间线', 'Memory Timeline'),
      subtitle: pickLocaleText(locale, `按日期访问：${timelineDate}`, `Access by date: ${timelineDate}`),
      kind: 'timeline',
    },
  ]), [locale, timelineDate]);

  const agentTargets = useMemo<MemoryTarget[]>(() => agents.map((agent) => ({
    id: `agent-${agent.id}`,
    path: `agents/${agent.id}/MEMORY.md`,
    label: `${agent.emoji || '🤖'} ${agent.label}`,
    subtitle: pickLocaleText(locale, 'Agent 专属长期记忆文件', 'Agent-specific long-term memory file'),
    kind: 'agent',
    agent,
  })), [agents, locale]);

  const memoryTargets = useMemo(() => [...globalTargets, ...agentTargets], [agentTargets, globalTargets]);
  const selectedTarget = memoryTargets.find((item) => item.path === selectedPath) || globalTargets[0] || null;
  const activeContent = activeFile?.content || '';
  const isSoulReadonly = selectedTarget?.path === 'SOUL.md';
  const isEditable = !!selectedTarget && !isSoulReadonly && activeFile?.editable !== false;
  const dirty = isEditable && draft !== activeContent;

  const openMemoryFile = async (target: MemoryTarget) => {
    if (!currentTask) return;
    setLoadingFile(true);
    setSelectedPath(target.path);
    setStatusText('');
    try {
      const result = await api.readWorkspaceFile(currentTask.id, target.path);
      setActiveFile(result);
      setDraft(result.content || '');
      setFilePresence((prev) => ({ ...prev, [target.path]: true }));
      setStatusText(pickLocaleText(locale, `已读取 ${target.path}`, `Loaded ${target.path}`));
    } catch {
      const template = buildTemplate(target, currentTask, locale);
      const readonly = target.path === 'SOUL.md';
      setActiveFile({ path: target.path, content: template, editable: !readonly });
      setDraft(template);
      setFilePresence((prev) => ({ ...prev, [target.path]: false }));
      setStatusText(
        readonly
          ? pickLocaleText(locale, 'SOUL.md 仅支持查看', 'SOUL.md is view-only')
          : pickLocaleText(locale, `将按模板创建 ${target.path}`, `${target.path} will be created from the template`),
      );
    } finally {
      setLoadingFile(false);
    }
  };

  useEffect(() => {
    if (!currentTask || !memoryTargets.length) {
      setSelectedPath('');
      setActiveFile(null);
      setDraft('');
      setStatusText('');
      return;
    }
    const nextTarget = memoryTargets.find((item) => item.path === selectedPath) || globalTargets[0] || memoryTargets[0];
    void openMemoryFile(nextTarget);
  }, [currentTask?.id]);

  const handleSave = async () => {
    if (!currentTask || !selectedTarget || !selectedPath || saving || !isEditable) return;
    setSaving(true);
    try {
      const result = await api.saveWorkspaceFile(currentTask.id, selectedPath, draft);
      if (!result.ok) throw new Error(result.error || pickLocaleText(locale, '保存失败', 'Save failed'));
      setActiveFile(result);
      setDraft(result.content || '');
      setFilePresence((prev) => ({ ...prev, [selectedPath]: true }));
      setStatusText(
        pickLocaleText(
          locale,
          `已保存到 ${selectedPath}。`,
          `Saved to ${selectedPath}.`,
        ),
      );
      toast(pickLocaleText(locale, `已保存 ${selectedPath}`, `Saved ${selectedPath}`), 'ok');
    } catch (err) {
      const message = err instanceof Error ? err.message : pickLocaleText(locale, '保存失败', 'Save failed');
      setStatusText(message);
      toast(message, 'err');
    } finally {
      setSaving(false);
    }
  };

  if (!currentTask) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <section style={{ padding: 22, borderRadius: 22, border: '1px solid var(--line)', background: 'var(--panel)', display: 'grid', gap: 10 }}>
          <div className="ec-id">{pickLocaleText(locale, '记忆中心', 'Memory Center')}</div>
          <div style={{ fontSize: 24, fontWeight: 850 }}>{pickLocaleText(locale, '暂无任务工作区', 'No Task Workspace')}</div>
        </section>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section
        style={{
          borderRadius: 22,
          border: '1px solid var(--line-strong)',
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--panel3) 95%, transparent), color-mix(in srgb, var(--panel2) 92%, transparent))',
          boxShadow: 'var(--shadow-soft)',
          padding: 18,
          display: 'grid',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="ec-id">{pickLocaleText(locale, '记忆中心', 'Memory Center')}</div>
            <div style={{ fontSize: 26, lineHeight: 1.1, fontWeight: 900, letterSpacing: '-0.03em' }}>{pickLocaleText(locale, '长期记忆与时间线', 'Long-Term Memory & Timeline')}</div>
            <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, maxWidth: 720 }}>
              {pickLocaleText(locale, '这里集中整理共享记忆、按日期沉淀的时间线，以及各 Agent 的长期上下文，不再直接暴露任务级标题与旧版底层入口。', 'Organize shared memory, date-based timelines, and long-term agent context here without exposing task-level headings or legacy low-level entry points.')}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`tag st-${currentTask.state}`}>{currentTask.state}</span>
            <span className="chip ok">{pickLocaleText(locale, `${globalTargets.length} 个核心分区`, `${globalTargets.length} core sections`)}</span>
            <span className="chip">{pickLocaleText(locale, `${agentTargets.length} 份 Agent 记忆`, `${agentTargets.length} agent memories`)}</span>
            <span className="chip">{pickLocaleText(locale, `时间线 ${timelineDate}`, `Timeline ${timelineDate}`)}</span>
            <button className="ab-btn active" onClick={() => setModalTaskId(currentTask.id)}>{pickLocaleText(locale, '进入当前任务', 'Open Current Task')}</button>
          </div>
        </div>
      </section>

      <section className="memory-center-layout" style={{ display: 'grid', gap: 16, alignItems: 'start' }}>
        <aside className="memory-center-layout__sidebar" style={{ padding: 18, borderRadius: 22, border: '1px solid var(--line)', background: 'var(--panel)', display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="ec-id">{pickLocaleText(locale, '时间线访问', 'Timeline Access')}</div>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '按日期打开记忆时间线', 'Open memory timeline by date')}</span>
              <input
                type="date"
                value={timelineDate}
                onChange={(event) => setTimelineDate(event.target.value || todayStamp())}
                style={{
                  width: '100%',
                  borderRadius: 14,
                  border: '1px solid var(--line)',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text)',
                  padding: '10px 12px',
                }}
              />
            </label>
            <button className="ab-btn" onClick={() => void openMemoryFile(globalTargets[1])}>
              {pickLocaleText(locale, '打开该日期时间线', 'Open Timeline for This Date')}
            </button>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <div className="ec-id">{pickLocaleText(locale, '全局记忆文件', 'Global Memory Files')}</div>
            {globalTargets.map((target) => {
              const active = selectedPath === target.path;
              const exists = filePresence[target.path];
              return (
                <button
                  key={target.path}
                  type="button"
                  onClick={() => void openMemoryFile(target)}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    borderRadius: 16,
                    border: `1px solid ${active ? 'rgba(122,162,255,0.42)' : 'rgba(255,255,255,0.08)'}`,
                    background: active ? 'rgba(122,162,255,0.10)' : 'rgba(255,255,255,0.03)',
                    display: 'grid',
                    gap: 6,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{target.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{target.subtitle}</div>
                    </div>
                    <span className={`chip ${exists ? 'ok' : ''}`}>{exists ? pickLocaleText(locale, '已存在', 'Ready') : pickLocaleText(locale, '模板', 'Template')}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <div className="ec-id">{pickLocaleText(locale, 'Agent 记忆文件', 'Agent Memory Files')}</div>
            <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflow: 'auto', paddingRight: 2 }}>
              {agentTargets.map((target) => {
                const active = selectedPath === target.path;
                const exists = filePresence[target.path];
                return (
                  <button
                    key={target.path}
                    type="button"
                    onClick={() => void openMemoryFile(target)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 16,
                      border: `1px solid ${active ? 'rgba(122,162,255,0.42)' : 'rgba(255,255,255,0.08)'}`,
                      background: active ? 'rgba(122,162,255,0.10)' : 'rgba(255,255,255,0.03)',
                      display: 'grid',
                      gap: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ fontSize: 14, fontWeight: 800 }}>{target.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{target.subtitle}</div>
                      </div>
                      <span className={`chip ${exists ? 'ok' : ''}`}>{exists ? 'MD' : pickLocaleText(locale, '待创建', 'New')}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="memory-center-layout__editor" style={{ padding: 18, borderRadius: 22, border: '1px solid var(--line)', background: 'var(--panel)', display: 'grid', gap: 14 }}>
          <div className="memory-center-layout__editor-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="ec-id">{pickLocaleText(locale, 'Markdown 编辑器', 'Markdown Editor')}</div>
              <div style={{ fontSize: 22, fontWeight: 850 }}>{selectedTarget?.label || selectedTarget?.path || pickLocaleText(locale, '请选择文件', 'Choose a file')}</div>
              {selectedTarget ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`chip ${isSoulReadonly ? '' : 'ok'}`}>
                    {isSoulReadonly ? pickLocaleText(locale, 'SOUL.md 仅查看', 'SOUL.md view only') : pickLocaleText(locale, '可编辑', 'Editable')}
                  </span>
                  {selectedTarget?.kind === 'timeline' ? <span className="chip">{timelineDate}</span> : null}
                  {activeFile?.modified_at ? <span className="chip">{formatTimeLabel(activeFile.modified_at, locale)}</span> : null}
                </div>
              ) : null}
            </div>

            <div className="memory-center-layout__editor-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectedTarget ? <button className="ab-btn" onClick={() => void openMemoryFile(selectedTarget)} disabled={loadingFile}>{loadingFile ? pickLocaleText(locale, '读取中…', 'Loading...') : pickLocaleText(locale, '重新读取', 'Reload')}</button> : null}
              {selectedTarget ? <button className="ab-btn" onClick={() => navigator.clipboard.writeText(selectedTarget.path).then(() => toast(pickLocaleText(locale, '已复制文件路径', 'File path copied'), 'ok')).catch(() => toast(pickLocaleText(locale, '复制失败，请稍后重试', 'Copy failed. Please try again later.'), 'err'))}>{pickLocaleText(locale, '复制路径', 'Copy Path')}</button> : null}
              <button className="ab-btn active" onClick={() => void handleSave()} disabled={!selectedTarget || saving || !dirty || !isEditable}>
                {isSoulReadonly
                  ? pickLocaleText(locale, '只读', 'View Only')
                  : (saving ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存', 'Save'))}
              </button>
            </div>
          </div>


          {statusText ? (
            <div style={{ padding: 10, borderRadius: 14, background: 'rgba(122,162,255,0.08)', border: '1px solid rgba(122,162,255,0.16)', color: 'var(--text-soft)', fontSize: 12 }}>
              {statusText}
            </div>
          ) : null}

          <textarea
            value={draft}
            onChange={(event) => {
              if (!isEditable) return;
              setDraft(event.target.value);
            }}
            readOnly={!isEditable}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 'clamp(320px, 58vh, 560px)',
              resize: 'vertical',
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.08)',
              background: !isEditable ? 'rgba(7,10,18,0.5)' : 'rgba(7,10,18,0.72)',
              color: 'var(--text)',
              padding: 16,
              fontSize: 14,
              lineHeight: 1.72,
              fontFamily: 'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
            }}
          />
        </section>
      </section>
    </div>
  );
}
