import { useState, useEffect } from 'react';

const GAME_LABELS = { tic_tac_toe: 'Tic Tac Toe', pictionary: 'Pictionary', spotto: 'Spotto', pack: 'Pack', board: 'BaseBoard' };

export default function HomePage({ guest, navigate }) {
    const [nameInput, setNameInput] = useState('');

    const [roomCodeInput, setRoomCodeInput] = useState('');
    const [joinError, setJoinError] = useState('');
    const [joinLoading, setJoinLoading] = useState(false);

    const [createError, setCreateError] = useState('');
    const [createLoading, setCreateLoading] = useState(false);
    const [createPublic, setCreatePublic] = useState(true);

    const [publicRooms, setPublicRooms] = useState([]);
    const [roomsLoading, setRoomsLoading] = useState(false);

    useEffect(() => {
        if (!guest.displayName) return;
        setRoomsLoading(true);
        fetch('/api/v1/rooms', {
            headers: { 'X-Guest-ID': guest.guestId, 'Accept': 'application/json' },
        })
            .then((r) => r.ok ? r.json() : [])
            .then(setPublicRooms)
            .catch(() => {})
            .finally(() => setRoomsLoading(false));
    }, [guest.displayName, guest.guestId]);

    function handleNameSubmit(e) {
        e.preventDefault();
        const name = nameInput.trim();
        if (name) {
            guest.setDisplayName(name);
            const pending = localStorage.getItem('dawdle_pending_room');
            if (pending) {
                localStorage.removeItem('dawdle_pending_room');
                navigate('/room/' + pending);
            }
        }
    }

    async function handleCreateRoom() {
        setCreateError('');
        setCreateLoading(true);
        try {
            const res = await fetch('/api/v1/rooms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Guest-ID': guest.guestId,
                },
                body: JSON.stringify({ display_name: guest.displayName, is_public: createPublic }),
            });
            if (!res.ok) throw new Error('Request failed');
            const data = await res.json();
            navigate('/room/' + data.code);
        } catch {
            setCreateError('Something went wrong. Please try again.');
        } finally {
            setCreateLoading(false);
        }
    }

    async function handleJoinRoom() {
        const code = roomCodeInput.trim();
        if (!code) return;
        setJoinError('');
        setJoinLoading(true);
        try {
            const res = await fetch('/api/v1/rooms/' + code, {
                headers: { 'X-Guest-ID': guest.guestId },
            });
            if (res.status === 404) { setJoinError('Room not found'); return; }
            if (!res.ok) throw new Error('Request failed');
            navigate('/room/' + code);
        } catch (err) {
            if (!joinError) setJoinError('Something went wrong. Please try again.');
        } finally {
            setJoinLoading(false);
        }
    }

    if (!guest.displayName) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <form onSubmit={handleNameSubmit} className="flex flex-col gap-4 w-64">
                    <h1 className="text-2xl font-bold text-center">Welcome to Dawdle</h1>
                    <input
                        type="text"
                        placeholder="Enter your display name"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className="border rounded px-3 py-2"
                        autoFocus
                    />
                    <button
                        type="submit"
                        disabled={!nameInput.trim()}
                        className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
                    >
                        Continue
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4">
            <div className="max-w-lg mx-auto flex flex-col gap-8">
                <h1 className="text-2xl font-bold text-center text-gray-900">Dawdle</h1>

                {/* Create */}
                <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col gap-3">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Create a room</h2>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleCreateRoom}
                            disabled={createLoading}
                            className="px-5 py-2 bg-blue-600 text-white rounded font-medium text-sm disabled:opacity-50 hover:bg-blue-700 transition-colors"
                        >
                            {createLoading ? '...' : 'Create'}
                        </button>
                        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={createPublic}
                                onChange={(e) => setCreatePublic(e.target.checked)}
                                className="rounded"
                            />
                            Public (show in lobby)
                        </label>
                    </div>
                    {createError && <p className="text-red-600 text-sm">{createError}</p>}
                </div>

                {/* Join by code */}
                <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col gap-3">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Join by code</h2>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Room code"
                            value={roomCodeInput}
                            onChange={(e) => { setRoomCodeInput(e.target.value); setJoinError(''); }}
                            className="border rounded px-3 py-2 flex-1 min-w-0 text-sm"
                        />
                        <button
                            onClick={handleJoinRoom}
                            disabled={joinLoading || !roomCodeInput.trim()}
                            className="px-4 py-2 bg-green-600 text-white rounded font-medium text-sm disabled:opacity-50 hover:bg-green-700 transition-colors"
                        >
                            {joinLoading ? '...' : 'Join'}
                        </button>
                    </div>
                    {joinError && <p className="text-red-600 text-sm">{joinError}</p>}
                </div>

                {/* Lobby browser */}
                <div className="flex flex-col gap-3">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Open rooms</h2>
                    {roomsLoading ? (
                        <p className="text-sm text-gray-400">Loading...</p>
                    ) : publicRooms.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No open rooms right now. Create one!</p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {publicRooms.map((r) => (
                                <li key={r.roomId} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="font-mono font-bold text-gray-800 text-sm tracking-widest">{r.code}</span>
                                        <span className="text-xs text-gray-400">
                                            {GAME_LABELS[r.selectedGame] ?? r.selectedGame}
                                            {' · '}
                                            {r.playerCount} {r.playerCount === 1 ? 'player' : 'players'}
                                            {' · '}
                                            <span className={r.status === 'playing' ? 'text-orange-500' : 'text-green-600'}>
                                                {r.status === 'playing' ? 'In game' : 'Waiting'}
                                            </span>
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => navigate('/room/' + r.code)}
                                        className="px-3 py-1.5 text-xs font-medium rounded bg-gray-800 text-white hover:bg-gray-700 transition-colors"
                                    >
                                        Join
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
