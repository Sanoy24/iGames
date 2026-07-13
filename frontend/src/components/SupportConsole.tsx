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

// ── Detail / thread ───────────────────────────────────────────────
function ConsoleDetail({ ticketId, onBack, onChanged }: { ticketId: string; onBack: () => void; onChanged: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const meId = useStore((s) => s.user?.id);
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundNote, setRefundNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await supportAgentApi.get(ticketId);
    setTicket(data.ticket);
    setMessages(data.messages);
    if (data.ticket.requestedAmountMinor) setRefundAmount((data.ticket.requestedAmountMinor / 100).toString());
  }, [ticketId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

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

  const approveRefund = async () => {
    const minor = Math.round(parseFloat(refundAmount) * 100);
    if (!minor || minor < 1) { addToast('error', 'Enter a valid amount.'); return; }
    setBusy(true);
    try {
      await supportAgentApi.approveRefund(ticketId, { amountMinor: minor, note: refundNote.trim() || undefined });
      addToast('success', 'Refund approved and credited.');
      void load(); onChanged();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const reject = async () => {
    if (!rejectReason.trim()) { addToast('error', 'Add a reason.'); return; }
    setBusy(true);
    try {
      await supportAgentApi.reject(ticketId, rejectReason.trim());
      addToast('success', 'Ticket rejected.');
      setShowReject(false); void load(); onChanged();
    } catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const isResolved = ticket?.status === 'resolved' || ticket?.status === 'closed';
  const isRefund = ticket?.category === 'refund';
  const decided = !!ticket?.resolutionType;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={onBack}><ArrowLeft size={16} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket?.subject ?? '…'}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
            {ticket && <Badge text={CATEGORY_LABEL[ticket.category]} cls="badge-violet" />}
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
        {ticket?.relatedType && <div>Related: {ticket.relatedType} <code>{ticket.relatedId}</code></div>}
        {isRefund && ticket?.requestedAmountMinor != null && <div>Requested refund: <strong>{formatCredits(ticket.requestedAmountMinor)}</strong></div>}
        {ticket?.resolutionType && (
          <div style={{ marginTop: 4 }}>
            Resolution: <strong>{ticket.resolutionType}</strong>
            {ticket.refundedAmountMinor != null && ` — ${formatCredits(ticket.refundedAmountMinor)}`}
            {ticket.resolutionNote && ` (${ticket.resolutionNote})`}
          </div>
        )}
      </div>

      {/* Thread */}
      <div ref={scrollRef} style={{ maxHeight: 320, overflowY: 'auto', padding: '4px 2px', marginBottom: 10 }}>
        {messages.map((m) => {
          if (m.authorRole === 'system') {
            return <div key={m.id} style={{ textAlign: 'center', margin: '6px 0', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{m.body}</div>;
          }
          const mine = m.authorRole === 'agent';
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{
                maxWidth: '80%',
                background: m.internal ? '#f59e0b22' : mine ? 'var(--accent)' : 'var(--card-bg)',
                color: m.internal ? 'var(--text-primary)' : mine ? '#fff' : 'var(--text-primary)',
                border: m.internal ? '1px dashed #f59e0b' : mine ? 'none' : '1px solid var(--border)',
                borderRadius: 12, padding: '8px 11px',
              }}>
                {m.internal && <div style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', marginBottom: 3 }}>INTERNAL NOTE</div>}
                <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3, textAlign: 'right' }}>{formatRelativeTime(m.createdAt)}</div>
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {STATUS_OPTIONS.filter((s) => s !== ticket?.status).map((s) => (
            <button key={s} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
      )}

      {/* Refund decision */}
      {isRefund && !decided && (
        <div className="card" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Refund decision</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder="Amount (ETB)" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} inputMode="decimal" style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={approveRefund}><CheckCircle2 size={14} /> Approve</button>
          </div>
          <input className="input" placeholder="Note (optional)" value={refundNote} onChange={(e) => setRefundNote(e.target.value)} style={{ marginBottom: 8 }} />
          {!showReject ? (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger, #ef4444)' }} onClick={() => setShowReject(true)}><XCircle size={14} /> Reject</button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" placeholder="Reason for rejection" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-sm" disabled={busy} onClick={reject} style={{ background: '#ef4444', color: '#fff' }}>Confirm</button>
            </div>
          )}
        </div>
      )}

      {/* Non-refund reject */}
      {!isRefund && !decided && !isResolved && (
        showReject ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="Reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-sm" disabled={busy} onClick={reject} style={{ background: '#ef4444', color: '#fff' }}>Reject</button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowReject(true)} style={{ fontSize: 11 }}>Reject / decline</button>
        )
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
