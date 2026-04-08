import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { SubConfig, SearchResultItem } from '../api';
import { pickLocaleText, formatCount, type Locale } from '../i18n';

const CAT_META: Record<string, { icon: string; color: string; descZh: string; descEn: string }> = {
  政治: { icon: '🏛️', color: '#6a9eff', descZh: '全球政治动态', descEn: 'Global political developments' },
  军事: { icon: '⚔️', color: '#ff5270', descZh: '军事与冲突', descEn: 'Military and conflict updates' },
  经济: { icon: '💹', color: '#2ecc8a', descZh: '经济与市场', descEn: 'Economy and markets' },
  AI大模型: { icon: '🤖', color: '#a07aff', descZh: 'AI与大模型进展', descEn: 'AI and foundation model updates' },
};

const DEFAULT_CATS = ['政治', '军事', '经济', 'AI大模型'];

function getCategoryLabel(locale: Locale, cat: string) {
  const labels: Record<string, string> = {
    政治: 'Politics',
    军事: 'Military',
    经济: 'Economy',
    AI大模型: 'AI Models',
  };
  return locale === 'en' ? labels[cat] || cat : cat;
}

function formatBriefDate(locale: Locale, raw?: string) {
  if (!raw) return '';
  if (locale === 'en') {
    return raw.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  }
  return raw.replace(/(\d{4})(\d{2})(\d{2})/, '$1年$2月$3日');
}

