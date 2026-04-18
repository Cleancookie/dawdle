import React from 'react';
import { useRoom } from '../hooks/use-room';

function LobbyView({ roomCode }) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-xl font-semibold">Waiting for players...</p>
            <p className="mt-2 text-sm font-mono">{roomCode}</p>
        </div>
    );
}

export default function RoomPage({ guest, roomCode, navigate }) {
    const [room, setRoom] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [copied, setCopied] = React.useState(false);

    const { members, channel } = useRoom(room?.roomId, guest.guestId);

    React.useEffect(() => {
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
    }, [roomCode]);

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
        fetch(`/api/v1/rooms/${room.roomId}/leave`, {
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
                    <LobbyView roomCode={roomCode} />
                </main>

                {/* Chat sidebar */}
                <aside className="flex-[3] flex flex-col bg-white">
                    <div className="flex-1 overflow-y-auto p-4 text-sm text-gray-400 italic">
                        No messages yet.
                    </div>
                    <div className="p-3 border-t border-gray-200">
                        <input
                            type="text"
                            disabled
                            placeholder="Chat coming soon..."
                            className="w-full px-3 py-2 text-sm rounded border border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                        />
                    </div>
                </aside>
            </div>
        </div>
    );
}
