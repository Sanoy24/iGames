import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import { getSocket } from '../hooks/useSocketConnection';

export function NotificationBell() {
  const notifications = useStore((s) => s.notifications);
  const unreadCount = useStore((s) => s.unreadCount);
  const addNotification = useStore((s) => s.addNotification);
  const markAllNotificationsRead = useStore((s) => s.markAllNotificationsRead);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isSocketConnected = useStore((s) => s.isSocketConnected);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleKenoWin = (data: { payoutMinor?: number }) => {
      if (!data.payoutMinor) return;
      addNotification({
        type: 'win',
        title: 'Keno Win!',
        message: `You won ${data.payoutMinor} ETB in Keno`,
      });
    };

    const handleBingoWin = (data: { payoutMinor?: number; tier?: string }) => {
      if (!data.payoutMinor) return;
      addNotification({
        type: 'win',
        title: 'Bingo Win!',
        message: `You won ${data.payoutMinor} ETB — ${data.tier ?? 'Prize'}`,
      });
    };

    socket.on('keno.ticket.won', handleKenoWin);
    socket.on('bingo.ticket.won', handleBingoWin);
    return () => {
      socket.off('keno.ticket.won', handleKenoWin);
      socket.off('bingo.ticket.won', handleBingoWin);
    };
  }, [isSocketConnected, addNotification]);

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

  const handleToggle = () => {
    if (!open && unreadCount > 0) markAllNotificationsRead();
    setOpen((o) => !o);
  };

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
                      {n.type === 'win' && <span style={{ fontSize: 14 }}>🏆</span>}
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{n.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.message}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {new Date(n.timestamp).toLocaleTimeString()}
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
