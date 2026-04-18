import { useState, useEffect, useRef } from 'react';
import { useRoom } from '../hooks/use-room';

function LobbyView({ roomCode, members, myGuestId, isHost, onReadyToggle, myReady, readySet }) {
    const [linkCopied, setLinkCopied] = useState(false);

    function copyLink() {
        navigator.clipboard.writeText(window.location.href);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    }

    const players = members.filter((m) => m.role === 'player');
    const spectators = members.filter((m) => m.role === 'spectator');

    return (
        <div className="p-6 flex flex-col gap-6">
            <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Players</h2>
                {players.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No players yet.</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {players.map((m) => (
                            <li key={m.id} className="flex items-center gap-2 text-sm text-gray-800">
                                <span
                                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${readySet.has(m.id) ? 'bg-green-500' : 'bg-gray-300'}`}
                                />
                                <span className={m.id === myGuestId ? 'font-semibold' : ''}>{m.displayName}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {spectators.length > 0 && (
                    <p className="mt-3 text-xs text-gray-400">
                        Spectating: {spectators.map((s) => s.displayName).join(', ')}
                    </p>
                )}
            </div>

            <button
                onClick={onReadyToggle}
                className={`self-start px-5 py-2 rounded font-medium text-sm transition-colors ${
                    myReady
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-gray-800 hover:bg-gray-700 text-white'
                }`}
            >
                {myReady ? 'Not Ready' : 'Ready'}
            </button>

            {isHost && (
                <div>
                    <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Game
                    </label>
                    {/* TODO: wire selected game to backend */}
                    <select className="px-3 py-2 text-sm rounded border border-gray-200 bg-white text-gray-800 focus:outline-none focus:border-gray-400">
                        <option value="tic_tac_toe">Tic Tac Toe</option>
                        <option value="pictionary">Pictionary</option>
                    </select>
                </div>
            )}

            <div>
                <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Invite Link
                </label>
                <div className="flex gap-2">
                    <input
                        readOnly
                        value={window.location.href}
                        className="flex-1 px-3 py-2 text-sm rounded border border-gray-200 bg-gray-50 text-gray-600 focus:outline-none"
                    />
                    <button
                        onClick={copyLink}
                        className="px-3 py-2 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                    >
                        {linkCopied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function RoomPage({ guest, roomCode, navigate }) {
    const [room, setRoom] = useState(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [messages, setMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatSending, setChatSending] = useState(false);
    const [readySet, setReadySet] = useState(new Set());
    const [myReady, setMyReady] = useState(false);
    const messagesEndRef = useRef(null);

    const { members, channel } = useRoom(room?.roomId, guest.guestId);

    // TODO: use room?.hostGuestId once the room API returns it
    const isHost = room?.hostGuestId === guest.guestId;

    useEffect(() => {
        fetch(`/api/v1/rooms/${roomCode}`, {
            headers: { 'X-Guest-ID': guest.guestId },
        })
            .then((res) => {
                if (res.status === 404) {
                    navigate('/');
                    return null;
                }
                return res.json();
            })
            .then((data) => {
                if (data) setRoom(data);
            })
            .finally(() => setLoading(false));
    }, [roomCode, guest.guestId, navigate]);

    useEffect(() => {
        if (!channel) return;
        channel.listen('.chat.message', (data) => {
            setMessages((prev) => [...prev, data]);
        });
        return () => {
            channel.stopListening('.chat.message');
        };
    }, [channel]);

    useEffect(() => {
        if (!channel) return;
        channel.listen('.room.player_ready', ({ guestId, ready }) => {
            setReadySet((prev) => {
                const next = new Set(prev);
                if (ready) next.add(guestId); else next.delete(guestId);
                return next;
            });
        });
        return () => channel.stopListening('.room.player_ready');
    }, [channel]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    async function handleReadyToggle() {
        const res = await fetch(`/api/v1/rooms/${roomCode}/ready`, {
            method: 'POST',
            headers: { 'X-Guest-ID': guest.guestId },
        });
        if (res.ok) {
            const data = await res.json();
            setMyReady(data.ready);
            setReadySet((prev) => {
                const next = new Set(prev);
                if (data.ready) next.add(guest.guestId); else next.delete(guest.guestId);
                return next;
            });
        }
    }

    async function sendChat() {
        const text = chatInput.trim();
        if (!text || !room || chatSending) return;
        setChatSending(true);
        const optimistic = {
            guestId: guest.guestId,
            displayName: guest.displayName,
            message: text,
            timestamp: new Date().toISOString(),
        };
        setChatInput('');
        setMessages((prev) => [...prev, optimistic]);
        try {
            await fetch(`/api/v1/rooms/${roomCode}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Guest-ID': guest.guestId,
                },
                body: JSON.stringify({ message: text }),
            });
        } catch {
            // message already shown optimistically; silent fail is acceptable for chat
        } finally {
            setChatSending(false);
        }
    }

    function copyInviteLink() {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    function leave() {
        if (!room) {
            navigate('/');
            return;
        }
        fetch(`/api/v1/rooms/${roomCode}/leave`, {
            method: 'DELETE',
            headers: { 'X-Guest-ID': guest.guestId },
        }).finally(() => navigate('/'));
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen text-gray-500">
                Loading...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-lg tracking-widest text-gray-800">
                        {roomCode}
                    </span>
                    {members.length > 0 && (
                        <span className="text-sm text-gray-500">
                            {members.length} {members.length === 1 ? 'player' : 'players'}
                        </span>
                    )}
                    <button
                        onClick={copyInviteLink}
                        className="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                    >
                        {copied ? 'Copied!' : 'Copy invite link'}
                    </button>
                </div>
                <button
                    onClick={leave}
                    className="px-4 py-1.5 text-sm rounded bg-red-100 hover:bg-red-200 text-red-700 font-medium transition-colors"
                >
                    Leave
                </button>
            </header>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
                {/* Game area */}
                <main className="flex-[7] overflow-y-auto border-r border-gray-200">
                    <LobbyView
                        roomCode={roomCode}
                        members={members}
                        myGuestId={guest.guestId}
                        channel={channel}
                        isHost={isHost}
                        onReadyToggle={handleReadyToggle}
                        myReady={myReady}
                        readySet={readySet}
                    />
                </main>

                {/* Chat sidebar */}
                <aside className="flex-[3] flex flex-col bg-white">
                    <div className="flex-1 overflow-y-auto p-4 text-sm">
                        {messages.length === 0 ? (
                            <p className="text-gray-400 italic">No messages yet.</p>
                        ) : (
                            messages.map((msg, i) => (
                                <div key={`${msg.timestamp}-${msg.guestId}-${i}`} className="mb-2">
                                    <span className="font-semibold text-gray-700">{msg.displayName}</span>
                                    <span className="text-gray-600"> {msg.message}</span>
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    <div className="p-3 border-t border-gray-200 flex gap-2">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                            disabled={chatSending || !room}
                            placeholder="Say something..."
                            className="flex-1 px-3 py-2 text-sm rounded border border-gray-200 bg-white text-gray-800 focus:outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                        />
                        <button
                            onClick={sendChat}
                            disabled={chatSending || !room}
                            className="px-3 py-2 text-sm rounded bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Send
                        </button>
                    </div>
                </aside>
            </div>
        </div>
    );
}
