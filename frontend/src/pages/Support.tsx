import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LifeBuoy, Send, Plus, X } from 'lucide-react';
import {
  supportApi,
  type SupportMessage,
  type SupportRequestType,
} from '../lib/api';
import { useSupportSocket, type SupportMessageEvent, type SupportRequestEvent } from '../hooks/useSupportSocket';
import { useStore, formatCredits } from '../store/useStore';
import { getErrorMessage, formatRelativeTime } from '../lib/utils';

const REQUEST_LABEL: Record<SupportRequestType, string> = {
  refund: 'support.reqRefund',
  dispute: 'support.reqDispute',
  complaint: 'support.reqComplaint',
};
const STATUS_CLASS: Record<string, string> = {
  pending: 'badge-gold',
  approved: 'badge-green',
  rejected: 'badge-red',
};

/** One message bubble; if it carries a tagged request, shows a status chip. */
function Bubble({ m, mine, t }: { m: SupportMessage; mine: boolean; t: (k: string, o?: Record<string, unknown>) => string }) {
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
        maxWidth: '80%',
        background: mine ? 'var(--accent)' : 'var(--card-bg)',
        color: mine ? '#1a1200' : 'var(--text-primary)',
        border: mine ? 'none' : '1px solid var(--border)',
        borderRadius: 12,
        padding: '8px 11px',
      }}>
        {m.requestType && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span className="badge badge-violet" style={{ fontSize: 9 }}>{t(REQUEST_LABEL[m.requestType])}</span>
            {m.requestType === 'refund' && m.requestedAmountMinor != null && (
              <span style={{ fontSize: 11, fontWeight: 800 }}>{formatCredits(m.requestedAmountMinor)} ETB</span>
            )}
            {m.requestStatus && (
              <span className={`badge ${STATUS_CLASS[m.requestStatus] ?? ''}`} style={{ fontSize: 9 }}>
                {t(`support.status_${m.requestStatus}`)}
              </span>
            )}
          </div>
        )}
        <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
        {m.requestStatus === 'approved' && m.refundedAmountMinor != null && (
          <div style={{ fontSize: 11, marginTop: 3, color: mine ? '#1a1200' : '#10b981' }}>
            ✅ {t('support.refundedAmount', { amount: formatCredits(m.refundedAmountMinor) })}
          </div>
        )}
        {m.requestStatus === 'rejected' && m.resolutionNote && (
          <div style={{ fontSize: 11, marginTop: 3, color: mine ? '#1a1200' : '#ef4444' }}>{m.resolutionNote}</div>
        )}
        <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3, textAlign: 'right' }}>{formatRelativeTime(m.createdAt)}</div>
      </div>
    </div>
  );
}

