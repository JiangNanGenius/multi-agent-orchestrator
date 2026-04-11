#!/usr/bin/env python3
"""Take dashboard screenshots for the public README.

This script targets the current workspace navigation:
- 任务中枢
- 协作会议室
- 实时动态
- 自动化控制台
- Agent 管理工作台
- Skill 管理工作台
- 记忆中心
- 全网搜索

The output filenames intentionally keep the legacy names already referenced by
README/docs so downstream documentation can be updated incrementally.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlparse

import requests
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'docs' / 'screenshots'
URL = os.environ.get('SCREENSHOT_URL', 'http://localhost:7891/index.html')
USERNAME = os.environ.get('SCREENSHOT_USERNAME', 'admin')
PASSWORD = os.environ.get('SCREENSHOT_PASSWORD', 'admin')
NEW_PASSWORD = os.environ.get('SCREENSHOT_NEW_PASSWORD', 'admin1234')
VIEWPORT = {'width': 1920, 'height': 1080}
TIMEOUT_MS = 15000


def wait_idle(page: Page, delay_ms: int = 1200) -> None:
    try:
        page.wait_for_load_state('networkidle', timeout=TIMEOUT_MS)
    except PlaywrightTimeoutError:
        page.wait_for_load_state('domcontentloaded', timeout=TIMEOUT_MS)
    page.wait_for_timeout(delay_ms)


def set_capture_prefs(page: Page, *, show_ceremony: bool) -> None:
    page.evaluate(
        """(showCeremony) => {
            localStorage.setItem('edict_locale', 'zh');
            if (showCeremony) {
                localStorage.removeItem('openclaw_startup_transition_date');
            } else {
                localStorage.setItem(
                    'openclaw_startup_transition_date',
                    new Date().toISOString().substring(0, 10),
                );
            }
        }""",
        show_ceremony,
    )


def dismiss_startup_overlay(page: Page) -> None:
    overlay = page.locator('.startup-overlay')
    try:
        if overlay.first.is_visible(timeout=1200):
            overlay.first.click(position={'x': 30, 'y': 30})
            page.wait_for_timeout(800)
    except Exception:
        return


def api_post(session: requests.Session, path: str, payload: dict) -> dict:
    response = session.post(f"{base_url()}{path}", json=payload, timeout=15)
    response.raise_for_status()
    return response.json()


def base_url() -> str:
    parsed = urlparse(URL)
    return f'{parsed.scheme}://{parsed.netloc}'


def authenticate_via_api() -> tuple[str, str]:
    session = requests.Session()
    last_error = '未尝试登录'

    for candidate in [PASSWORD, NEW_PASSWORD]:
        try:
            login_result = api_post(
                session,
                '/api/auth/login',
                {'username': USERNAME, 'password': candidate},
            )
        except requests.HTTPError as exc:
            body = exc.response.text if exc.response is not None else str(exc)
            last_error = body
            continue

        token = login_result.get('token', '')
        active_password = candidate
        if login_result.get('mustChangePassword'):
            first_change = api_post(
                session,
                '/api/auth/first-change',
                {
                    'currentPassword': candidate,
                    'newPassword': NEW_PASSWORD,
                    'newUsername': USERNAME,
                },
            )
            token = first_change.get('token', token)
            active_password = NEW_PASSWORD

        if token:
            return token, active_password

        last_error = str(login_result)

    raise RuntimeError(f'无法通过 API 完成认证：{last_error}')


def open_workspace(page: Page) -> str:
    page.goto(URL, wait_until='domcontentloaded')
    wait_idle(page, 1500)
    page.locator('.workspace-frame').first.wait_for(timeout=TIMEOUT_MS)
    page.locator('.workspace-content').first.wait_for(timeout=TIMEOUT_MS)

    set_capture_prefs(page, show_ceremony=False)
    page.reload(wait_until='domcontentloaded')
    wait_idle(page, 1800)
    dismiss_startup_overlay(page)
    page.locator('.workspace-frame').first.wait_for(timeout=TIMEOUT_MS)
    return page.title()


def click_nav(page: Page, label: str) -> None:
    nav_button = page.locator('button.workspace-nav__item').filter(has_text=label).first
    nav_button.wait_for(timeout=TIMEOUT_MS)
    nav_button.click()
    wait_idle(page, 900)


def screenshot(page: Page, filename: str) -> None:
    path = SHOTS / filename
    page.screenshot(path=str(path), full_page=False)
    print(f'📸 saved {path.name}')


def capture_task_detail(page: Page) -> None:
    click_nav(page, '任务中枢')
    cards = page.locator('.edict-card')
    if cards.count() == 0:
        print('⚠️ no task card found, skip 03-task-detail.png')
        return
    cards.first.click()
    page.locator('.modal-bg').first.wait_for(timeout=10000)
    page.wait_for_timeout(800)
    screenshot(page, '03-task-detail.png')
    close_button = page.locator('.modal-bg.open .modal-close').first
    if close_button.count() > 0:
        close_button.click()
    else:
        page.keyboard.press('Escape')
    page.locator('.modal-bg.open').first.wait_for(state='hidden', timeout=10000)
    page.wait_for_timeout(500)


def capture_agents_overview_and_model_config(page: Page) -> None:
    click_nav(page, 'Agent 管理工作台')
    page.locator('.workspace-content').evaluate('(node) => node.scrollTo(0, 0)')
    page.wait_for_timeout(600)
    screenshot(page, '06-official-overview.png')

    config_toggle = page.get_by_role('button', name='调整配置')
    if config_toggle.count() > 0:
        config_toggle.first.click()
        page.wait_for_timeout(700)

    embedded_model_toggle = page.get_by_role('button', name=re.compile(r'按正式角色查看并调整各 Agent 方案'))
    if embedded_model_toggle.count() > 0:
        embedded_model_toggle.first.click()
        page.wait_for_timeout(700)
    else:
        expand_hint = page.get_by_text(re.compile(r'展开\s*▼'))
        if expand_hint.count() > 0:
            expand_hint.first.click()
            page.wait_for_timeout(700)

    model_grid = page.locator('.model-grid').first
    if model_grid.count() > 0:
        model_grid.scroll_into_view_if_needed()
        page.wait_for_timeout(700)
        screenshot(page, '04-model-config.png')
    else:
        print('⚠️ model grid not found, fallback to current agents page for 04-model-config.png')
        screenshot(page, '04-model-config.png')


def capture_skills(page: Page) -> None:
    click_nav(page, 'Skill 管理工作台')
    expand_panel = page.get_by_role('button', name='展开面板')
    if expand_panel.count() > 0:
        expand_panel.first.click()
        page.wait_for_timeout(700)
    screenshot(page, '05-skills-config.png')


def capture_sessions(page: Page) -> None:
    click_nav(page, '协作会议室')
    screenshot(page, '07-sessions.png')


def capture_memory(page: Page) -> None:
    click_nav(page, '记忆中心')
    screenshot(page, '08-memorials.png')


def capture_automation(page: Page) -> None:
    click_nav(page, '自动化控制台')
    screenshot(page, '09-templates.png')


def capture_web_search(page: Page) -> None:
    click_nav(page, '全网搜索')
    screenshot(page, '10-morning-briefing.png')


def capture_ceremony(page: Page) -> None:
    set_capture_prefs(page, show_ceremony=True)
    page.reload(wait_until='domcontentloaded')
    wait_idle(page, 1800)
    screenshot(page, '11-ceremony.png')


def main() -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    token, active_password = authenticate_via_api()
    parsed = urlparse(URL)
    cookie_domain = parsed.hostname or 'localhost'

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=2,
            color_scheme='dark',
        )
        ctx.add_cookies([
            {
                'name': 'edict_token',
                'value': token,
                'domain': cookie_domain,
                'path': '/',
                'httpOnly': True,
                'sameSite': 'Strict',
            }
        ])
        page = ctx.new_page()

        workspace_title = open_workspace(page)
        print(f'🔐 authenticated as {USERNAME} with active password marker: {active_password}')
        print(f'🧭 workspace title: {workspace_title}')

        click_nav(page, '任务中枢')
        screenshot(page, '01-kanban-main.png')

        click_nav(page, '实时动态')
        screenshot(page, '02-monitor.png')

        capture_task_detail(page)
        capture_agents_overview_and_model_config(page)
        capture_skills(page)
        capture_sessions(page)
        capture_memory(page)
        capture_automation(page)
        capture_web_search(page)
        capture_ceremony(page)

        browser.close()

    print(f'✅ all screenshots saved to {SHOTS}')


if __name__ == '__main__':
    main()
