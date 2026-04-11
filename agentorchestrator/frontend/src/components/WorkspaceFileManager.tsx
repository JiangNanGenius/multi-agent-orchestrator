import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type WorkspaceFileEntry } from '../api';

type ToastType = 'ok' | 'err';

type QuickPath = {
  label: string;
  path: string;
};

type WorkspaceFileManagerProps = {
  taskId: string;
  taskState?: string;
  workspacePath?: string;
  quickPaths?: QuickPath[];
  toast: (msg: string, type?: ToastType) => void;
};

function dirname(path: string): string {
  const normalized = path.replace(/\\+/g, '/').replace(/\/$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '';
  return normalized.slice(0, idx);
}

function formatSize(size?: number): string {
  if (!size || size <= 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspaceFileManager({ taskId, taskState, workspacePath, quickPaths = [], toast }: WorkspaceFileManagerProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedContent, setSelectedContent] = useState('');
  const [selectedEditable, setSelectedEditable] = useState(false);
  const [selectedReadonly, setSelectedReadonly] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);

  const normalizedQuickPaths = useMemo(
    () => quickPaths.filter((item) => item?.path?.trim()),
    [quickPaths],
  );

  const loadDirectory = useCallback(
    async (path = '') => {
      setLoadingList(true);
      try {
        const result = await api.listWorkspaceFiles(taskId, path);
        setCurrentPath(result?.current_path || path || '');
        setEntries(Array.isArray(result?.entries) ? result.entries : []);
      } catch {
        setEntries([]);
        toast('读取工作区目录失败', 'err');
      } finally {
        setLoadingList(false);
      }
    },
    [taskId, toast],
  );

  const loadFile = useCallback(
    async (path: string) => {
      if (!path) return;
      setLoadingFile(true);
      try {
        const result = await api.readWorkspaceFile(taskId, path);
        setSelectedPath(result?.path || path);
        setSelectedContent(result?.content || '');
        setSelectedEditable(result?.editable !== false && result?.readonly !== true);
        setSelectedReadonly(result?.readonly === true);
      } catch {
        toast('读取工作区文件失败', 'err');
      } finally {
        setLoadingFile(false);
      }
    },
    [taskId, toast],
  );

  useEffect(() => {
    setSelectedPath('');
    setSelectedContent('');
    setSelectedEditable(false);
    setSelectedReadonly(true);
    loadDirectory('');
  }, [taskId, loadDirectory]);

  const openEntry = async (entry: WorkspaceFileEntry) => {
    if (entry.kind === 'directory') {
      await loadDirectory(entry.path || '');
      return;
    }
    await loadFile(entry.path || '');
  };

  const openQuickPath = async (path: string) => {
    const target = path.trim();
    if (!target) return;
    const lower = target.toLowerCase();
    const fileLike = /\.[a-z0-9_-]{1,12}$/i.test(lower);
    if (fileLike) {
      await loadDirectory(dirname(target));
      await loadFile(target);
      return;
    }
    await loadDirectory(target);
  };

  const saveCurrentFile = async () => {
    if (!selectedPath || !selectedEditable || selectedReadonly) return;
    setSaving(true);
    try {
      const result = await api.saveWorkspaceFile(taskId, selectedPath, selectedContent);
      setSelectedContent(result?.content || selectedContent);
      toast(result?.message || '文件已保存', 'ok');
      await loadDirectory(dirname(selectedPath));
    } catch {
      toast('保存工作区文件失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  const downloadCurrentFile = () => {
    if (!selectedPath) return;
    window.open(api.workspaceFileDownloadUrl(taskId, selectedPath), '_blank', 'noopener,noreferrer');
  };

  const copyCurrentPath = async () => {
    if (!selectedPath) return;
    try {
      await navigator.clipboard.writeText(selectedPath);
      toast('已复制文件路径', 'ok');
    } catch {
      toast('复制文件路径失败', 'err');
    }
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', background: 'var(--panel)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>工作区文件面板</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            当前任务状态：{taskState || 'unknown'}；根路径：{workspacePath || '未返回'}
          </div>
        </div>
        <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={() => loadDirectory(currentPath)}>
          刷新目录
        </button>
      </div>

      {normalizedQuickPaths.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {normalizedQuickPaths.map((item) => (
            <button
              key={`${item.label}-${item.path}`}
              className="sched-btn"
              style={{ padding: '6px 10px' }}
              onClick={() => openQuickPath(item.path)}
            >
              打开 {item.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)', gap: 12 }}>
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', minHeight: 280 }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 700 }}>
            目录：<code>{currentPath || '/'}</code>
          </div>
          <div style={{ padding: 10, display: 'grid', gap: 8, maxHeight: 420, overflow: 'auto' }}>
            {currentPath && (
              <button className="sched-btn" style={{ padding: '6px 10px', justifySelf: 'start' }} onClick={() => loadDirectory(dirname(currentPath))}>
                返回上级
              </button>
            )}
            {loadingList && <div style={{ fontSize: 12, color: 'var(--muted)' }}>目录读取中…</div>}
            {!loadingList && entries.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>当前目录为空或暂不可访问。</div>}
            {!loadingList && entries.map((entry) => (
              <button
                key={`${entry.kind}-${entry.path}`}
                onClick={() => openEntry(entry)}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  background: selectedPath === entry.path ? 'rgba(124,92,252,0.12)' : 'transparent',
                  color: 'inherit',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 700 }}>{entry.kind === 'directory' ? '📁' : '📄'} {entry.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, wordBreak: 'break-all' }}>{entry.path}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  大小：{formatSize(entry.size)} · {entry.modified_at || '时间未知'}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', minHeight: 280 }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>文件内容</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, wordBreak: 'break-all' }}>{selectedPath || '尚未选择文件'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={copyCurrentPath} disabled={!selectedPath}>复制路径</button>
              <button className="sched-btn" style={{ padding: '6px 10px' }} onClick={downloadCurrentFile} disabled={!selectedPath}>下载</button>
              <button
                className="sched-btn"
                style={{ padding: '6px 10px' }}
                onClick={saveCurrentFile}
                disabled={!selectedPath || !selectedEditable || selectedReadonly || saving}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
          <div style={{ padding: 10 }}>
            {loadingFile && <div style={{ fontSize: 12, color: 'var(--muted)' }}>文件读取中…</div>}
            {!loadingFile && !selectedPath && <div style={{ fontSize: 12, color: 'var(--muted)' }}>请选择左侧文件后查看内容。</div>}
            {!loadingFile && selectedPath && (
              <>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                  {selectedReadonly ? '当前文件为只读模式。' : selectedEditable ? '当前文件可直接编辑保存。' : '当前文件暂不支持在线编辑，但可下载后处理。'}
                </div>
                <textarea
                  value={selectedContent}
                  onChange={(e) => setSelectedContent(e.target.value)}
                  readOnly={!selectedEditable || selectedReadonly}
                  style={{
                    width: '100%',
                    minHeight: 340,
                    resize: 'vertical',
                    borderRadius: 12,
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'inherit',
                    padding: 12,
                    fontSize: 12,
                    lineHeight: 1.6,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
