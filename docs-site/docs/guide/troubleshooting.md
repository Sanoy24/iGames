# Troubleshooting

## Common Issues

### Schedulers are missing execution
- **Cause**: Redis connection dropping or Lock TTL is too long and the process died mid-execution.
- **Fix**: Check `RedisLockService`. Ensure `DRAW_LOCK_TTL_MS` accounts for max execution time but isn't stuck forever.

### "Idempotent wallet mutation is already in progress"
- **Cause**: The client double-tapped the buy button with the exact same `Idempotency-Key` while the first database transaction was still in flight.
- **Fix**: The framework natively blocks this with `409 Conflict`. Frontend should aggressively disable buttons upon click.

### Bingo balls are out of sync on frontend
- **Cause**: Telegram Mini-Apps pause WebSockets when minimized on iOS/Android.
- **Fix**: The frontend handles this via `socket.on('connect')`. It queries `GET /bingo/rooms/:id/sync` which returns the full array of drawn numbers to instantly restore the visual Bingo card state.

## Debugging

The platform outputs detailed logs via NestJS built-in `Logger`.
- Set `NODE_ENV=development` to enable verbose Mongoose query debugging.
- Use `admin Platform Stats` to visually audit global GGR and verify that `Total Liabilities` is behaving correctly.
