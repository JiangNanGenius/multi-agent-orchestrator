import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { pickLocaleText } from '../i18n';

interface MemoryFileItem {
  path: string;
  name: string;
  label: string;
  kind: string;
  size: number;
  updated_at: string;
}

function todayStamp() { return new Date().toISOString().slice(0, 10); }

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MemoryCenterPanel() {
  const locale = useStore((s) => s.locale);

  const [memoryFiles, setMemoryFiles] = useState<MemoryFileItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [dateFilter, setDateFilter] = useState(todayStamp());

  const loadMemoryList = async () => {
    setLoadingList(true);
    try {
      const res = await api.memoryFiles() as any;
      if (res.ok) setMemoryFiles(res.files || []);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { loadMemoryList(); }, []);

  const longTermFiles = useMemo(() => memoryFiles.filter(f => f.name === 'MEMORY.md'), [memoryFiles]);
  
  const dailyFiles = useMemo(() => {
    if (!dateFilter) return memoryFiles.filter(f => f.name !== 'MEMORY.md');
    return memoryFiles.filter(f => f.name !== 'MEMORY.md' && f.name.includes(dateFilter));
  }, [memoryFiles, dateFilter]);

  // Dates that have memory files (extracted from filenames)
  const activeDates = useMemo(() => {
    const dates = new Set<string>();
    memoryFiles.forEach(f => {
      const m = f.name.match(/^(\d{4}-\d{2}-\d{2})-/);
      if (m) dates.add(m[1]);
    });
    return dates;
  }, [memoryFiles]);

  const openFile = async (file: MemoryFileItem) => {
    setLoadingFile(true);
    setSelectedPath(file.path);
    try {
      const result = await api.memoryFile(file.path) as any;
      setContent(result.ok ? (result.content || '') : '');
    } finally {
      setLoadingFile(false);
    }
  };

  const renderFileButton = (file: MemoryFileItem) => (
    <button
      key={file.path}
      type="button"
      onClick={() => openFile(file)}
      style={{
        textAlign: 'left', padding: 8, borderRadius: 12,
        border: `1px solid ${selectedPath === file.path ? 'rgba(122,162,255,0.42)' : 'rgba(255,255,255,0.08)'}`,
        background: selectedPath === file.path ? 'rgba(122,162,255,0.10)' : 'rgba(255,255,255,0.03)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{file.label} · {formatSize(file.size)}</div>
    </button>
  );

  if (loadingList) return <div className="empty">{pickLocaleText(locale, '加载中…', 'Loading...')}</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 0.3fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <aside style={{ padding: 16, borderRadius: 18, border: '1px solid var(--line)', background: 'var(--panel)', display: 'grid', gap: 12, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            style={{
              width: '100%', borderRadius: 12, border: '1px solid var(--line)',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text)', padding: '8px 10px', fontSize: 12,
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Array.from(activeDates).sort().reverse().slice(0, 7).map(d => (
              <button
                key={d}
                onClick={() => setDateFilter(d)}
                style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 6,
                  border: dateFilter === d ? '1px solid var(--acc)' : '1px solid var(--line)',
                  background: dateFilter === d ? 'var(--acc)18' : 'transparent',
                  color: dateFilter === d ? 'var(--acc)' : 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                {d.slice(5)}
              </button>
            ))}
          </div>
        </div>
        {longTermFiles.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--acc)' }}>{pickLocaleText(locale, '长期记忆', 'Long-Term Memory')}</div>
            {longTermFiles.map(f => renderFileButton(f))}
          </div>
        )}
        {dailyFiles.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{pickLocaleText(locale, '日期记忆', 'Daily Memory')}</div>
            {dailyFiles.map(f => renderFileButton(f))}
          </div>
        )}
        {(longTermFiles.length + dailyFiles.length) === 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
            {pickLocaleText(locale, '该日期无记忆文件', 'No memory files for this date')}
          </div>
        )}
      </aside>
      <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--line)', background: 'var(--panel)', minHeight: 400 }}>
        {selectedPath ? (
          loadingFile ? <div className="empty">{pickLocaleText(locale, '加载中…', 'Loading...')}</div> : (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8, color: 'var(--text)', fontFamily: "'SF Mono','Fira Code',monospace", maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
              {content || pickLocaleText(locale, '（空文件）', '(empty file)')}
            </div>
          )
        ) : (
          <div className="empty">{pickLocaleText(locale, '选择左侧文件查看内容', 'Select a file to view')}</div>
        )}
      </div>
    </div>
  );
}
