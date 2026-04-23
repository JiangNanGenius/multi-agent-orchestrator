import { useEffect, useMemo, useState } from 'react';
import { Bot, LoaderCircle, RefreshCcw, X } from 'lucide-react';

import { api, type AgentRuntimeLogsResult } from '../api';
import { pickLocaleText } from '../i18n';

type Props = {
  open: boolean;
  locale: 'zh' | 'en';
  onClose: () => void;
};

const DEFAULT_TARGETS = ['dispatch', 'orchestrator', 'outbox', 'api'];
const DEFAULT_LIMIT = 160;

function formatBytes(bytes: number, locale: 'zh' | 'en'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return locale === 'en' ? '0 KB' : '0 KB';
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AgentLogModal({ open, locale, onClose }: Props) {
  const [target, setTarget] = useState('dispatch');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AgentRuntimeLogsResult | null>(null);

  const targets = useMemo(() => {
    const source = result?.targets?.length ? result.targets : DEFAULT_TARGETS;
    return Array.from(new Set(source));
  }, [result]);

  async function loadLogs(nextTarget = target) {
    setLoading(true);
    setError('');
    try {
      const data = await api.agentRuntimeLogs(nextTarget, DEFAULT_LIMIT);
      setResult(data);
      setTarget(data.target || nextTarget);
    } catch (err) {
      setError(err instanceof Error ? err.message : pickLocaleText(locale, '日志读取失败，请稍后重试。', 'Failed to load diagnostic logs.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadLogs(target);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal agent-log-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={pickLocaleText(locale, 'Agent 排错日志', 'Agent Diagnostic Logs')}
      >
        <button className="modal-close" onClick={onClose} aria-label={pickLocaleText(locale, '关闭日志窗口', 'Close log window')}>
          <X size={16} />
        </button>

        <div className="agent-log-modal__header">
          <div className="agent-log-modal__badge" aria-hidden="true"><Bot size={16} /></div>
          <div className="agent-log-modal__copy">
            <div className="modal-id">{pickLocaleText(locale, 'Agent 排错日志', 'Agent Diagnostic Logs')}</div>
            <div className="modal-desc">
              {pickLocaleText(
                locale,
                '面向 Agent 自主排错的最近滚动日志。每个进程都有独立日志文件，并按大小上限自动轮转保留。',
                'Recent rolling logs for Agent self-debugging. Each process keeps its own capped log file with automatic rotation.'
              )}
            </div>
          </div>
        </div>

        <div className="agent-log-modal__controls">
          <label className="agent-log-modal__field">
            <span>{pickLocaleText(locale, '目标进程', 'Target')}</span>
            <select
              className="agent-log-modal__select"
              value={target}
              onChange={(event) => {
                const nextTarget = event.target.value;
                setTarget(nextTarget);
                void loadLogs(nextTarget);
              }}
            >
              {targets.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="btn btn-secondary agent-log-modal__refresh"
            onClick={() => void loadLogs(target)}
            disabled={loading}
          >
            {loading ? <LoaderCircle size={14} className="toast__spin" /> : <RefreshCcw size={14} />}
            <span>{pickLocaleText(locale, '刷新日志', 'Refresh')}</span>
          </button>
        </div>

        <div className="agent-log-modal__meta">
          <span>{pickLocaleText(locale, '保留行数', 'Lines')}: {result?.limit || DEFAULT_LIMIT}</span>
          <span>{pickLocaleText(locale, '单文件上限', 'Per-file cap')}: {formatBytes(result?.meta?.max_bytes || 0, locale)}</span>
          <span>{pickLocaleText(locale, '轮转备份', 'Backups')}: {result?.meta?.backup_count ?? 0}</span>
          <span>{pickLocaleText(locale, '当前大小', 'Current size')}: {formatBytes(result?.meta?.size_bytes || 0, locale)}</span>
        </div>

        {error ? <div className="agent-log-modal__error">{error}</div> : null}

        <div className="agent-log-modal__viewer" role="log" aria-live="polite">
          <pre>
            {result?.log?.trim()
              ? result.log
              : loading
                ? pickLocaleText(locale, '日志加载中…', 'Loading logs…')
                : pickLocaleText(locale, '当前还没有可显示的排错日志。', 'No diagnostic logs available yet.')}
          </pre>
        </div>
      </div>
    </div>
  );
}
