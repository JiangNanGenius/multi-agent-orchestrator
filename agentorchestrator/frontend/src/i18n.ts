export type Locale = 'zh' | 'en';

const LOCALE_KEY = 'agentorchestrator_locale';

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  const saved = window.localStorage.getItem(LOCALE_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  const browserLang = (window.navigator.language || '').toLowerCase();
  return browserLang.startsWith('en') ? 'en' : 'zh';
}

export function persistLocale(locale: Locale) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCALE_KEY, locale);
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
}

export function applyLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
}

export function pickLocaleText(locale: Locale, zh: string, en: string): string {
  return locale === 'en' ? en : zh;
}

export function formatCount(locale: Locale, count: number, zhUnit: string, enUnit: string): string {
  return locale === 'en' ? `${count} ${enUnit}` : `${count} ${zhUnit}`;
}

export function formatRelativeTime(locale: Locale, minutes: number, hours: number): string {
  if (locale === 'en') {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) > 1 ? 's' : ''} ago`;
  }
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export const localeLabels: Record<Locale, { current: string; switchTo: string; short: string }> = {
  zh: { current: '中文', switchTo: '切换英文', short: '中' },
  en: { current: 'English', switchTo: 'Switch to Chinese', short: 'EN' },
};
