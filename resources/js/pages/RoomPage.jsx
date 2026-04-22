import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { useRoom } from '../hooks/use-room';
import TicTacToeGame from '../games/tic-tac-toe/index.js';
import PictionaryGame from '../games/pictionary/index.jsx';
import SpottoGame from '../games/spotto/index.jsx';

const GAME_MODULES = { tic_tac_toe: TicTacToeGame, pictionary: PictionaryGame, spotto: SpottoGame };

const GAME_LABELS = { tic_tac_toe: 'Tic Tac Toe', pictionary: 'Pictionary', spotto: 'Spotto' };

function LobbyView({ members, myGuestId, isHost, onReadyToggle, myReady, readySet, selectedGame, onSelectGame }) {
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

            <div>
                <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Game
                </label>
                {isHost ? (
                    <select
                        value={selectedGame}
                        onChange={(e) => onSelectGame(e.target.value)}
                        className="px-3 py-2 text-sm rounded border border-gray-200 bg-white text-gray-800 focus:outline-none focus:border-gray-400"
                    >
                        {Object.entries(GAME_LABELS).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                        ))}
                    </select>
                ) : (
                    <p className="text-sm text-gray-700">{GAME_LABELS[selectedGame] ?? selectedGame}</p>
                )}
            </div>

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

function GameArea({ gameType, gameConfig, onMove, onComplete, onMounted, gameRef }) {
    const containerRef = useRef(null);

    useLayoutEffect(() => {
        const GameClass = GAME_MODULES[gameType];
        if (!GameClass || !containerRef.current) return;

        const game = new GameClass(containerRef.current, gameConfig);
        game.on('move', onMove);
        game.on('complete', onComplete);
        gameRef.current = game;
        onMounted?.();

        return () => {
            game.destroy();
            gameRef.current = null;
        };
    }, [gameConfig.gameId]);

    return <div ref={containerRef} className="w-full h-full" />;
}

function ScoreScreen({ scores, members, myGuestId, onPlayAgain }) {
    const sorted = [...scores].sort((a, b) => b.score - a.score);

    function displayName(guestId) {
        const m = members.find((m) => m.id === guestId);
        return m?.displayName ?? guestId.slice(0, 8);
    }

    return (
        <div className="p-6 flex flex-col gap-6 items-center">
            <h2 className="text-xl font-bold text-gray-800">Game Over</h2>
            <ul className="flex flex-col gap-3 w-full max-w-xs">
                {sorted.map((s, i) => (
                    <li key={s.guestId} className="flex items-center justify-between px-4 py-3 rounded bg-white border border-gray-200">
                        <span className="flex items-center gap-3 text-sm text-gray-800">
                            <span className="text-gray-400 font-mono w-4">{i + 1}.</span>
                            <span className={s.guestId === myGuestId ? 'font-semibold' : ''}>
                                {displayName(s.guestId)}
                            </span>
                        </span>
                        <span className="text-sm font-medium text-gray-600">
                            {s.score} pts
                        </span>
                    </li>
                ))}
            </ul>
            <button
                onClick={onPlayAgain}
                className="px-6 py-2 rounded bg-gray-800 text-white font-medium text-sm hover:bg-gray-700 transition-colors"
            >
                Play Again
            </button>
        </div>
    );
}

