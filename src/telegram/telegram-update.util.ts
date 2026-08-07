/**
 * Summarizes a raw Telegram Update for logging. grammY's webhook timeout error
 * ("Request timed out after 10000 ms") carries no reference to which update was
 * being processed, so a stall is otherwise unattributable to a specific handler
 * — this turns the next occurrence into an actionable log line instead of a
 * dead end.
 */
export function describeTelegramUpdate(body: unknown): string {
  if (!body || typeof body !== 'object') return 'update_id=? type=unknown';
  const b = body as Record<string, any>;
  const updateId = b.update_id ?? '?';
  const kind =
    ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member', 'inline_query'].find(
      (k) => b[k] !== undefined,
    ) ?? 'unknown';
  const payload = b[kind] ?? {};
  const chat = payload.chat ?? payload.message?.chat;
  const from = payload.from;
  const text: string | undefined =
    typeof payload.text === 'string' ? payload.text : typeof payload.data === 'string' ? payload.data : undefined;
  return (
    `update_id=${updateId} type=${kind} chat=${chat?.id ?? '?'} from=${from?.id ?? '?'}` +
    (text ? ` text="${text.slice(0, 40)}"` : '')
  );
}
