import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore, type LiveCounts } from '../store/useStore';
import type { Wallet } from '../lib/models';
import { gamesApi, type GameCatalogEntry } from '../lib/api';

let socketInstance: Socket | null = null;

type MaintenancePayload = {
    etaSeconds: number;
};

// Silently refresh the access token using the stored refresh token
async function refreshAccessToken(): Promise<string | null> {
    try {
        const rt = localStorage.getItem('refreshToken');
        if (!rt) return null;
        const baseUrl = import.meta.env.VITE_API_URL ?? '/api';
        const res = await fetch(`${baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
            accessToken: string;
            refreshToken?: string;
        };
        localStorage.setItem('accessToken', data.accessToken);
        if (data.refreshToken)
            localStorage.setItem('refreshToken', data.refreshToken);
        return data.accessToken;
    } catch {
        return null;
    }
}

/**
 * Freshest access token available. localStorage is authoritative: both the login
 * path and the socket's own silent refresh write it, whereas the store's
 * accessToken is only updated on auth  so localStorage is never staler.
 */
function currentToken(): string | null {
    return (
        localStorage.getItem('accessToken') ?? useStore.getState().accessToken
    );
}

export function useSocketConnection() {
    const setSocketConnected = useStore((s) => s.setSocketConnected);
    const isAuthenticated = useStore((s) => s.isAuthenticated);
    const accessToken = useStore((s) => s.accessToken);
    const addToast = useStore((s) => s.addToast);
    const setWallet = useStore((s) => s.setWallet);

    useEffect(() => {
        if (!isAuthenticated) return;

        if (!socketInstance) {
            const token = currentToken();
            // Empty string = connect to the current page origin.
            // In dev, Vite proxies /socket.io → localhost:3000 so this works through
            // ngrok and any other tunnel without exposing localhost to the client.
            // In production, VITE_API_URL is the absolute backend domain.
            const SOCKET_URL = import.meta.env.VITE_API_URL ?? '';

            socketInstance = io(SOCKET_URL, {
                auth: { token },
                // Try a real WebSocket first instead of socket.io's default
                // "long-poll, then upgrade"  that extra polling round-trip before
                // the upgrade is pure added latency once WebSocket is known to work
                // (it already has to, for live game state), and it's what was
                // delaying the admin "player opened the app" alert.
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 10000,
                timeout: 20000,
            });

            socketInstance.on('connect', () => {
                setSocketConnected(true);
                // Pull live counts immediately so the UI doesn't wait for the next heartbeat.
                socketInstance?.emit('request.counts');
                // Refresh the game availability catalog on (re)connect.
                gamesApi
                    .getCatalog()
                    .then((c) => useStore.getState().setGameCatalog(c))
                    .catch(() => {});
            });
            socketInstance.on('disconnect', () => setSocketConnected(false));

            // On connect error, silently try to refresh the access token and update
            // the socket auth before the next reconnect attempt  users should never
            // see an "Access token invalid" toast just because their tab was open.
            socketInstance.on('connect_error', async () => {
                setSocketConnected(false);
                if (!socketInstance) return;
                // Only refresh if we have a refresh token (i.e., not a network error)
                const newToken = await refreshAccessToken();
                if (newToken && socketInstance) {
                    // Update auth so the next reconnect uses the fresh token
                    socketInstance.auth = { token: newToken };
                }
            });

            socketInstance.on(
                'system.maintenance',
                (data: MaintenancePayload) => {
                    addToast(
                        'error',
                        `Server going down for maintenance in ${data.etaSeconds} seconds.`,
                    );
                },
            );

            socketInstance.on('wallet.updated', (wallet: Wallet) => {
                setWallet(wallet);
            });

            socketInstance.on('live.counts', (counts: LiveCounts) => {
                useStore.getState().setLiveCounts(counts);
            });

            // Admin toggled a game on/off/maintenance  update the catalog live.
            socketInstance.on(
                'games.catalog.updated',
                (catalog: GameCatalogEntry[]) => {
                    useStore.getState().setGameCatalog(catalog);
                },
            );
        }

        // ── Foreground recovery ──────────────────────────────────────────────
        // Telegram Mini Apps (and mobile browser tabs) freeze the webview while
        // backgrounded, which silently kills the socket's transport. socket.io can
        // take tens of seconds to notice, so the online count looks frozen/absent
        // until a manual reload. When the app returns to the foreground we make sure
        // the token is fresh, force a reconnect if the transport is down, and always
        // re-pull counts so the number is live again immediately  no reload needed.
        const onForeground = () => {
            if (
                typeof document !== 'undefined' &&
                document.visibilityState !== 'visible'
            )
                return;
            if (!socketInstance) return;
            socketInstance.auth = { token: currentToken() };
            if (socketInstance.connected) {
                // The transport never actually dropped, so the server's
                // handleConnection won't re-fire on its own  tell it explicitly
                // that the app is back in front (powers the admin "player opened
                // the app" alert for this case; see game-events.gateway.ts).
                socketInstance.emit('player.app_opened');
            } else {
                // A real reconnect already re-triggers handleConnection (and its
                // own alert) once it completes, so don't also emit here  that
                // would double it up.
                socketInstance.connect();
            }
            socketInstance.emit('request.counts');
        };
        document.addEventListener('visibilitychange', onForeground);
        window.addEventListener('focus', onForeground);

        return () => {
            document.removeEventListener('visibilitychange', onForeground);
            window.removeEventListener('focus', onForeground);
            if (socketInstance) {
                socketInstance.disconnect();
                socketInstance = null;
                setSocketConnected(false);
            }
        };
    }, [isAuthenticated, setSocketConnected, addToast, setWallet]);

    // ── Keep the socket's auth token fresh ───────────────────────────────────
    // The socket captures the access token once at creation. When a re-auth rotates
    // the token (Telegram initData login, silent refresh), push the new one onto the
    // existing socket and reconnect if it had dropped  otherwise a stale token can
    // lock the socket out of reconnecting, and counts never arrive until a reload.
    useEffect(() => {
        if (!socketInstance || !accessToken) return;
        socketInstance.auth = { token: accessToken };
        if (!socketInstance.connected) socketInstance.connect();
    }, [accessToken]);

    return socketInstance;
}

export const getSocket = () => socketInstance;