export default function RoomPage({ guest, roomCode, navigate }) {
    const [room, setRoom] = useState(null);
    const [loading, setLoading] = useState(true);
    const [messages, setMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatSending, setChatSending] = useState(false);
    const [readySet, setReadySet] = useState(new Set());
    const [myReady, setMyReady] = useState(false);
    const [selectedGame, setSelectedGame] = useState('tic_tac_toe');
    const [phase, setPhase] = useState('lobby');  // 'lobby' | 'playing' | 'score'
    const [gameSession, setGameSession] = useState(null);
    const [scores, setScores] = useState(null);
    const messagesEndRef = useRef(null);
    const chatInputRef = useRef(null);
    const gameRef = useRef(null);
    const pendingGameEvents = useRef([]);
    const [chatCollapsed, setChatCollapsed] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState('');

    function sysMsg(text) {
        setMessages((prev) => [...prev, { system: true, text, timestamp: new Date().toISOString() }]);
    }

    const { members, channel } = useRoom(room?.roomId, guest.guestId);
    const isHost = room?.hostGuestId === guest.guestId;

    useEffect(() => {
        if (!guest.displayName) { navigate('/'); return; }

        fetch(`/api/v1/rooms/${roomCode}`, {
            headers: { 'X-Guest-ID': guest.guestId, 'Accept': 'application/json' },
        })
            .then((res) => {
                if (res.status === 404) { navigate('/'); return null; }
                return res.json();
            })
            .then((data) => {
                if (!data) return;
                return fetch(`/api/v1/rooms/${roomCode}/join`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Guest-ID': guest.guestId,
                    },
                    body: JSON.stringify({ display_name: guest.displayName }),
                }).then((res) => {
                    if (res.ok) {
                        setRoom(data);
                        setSelectedGame(data.selectedGame ?? 'tic_tac_toe');

                        // Reconnect mid-game: restore playing phase from server state.
                        if (data.status === 'playing' && data.activeGame) {
                            setGameSession(data.activeGame);
                            setPhase('playing');
                        }
                    } else {
                        navigate('/');
                    }
                });
            })
            .finally(() => setLoading(false));
    }, [roomCode, guest.guestId, navigate]);

    useEffect(() => {
        if (!channel) return;
        channel.listen('.chat.message', (data) => setMessages((prev) => [...prev, data]));
        return () => channel.stopListening('.chat.message');
    }, [channel]);

    useEffect(() => {
        if (!channel) return;
        const raw = channel.subscription;
        const handler = (_eventName, data) => {
            if (data?.systemMessage) sysMsg(data.systemMessage);
        };
        raw.bind_global(handler);
        return () => raw.unbind_global(handler);
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
        if (!channel) return;
        channel.listen('.room.game_selected', ({ gameType }) => {
            setSelectedGame(gameType);
        });
        return () => channel.stopListening('.room.game_selected');
    }, [channel]);

    useEffect(() => {
        if (!channel) return;
        channel.listen('.game.started', (data) => {
            setPhase('playing');
            setMyReady(false);
            setReadySet(new Set());
            setGameSession(data);
        });
        return () => channel.stopListening('.game.started');
    }, [channel]);

    useEffect(() => {
        if (!channel) return;
        channel.listen('.game.ended', (data) => {
            gameRef.current?.receiveEvent('game.ended', data);
            pendingGameEvents.current = [];
            setPhase('score');
            setScores(data.scores);
            setGameSession(null);
            setMyReady(false);
            setReadySet(new Set());
        });
        return () => channel.stopListening('.game.ended');
    }, [channel]);

    // All game event forwarding in one effect — registered as soon as channel is
    // available so we never miss events that fire immediately after game.started.
    // Events that arrive before the game module mounts are buffered and drained
    // once the module is ready (via handleGameMounted).
    useEffect(() => {
        if (!channel) return;
        const fwd = (name) => (data) => {
            if (gameRef.current) {
                gameRef.current.receiveEvent(name, data);
            } else {
                pendingGameEvents.current.push([name, data]);
            }
        };
        const gameEvents = [
            'ttt.move_made',
            'pict.round_started', 'pict.stroke', 'pict.stroke_delta',
            'pict.canvas_clear', 'pict.guess_correct', 'pict.round_ended',
            'spotto.round_started', 'spotto.point_scored', 'spotto.hover',
        ];
        gameEvents.forEach((e) => channel.listen('.' + e, fwd(e)));
        return () => gameEvents.forEach((e) => channel.stopListening('.' + e));
    }, [channel]);


    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    async function handleSelectGame(gameType) {
        setSelectedGame(gameType);
        await fetch(`/api/v1/rooms/${roomCode}/game`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Guest-ID': guest.guestId },
            body: JSON.stringify({ game_type: gameType }),
        });
    }

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

    async function handleMove(moveData) {
        await fetch(`/api/v1/games/${gameSession.gameId}/move`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Guest-ID': guest.guestId,
                ...(window.Echo?.socketId() ? { 'X-Socket-ID': window.Echo.socketId() } : {}),
            },
            body: JSON.stringify(moveData),
        });
    }

    function handleComplete() {
        // game.ended from server is the canonical trigger; this is a secondary signal
    }

    function handleGameMounted() {
        const game = gameRef.current;
        if (!game) return;
        pendingGameEvents.current.forEach(([name, data]) => game.receiveEvent(name, data));
        pendingGameEvents.current = [];
    }

    function handlePlayAgain() {
        setPhase('lobby');
        setScores(null);
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
                    'Accept': 'application/json',
                    'X-Guest-ID': guest.guestId,
                    ...(window.Echo?.socketId() ? { 'X-Socket-ID': window.Echo.socketId() } : {}),
                },
                body: JSON.stringify({ message: text }),
            });
        } catch {
            // optimistic update stays; silent fail acceptable for chat
        } finally {
            setChatSending(false);
        }
    }

    async function handleNameSave(e) {
        e.preventDefault();
        const trimmed = nameInput.trim();
        if (!trimmed || trimmed === guest.displayName) { setEditingName(false); return; }
        guest.setDisplayName(trimmed);
        setEditingName(false);
        await fetch('/api/v1/guests/display-name', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Guest-ID': guest.guestId },
            body: JSON.stringify({ display_name: trimmed }),
        }).catch(() => {});
    }

    function leave() {
        if (!room) { navigate('/'); return; }
        fetch(`/api/v1/rooms/${roomCode}/leave`, {
            method: 'DELETE',
            headers: { 'X-Guest-ID': guest.guestId },
        }).finally(() => navigate('/'));
    }

    function buildGameConfig() {
        if (!gameSession) return null;
        const { gameId, gameType, players: gamePlayers, firstTurn } = gameSession;
        const playerIds = gamePlayers.map((p) => p.guestId);

        const mappedPlayers = gamePlayers.map((p) => {
            const m = members.find((m) => m.id === p.guestId);
            return { guestId: p.guestId, displayName: m?.displayName ?? p.guestId.slice(0, 8), isMe: p.guestId === guest.guestId };
        });

        const spectatorList = members
            .filter((m) => !playerIds.includes(m.id))
            .map((m) => ({ guestId: m.id, displayName: m.displayName }));

        const gameState = gameType === 'tic_tac_toe'
            ? {
                board: Array(9).fill(null),
                players: { X: firstTurn, O: gamePlayers.find((p) => p.guestId !== firstTurn)?.guestId },
                currentTurn: firstTurn,
                status: 'playing',
              }
            : {};

        return {
            roomId: room?.roomId,
            gameId,
            guestId: guest.guestId,
            players: mappedPlayers,
            spectators: spectatorList,
            role: playerIds.includes(guest.guestId) ? 'player' : 'spectator',
            gameType,
            gameState,
        };
    }

    if (loading) {
        return <div className="flex items-center justify-center h-screen text-gray-500">Loading...</div>;
    }

    const gameConfig = phase === 'playing' ? buildGameConfig() : null;

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-lg tracking-widest text-gray-800">{roomCode}</span>
                    {members.length > 0 && (
                        <span className="text-sm text-gray-500">
                            {members.length} {members.length === 1 ? 'player' : 'players'}
                        </span>
                    )}
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
                    {phase === 'lobby' && (
                        <LobbyView
                            members={members}
                            myGuestId={guest.guestId}
                            isHost={isHost}
                            onReadyToggle={handleReadyToggle}
                            myReady={myReady}
                            readySet={readySet}
                            selectedGame={selectedGame}
                            onSelectGame={handleSelectGame}
                        />
                    )}
                    {phase === 'playing' && gameConfig && (
                        <GameArea
                            gameType={gameSession.gameType}
                            gameConfig={gameConfig}
                            onMove={handleMove}
                            onComplete={handleComplete}
                            onMounted={handleGameMounted}
                            gameRef={gameRef}
                        />
                    )}
                    {phase === 'score' && scores && (
                        <ScoreScreen
                            scores={scores}
                            members={members}
                            myGuestId={guest.guestId}
                            onPlayAgain={handlePlayAgain}
                        />
                    )}
                </main>

                {/* Chat sidebar */}
                <aside className={`flex flex-col bg-white border-l border-gray-200 transition-all ${chatCollapsed ? 'w-10' : 'flex-[3]'}`}>
                    {/* Sidebar header: collapse toggle */}
                    <div className="flex items-center justify-between px-2 py-2 border-b border-gray-200 shrink-0">
                        {!chatCollapsed && <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide pl-1">Chat</span>}
                        <button
                            onClick={() => setChatCollapsed((v) => !v)}
                            className="ml-auto p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                            title={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
                        >
                            {chatCollapsed ? '»' : '«'}
                        </button>
                    </div>

                    {!chatCollapsed && (
                        <>
                            {/* Nickname display / edit */}
                            <div className="px-3 py-2 border-b border-gray-100 shrink-0">
                                {editingName ? (
                                    <form onSubmit={handleNameSave} className="flex gap-1">
                                        <input
                                            autoFocus
                                            type="text"
                                            value={nameInput}
                                            onChange={(e) => setNameInput(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Escape' && setEditingName(false)}
                                            className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-gray-300 focus:outline-none focus:border-gray-400"
                                            maxLength={32}
                                        />
                                        <button type="submit" className="px-2 py-1 text-xs rounded bg-gray-800 text-white hover:bg-gray-700">Save</button>
                                        <button type="button" onClick={() => setEditingName(false)} className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200">✕</button>
                                    </form>
                                ) : (
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm font-medium text-gray-700 truncate">{guest.displayName}</span>
                                        <button
                                            onClick={() => { setNameInput(guest.displayName); setEditingName(true); }}
                                            className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                                            title="Change nickname"
                                        >
                                            Edit
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 text-sm">
                                {messages.length === 0 ? (
                                    <p className="text-gray-400 italic">No messages yet.</p>
                                ) : (
                                    messages.map((msg, i) =>
                                        msg.system ? (
                                            <div key={`sys-${msg.timestamp}-${i}`} className="mb-2 text-xs text-gray-400 italic">
                                                {msg.text}
                                            </div>
                                        ) : (
                                            <div key={`${msg.timestamp}-${msg.guestId}-${i}`} className="mb-2">
                                                <span className="font-semibold text-gray-700">{msg.displayName}</span>
                                                <span className="text-gray-600"> {msg.message}</span>
                                            </div>
                                        )
                                    )
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Chat input */}
                            <div className="p-3 border-t border-gray-200 flex gap-2">
                                <input
                                    ref={chatInputRef}
                                    type="text"
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                                    disabled={!room}
                                    placeholder="Say something..."
                                    className="flex-1 px-3 py-2 text-sm rounded border border-gray-200 bg-white text-gray-800 focus:outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                                />
                                <button
                                    onClick={sendChat}
                                    disabled={!room}
                                    className="px-3 py-2 text-sm rounded bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Send
                                </button>
                            </div>
                        </>
                    )}
                </aside>
            </div>
        </div>
    );
}
