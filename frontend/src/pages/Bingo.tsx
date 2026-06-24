import { useCallback, useEffect, useMemo, useState } from "react";
import { GameTabs, type GameTabOption } from "../components/GameTabs";
import { Gamepad2, Hash, Ticket } from 'lucide-react';
import { bingoApi, walletApi } from "../lib/api";
import type { BingoRoom, BingoRoomState } from "../lib/models";
import {
    createIdempotencyKey,
    formatCreditsFull,
    formatDateTime,
    formatRelativeTime,
    getErrorMessage,
    titleCase,
} from "../lib/utils";

function formatPrizeTier(key: string): string {
    return titleCase(key.replace(/minor$/i, '').trim());
}
import { formatCredits, useStore } from "../store/useStore";
import { getSocket } from "../hooks/useSocketConnection";
import { soundEngine } from "../lib/audio";
import confetti from "canvas-confetti";

type BingoRoomEventPayload = {
    roomId?: string;
};

type BingoProps = {
    onBack: () => void;
};

type BingoTab = "active" | "draws" | "tickets";

const BINGO_TABS: Array<GameTabOption<BingoTab>> = [
    { id: "active", label: "Active Game", description: "Rooms, status, and ticket purchase.", icon: <Gamepad2 size={20} /> },
    { id: "draws", label: "Drawn Numbers", description: "Live Bingo balls for the selected room.", icon: <Hash size={20} /> },
    { id: "tickets", label: "Your Tickets", description: "Your Bingo cards and results.", icon: <Ticket size={20} /> },
];

