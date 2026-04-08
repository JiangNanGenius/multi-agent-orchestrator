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

const CHANNELS = [
  { id: 'feishu', label: '飞书 Feishu', labelEn: 'Feishu' },
  { id: 'telegram', label: 'Telegram', labelEn: 'Telegram' },
  { id: 'wecom', label: '企业微信 WeCom', labelEn: 'WeCom' },
  { id: 'discord', label: 'Discord', labelEn: 'Discord' },
  { id: 'slack', label: 'Slack', labelEn: 'Slack' },
  { id: 'signal', label: 'Signal', labelEn: 'Signal' },
  { id: 'tui', label: 'TUI (终端)', labelEn: 'TUI (Terminal)' },
];

export default function ModelConfig() {
  const locale = useStore((s) => s.locale);
  const agentConfig = useStore((s) => s.agentConfig);
  const changeLog = useStore((s) => s.changeLog);
  const loadAgentConfig = useStore((s) => s.loadAgentConfig);
  const toast = useStore((s) => s.toast);

  const [selMap, setSelMap] = useState<Record<string, string>>({});
  const [statusMap, setStatusMap] = useState<Record<string, { cls: string; text: string }>>({});
  const [channelSel, setChannelSel] = useState('feishu');
  const [channelStatus, setChannelStatus] = useState('');

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
    if (agentConfig?.dispatchChannel) {
      setChannelSel(agentConfig.dispatchChannel);
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
        {pickLocaleText(locale, '⚠️ 请先启动本地服务器', '⚠️ Please start the local server first')}
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
        text: pickLocaleText(locale, '⟳ 提交中…', '⟳ Submitting...'),
      },
    }));
    try {
      const r = await api.setModel(agentId, model);
      if (r.ok) {
        setStatusMap((p) => ({
          ...p,
          [agentId]: {
            cls: 'ok',
            text: pickLocaleText(locale, '✅ 已提交，Gateway 重启中（约5秒）', '✅ Submitted. Gateway is restarting (about 5 seconds)'),
          },
        }));
        toast(locale === 'en' ? `${agentId} model updated` : `${agentId} 模型已更改`, 'ok');
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
          text: pickLocaleText(locale, '❌ 无法连接服务器', '❌ Unable to reach server'),
        },
      }));
    }
  };

  return (
    <div>
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
                  <div className="mc-name">
                    {meta.label || ag.label}{' '}
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{ag.id}</span>
                  </div>
                  <div className="mc-role">{meta.role || ag.role}</div>
                </div>
              </div>
              <div className="mc-cur">
                {pickLocaleText(locale, '当前', 'Current')}: <b>{ag.model}</b>
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
                  {pickLocaleText(locale, '应用', 'Apply')}
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

      <div style={{ marginTop: 24, marginBottom: 8 }}>
        <div className="sec-title">{pickLocaleText(locale, '派发渠道', 'Dispatch Channel')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
          <select
            className="msel"
            value={channelSel}
            onChange={(e) => setChannelSel(e.target.value)}
            style={{ maxWidth: 220 }}
          >
            {CHANNELS.map((ch) => (
              <option key={ch.id} value={ch.id}>{locale === 'en' ? ch.labelEn : ch.label}</option>
            ))}
          </select>
          <button
            className="btn btn-p"
            disabled={channelSel === (agentConfig?.dispatchChannel || 'feishu')}
            onClick={async () => {
              try {
                const r = await api.setDispatchChannel(channelSel);
                if (r.ok) {
                  setChannelStatus(pickLocaleText(locale, '✅ 已保存', '✅ Saved'));
                  toast(pickLocaleText(locale, '派发渠道已切换', 'Dispatch channel switched'), 'ok');
                  loadAgentConfig();
                } else {
                  setChannelStatus(`❌ ${r.error || pickLocaleText(locale, '失败', 'Failed')}`);
                }
              } catch {
                setChannelStatus(pickLocaleText(locale, '❌ 无法连接', '❌ Unable to connect'));
              }
              setTimeout(() => setChannelStatus(''), 3000);
            }}
          >
            {pickLocaleText(locale, '应用', 'Apply')}
          </button>
          {channelStatus && (
            <span style={{ fontSize: 12, color: channelStatus.startsWith('✅') ? 'var(--success)' : 'var(--danger)' }}>
              {channelStatus}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {pickLocaleText(locale, '自动派发时使用的通知渠道（需在本地通知配置中启用对应 channel）', 'Notification channel used for automatic dispatching. The corresponding channel must be enabled in local notification settings.')}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="sec-title">{pickLocaleText(locale, '变更日志', 'Change Log')}</div>
        <div className="cl-list">
          {!changeLog?.length ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
              {pickLocaleText(locale, '暂无变更', 'No changes yet')}
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
                        {pickLocaleText(locale, '⚠ 已回滚', '⚠ Rolled Back')}
                      </span>
                    )}
                  </span>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
