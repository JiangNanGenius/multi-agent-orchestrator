import { CheckCircle2, CircleAlert, Info, LoaderCircle, XCircle, X } from 'lucide-react';

import { useStore } from '../store';

const TOAST_META = {
  success: { icon: CheckCircle2, label: 'Success' },
  error: { icon: XCircle, label: 'Error' },
  warning: { icon: CircleAlert, label: 'Warning' },
  info: { icon: Info, label: 'Info' },
  loading: { icon: LoaderCircle, label: 'Loading' },
} as const;

export default function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  if (!toasts.length) return null;

  return (
    <div className="toaster" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => {
        const meta = TOAST_META[t.type] || TOAST_META.info;
        const Icon = meta.icon;
        return (
          <div key={t.id} className={`toast toast--enter toast--${t.type}`}>
            <div className="toast__icon" aria-hidden="true">
              <Icon size={16} className={t.type === 'loading' ? 'toast__spin' : ''} />
            </div>
            <div className="toast__body">
              <div className="toast__title">{t.title || meta.label}</div>
              <div className="toast__msg">{t.msg}</div>
            </div>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
