#!/usr/bin/env python3
"""
兼容包装脚本：遗留搜索简报抓取入口。

说明：
- 保留该文件以兼容历史调用与旧运维入口
- 实际逻辑已迁移到 fetch_search_brief.py
- 新实现会统一生成 search_brief 文件，并同步回写 legacy brief 文件
"""

from fetch_search_brief import main


if __name__ == '__main__':
    main()
