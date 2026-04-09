import { useEffect, useMemo, useState } from 'react';
import { api, type SystemSettings } from '../api';
import { pickLocaleText } from '../i18n';
import { useStore } from '../store';

type Props = {
  currentUser: string;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  onChangeUsername: (currentPassword: string, newUsername: string) => Promise<string | null>;
  onLogout: () => Promise<void>;
};

const DEFAULT_SETTINGS: SystemSettings = {
  scan_record_retention_days: 7,
};

function clampRetentionDays(value: number) {
  if (!Number.isFinite(value)) return 7;
  return Math.max(1, Math.min(30, Math.round(value)));
}

export default function SystemSettingsPanel({
  currentUser,
  onChangePassword,
  onChangeUsername,
  onLogout,
}: Props) {
  const locale = useStore((s) => s.locale);
  const toast = useStore((s) => s.toast);

  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState(currentUser);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nameMsg, setNameMsg] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [busy, setBusy] = useState<'username' | 'password' | 'logout' | ''>('');

  useEffect(() => {
    setNewUsername(currentUser);
  }, [currentUser]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.systemSettings()
      .then((result) => {
        if (cancelled) return;
        setSettings({
          scan_record_retention_days: clampRetentionDays(Number(result.scan_record_retention_days || 7)),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSettings(DEFAULT_SETTINGS);
        toast(pickLocaleText(locale, '系统设置读取失败，已使用默认值', 'Failed to load system settings. Default values are used.'), 'err');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, toast]);

  const retentionLabel = useMemo(() => {
    const days = clampRetentionDays(Number(settings.scan_record_retention_days || 7));
    return pickLocaleText(locale, `当前保留 ${days} 天`, `Currently keeping ${days} day(s)`);
  }, [locale, settings.scan_record_retention_days]);

  const saveSystemSettings = async () => {
    setSavingSettings(true);
    try {
      const payload = {
        scan_record_retention_days: clampRetentionDays(Number(settings.scan_record_retention_days || 7)),
      };
      const result = await api.saveSystemSettings(payload);
      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '系统设置保存失败', 'Failed to save system settings'), 'err');
        return;
      }
      setSettings(result.settings || payload);
      toast(result.message || pickLocaleText(locale, '系统设置已保存', 'System settings saved'), 'ok');
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ padding: 20, borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(135deg, rgba(68,110,255,0.12), rgba(160,122,255,0.10) 55%, rgba(58,208,182,0.08))', display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>{pickLocaleText(locale, '系统设置', 'System Settings')}</div>
          <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.2 }}>{pickLocaleText(locale, '集中管理系统级设置', 'Manage system-wide settings in one place')}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 860, lineHeight: 1.7 }}>
            {pickLocaleText(locale, '这里放系统层面的参数与账号安全项，不再混在搜索设置里。当前包含巡检记录保留时间，以及用户名、密码、登录会话等设置。', 'This page is dedicated to system-wide controls instead of mixing them into search settings. It currently includes scan-record retention plus account and security actions such as username, password, and sign-out management.')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="chip ok">{retentionLabel}</span>
          <span className="chip">{pickLocaleText(locale, `当前用户：${currentUser || 'admin'}`, `Current user: ${currentUser || 'admin'}`)}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(360px, 1.05fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--line)', background: 'var(--panel2)', display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{pickLocaleText(locale, '巡检记录设置', 'Scan Record Settings')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              {pickLocaleText(locale, '控制“检查进度”产生的巡检记录默认保留多久。该设置属于系统级行为，因此放在系统设置中统一管理。', 'Control how long scan records generated by “Check Progress” are kept by default. This is a system-level behavior, so it is managed here instead of inside search settings.')}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '巡检记录保留天数', 'Scan record retention days')}</div>
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              value={String(settings.scan_record_retention_days || 7)}
              onChange={(event) => setSettings((prev) => ({ ...prev, scan_record_retention_days: clampRetentionDays(Number(event.target.value || 7)) }))}
              style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 13 }}
            />
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              {pickLocaleText(locale, '默认保留 7 天；最少 1 天，最多 30 天。超过保留期的历史记录将在本地展示时被自动清理。', 'The default is 7 days; the minimum is 1 day and the maximum is 30 days. Records older than the retention window are automatically cleaned up when rendered locally.')}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="tpl-go" onClick={saveSystemSettings} disabled={savingSettings || loading} style={{ fontSize: 12, padding: '8px 16px' }}>
              {savingSettings
                ? pickLocaleText(locale, '保存中…', 'Saving...')
                : pickLocaleText(locale, '保存系统设置', 'Save System Settings')}
            </button>
          </div>
        </div>

        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--line)', background: 'var(--panel2)', display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{pickLocaleText(locale, '账号与安全', 'Account and Security')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              {pickLocaleText(locale, '这里集中处理用户名、密码和登录会话，不再把这类系统项塞进别的功能页。', 'Manage username, password, and session controls here instead of scattering them across feature pages.')}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '修改用户名', 'Change Username')}</div>
              <label className="auth-label">
                <span>{pickLocaleText(locale, '当前密码', 'Current password')}</span>
                <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={pickLocaleText(locale, '请输入当前密码', 'Enter current password')} />
              </label>
              <label className="auth-label">
                <span>{pickLocaleText(locale, '新用户名', 'New username')}</span>
                <input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder={pickLocaleText(locale, '请输入新用户名', 'Enter new username')} />
              </label>
              {nameMsg ? <div className="auth-tip">{nameMsg}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn-refresh"
                  disabled={busy !== ''}
                  onClick={async () => {
                    setBusy('username');
                    const msg = await onChangeUsername(currentPassword, newUsername.trim());
                    setNameMsg(msg || pickLocaleText(locale, '用户名已更新', 'Username updated'));
                    setBusy('');
                  }}
                >
                  {busy === 'username' ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存用户名', 'Save Username')}
                </button>
              </div>
            </div>

            <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '修改密码', 'Change Password')}</div>
              <label className="auth-label">
                <span>{pickLocaleText(locale, '新密码', 'New password')}</span>
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={pickLocaleText(locale, '请输入新密码', 'Enter new password')} />
              </label>
              <label className="auth-label">
                <span>{pickLocaleText(locale, '确认新密码', 'Confirm new password')}</span>
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={pickLocaleText(locale, '请再次输入新密码', 'Re-enter new password')} />
              </label>
              {pwdMsg ? <div className="auth-tip">{pwdMsg}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn-refresh"
                  disabled={busy !== ''}
                  onClick={async () => {
                    setBusy('logout');
                    await onLogout();
                    setBusy('');
                  }}
                >
                  {busy === 'logout' ? pickLocaleText(locale, '退出中…', 'Signing out...') : pickLocaleText(locale, '退出登录', 'Sign Out')}
                </button>
                <button
                  className="btn-refresh"
                  disabled={busy !== ''}
                  onClick={async () => {
                    if (newPassword !== confirmPassword) {
                      setPwdMsg(pickLocaleText(locale, '两次输入的新密码不一致', 'The two new passwords do not match'));
                      return;
                    }
                    setBusy('password');
                    const msg = await onChangePassword(currentPassword, newPassword);
                    setPwdMsg(msg || pickLocaleText(locale, '密码已更新', 'Password updated'));
                    setBusy('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                >
                  {busy === 'password' ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存密码', 'Save Password')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
