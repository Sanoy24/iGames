import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { SupportMessage } from '../lib/api';

export type SupportMessageEvent = {
  ticketId: string;
  messageId: string;
  authorRole: SupportMessage['authorRole'];
  authorId: string | null;
  body: string;
  assignedAgentId: string | null;
  createdAt: string;
};

export type SupportTicketEvent = {
  ticketId: string;
  userId?: string;
  category?: string;
  subject?: string;
  priority?: string;
  status?: string;
  resolutionType?: string | null;
};

export type SupportTypingEvent = {
  ticketId: string;
  userId?: string;
  displayName?: string;
  typing: boolean;
};

type Handlers = {
  onMessage?: (e: SupportMessageEvent) => void;
  onTicketCreated?: (e: SupportTicketEvent) => void;
  onTicketUpdated?: (e: SupportTicketEvent) => void;
  onLivechatActivity?: (e: SupportTicketEvent) => void;
  onTyping?: (e: SupportTypingEvent) => void;
};

// Single shared connection to the dedicated /support namespace. Kept separate
// from the main game socket so support traffic is isolated.
let supportSocket: Socket | null = null;

function ensureSupportSocket(): Socket {
  if (!supportSocket) {
    const token = localStorage.getItem('accessToken');
    const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
    supportSocket = io(`${base}/support`, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });
  }
  return supportSocket;
}

export function getSupportSocket(): Socket {
  return ensureSupportSocket();
}

/** Subscribe to support events; optionally join a specific ticket thread room. */
export function useSupportSocket(handlers: Handlers, openTicketId?: string) {
  const ref = useRef(handlers);
  useEffect(() => { ref.current = handlers; });

  useEffect(() => {
    const s = ensureSupportSocket();
    const onMsg = (e: SupportMessageEvent) => ref.current.onMessage?.(e);
    const onCreated = (e: SupportTicketEvent) => ref.current.onTicketCreated?.(e);
    const onUpdated = (e: SupportTicketEvent) => ref.current.onTicketUpdated?.(e);
    const onActivity = (e: SupportTicketEvent) => ref.current.onLivechatActivity?.(e);
    const onTyping = (e: SupportTypingEvent) => ref.current.onTyping?.(e);

    s.on('support.message.new', onMsg);
    s.on('support.ticket.created', onCreated);
    s.on('support.ticket.updated', onUpdated);
    s.on('support.livechat.activity', onActivity);
    s.on('support.typing', onTyping);

    return () => {
      s.off('support.message.new', onMsg);
      s.off('support.ticket.created', onCreated);
      s.off('support.ticket.updated', onUpdated);
      s.off('support.livechat.activity', onActivity);
      s.off('support.typing', onTyping);
    };
  }, []);

  useEffect(() => {
    if (!openTicketId) return;
    const s = ensureSupportSocket();
    s.emit('support.ticket.open', { ticketId: openTicketId });
    return () => {
      s.emit('support.ticket.leave', { ticketId: openTicketId });
    };
  }, [openTicketId]);

  return {
    sendChat: (text: string, ticketId?: string) =>
      ensureSupportSocket().emit('support.chat.send', { text, ticketId }),
    sendTyping: (ticketId: string, typing: boolean) =>
      ensureSupportSocket().emit('support.typing', { ticketId, typing }),
  };
}
