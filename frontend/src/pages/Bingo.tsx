import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatCredits, useStore } from "../store/useStore";
import { getSocket } from "../hooks/useSocketConnection";
import { soundEngine } from "../lib/audio";
import confetti from "canvas-confetti";

export function Bingo() {
    const addToast = useStore((state) => state.addToast);
    const setWallet = useStore((state) => state.setWallet);
    const [rooms, setRooms] = useState<BingoRoom[]>([]);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [roomState, setRoomState] = useState<BingoRoomState | null>(null);
    const [ticketCount, setTicketCount] = useState(1);
    const [loadingRooms, setLoadingRooms] = useState(true);
    const [loadingRoomState, setLoadingRoomState] = useState(false);
    const [buying, setBuying] = useState(false);

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
            const handleRoomUpdate = (payload: any) => {
                if (payload.roomId === selectedRoomId) {
                    void loadRoomState(selectedRoomId);
                } else {
                    void loadRooms(); // If a different room updated, refresh the rooms list
                }
            };

            const handleNumberDrawn = (payload: any) => {
                if (payload.roomId === selectedRoomId) {
                    soundEngine.pop();
                    void loadRoomState(selectedRoomId);
                }
            };

            const handleRoomCompleted = (payload: any) => {
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
    }, [roomState?.status]); // Only run when status changes to completed

    const selectedRoom = useMemo(
        () =>
            rooms.find((room) => room.id === selectedRoomId) ??
            roomState ??
            null,
        [roomState, rooms, selectedRoomId],
    );

    const buyTickets = async () => {
        if (!selectedRoomId) {
            addToast("info", "Pick a room before buying tickets.");
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
            <section className="card hero-subpanel">
                <div className="section-header">
                    <div>
                        <div className="section-title">Bingo Rooms</div>
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
                    <section className="card">
                        <div className="section-header">
                            <div>
                                <div className="section-title">
                                    {selectedRoom.name}
                                </div>
                                <p className="section-copy">
                                    Starts{" "}
                                    {formatRelativeTime(
                                        selectedRoom.scheduledStartAt,
                                    )}{" "}
                                    · {selectedRoom.status}
                                </p>
                            </div>
                            <span
                                className={`badge ${selectedRoom.status === "running" ? "badge-green" : "badge-violet"}`}
                            >
                                {selectedRoom.status}
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
                                    Each ticket uses the same backend purchase
                                    flow as the API.
                                </p>
                            </div>
                            <div className="purchase-controls">
                                <input
                                    className="input compact-input"
                                    type="number"
                                    min={1}
                                    max={24}
                                    value={ticketCount}
                                    onChange={(event) =>
                                        setTicketCount(
                                            Number(event.target.value) || 1,
                                        )
                                    }
                                />
                                <button
                                    className="btn btn-primary"
                                    disabled={buying}
                                    onClick={buyTickets}
                                >
                                    {buying ? "Buying..." : "Buy Tickets"}
                                </button>
                            </div>
                        </div>
                    </section>

                    <section className="card">
                        <div className="section-header">
                            <div>
                                <div className="section-title">
                                    Drawn Numbers
                                </div>
                                <p className="section-copy">
                                    Live room state from `GET
                                    /bingo/rooms/:id/state`.
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
                                                    {titleCase(tier)}
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

                    <section className="card">
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
                                    ? "Your room tickets are not available on this endpoint yet, but purchase flow is live."
                                    : "Select a room to inspect ticket state."}
                            </div>
                        )}
                    </section>
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
