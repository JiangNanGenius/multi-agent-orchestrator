#!/usr/bin/env python3
"""
全网搜索简报采集脚本
每日定时运行，抓取全球新闻 RSS → data/search_brief_YYYYMMDD.json
覆盖: 政治 | 军事 | 经济 | AI大模型

说明：
- 统一读取与写入 search_brief 正式配置和数据文件
- 不再维护历史兼容命名入口，所有链路仅保留全网搜索简报口径

"""

import json
import pathlib
import datetime
import re
import logging
from xml.etree import ElementTree as ET

from file_lock import atomic_json_write
from utils import validate_url

log = logging.getLogger('搜索简报')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s', datefmt='%H:%M:%S')

DATA = pathlib.Path(__file__).resolve().parent.parent / 'data'

# ── RSS 源配置 ──────────────────────────────────────────────────────────
FEEDS = {
    '政治': [
        ('BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
        ('Reuters World', 'https://feeds.reuters.com/reuters/worldNews'),
        ('AP Top News', 'https://rsshub.app/apnews/topics/ap-top-news'),
    ],
    '军事': [
        ('Defense News', 'https://www.defensenews.com/rss/'),
        ('BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
        ('Reuters', 'https://feeds.reuters.com/reuters/worldNews'),
    ],
    '经济': [
        ('Reuters Business', 'https://feeds.reuters.com/reuters/businessNews'),
        ('BBC Business', 'https://feeds.bbci.co.uk/news/business/rss.xml'),
        ('CNBC', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114'),
    ],
    'AI大模型': [
        ('Hacker News', 'https://hnrss.org/newest?q=AI+LLM+model&points=50'),
        ('VentureBeat AI', 'https://venturebeat.com/category/ai/feed/'),
        ('MIT Tech Review', 'https://www.technologyreview.com/feed/'),
    ],
}

CATEGORY_KEYWORDS = {
    '军事': ['war', 'military', 'troops', 'attack', 'missile', 'army', 'navy', 'weapons',
             '战', '军', '导弹', '士兵', 'ukraine', 'russia', 'china sea', 'nato'],
    'AI大模型': ['ai', 'llm', 'gpt', 'claude', 'gemini', 'openai', 'anthropic', 'deepseek',
               'machine learning', 'neural', 'model', '大模型', '人工智能', 'chatgpt'],
}


def curl_rss(url, timeout=10):
    """用 urllib 抓取 RSS。"""
    try:
        from urllib.request import Request, urlopen
        req = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; SearchBrief/1.0)'})
        response = urlopen(req, timeout=timeout)
        return response.read().decode('utf-8', errors='ignore')
    except Exception:
        return ''



def _safe_parse_xml(xml_text, max_size=5 * 1024 * 1024):
    """安全解析 XML：限制大小，禁用外部实体（防 XXE）。"""
    if len(xml_text) > max_size:
        log.warning(f'XML 内容过大 ({len(xml_text)} bytes)，跳过')
        return None
    cleaned = re.sub(r'<!DOCTYPE[^>]*>', '', xml_text, flags=re.IGNORECASE)
    cleaned = re.sub(r'<!ENTITY[^>]*>', '', cleaned, flags=re.IGNORECASE)
    try:
        return ET.fromstring(cleaned)
    except ET.ParseError:
        return None



def parse_rss(xml_text):
    """解析 RSS XML → list of {title, desc, link, pub_date, image}"""
    items = []
    try:
        root = _safe_parse_xml(xml_text)
        if root is None:
            return items
        ns = {'media': 'http://search.yahoo.com/mrss/'}
        for item in root.findall('.//item')[:8]:
            def get(tag):
                el = item.find(tag)
                return (el.text or '').strip() if el is not None else ''

            title = get('title')
            desc = re.sub(r'<[^>]+>', '', get('description'))[:200]
            link = get('link')
            pub = get('pubDate')
            img = ''
            enc = item.find('enclosure')
            if enc is not None and 'image' in (enc.get('type') or ''):
                img = enc.get('url', '')
            media = item.find('media:thumbnail', ns) or item.find('media:content', ns)
            if media is not None:
                img = media.get('url', img)
            items.append({
                'title': title,
                'desc': desc,
                'link': link,
                'pub_date': pub,
                'image': img,
            })
    except Exception:
        pass
    return items



def match_category(item, category):
    """判断条目是否属于该分类（用于军事/AI过滤）。"""
    kws = CATEGORY_KEYWORDS.get(category, [])
    if not kws:
        return True
    text = (item['title'] + ' ' + item['desc']).lower()
    return any(k in text for k in kws)



def fetch_category(category, feeds, max_items=5):
    """抓取一个分类的搜索简报条目。"""
    seen_urls = set()
    results = []
    for source_name, url in feeds:
        if len(results) >= max_items:
            break
        xml = curl_rss(url)
        if not xml:
            continue
        items = parse_rss(xml)
        for item in items:
            if not item['title']:
                continue
            if item['link'] in seen_urls:
                continue
            if category in CATEGORY_KEYWORDS and not match_category(item, category):
                continue
            seen_urls.add(item['link'])
            results.append({
                'title': item['title'],
                'summary': item['desc'] or item['title'],
                'link': item['link'],
                'pub_date': item['pub_date'],
                'image': item['image'],
                'source': source_name,
            })
            if len(results) >= max_items:
                break
    return results



def load_config():
    """优先读取新的 search 配置，旧版兼容配置仅作为回退。"""
    search_cfg = DATA / 'search_brief_config.json'
    legacy_cfg = DATA / SEARCH_BRIEF_COMPAT_FILES['config']
    for path in (search_cfg, legacy_cfg):
        if path.exists():
            try:
                return json.loads(path.read_text())
            except Exception:
                continue
    return {}



def write_outputs(today, result):
    """写入新的 search 文件，并同步回写遗留 brief 文件以平滑迁移。"""
    today_search_file = DATA / f'search_brief_{today}.json'
    latest_search_file = DATA / 'search_brief.json'
    atomic_json_write(today_search_file, result)
    atomic_json_write(latest_search_file, result)

    atomic_json_write(legacy_search_brief_file(today), result)
    atomic_json_write(legacy_search_brief_file(), result)



def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='强制采集，忽略幂等锁')
    args = parser.parse_args()

    today = datetime.date.today().strftime('%Y%m%d')
    lock_file = DATA / f'search_brief_{today}.lock'
    legacy_lock_file = legacy_search_lock_file(today)
    if lock_file.exists() and not args.force:
        age = datetime.datetime.now().timestamp() - lock_file.stat().st_mtime
        if age < 3600:
            log.info(f'今日已采集（{today}），跳过（使用 --force 强制采集）')
            return

    config = load_config()

    enabled_cats = set()
    if config.get('categories'):
        for c in config['categories']:
            if c.get('enabled', True):
                enabled_cats.add(c['name'])
    else:
        enabled_cats = set(FEEDS.keys())

    user_keywords = [kw.lower() for kw in config.get('keywords', [])]

    custom_feeds = config.get('custom_feeds', [])
    merged_feeds = {}
    for cat, feeds in FEEDS.items():
        if cat in enabled_cats:
            merged_feeds[cat] = list(feeds)
    for cf in custom_feeds:
        cat = cf.get('category', '')
        feed_url = cf.get('url', '')
        if cat in enabled_cats and feed_url:
            if validate_url(feed_url):
                merged_feeds.setdefault(cat, []).append((cf.get('name', '自定义'), feed_url))
            else:
                log.warning(f'自定义源 URL 不合法，跳过: {feed_url}')

    log.info(f'开始刷新全网搜索简报 {today}...')
    log.info(f'  启用分类: {", ".join(enabled_cats)}')
    if user_keywords:
        log.info(f'  关注词: {", ".join(user_keywords)}')
    if custom_feeds:
        log.info(f'  自定义源: {len(custom_feeds)} 个')

    result = {
        'date': today,
        'generated_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'categories': {},
    }

    for category, feeds in merged_feeds.items():
        log.info(f'  抓取 {category}...')
        items = fetch_category(category, feeds)
        if user_keywords:
            for item in items:
                text = (item.get('title', '') + ' ' + item.get('summary', '')).lower()
                item['_kw_hits'] = sum(1 for kw in user_keywords if kw in text)
            items.sort(key=lambda x: x.get('_kw_hits', 0), reverse=True)
            for item in items:
                item.pop('_kw_hits', None)
        result['categories'][category] = items
        log.info(f'    {category}: {len(items)} 条')

    write_outputs(today, result)

    total = sum(len(v) for v in result['categories'].values())
    log.info(f'✅ 完成：共 {total} 条结果 → search_brief_{today}.json')

    lock_file.touch()
    legacy_lock_file.touch()


if __name__ == '__main__':
    main()
