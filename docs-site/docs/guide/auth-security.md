# Authentication & Security

Security in iGames revolves around **Stateless JWTs**, **Telegram App Data Validation**, and **Idempotency Locks**.

## Telegram Mini-App Authentication

Users authenticate without passwords. When the Mini-App opens inside Telegram, it receives a cryptographically signed payload (`initData`).

1. The frontend POSTs `initData` to `/auth/telegram/miniapp`.
2. The `AuthService` extracts the bot token and securely validates the payload signature using `crypto.createHmac`.
3. If verified, the system either provisions a new `User` and `Wallet` or fetches the existing ones.
4. A signed JWT is returned for subsequent API calls.

## Guards and Decorators

The framework exposes strict Guards to protect routes:

- `@UseGuards(JwtAuthGuard)`: Requires a valid JWT Bearer token.
- `@UseGuards(RolesGuard)` combined with `@Roles('admin')`: Restricts endpoint access strictly to administrators.

## Financial Security (Idempotency)

Financial security is enforced at the controller level. Whenever a mutating action occurs (e.g., buying a ticket), the client *must* submit an `Idempotency-Key` header.

```typescript
@Post('rooms/:id/tickets')
async purchaseTickets(
  @Body() dto: PurchaseBingoTicketsDto,
  @Headers('idempotency-key') idempotencyKey: string
) {
  // WalletService uses the key to safely cache/reject duplicate requests
}
```

## Audit Logging

Destructive administrative actions (like `PUT /users/:id/status` or wallet adjustments) are captured by the `AdminAuditInterceptor`. It logs the admin's ID, route, IP, and body payload directly into an `adminauditlogs` MongoDB collection to satisfy regulatory non-repudiation requirements.
