import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, Send, UserCheck, CheckCircle2, XCircle, StickyNote } from 'lucide-react';
import {
  supportAgentApi,
  type SupportTicket,
  type SupportMessage,
  type SupportTicketStatus,
  type SupportTicketCategory,
} from '../lib/api';
import { useSupportSocket, type SupportMessageEvent } from '../hooks/useSupportSocket';
import { useStore, formatCredits } from '../store/useStore';
import { getErrorMessage, formatRelativeTime } from '../lib/utils';

const CATEGORY_LABEL: Record<string, string> = {
  general: 'General', complaint: 'Complaint', dispute: 'Dispute', refund: 'Refund', live_chat: 'Live chat',
};
const STATUS_BADGE: Record<string, string> = {
  open: 'badge-gold', pending_agent: 'badge-gold', pending_user: 'badge-violet', resolved: 'badge-green', closed: 'badge-red',
};
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', pending_agent: 'Awaiting agent', pending_user: 'Awaiting user', resolved: 'Resolved', closed: 'Closed',
};
const STATUS_OPTIONS: SupportTicketStatus[] = ['open', 'pending_agent', 'pending_user', 'resolved', 'closed'];
const CATEGORY_OPTIONS: SupportTicketCategory[] = ['general', 'complaint', 'dispute', 'refund', 'live_chat'];

function Badge({ text, cls }: { text: string; cls?: string }) {
  return <span className={`badge ${cls ?? ''}`} style={{ fontSize: 10 }}>{text}</span>;
}

const REQ_LABEL: Record<string, string> = { refund: 'Refund', dispute: 'Dispute', complaint: 'Complaint' };
const REQ_STATUS_BADGE: Record<string, string> = { pending: 'badge-gold', approved: 'badge-green', rejected: 'badge-red' };