export function Bingo({ onBack }: BingoProps) {
    const addToast = useStore((state) => state.addToast);
    const setWallet = useStore((state) => state.setWallet);
    const liveCounts = useStore((state) => state.liveCounts);
    const [rooms, setRooms] = useState<BingoRoom[]>([]);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [roomState, setRoomState] = useState<BingoRoomState | null>(null);
    const [ticketCount, setTicketCount] = useState(1);
    const [loadingRooms, setLoadingRooms] = useState(true);
    const [loadingRoomState, setLoadingRoomState] = useState(false);
    const [buying, setBuying] = useState(false);
    const [activeTab, setActiveTab] = useState<BingoTab>("active");

    const loadRooms = useCallback(async () => {
        setLoadingRooms(true);
        try {
            const nextRooms = await bingoApi.listRooms();
            setRooms(nextRooms);
            setSelectedRoomId((current) => current ?? nextRooms[0]?.id ?? null);
        } catch (error) {
            addToast("error", getErrorMessage(error));
        } finally {
            setLoadingRooms(false);
        }
    }, [addToast]);

    const loadRoomState = useCallback(
        async (roomId: string) => {
            setLoadingRoomState(true);
            try {
                const nextRoomState = await bingoApi.getRoomState(roomId);
                setRoomState(nextRoomState);
            } catch (error) {
                addToast("error", getErrorMessage(error));
            } finally {
                setLoadingRoomState(false);
            }
        },
        [addToast],
    );

    useEffect(() => {
        void loadRooms();
    }, [loadRooms]);

    useEffect(() => {
        if (!selectedRoomId) {
            setRoomState(null);
            return;
        }

        void loadRoomState(selectedRoomId);

        const socket = getSocket();
        if (socket) {
            socket.emit('enter.game', { game: 'bingo' });

            const handleRoomUpdate = (payload: BingoRoomEventPayload) => {
                if (payload.roomId === selectedRoomId) {
                    void Promise.all([loadRoomState(selectedRoomId), loadRooms()]);
                } else {
                    void loadRooms(); // If a different room updated, refresh the rooms list
                }
            };

            const handleNumberDrawn = (payload: BingoRoomEventPayload) => {
                if (payload.roomId === selectedRoomId) {
                    soundEngine.pop();
                    void loadRoomState(selectedRoomId);
                }
            };

            const handleRoomCompleted = (payload: BingoRoomEventPayload) => {
                if (payload.roomId === selectedRoomId) {
                    void loadRoomState(selectedRoomId);
                    addToast(
                        "info",
                        "Bingo room completed and payouts settled.",
                    );
                }
            };

            socket.on("bingo.room.updated", handleRoomUpdate);
            socket.on("bingo.number.drawn", handleNumberDrawn);
            socket.on("bingo.room.completed", handleRoomCompleted);

            return () => {
                socket.emit('leave.game', { game: 'bingo' });
                socket.off("bingo.room.updated", handleRoomUpdate);
                socket.off("bingo.number.drawn", handleNumberDrawn);
                socket.off("bingo.room.completed", handleRoomCompleted);
            };
        }
    }, [loadRoomState, loadRooms, selectedRoomId, addToast]);

    // Check for wins to trigger confetti
    useEffect(() => {
        if (roomState?.status === "completed" && roomState.tickets?.length) {
            const hasWinningTicket = roomState.tickets.some(
                (t) => t.payoutMinor > 0,
            );
            if (hasWinningTicket) {
                soundEngine.win();
                confetti({
                    particleCount: 200,
                    spread: 100,
                    origin: { y: 0.5 },
                    colors: ["#00FFFF", "#FF00FF", "#FFFFFF"],
                });
            }
        }
    }, [roomState?.status, roomState?.tickets]); // Only run when status changes or tickets update

    const selectedRoom = useMemo(
        () =>
            roomState ??
            rooms.find((room) => room.id === selectedRoomId) ??
            null,
        [roomState, rooms, selectedRoomId],
    );

    const remainingTickets = selectedRoom
        ? Math.max(0, selectedRoom.maxTickets - selectedRoom.soldTickets)
        : 0;
    const salesOpen = selectedRoom?.status === "open";
    const buyDisabledReason = !selectedRoom
        ? "Pick a room first."
        : !salesOpen
        ? "Ticket sales are closed for this room."
        : remainingTickets <= 0
        ? "This room is sold out."
        : null;

    const buyTickets = async () => {
        if (!selectedRoomId) {
            addToast("info", "Pick a room before buying tickets.");
            return;
        }
        if (buyDisabledReason) {
            addToast("info", buyDisabledReason);
            return;
        }

        setBuying(true);
        try {
            await bingoApi.purchaseTickets(
                selectedRoomId,
                ticketCount,
                createIdempotencyKey("bingo"),
            );
            const [wallet] = await Promise.all([
                walletApi.getWallet(),
                loadRoomState(selectedRoomId),
                loadRooms(),
            ]);
            setWallet(wallet);
            addToast(
                "success",
                `Bought ${ticketCount} Bingo ticket${ticketCount === 1 ? "" : "s"}.`,
            );
        } catch (error) {
            addToast("error", getErrorMessage(error));
        } finally {
            setBuying(false);
        }
    };

    return (
        <div className="stack-lg">
            <GameTabs
                tabs={BINGO_TABS}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onBack={onBack}
                ariaLabel="Bingo sections"
            />

            <section className="card hero-subpanel">
                <div className="section-header">
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="section-title">Bingo Rooms</div>
                            {liveCounts && liveCounts.bingoOnline > 0 && (
                                <span className="live-badge-pulse">
                                    <span className="pulse-dot"></span>
                                    {liveCounts.bingoOnline} online
                                </span>
                            )}
                        </div>
                        <p className="section-copy">
                            Track active rooms, buy tickets, and follow live
                            numbers as tiers settle.
                        </p>
                    </div>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void loadRooms()}
                    >
                        Refresh
                    </button>
                </div>

                {loadingRooms && rooms.length === 0 ? (
                    <div className="card-muted">Loading Bingo rooms...</div>
                ) : (
                    <div className="room-strip">
                        {rooms.map((room) => (
                            <button
                                key={room.id}
                                className={`room-chip${selectedRoomId === room.id ? " active" : ""}`}
                                onClick={() => setSelectedRoomId(room.id)}
                            >
                                <strong>{room.name}</strong>
                                <span>
                                    {room.soldTickets}/{room.maxTickets} sold
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            {selectedRoom ? (
                <>
                    {activeTab === 'active' && (
                    <div className="game-tab-panel" role="tabpanel" aria-label="Active Game">
                    <section className="card">
                        <div className="section-header">
                            <div>
                                <div className="section-title">
                                    {selectedRoom.name}
                                </div>
                                <p className="section-copy">
                                    {selectedRoom.status === 'running'
                                        ? 'In progress · drawing numbers automatically'
                                        : selectedRoom.status === 'open'
                                        ? `Starts ${formatRelativeTime(selectedRoom.scheduledStartAt)}`
                                        : selectedRoom.status === 'completed'
                                        ? 'Game over · results settled'
                                        : selectedRoom.status}
                                </p>
                            </div>
                            <span className={`badge ${
                                selectedRoom.status === 'running' ? 'badge-green' :
                                selectedRoom.status === 'completed' ? 'badge-violet' :
                                selectedRoom.status === 'cancelled' ? 'badge-red' : 'badge-gold'
                            }`}>
                                {selectedRoom.status === 'running' ? 'Live' :
                                 selectedRoom.status === 'open' ? 'Open' :
                                 selectedRoom.status === 'completed' ? 'Completed' : selectedRoom.status}
                            </span>
                        </div>

                        <div className="stats-grid">
                            <div className="stat-card">
                                <span className="stat-label">Ticket Price</span>
                                <strong>
                                    {formatCredits(
                                        selectedRoom.ticketPriceMinor,
                                    )}{" "}
                                    Credits
                                </strong>
                            </div>
                            <div className="stat-card">
                                <span className="stat-label">Sold Tickets</span>
                                <strong>
                                    {selectedRoom.soldTickets}/
                                    {selectedRoom.maxTickets}
                                </strong>
                            </div>
                            <div className="stat-card">
                                <span className="stat-label">Starts</span>
                                <strong>
                                    {formatDateTime(
                                        selectedRoom.scheduledStartAt,
                                    )}
                                </strong>
                            </div>
                        </div>

                        <div className="divider" />

                        <div className="purchase-panel">
                            <div>
                                <h3>Buy Tickets</h3>
                                <p className="section-copy">
                                    Each ticket is a unique 3×9 card with 15 numbers.
                                </p>
                            </div>
                            <div className="purchase-controls">
                                <input
                                    className="input compact-input"
                                    type="number"
                                    min={1}
                                    max={Math.max(1, Math.min(24, remainingTickets || 24))}
                                    value={ticketCount}
                                    onChange={(event) =>
                                        setTicketCount(
                                            Number(event.target.value) || 1,
                                        )
                                    }
                                />
                                <button
                                    className="btn btn-primary"
                                    disabled={buying || !!buyDisabledReason}
                                    onClick={buyTickets}
                                >
                                    {buying ? "Buying..." : "Buy Tickets"}
                                </button>
                            </div>
                            {buyDisabledReason && (
                                <p className="section-copy" style={{ marginTop: 8 }}>
                                    {buyDisabledReason}
                                </p>
                            )}
                        </div>
                    </section>
                    </div>
                    )}

                    {activeTab === 'draws' && (
                    <section className="card" role="tabpanel" aria-label="Drawn Numbers">
                        <div className="section-header">
                            <div>
                                <div className="section-title">Drawn Numbers</div>
                                <p className="section-copy">
                                    {(roomState?.drawnNumbers.length ?? 0) > 0
                                        ? `Ball ${roomState!.drawnNumbers.length} of 90 drawn`
                                        : 'Waiting for first ball.'}
                                </p>
                            </div>
                        </div>
                        {loadingRoomState && !roomState ? (
                            <div className="card-muted">
                                Loading room state...
                            </div>
                        ) : (
                            <>
                                <div className="ball-row">
                                    {(roomState?.drawnNumbers ?? []).length >
                                    0 ? (
                                        roomState?.drawnNumbers.map((value) => (
                                            <span
                                                key={value}
                                                className="ball ball-drawn"
                                            >
                                                {value}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-muted">
                                            No numbers drawn yet.
                                        </span>
                                    )}
                                </div>
                                <div className="divider" />
                                <div className="prize-grid">
                                    {Object.entries(selectedRoom.prizes).map(
                                        ([tier, amount]) => (
                                            <div
                                                key={tier}
                                                className="prize-card"
                                            >
                                                <span className="prize-tier">
                                                    {formatPrizeTier(tier)}
                                                </span>
                                                <strong>
                                                    {formatCreditsFull(amount)}{" "}
                                                    Credits
                                                </strong>
                                            </div>
                                        ),
                                    )}
                                </div>
                            </>
                        )}
                    </section>
                    )}

                    {activeTab === 'tickets' && (
                    <section className="card" role="tabpanel" aria-label="Your Tickets">
                        <div className="section-header">
                            <div>
                                <div className="section-title">
                                    Your Tickets In This Room
                                </div>
                                <p className="section-copy">
                                    Room-specific ticket state when available.
                                </p>
                            </div>
                        </div>

                        {roomState?.tickets?.length ? (
                            <div className="list-stack">
                                {roomState.tickets.map((ticket) => (
                                    <article
                                        key={ticket.id}
                                        className="ticket-card"
                                    >
                                        <div className="list-card-header">
                                            <div>
                                                <h3>
                                                    Ticket {ticket.id.slice(-6)}
                                                </h3>
                                                <p>
                                                    {ticket.wonTiers.length > 0
                                                        ? `Won: ${ticket.wonTiers.map(titleCase).join(", ")}`
                                                        : "Awaiting settlement"}
                                                </p>
                                            </div>
                                            <span
                                                className={`badge ${ticket.payoutMinor > 0 ? "badge-green" : "badge-gold"}`}
                                            >
                                                {ticket.payoutMinor > 0
                                                    ? "Paid"
                                                    : ticket.settlementStatus}
                                            </span>
                                        </div>
                                        <div className="ticket-grid">
                                            {ticket.grid.map(
                                                (row, rowIndex) => (
                                                    <div
                                                        key={`${ticket.id}-${rowIndex}`}
                                                        className="ticket-row"
                                                    >
                                                        {row.map(
                                                            (
                                                                value,
                                                                columnIndex,
                                                            ) =>
                                                                value ? (
                                                                    <span
                                                                        key={`${ticket.id}-${rowIndex}-${columnIndex}`}
                                                                        className={`ticket-cell${ticket.markedNumbers.includes(value) ? " marked" : ""}`}
                                                                    >
                                                                        {value}
                                                                    </span>
                                                                ) : (
                                                                    <span
                                                                        key={`${ticket.id}-${rowIndex}-${columnIndex}`}
                                                                        className="ticket-cell empty"
                                                                    />
                                                                ),
                                                        )}
                                                    </div>
                                                ),
                                            )}
                                        </div>
                                        <div className="ticket-meta">
                                            <span>
                                                Stake:{" "}
                                                {formatCredits(
                                                    ticket.stakeMinor,
                                                )}
                                            </span>
                                            <span>
                                                Payout:{" "}
                                                {formatCreditsFull(
                                                    ticket.payoutMinor,
                                                )}
                                            </span>
                                            <span>
                                                Lines:{" "}
                                                {ticket.completedLines.length}
                                            </span>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <div className="card-muted">
                                {roomState
                                    ? "Buy tickets for this room to see them here."
                                    : "Select a room to see your tickets."}
                            </div>
                        )}
                    </section>
                    )}
                </>
            ) : (
                <section className="card">
                    <div className="card-muted">
                        No Bingo rooms available yet.
                    </div>
                </section>
            )}
        </div>
    );
}
