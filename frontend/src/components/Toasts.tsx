import { useStore } from '../store/useStore';

export function Toasts() {
  const { toasts, removeToast } = useStore();
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          onClick={() => removeToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