// ── Detail / conversation ─────────────────────────────────────────
function ConsoleDetail({ ticketId, onBack, onChanged }: { ticketId: string; onBack: () => void; onChanged: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const meId = useStore((s) => s.user?.id);
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const prefillAmounts = (msgs: SupportMessage[]) =>
    setAmounts((prev) => {
      const next = { ...prev };
      for (const m of msgs) {
        if (m.requestType === 'refund' && m.requestStatus === 'pending' && next[m.id] === undefined && m.requestedAmountMinor != null) {
          next[m.id] = String(m.requestedAmountMinor / 100);
        }
      }
      return next;
    });

  const load = useCallback(async () => {
    const data = await supportAgentApi.get(ticketId);
    setTicket(data.ticket);
    setMessages(data.messages);
    prefillAmounts(data.messages);
  }, [ticketId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  useSupportSocket({
    onMessage: (e: SupportMessageEvent) => {
      if (e.ticketId !== ticketId) return;
      setMessages((prev) => prev.some((m) => m.id === e.messageId) ? prev : [...prev, {
        id: e.messageId, authorId: e.authorId, authorRole: e.authorRole, body: e.body, attachments: null, internal: false, createdAt: e.createdAt,
        requestType: (e.requestType ?? null) as SupportMessage['requestType'], requestStatus: (e.requestStatus ?? null) as SupportMessage['requestStatus'],
        requestedAmountMinor: e.requestedAmountMinor ?? null, relatedType: null, relatedId: null, refundedAmountMinor: null, resolutionNote: null, decidedAt: null,
      }]);
      if (e.requestType === 'refund' && e.requestedAmountMinor != null) {
        setAmounts((prev) => prev[e.messageId] !== undefined ? prev : { ...prev, [e.messageId]: String((e.requestedAmountMinor as number) / 100) });
      }
    },
    onRequestUpdated: (e) => setMessages((prev) => prev.map((m) => m.id === e.messageId
      ? { ...m, requestStatus: (e.requestStatus ?? m.requestStatus) as SupportMessage['requestStatus'], refundedAmountMinor: e.refundedAmountMinor ?? m.refundedAmountMinor }
      : m)),
    onTicketUpdated: (e) => { if (e.ticketId === ticketId) void load(); },
  }, ticketId);

  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    setBusy(true);
    try {
      const m = await supportAgentApi.reply(ticketId, text, internal);
      setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
      setReply('');
      if (internal) void load();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const claim = async () => {
    try { await supportAgentApi.claim(ticketId); addToast('success', 'Claimed.'); void load(); onChanged(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
  };

  const setStatus = async (status: SupportTicketStatus) => {
    try { await supportAgentApi.update(ticketId, { status }); void load(); onChanged(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
  };

  const approveRefund = async (messageId: string) => {
    const minor = Math.round(parseFloat(amounts[messageId] ?? '') * 100);
    if (!minor || minor < 1) { addToast('error', 'Enter a valid amount.'); return; }
    setBusy(true);
    try {
      await supportAgentApi.approveRefund(messageId, { amountMinor: minor });
      addToast('success', 'Refund approved and credited.');
      void load(); onChanged();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const rejectRequest = async (messageId: string) => {
    if (!rejectReason.trim()) { addToast('error', 'Add a reason.'); return; }
    setBusy(true);
    try {
      await supportAgentApi.reject(messageId, rejectReason.trim());
      addToast('success', 'Request declined.');
      setRejectingId(null); setRejectReason(''); void load(); onChanged();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const isResolved = ticket?.status === 'resolved' || ticket?.status === 'closed';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={onBack}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Conversation</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
            {ticket && <Badge text={STATUS_LABEL[ticket.status]} cls={STATUS_BADGE[ticket.status]} />}
            {ticket?.priority && ticket.priority !== 'normal' && <Badge text={ticket.priority} cls="badge-gold" />}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={claim} style={{ fontSize: 11 }}><UserCheck size={13} /> Claim</button>
      </div>

      {/* Meta */}
      <div className="card" style={{ padding: '8px 12px', marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
        <div>User: <code>{ticket?.userId}</code></div>
        {ticket?.assignedAgentId && <div>Assigned: <code>{ticket.assignedAgentId}{ticket.assignedAgentId === meId ? ' (you)' : ''}</code></div>}
      </div>

      {/* Thread */}
      <div ref={scrollRef} style={{ maxHeight: 340, overflowY: 'auto', padding: '4px 2px', marginBottom: 10 }}>
        {messages.map((m) => {
          if (m.authorRole === 'system') {
            return <div key={m.id} style={{ textAlign: 'center', margin: '6px 0', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{m.body}</div>;
          }
          const mine = m.authorRole === 'agent';
          const pendingRequest = m.requestType && m.requestStatus === 'pending';
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{ maxWidth: '86%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: 4 }}>
                <div style={{
                  background: m.internal ? '#f59e0b22' : mine ? 'var(--accent)' : 'var(--card-bg)',
                  color: m.internal ? 'var(--text-primary)' : mine ? '#1a1200' : 'var(--text-primary)',
                  border: m.internal ? '1px dashed #f59e0b' : mine ? 'none' : '1px solid var(--border)',
                  borderRadius: 12, padding: '8px 11px',
                }}>
                  {m.internal && <div style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', marginBottom: 3 }}>INTERNAL NOTE</div>}
                  {m.requestType && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <Badge text={REQ_LABEL[m.requestType]} cls="badge-violet" />
                      {m.requestType === 'refund' && m.requestedAmountMinor != null && <span style={{ fontSize: 11, fontWeight: 800 }}>{formatCredits(m.requestedAmountMinor)} ETB</span>}
                      {m.requestStatus && <Badge text={m.requestStatus} cls={REQ_STATUS_BADGE[m.requestStatus]} />}
                    </div>
                  )}
                  <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                  <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3, textAlign: 'right' }}>{formatRelativeTime(m.createdAt)}</div>
                </div>

                {/* Inline request actions (agent) */}
                {pendingRequest && (
                  <div className="card" style={{ padding: 8, width: 260, maxWidth: '100%' }}>
                    {m.requestType === 'refund' && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input className="input" placeholder="Amount (ETB)" value={amounts[m.id] ?? ''} onChange={(e) => setAmounts((p) => ({ ...p, [m.id]: e.target.value }))} inputMode="decimal" style={{ flex: 1 }} />
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => approveRefund(m.id)}><CheckCircle2 size={13} /> Approve</button>
                      </div>
                    )}
                    {rejectingId === m.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="input" placeholder="Reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ flex: 1 }} />
                        <button className="btn btn-sm" disabled={busy} onClick={() => rejectRequest(m.id)} style={{ background: '#ef4444', color: '#fff' }}>Decline</button>
                      </div>
                    ) : (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger, #ef4444)', fontSize: 11 }} onClick={() => { setRejectingId(m.id); setRejectReason(''); }}><XCircle size={13} /> Decline request</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply */}
      {!isResolved && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder={internal ? 'Internal note…' : 'Reply to user…'} value={reply}
              onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} style={{ flex: 1 }} />
            <button className="btn btn-primary icon-btn" disabled={busy || !reply.trim()} onClick={send}><Send size={16} /></button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            <StickyNote size={12} /> Internal note (hidden from user)
          </label>
        </div>
      )}

      {/* Status controls */}
      {!isResolved && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.filter((s) => s !== ticket?.status).map((s) => (
            <button key={s} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Console (inbox) ───────────────────────────────────────────────
export function SupportConsole() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SupportTicketStatus | ''>('');
  const [category, setCategory] = useState<SupportTicketCategory | ''>('');
  const [mineOnly, setMineOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supportAgentApi.list({
        status: status || undefined,
        category: category || undefined,
        assignedAgentId: mineOnly ? 'me' : undefined,
        limit: 50,
      });
      setTickets(res.items);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, [status, category, mineOnly]);

  useEffect(() => { void load(); }, [load]);

  // Live: refresh the inbox when anything changes server-side.
  useSupportSocket({
    onTicketCreated: () => void load(),
    onMessage: () => { if (!selected) void load(); },
    onLivechatActivity: () => void load(),
  });

  if (selected) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <ConsoleDetail ticketId={selected} onBack={() => setSelected(null)} onChanged={load} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 15 }}>Support inbox <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({total})</span></strong>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={() => void load()}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as SupportTicketStatus | '')} style={{ flex: 1, minWidth: 120, fontSize: 12 }}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value as SupportTicketCategory | '')} style={{ flex: 1, minWidth: 120, fontSize: 12 }}>
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <button className={`btn btn-sm ${mineOnly ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMineOnly((v) => !v)} style={{ fontSize: 11 }}>Mine</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>
      ) : tickets.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30 }}>No tickets match.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tickets.map((t) => (
            <button key={t.id} className="card" style={{ textAlign: 'left', padding: 12, cursor: 'pointer', border: '1px solid var(--border)' }} onClick={() => setSelected(t.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subject}</span>
                <Badge text={STATUS_LABEL[t.status]} cls={STATUS_BADGE[t.status]} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Badge text={CATEGORY_LABEL[t.category]} cls="badge-violet" />
                  {t.category === 'refund' && t.requestedAmountMinor != null && (
                    <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{formatCredits(t.requestedAmountMinor)}</span>
                  )}
                  {t.priority !== 'normal' && <Badge text={t.priority} cls="badge-gold" />}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatRelativeTime(t.lastMessageAt ?? t.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
