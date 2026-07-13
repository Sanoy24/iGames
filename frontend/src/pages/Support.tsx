import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageSquarePlus, Send, LifeBuoy, MessagesSquare, Plus, X } from 'lucide-react';
import {
  supportApi,
  type SupportTicket,
  type SupportMessage,
  type CreateTicketInput,
} from '../lib/api';
import { useSupportSocket, type SupportMessageEvent } from '../hooks/useSupportSocket';
import { useStore, formatCredits } from '../store/useStore';
import { getErrorMessage, formatRelativeTime } from '../lib/utils';

const CATEGORY_LABEL: Record<string, string> = {
  general: 'General',
  complaint: 'Complaint',
  dispute: 'Dispute',
  refund: 'Refund',
  live_chat: 'Live chat',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-gold',
  pending_agent: 'badge-gold',
  pending_user: 'badge-violet',
  resolved: 'badge-green',
  closed: 'badge-red',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  pending_agent: 'Awaiting agent',
  pending_user: 'Reply needed',
  resolved: 'Resolved',
  closed: 'Closed',
};

function Badge({ text, cls }: { text: string; cls?: string }) {
  return <span className={`badge ${cls ?? ''}`} style={{ fontSize: 10 }}>{text}</span>;
}

function MessageBubble({ m, mine }: { m: { authorRole: string; body: string; createdAt: string }; mine: boolean }) {
  if (m.authorRole === 'system') {
    return (
      <div style={{ textAlign: 'center', margin: '6px 0' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{m.body}</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
      <div style={{
        maxWidth: '78%',
        background: mine ? 'var(--accent)' : 'var(--card-bg)',
        color: mine ? '#fff' : 'var(--text-primary)',
        border: mine ? 'none' : '1px solid var(--border)',
        borderRadius: 12,
        padding: '8px 11px',
      }}>
        <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
        <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3, textAlign: 'right' }}>
          {formatRelativeTime(m.createdAt)}
        </div>
      </div>
    </div>
  );
}

// ── New ticket form ───────────────────────────────────────────────
function NewTicketForm({ onClose, onCreated }: { onClose: () => void; onCreated: (t: SupportTicket) => void }) {
  const addToast = useStore((s) => s.addToast);
  const [category, setCategory] = useState<CreateTicketInput['category']>('general');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [amount, setAmount] = useState('');
  const [relatedId, setRelatedId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (subject.trim().length < 3 || body.trim().length < 1) {
      addToast('error', 'Add a subject and a message.');
      return;
    }
    const dto: CreateTicketInput = { category, subject: subject.trim(), body: body.trim() };
    if (category === 'refund') {
      const minor = Math.round(parseFloat(amount) * 100);
      if (!minor || minor < 1) { addToast('error', 'Enter the refund amount.'); return; }
      dto.requestedAmountMinor = minor;
    }
    if ((category === 'dispute' || category === 'refund') && relatedId.trim()) {
      dto.relatedType = 'withdrawal';
      dto.relatedId = relatedId.trim();
    }
    setSubmitting(true);
    try {
      const t = await supportApi.createTicket(dto);
      addToast('success', 'Ticket submitted.');
      onCreated(t);
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 520, borderRadius: '16px 16px 0 0', padding: '16px 16px calc(20px + env(safe-area-inset-bottom, 0px))', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 16 }}>New support ticket</strong>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Category</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, margin: '6px 0 12px' }}>
          {(['general', 'complaint', 'dispute', 'refund'] as const).map((c) => (
            <button
              key={c}
              className={`btn btn-sm ${category === c ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setCategory(c)}
              style={{ fontSize: 11 }}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>

        <input className="input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} style={{ marginBottom: 10 }} />

        {category === 'refund' && (
          <input className="input" placeholder="Refund amount (ETB)" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ marginBottom: 10 }} />
        )}
        {(category === 'dispute' || category === 'refund') && (
          <input className="input" placeholder="Related withdrawal ID (optional)" value={relatedId} onChange={(e) => setRelatedId(e.target.value)} style={{ marginBottom: 10 }} />
        )}

        <textarea className="input" placeholder="Describe your issue…" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} style={{ marginBottom: 14, resize: 'vertical' }} />

        <button className="btn btn-primary" style={{ width: '100%' }} disabled={submitting} onClick={submit}>
          {submitting ? 'Submitting…' : 'Submit ticket'}
        </button>
      </div>
    </div>
  );
}

// ── Ticket detail (thread + reply) ────────────────────────────────
function TicketDetail({ ticketId, onBack, onChanged }: { ticketId: string; onBack: () => void; onChanged: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await supportApi.getMyTicket(ticketId);
    setTicket(data.ticket);
    setMessages(data.messages);
  }, [ticketId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  // Live updates for this thread.
  useSupportSocket({
    onMessage: (e: SupportMessageEvent) => {
      if (e.ticketId !== ticketId) return;
      setMessages((prev) => prev.some((m) => m.id === e.messageId) ? prev : [...prev, {
        id: e.messageId, authorId: e.authorId, authorRole: e.authorRole, body: e.body, attachments: null, internal: false, createdAt: e.createdAt,
      }]);
    },
    onTicketUpdated: (e) => { if (e.ticketId === ticketId) void load(); },
  }, ticketId);

  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    try {
      const m = await supportApi.postMessage(ticketId, text);
      setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
      setReply('');
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const close = async () => {
    try { await supportApi.closeTicket(ticketId); addToast('success', 'Ticket closed.'); onChanged(); void load(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
  };

  const isClosed = ticket?.status === 'closed' || ticket?.status === 'resolved';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={onBack}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket?.subject ?? '…'}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            {ticket && <Badge text={CATEGORY_LABEL[ticket.category]} cls="badge-violet" />}
            {ticket && <Badge text={STATUS_LABEL[ticket.status]} cls={STATUS_BADGE[ticket.status]} />}
          </div>
        </div>
        {!isClosed && <button className="btn btn-ghost btn-sm" onClick={close} style={{ fontSize: 11 }}>Close</button>}
      </div>

      {ticket?.resolutionType && (
        <div className="card" style={{ padding: '8px 12px', marginBottom: 8, fontSize: 12 }}>
          {ticket.resolutionType === 'refunded'
            ? `✅ Refunded ${formatCredits(ticket.refundedAmountMinor ?? 0)} to your wallet.`
            : ticket.resolutionType === 'rejected'
              ? `❌ Declined${ticket.resolutionNote ? `: ${ticket.resolutionNote}` : ''}.`
              : `Resolved${ticket.resolutionNote ? `: ${ticket.resolutionNote}` : ''}.`}
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 2px' }}>
        {messages.map((m) => <MessageBubble key={m.id} m={m} mine={m.authorRole === 'user'} />)}
      </div>

      {!isClosed && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
          <input
            className="input"
            placeholder="Type a reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary icon-btn" disabled={sending || !reply.trim()} onClick={send}><Send size={16} /></button>
        </div>
      )}
    </div>
  );
}

// ── Live chat ─────────────────────────────────────────────────────
function LiveChat() {
  const [ticketId, setTicketId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Array<{ id: string; authorRole: string; body: string; createdAt: string }>>([]);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the most recent live-chat history (if any) so the conversation resumes.
  useEffect(() => {
    void (async () => {
      const tickets = await supportApi.listMyTickets(50);
      const chat = tickets.find((t) => t.category === 'live_chat' && t.status !== 'closed' && t.status !== 'resolved');
      if (chat) {
        setTicketId(chat.id);
        const thread = await supportApi.getMyTicket(chat.id);
        setMessages(thread.messages.map((m) => ({ id: m.id, authorRole: m.authorRole, body: m.body, createdAt: m.createdAt })));
      }
    })();
  }, []);

  const { sendChat } = useSupportSocket({
    onMessage: (e) => {
      if (ticketId && e.ticketId !== ticketId) return;
      if (!ticketId) setTicketId(e.ticketId);
      setMessages((prev) => prev.some((m) => m.id === e.messageId) ? prev : [...prev, { id: e.messageId, authorRole: e.authorRole, body: e.body, createdAt: e.createdAt }]);
    },
  }, ticketId);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    sendChat(t, ticketId);
    setText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 2px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 40 }}>
            👋 Say hi — an agent will be with you shortly.
          </div>
        )}
        {messages.map((m) => <MessageBubble key={m.id} m={m} mine={m.authorRole === 'user'} />)}
      </div>
      <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
        <input
          className="input"
          placeholder="Message support…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary icon-btn" disabled={!text.trim()} onClick={send}><Send size={16} /></button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export function Support({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<'tickets' | 'chat'>('tickets');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTickets(await supportApi.listMyTickets()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (selected) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 12px 80px' }}>
        <TicketDetail ticketId={selected} onBack={() => { setSelected(null); void load(); }} onChanged={load} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 12px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={onBack}><ArrowLeft size={16} /></button>
        <LifeBuoy size={18} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 17 }}>Support</span>
      </div>

      {/* View switch */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button className={`btn btn-sm ${view === 'tickets' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setView('tickets')}>
          <MessagesSquare size={14} /> My tickets
        </button>
        <button className={`btn btn-sm ${view === 'chat' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setView('chat')}>
          <MessageSquarePlus size={14} /> Live chat
        </button>
      </div>

      {view === 'chat' ? (
        <LiveChat />
      ) : (
        <>
          <button className="btn btn-primary" style={{ width: '100%', marginBottom: 14 }} onClick={() => setShowNew(true)}>
            <Plus size={16} /> New ticket
          </button>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>
          ) : tickets.filter((t) => t.category !== 'live_chat').length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30 }}>
              No tickets yet. Open one if you need help.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tickets.filter((t) => t.category !== 'live_chat').map((t) => (
                <button key={t.id} className="card" style={{ textAlign: 'left', padding: 12, cursor: 'pointer', border: '1px solid var(--border)' }} onClick={() => setSelected(t.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</span>
                    <Badge text={STATUS_LABEL[t.status]} cls={STATUS_BADGE[t.status]} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <Badge text={CATEGORY_LABEL[t.category]} cls="badge-violet" />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatRelativeTime(t.lastMessageAt ?? t.createdAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {showNew && (
        <NewTicketForm
          onClose={() => setShowNew(false)}
          onCreated={(t) => { setShowNew(false); void load(); setSelected(t.id); }}
        />
      )}
    </div>
  );
}
