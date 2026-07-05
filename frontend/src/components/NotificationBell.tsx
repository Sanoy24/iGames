import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore, type AppNotification, type NotificationKind } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';
import { notificationsApi, type ServerNotification } from '../lib/api';

const TYPE_ICON: Record<NotificationKind, string> = {
  win: '🏆',
  deposit: '💰',
  withdrawal: '🏧',
  adjustment: '⚙️',
  bonus: '🎁',
  system: '🔔',
  info: 'ℹ️',
};

function mapServerNotification(n: ServerNotification): AppNotification {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.body,
    timestamp: new Date(n.createdAt).getTime(),
    read: n.read,
  };
}

export function NotificationBell() {
  const notifications = useStore((s) => s.notifications);
  const unreadCount = useStore((s) => s.unreadCount);
  const setNotifications = useStore((s) => s.setNotifications);
  const addServerNotification = useStore((s) => s.addServerNotification);
  const markAllNotificationsRead = useStore((s) => s.markAllNotificationsRead);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const isSocketConnected = useStore((s) => s.isSocketConnected);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load the persisted list on login (survives reload, delivers what you missed).
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    notificationsApi
      .list()
      .then((res) => {
        if (!cancelled) setNotifications(res.items.map(mapServerNotification), res.unreadCount);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isAuthenticated, setNotifications]);

  // Live notifications pushed to this user's socket room.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNew = (payload: ServerNotification) => addServerNotification(mapServerNotification(payload));
    socket.on('notification.new', onNew);
    return () => { socket.off('notification.new', onNew); };
  }, [isSocketConnected, addServerNotification]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = useCallback(() => {
    if (!open && unreadCount > 0) {
      markAllNotificationsRead();
      notificationsApi.markRead().catch(() => undefined); // persist read state
    }
    setOpen((o) => !o);
  }, [open, unreadCount, markAllNotificationsRead]);

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      <button
        type="button"
        onClick={handleToggle}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          padding: '4px 6px',
          display: 'flex',
          alignItems: 'center',
        }}
        aria-label="Notifications"
      >
        <Bell size={18} strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: 0,
            right: 0,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            borderRadius: 99,
            minWidth: 14,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              top: '110%',
              right: 0,
              width: 280,
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              zIndex: 200,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
              Notifications
            </div>
            {notifications.length === 0 ? (
              <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                No notifications yet
              </div>
            ) : (
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      padding: '9px 14px',
                      borderBottom: '1px solid var(--border)',
                      opacity: n.read ? 0.7 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 14 }}>{TYPE_ICON[n.type] ?? '🔔'}</span>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{n.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.message}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {new Date(n.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
