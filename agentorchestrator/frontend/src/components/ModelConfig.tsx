import { useEffect, useMemo, useState } from 'react';
import { useStore, deptMeta } from '../store';
import { api } from '../api';
import { pickLocaleText } from '../i18n';

const FALLBACK_MODELS = [
  { id: 'anthropic/claude-sonnet-4-6', l: 'Claude Sonnet 4.6', p: 'Anthropic' },
  { id: 'anthropic/claude-opus-4-5', l: 'Claude Opus 4.5', p: 'Anthropic' },
  { id: 'anthropic/claude-haiku-3-5', l: 'Claude Haiku 3.5', p: 'Anthropic' },
  { id: 'openai/gpt-4o', l: 'GPT-4o', p: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', l: 'GPT-4o Mini', p: 'OpenAI' },
  { id: 'google/gemini-2.5-pro', l: 'Gemini 2.5 Pro', p: 'Google' },
  { id: 'copilot/claude-sonnet-4', l: 'Claude Sonnet 4', p: 'Copilot' },
  { id: 'copilot/claude-opus-4.5', l: 'Claude Opus 4.5', p: 'Copilot' },
  { id: 'copilot/gpt-4o', l: 'GPT-4o', p: 'Copilot' },
  { id: 'copilot/gemini-2.5-pro', l: 'Gemini 2.5 Pro', p: 'Copilot' },
];


export default function ModelConfig({ embedded = false }: { embedded?: boolean }) {
  const locale = useStore((s) => s.locale);
  const agentConfig = useStore((s) => s.agentConfig);
  const changeLog = useStore((s) => s.changeLog);
  const loadAgentConfig = useStore((s) => s.loadAgentConfig);
  const toast = useStore((s) => s.toast);

  const [selMap, setSelMap] = useState<Record<string, string>>({});
  const [statusMap, setStatusMap] = useState<Record<string, { cls: string; text: string }>>({});
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    loadAgentConfig();
  }, [loadAgentConfig]);

  useEffect(() => {
    if (agentConfig?.agents) {
      const m: Record<string, string> = {};
      agentConfig.agents.forEach((ag) => {
        m[ag.id] = ag.model;
      });
      setSelMap(m);
    }
  }, [agentConfig]);

  const models = useMemo(() => (
    agentConfig?.knownModels?.length
      ? agentConfig.knownModels.map((m) => ({ id: m.id, l: m.label, p: m.provider }))
      : FALLBACK_MODELS
  ), [agentConfig?.knownModels]);

  if (!agentConfig?.agents) {
    return (
      <div className="empty" style={{ gridColumn: '1/-1' }}>
        {pickLocaleText(locale, '⚠️ 当前暂时无法加载回复偏好设置', '⚠️ Response preference settings are temporarily unavailable')}
      </div>
    );
  }

  const handleSelect = (agentId: string, val: string) => {
    setSelMap((p) => ({ ...p, [agentId]: val }));
  };

  const resetMC = (agentId: string) => {
    const ag = agentConfig.agents.find((a) => a.id === agentId);
    if (ag) setSelMap((p) => ({ ...p, [agentId]: ag.model }));
  };

  const applyModel = async (agentId: string) => {
    const model = selMap[agentId];
    if (!model) return;
    setStatusMap((p) => ({
      ...p,
      [agentId]: {
        cls: 'pending',
        text: pickLocaleText(locale, '⟳ 保存中…', '⟳ Saving...'),
      },
    }));
    try {
      const r = await api.setModel(agentId, model);
      if (r.ok) {
        setStatusMap((p) => ({
          ...p,
          [agentId]: {
            cls: 'ok',
            text: pickLocaleText(locale, '✅ 已保存，新的回复偏好将在几秒内生效', '✅ Saved. The new response preference will take effect in a few seconds'),
          },
        }));
        toast(pickLocaleText(locale, '回复偏好已更新', 'Response preference updated'), 'ok');
        setTimeout(() => loadAgentConfig(), 5500);
      } else {
        setStatusMap((p) => ({
          ...p,
          [agentId]: {
            cls: 'err',
            text: `❌ ${r.error || pickLocaleText(locale, '错误', 'Error')}`,
          },
        }));
      }
    } catch {
      setStatusMap((p) => ({
        ...p,
        [agentId]: {
          cls: 'err',
            text: pickLocaleText(locale, '❌ 当前无法保存，请稍后再试', '❌ Unable to save right now, please try again later'),
        },
      }));
    }
  };

  return (
    <section
      style={{
        border: '1px solid rgba(123, 224, 255, 0.16)',
        borderRadius: 18,
        background: 'linear-gradient(180deg, rgba(12,18,33,.92), rgba(8,12,24,.92))',
        boxShadow: '0 18px 36px rgba(0, 0, 0, .18)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          padding: '18px 20px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: '#7be0ff', fontWeight: 700, letterSpacing: '.06em', marginBottom: 6 }}>
            {pickLocaleText(locale, embedded ? '模型设置' : 'Agent 调基', embedded ? 'Model Settings' : 'Agent Model Tuning')}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
            {pickLocaleText(locale, '按正式角色查看并调整各 Agent 方案', 'Review and tune each agent by its formal role')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, maxWidth: 760 }}>
            {pickLocaleText(locale, '这里把每位 Agent 的回复偏好与最近设置记录并入 Agent 调整窗口，方便在同一处完成沟通与配置；日常指令仍以总控中心为主。', 'This section folds each Agent’s response preference and recent change log into the Agent update window, so communication and configuration can happen in one place while everyday requests still go through the Control Center.')}
          </div>
        </div>
        <span style={{ fontSize: 12, color: '#7be0ff', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {panelOpen ? pickLocaleText(locale, '收起 ▲', 'Collapse ▲') : pickLocaleText(locale, '展开 ▼', 'Expand ▼')}
        </span>
      </button>

      {panelOpen && (
        <div style={{ padding: '0 20px 20px' }}>
          <div className="model-grid">
            {agentConfig.agents.map((ag) => {
              const sel = selMap[ag.id] || ag.model;
              const changed = sel !== ag.model;
              const st = statusMap[ag.id];
              const meta = deptMeta(ag.id, locale);
              return (
                <div className="mc-card" key={ag.id}>
                  <div className="mc-top">
                    <span className="mc-emoji">{ag.emoji || '🏛️'}</span>
                    <div>
                      <div className="mc-name">{meta.label || ag.label}</div>
                      <div className="mc-role">{meta.role || ag.role}</div>
                    </div>
                  </div>
                  <div className="mc-cur">
                    {pickLocaleText(locale, '当前方案', 'Current option')}: <b>{ag.model}</b>
                  </div>
                  <select className="msel" value={sel} onChange={(e) => handleSelect(ag.id, e.target.value)}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.l} ({m.p})
                      </option>
                    ))}
                  </select>
                  <div className="mc-btns">
                    <button className="btn btn-p" disabled={!changed} onClick={() => applyModel(ag.id)}>
                      {pickLocaleText(locale, '保存', 'Save')}
                    </button>
                    <button className="btn btn-g" onClick={() => resetMC(ag.id)}>
                      {pickLocaleText(locale, '重置', 'Reset')}
                    </button>
                  </div>
                  {st && <div className={`mc-st ${st.cls}`}>{st.text}</div>}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 24 }}>
            <div className="sec-title">{pickLocaleText(locale, '最近设置记录', 'Recent Updates')}</div>
            <div className="cl-list">
              {!changeLog?.length ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
                  {pickLocaleText(locale, '暂无记录', 'No updates yet')}
                </div>
              ) : (
                [...changeLog]
                  .reverse()
                  .slice(0, 15)
                  .map((e, i) => (
                    <div className="cl-row" key={i}>
                      <span className="cl-t">{(e.at || '').substring(0, 16).replace('T', ' ')}</span>
                      <span className="cl-a">{e.agentId}</span>
                      <span className="cl-c">
                        <b>{e.oldModel}</b> → <b>{e.newModel}</b>
                        {e.rolledBack && (
                          <span
                            style={{
                              color: 'var(--danger)',
                              fontSize: 10,
                              border: '1px solid #ff527044',
                              padding: '1px 5px',
                              borderRadius: 3,
                              marginLeft: 4,
                            }}
                          >
                            {pickLocaleText(locale, '⚠ 已恢复为原方案', '⚠ Restored to previous option')}
                          </span>
                        )}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