export default function WebSearchPanel() {
  const locale = useStore((s) => s.locale);
  const searchBrief = useStore((s) => s.searchBrief);
  const subConfig = useStore((s) => s.subConfig);
  const loadWebSearch = useStore((s) => s.loadWebSearch);
  const loadSubConfig = useStore((s) => s.loadSubConfig);
  const toast = useStore((s) => s.toast);

  const [showConfig, setShowConfig] = useState(false);
  const [localConfig, setLocalConfig] = useState<SubConfig | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLabel, setRefreshLabel] = useState(pickLocaleText(locale, '⟳ 立即抓取', '⟳ Fetch Now'));
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadWebSearch();
  }, [loadWebSearch]);

  useEffect(() => {
    if (subConfig) setLocalConfig(JSON.parse(JSON.stringify(subConfig)));
  }, [subConfig]);

  useEffect(() => {
    setRefreshLabel(refreshing ? pickLocaleText(locale, '⟳ 抓取中…', '⟳ Fetching...') : pickLocaleText(locale, '⟳ 立即抓取', '⟳ Fetch Now'));
  }, [locale, refreshing]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const refreshSearchResults = async () => {
    setRefreshing(true);
    setRefreshLabel(pickLocaleText(locale, '⟳ 抓取中…', '⟳ Fetching...'));
    let lastDate: string | null = null;
    try {
      lastDate = searchBrief?.generated_at || null;
    } catch {
      /* ignore */
    }

    try {
      await api.refreshSearch();
      toast(pickLocaleText(locale, '搜索采集已触发，系统正在自动检测更新…', 'Search collection has been triggered. The system is checking for updates automatically...'), 'ok');
      let count = 0;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        count++;
        if (count > 24) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRefreshing(false);
          setRefreshLabel(pickLocaleText(locale, '⟳ 立即抓取', '⟳ Fetch Now'));
          toast(pickLocaleText(locale, '抓取超时，请重试', 'Fetch timed out. Please try again'), 'err');
          return;
        }
        try {
          const fresh = await api.searchBrief();
          if (fresh.generated_at && fresh.generated_at !== lastDate) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setRefreshing(false);
            setRefreshLabel(pickLocaleText(locale, '⟳ 立即抓取', '⟳ Fetch Now'));
            loadWebSearch();
            toast(pickLocaleText(locale, '✅ 全网搜索结果已更新', '✅ Web search results have been updated'), 'ok');
          } else {
            setRefreshLabel(locale === 'en' ? `⟳ Fetching... (${count * 5}s)` : `⟳ 抓取中… (${count * 5}s)`);
          }
        } catch {
          /* ignore */
        }
      }, 5000);
    } catch {
      toast(pickLocaleText(locale, '触发搜索抓取失败', 'Failed to trigger web search collection'), 'err');
      setRefreshing(false);
      setRefreshLabel(pickLocaleText(locale, '⟳ 立即抓取', '⟳ Fetch Now'));
    }
  };

  const toggleCat = (name: string) => {
    if (!localConfig) return;
    const cats = [...(localConfig.categories || [])];
    const existing = cats.find((c) => c.name === name);
    if (existing) existing.enabled = !existing.enabled;
    else cats.push({ name, enabled: true });
    setLocalConfig({ ...localConfig, categories: cats });
  };

  const addKeyword = (kw: string) => {
    if (!localConfig || !kw) return;
    const kws = [...(localConfig.keywords || [])];
    if (!kws.includes(kw)) kws.push(kw);
    setLocalConfig({ ...localConfig, keywords: kws });
  };

  const removeKeyword = (i: number) => {
    if (!localConfig) return;
    const kws = [...(localConfig.keywords || [])];
    kws.splice(i, 1);
    setLocalConfig({ ...localConfig, keywords: kws });
  };

  const addFeed = (name: string, url: string, category: string) => {
    if (!localConfig || !name || !url) {
      toast(pickLocaleText(locale, '请填写源名称和URL', 'Please fill in the source name and URL'), 'err');
      return;
    }
    const feeds = [...(localConfig.custom_feeds || [])];
    feeds.push({ name, url, category });
    setLocalConfig({ ...localConfig, custom_feeds: feeds });
  };

  const removeFeed = (i: number) => {
    if (!localConfig) return;
    const feeds = [...(localConfig.custom_feeds || [])];
    feeds.splice(i, 1);
    setLocalConfig({ ...localConfig, custom_feeds: feeds });
  };

  const saveConfig = async () => {
    if (!localConfig) return;
    try {
      const r = await api.saveSearchConfig(localConfig);
      if (r.ok) {
        toast(pickLocaleText(locale, '搜索配置已保存', 'Search configuration saved'), 'ok');
        loadSubConfig();
      } else {
        toast(r.error || pickLocaleText(locale, '保存失败', 'Failed to save configuration'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
  };

  const enabledSet = localConfig
    ? new Set((localConfig.categories || []).filter((c) => c.enabled).map((c) => c.name))
    : new Set(DEFAULT_CATS);
  const userKws = (localConfig?.keywords || []).map((k) => k.toLowerCase());

  const cats = searchBrief?.categories || {};
  const dateStr = formatBriefDate(locale, searchBrief?.date);
  const totalNews = Object.values(cats).flat().length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{pickLocaleText(locale, '🌐 全网搜索', '🌐 Web Search')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {dateStr && `${dateStr} | `}
            {searchBrief?.generated_at && `${pickLocaleText(locale, '抓取于', 'Fetched at')} ${searchBrief.generated_at} | `}
            {pickLocaleText(locale, `共 ${totalNews} 条搜索结果`, formatCount(locale, totalNews, 'search result(s)', 'search result(s)'))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-g"
            onClick={() => setShowConfig(!showConfig)}
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            {pickLocaleText(locale, '⚙ 搜索配置', '⚙ Search Config')}
          </button>
          <button
            className="tpl-go"
            disabled={refreshing}
            onClick={refreshSearchResults}
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            {refreshLabel}
          </button>
        </div>
      </div>

      {showConfig && localConfig && (
        <SubConfigPanel
          locale={locale}
          config={localConfig}
          enabledSet={enabledSet}
          onToggleCat={toggleCat}
          onAddKeyword={addKeyword}
          onRemoveKeyword={removeKeyword}
          onAddFeed={addFeed}
          onRemoveFeed={removeFeed}
          onSave={saveConfig}
          onSetWebhook={(v) => setLocalConfig({ ...localConfig, feishu_webhook: v })}
        />
      )}

      {!Object.keys(cats).length ? (
        <div className="mb-empty">{pickLocaleText(locale, '暂无数据，点击右上角「立即抓取」获取最新全网搜索结果', 'No data yet. Click “Fetch Now” in the top-right corner to retrieve the latest web search results')}</div>
      ) : (
        <div className="mb-cats">
          {Object.entries(cats).map(([cat, items]) => {
            if (!enabledSet.has(cat)) return null;
            const meta = CAT_META[cat] || { icon: '📰', color: 'var(--acc)', descZh: cat, descEn: cat };
            const scored = (items as SearchResultItem[])
              .map((item) => {
                const text = ((item.title || '') + (item.summary || '')).toLowerCase();
                const kwHits = userKws.filter((k) => text.includes(k)).length;
                return { ...item, _kwHits: kwHits };
              })
              .sort((a, b) => b._kwHits - a._kwHits);

            return (
              <div className="mb-cat" key={cat}>
                <div className="mb-cat-hdr">
                  <span className="mb-cat-icon">{meta.icon}</span>
                  <span className="mb-cat-name" style={{ color: meta.color }}>{getCategoryLabel(locale, cat)}</span>
                  <span className="mb-cat-cnt">{formatCount(locale, scored.length, '条', 'item(s)')}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px 34px' }}>
                  {locale === 'en' ? meta.descEn : meta.descZh}
                </div>
                <div className="mb-news-list">
                  {!scored.length ? (
                    <div className="mb-empty" style={{ padding: 16 }}>{pickLocaleText(locale, '暂无搜索结果', 'No search results')}</div>
                  ) : (
                    scored.map((item, i) => {
                      const hasImg = !!(item.image && item.image.startsWith('http'));
                      return (
                        <div
                          className="mb-card"
                          key={i}
                          onClick={() => window.open(item.link, '_blank')}
                        >
                          <div className="mb-img">
                            {hasImg ? (
                              <img
                                src={item.image}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                                loading="lazy"
                                alt=""
                              />
                            ) : (
                              <span>{meta.icon}</span>
                            )}
                          </div>
                          <div className="mb-info">
                            <div className="mb-headline">
                              {item.title}
                              {item._kwHits > 0 && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    padding: '1px 5px',
                                    borderRadius: 999,
                                    background: '#a07aff22',
                                    color: '#a07aff',
                                    border: '1px solid #a07aff44',
                                    marginLeft: 4,
                                  }}
                                >
                                  {pickLocaleText(locale, '⭐ 关注', '⭐ Focus')}
                                </span>
                              )}
                            </div>
                            <div className="mb-summary">{item.summary || item.desc || ''}</div>
                            <div className="mb-meta">
                              <span className="mb-source">📡 {item.source || ''}</span>
                              {item.pub_date && (
                                <span className="mb-time">{item.pub_date.substring(0, 16)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubConfigPanel({
  locale,
  config,
  enabledSet,
  onToggleCat,
  onAddKeyword,
  onRemoveKeyword,
  onAddFeed,
  onRemoveFeed,
  onSave,
  onSetWebhook,
}: {
  locale: Locale;
  config: SubConfig;
  enabledSet: Set<string>;
  onToggleCat: (name: string) => void;
  onAddKeyword: (kw: string) => void;
  onRemoveKeyword: (i: number) => void;
  onAddFeed: (name: string, url: string, cat: string) => void;
  onRemoveFeed: (i: number) => void;
  onSave: () => void;
  onSetWebhook: (v: string) => void;
}) {
  const [newKw, setNewKw] = useState('');
  const [feedName, setFeedName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [feedCat, setFeedCat] = useState(DEFAULT_CATS[0]);

  const allCats = [...DEFAULT_CATS];
  (config.categories || []).forEach((c) => {
    if (!allCats.includes(c.name)) allCats.push(c.name);
  });

  return (
    <div className="sub-config" style={{ marginBottom: 20, padding: 16, background: 'var(--panel2)', borderRadius: 12, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{pickLocaleText(locale, '⚙ 搜索配置', '⚙ Search Config')}</div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{pickLocaleText(locale, '订阅分类', 'Subscribed Categories')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {allCats.map((cat) => {
            const meta = CAT_META[cat] || { icon: '📰', color: 'var(--acc)', descZh: cat, descEn: cat };
            const on = enabledSet.has(cat);
            return (
              <div
                key={cat}
                className={`sub-cat ${on ? 'active' : ''}`}
                onClick={() => onToggleCat(cat)}
                style={{ cursor: 'pointer', padding: '6px 12px', borderRadius: 8, border: `1px solid ${on ? 'var(--acc)' : 'var(--line)'}`, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span>{meta.icon}</span>
                <span style={{ fontSize: 12 }}>{getCategoryLabel(locale, cat)}</span>
                {on && <span style={{ fontSize: 10, color: 'var(--ok)' }}>✓</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{pickLocaleText(locale, '关注关键词', 'Focus Keywords')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {(config.keywords || []).map((kw, i) => (
            <span key={i} className="sub-kw" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--line)' }}>
              {kw}
              <span style={{ cursor: 'pointer', marginLeft: 4, color: 'var(--danger)' }} onClick={() => onRemoveKeyword(i)}>✕</span>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={newKw}
            onChange={(e) => setNewKw(e.target.value)}
            placeholder={pickLocaleText(locale, '输入关键词', 'Enter keyword')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onAddKeyword(newKw.trim());
                setNewKw('');
              }
            }}
            style={{ flex: 1, padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none' }}
          />
          <button className="btn btn-g" onClick={() => { onAddKeyword(newKw.trim()); setNewKw(''); }} style={{ fontSize: 11, padding: '4px 12px' }}>
            {pickLocaleText(locale, '添加', 'Add')}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{pickLocaleText(locale, '自定义信息源', 'Custom Sources')}</div>
        {(config.custom_feeds || []).map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, fontSize: 11 }}>
            <span style={{ fontWeight: 600 }}>{f.name}</span>
            <span style={{ color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.url}</span>
            <span style={{ color: 'var(--acc)' }}>{getCategoryLabel(locale, f.category)}</span>
            <span style={{ cursor: 'pointer', color: 'var(--danger)' }} onClick={() => onRemoveFeed(i)}>✕</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            placeholder={pickLocaleText(locale, '源名称', 'Source Name')}
            value={feedName}
            onChange={(e) => setFeedName(e.target.value)}
            style={{ width: 100, padding: '6px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', fontSize: 11, outline: 'none' }}
          />
          <input
            placeholder={pickLocaleText(locale, 'RSS / 链接', 'RSS / URL')}
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            style={{ flex: 1, padding: '6px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', fontSize: 11, outline: 'none' }}
          />
          <select
            value={feedCat}
            onChange={(e) => setFeedCat(e.target.value)}
            style={{ padding: '6px 8px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', fontSize: 11, outline: 'none' }}
          >
            {allCats.map((c) => <option key={c} value={c}>{getCategoryLabel(locale, c)}</option>)}
          </select>
          <button className="btn btn-g" onClick={() => { onAddFeed(feedName, feedUrl, feedCat); setFeedName(''); setFeedUrl(''); }} style={{ fontSize: 11, padding: '4px 12px' }}>
            {pickLocaleText(locale, '添加', 'Add')}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{pickLocaleText(locale, '飞书 Webhook', 'Feishu Webhook')}</div>
        <input
          type="text"
          value={config.feishu_webhook || ''}
          onChange={(e) => onSetWebhook(e.target.value)}
          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
          style={{ width: '100%', padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="tpl-go" onClick={onSave} style={{ fontSize: 12, padding: '6px 16px' }}>
          {pickLocaleText(locale, '💾 保存配置', '💾 Save Config')}
        </button>
      </div>
    </div>
  );
}
