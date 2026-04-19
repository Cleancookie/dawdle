import { useState } from 'react';

export default function HomePage({ guest, navigate }) {
    const [nameInput, setNameInput] = useState('');

    const [roomCodeInput, setRoomCodeInput] = useState('');
    const [joinError, setJoinError] = useState('');
    const [joinLoading, setJoinLoading] = useState(false);

    const [createError, setCreateError] = useState('');
    const [createLoading, setCreateLoading] = useState(false);

    function handleNameSubmit(e) {
        e.preventDefault();
        const name = nameInput.trim();
        if (name) {
            guest.setDisplayName(name);
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
                body: JSON.stringify({ display_name: guest.displayName }),
            });
            if (!res.ok) {
                throw new Error('Request failed');
            }
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
            if (res.status === 404) {
                setJoinError('Room not found');
                return;
            }
            if (!res.ok) {
                throw new Error('Request failed');
            }
            navigate('/room/' + code);
        } catch (err) {
            if (!joinError) {
                setJoinError('Something went wrong. Please try again.');
            }
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
        <div className="flex min-h-screen items-center justify-center">
            <div className="flex flex-col gap-8 w-72">
                <h1 className="text-2xl font-bold text-center">Dawdle</h1>

                <div className="flex flex-col gap-2">
                    <button
                        onClick={handleCreateRoom}
                        disabled={createLoading}
                        className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
                    >
                        {createLoading ? '...' : 'Create Room'}
                    </button>
                    {createError && (
                        <p className="text-red-600 text-sm">{createError}</p>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Room code"
                            value={roomCodeInput}
                            onChange={(e) => {
                                setRoomCodeInput(e.target.value);
                                setJoinError('');
                            }}
                            className="border rounded px-3 py-2 flex-1 min-w-0"
                        />
                        <button
                            onClick={handleJoinRoom}
                            disabled={joinLoading || !roomCodeInput.trim()}
                            className="bg-green-600 text-white rounded px-4 py-2 disabled:opacity-50"
                        >
                            {joinLoading ? '...' : 'Join'}
                        </button>
                    </div>
                    {joinError && (
                        <p className="text-red-600 text-sm">{joinError}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
