#!/usr/bin/env python3
"""Take all dashboard screenshots for the README using Playwright."""
from playwright.sync_api import sync_playwright
import time, os

SHOTS = os.path.join(os.path.dirname(__file__), '..', 'docs', 'screenshots')
URL = 'http://localhost:7891'

def main():
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            device_scale_factor=2,
            color_scheme='dark',
        )
        page = ctx.new_page()

        # ── 预设启动过渡状态，避免每次加载都重复展示
        page.goto(URL)
        page.evaluate("localStorage.setItem('openclaw_startup_transition_date', new Date().toISOString().substring(0,10))")
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        # 1. Kanban main (default tab = tasks)
        print('📋 01 kanban...')
        page.screenshot(path=os.path.join(SHOTS, '01-kanban-main.png'), full_page=False)

        # 2. Monitor (运行调度)
        print('🔭 02 monitor...')
        page.click('[data-tab="monitor"]')
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(SHOTS, '02-monitor.png'), full_page=False)

        # 3. Task detail - click first task card
        print('📜 03 task detail...')
        page.click('[data-tab="tasks"]')
        page.wait_for_timeout(500)
        cards = page.locator('.edict-card')
        if cards.count() > 0:
            cards.first.click()
            page.wait_for_timeout(800)
            page.screenshot(path=os.path.join(SHOTS, '03-task-detail.png'), full_page=False)
            # Close modal
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)

        # 4. Model config
        print('⚙️ 04 models...')
        page.click('[data-tab="models"]')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(SHOTS, '04-model-config.png'), full_page=False)

        # 5. Skills config
        print('🛠️ 05 skills...')
        page.click('[data-tab="skills"]')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(SHOTS, '05-skills-config.png'), full_page=False)

        # 6. Agents overview
        print('👥 06 agents overview...')
        page.click('[data-tab="agents"]')
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(SHOTS, '06-agents-overview.png'), full_page=False)

        # 7. Sessions
        print('💬 07 sessions...')
        page.click('[data-tab="sessions"]')
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(SHOTS, '07-sessions.png'), full_page=False)

        # 8. Archives
        print('📜 08 archives...')
        page.click('[data-tab="archives"]')
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(SHOTS, '08-archives.png'), full_page=False)

        # 9. Templates
        print('📜 09 templates...')
        page.click('[data-tab="templates"]')
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(SHOTS, '09-templates.png'), full_page=False)

        # 10. Web search brief
        print('📰 10 web_search...')
        page.click('[data-tab="web_search"]')
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(SHOTS, '10-web-search-brief.png'), full_page=False)

        # 11. Startup transition - clear date then reload
        print('🎬 11 startup transition...')
        page.evaluate("localStorage.removeItem('openclaw_startup_transition_date')")
        page.reload()
        page.wait_for_timeout(2500)
        page.screenshot(path=os.path.join(SHOTS, '11-startup-transition.png'), full_page=False)

        browser.close()
    print('✅ All screenshots saved to', SHOTS)

if __name__ == '__main__':
    main()