// ── Request composer (bottom sheet) ───────────────────────────────
function RequestSheet({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (input: { requestType: SupportRequestType; body: string; requestedAmountMinor?: number; relatedType?: string; relatedId?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const addToast = useStore((s) => s.addToast);
  const [type, setType] = useState<SupportRequestType>('refund');
  const [amount, setAmount] = useState('');
  const [relatedId, setRelatedId] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (body.trim().length < 1) { addToast('error', t('support.describeIssue')); return; }
    const input: { requestType: SupportRequestType; body: string; requestedAmountMinor?: number; relatedType?: string; relatedId?: string } = { requestType: type, body: body.trim() };
    if (type === 'refund') {
      const minor = Math.round(parseFloat(amount) * 100);
      if (!minor || minor < 1) { addToast('error', t('support.enterRefundAmount')); return; }
      input.requestedAmountMinor = minor;
    }
    if ((type === 'dispute' || type === 'refund') && relatedId.trim()) {
      input.relatedType = 'withdrawal';
      input.relatedId = relatedId.trim();
    }
    setSubmitting(true);
    try { await onSubmit(input); onClose(); }
    catch (e) { addToast('error', getErrorMessage(e)); }
    finally { setSubmitting(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 520, borderRadius: '16px 16px 0 0', padding: '16px 16px calc(20px + env(safe-area-inset-bottom, 0px))', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 16 }}>{t('support.newRequest')}</strong>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 12 }}>
          {(['refund', 'dispute', 'complaint'] as const).map((ty) => (
            <button key={ty} className={`btn btn-sm ${type === ty ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType(ty)} style={{ fontSize: 11 }}>
              {t(REQUEST_LABEL[ty])}
            </button>
          ))}
        </div>

        {type === 'refund' && (
          <input className="input" placeholder={t('support.refundAmountPlaceholder')} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ marginBottom: 10 }} />
        )}
        {(type === 'refund' || type === 'dispute') && (
          <input className="input" placeholder={t('support.relatedIdPlaceholder')} value={relatedId} onChange={(e) => setRelatedId(e.target.value)} style={{ marginBottom: 10 }} />
        )}
        <textarea className="input" placeholder={t('support.describeIssue')} value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} style={{ marginBottom: 14, resize: 'vertical' }} />

        <button className="btn btn-primary" style={{ width: '100%' }} disabled={submitting} onClick={submit}>
          {submitting ? t('support.sending') : t('support.sendRequest')}
        </button>
      </div>
    </div>
  );
}

// ── Page: one persistent chat window ──────────────────────────────
export function Support({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const addToast = useStore((s) => s.addToast);
  const currentUserId = useStore((s) => s.user?.id);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showRequest, setShowRequest] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await supportApi.getConversation();
      setTicketId(data.ticket.id);
      setMessages(data.messages);
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  useSupportSocket({
    onMessage: (e: SupportMessageEvent) => {
      if (ticketId && e.ticketId !== ticketId) return;
      setMessages((prev) => prev.some((m) => m.id === e.messageId) ? prev : [...prev, {
        id: e.messageId, authorId: e.authorId, authorRole: e.authorRole, body: e.body, attachments: null, internal: false, createdAt: e.createdAt,
        requestType: (e.requestType ?? null) as SupportMessage['requestType'], requestStatus: (e.requestStatus ?? null) as SupportMessage['requestStatus'],
        requestedAmountMinor: e.requestedAmountMinor ?? null, relatedType: null, relatedId: null, refundedAmountMinor: null, resolutionNote: null, decidedAt: null,
      }]);
    },
    onRequestUpdated: (e: SupportRequestEvent) => {
      setMessages((prev) => prev.map((m) => m.id === e.messageId
        ? { ...m, requestStatus: (e.requestStatus ?? m.requestStatus) as SupportMessage['requestStatus'], refundedAmountMinor: e.refundedAmountMinor ?? m.refundedAmountMinor }
        : m));
    },
  }, ticketId ?? undefined);

  const appendMine = (m: SupportMessage) => setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);

  const sendPlain = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const m = await supportApi.postMessage({ body });
      appendMine(m);
      setText('');
    } catch (e) {
      addToast('error', getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const submitRequest = async (input: Parameters<typeof supportApi.postMessage>[0]) => {
    const m = await supportApi.postMessage(input);
    appendMine(m);
    addToast('success', t('support.requestSent'));
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 12px 80px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 130px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm icon-btn" onClick={onBack}><ArrowLeft size={16} /></button>
        <LifeBuoy size={18} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 17 }}>{t('support.title')}</span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 2px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" /></div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 40 }}>
            👋 {t('support.emptyChat')}
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} mine={m.authorRole === 'user' && m.authorId === currentUserId} t={t} />)
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 8, alignItems: 'center' }}>
        <button className="btn btn-secondary btn-sm icon-btn" onClick={() => setShowRequest(true)} title={t('support.newRequest')} style={{ flexShrink: 0 }}>
          <Plus size={16} />
        </button>
        <input
          className="input"
          placeholder={t('support.messagePlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void sendPlain(); }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary icon-btn" disabled={sending || !text.trim()} onClick={sendPlain} style={{ flexShrink: 0 }}><Send size={16} /></button>
      </div>

      {showRequest && <RequestSheet onClose={() => setShowRequest(false)} onSubmit={submitRequest} />}
    </div>
  );
}
