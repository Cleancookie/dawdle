import ReactDOM from 'react-dom/client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getStroke } from 'perfect-freehand';

// ---------------------------------------------------------------------------
// SimpleEmitter — same pattern as tic-tac-toe
// ---------------------------------------------------------------------------
class SimpleEmitter {
    constructor() { this._listeners = {}; }
    on(event, fn) { (this._listeners[event] ??= []).push(fn); return this; }
    emit(event, ...args) { (this._listeners[event] ?? []).forEach((fn) => fn(...args)); }
    removeAllListeners() { this._listeners = {}; }
}

// ---------------------------------------------------------------------------
// SVG path helper
// ---------------------------------------------------------------------------
function pointsToPath(points) {
    if (!points.length) return '';
    const d = points.reduce((acc, [x, y], i) =>
        i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`, '');
    return d + ' Z';
}

function strokeToPath(rawPoints, width) {
    const outlinePoints = getStroke(rawPoints, {
        size: width * 4,
        smoothing: 0.5,
        thinning: 0.5,
    });
    return pointsToPath(outlinePoints);
}

// ---------------------------------------------------------------------------
// Timer hook
// ---------------------------------------------------------------------------
function useCountdown(initialSeconds, onExpire) {
    const [seconds, setSeconds] = useState(initialSeconds);
    const expiredRef = useRef(false);

    useEffect(() => {
        setSeconds(initialSeconds);
        expiredRef.current = false;
        if (!initialSeconds) return;

        const interval = setInterval(() => {
            setSeconds((s) => {
                if (s <= 1) {
                    clearInterval(interval);
                    if (!expiredRef.current) {
                        expiredRef.current = true;
                        onExpire();
                    }
                    return 0;
                }
                return s - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [initialSeconds]);

    return seconds;
}

// ---------------------------------------------------------------------------
// Main Pictionary component
// ---------------------------------------------------------------------------
function PictionaryApp({ config, eventBus, emit }) {
    const { guestId, gameId, players, role: roomRole } = config;

    // Find display name helper
    const allParticipants = [...players, ...(config.spectators ?? [])];
    const getDisplayName = (id) => {
        const p = allParticipants.find((p) => p.guestId === id);
        return p ? p.displayName : id.slice(0, 8);
    };

    // Round state
    const [round, setRound] = useState(null);           // { round, totalRounds, drawerGuestId, word, timeLimit }
    const [strokes, setStrokes] = useState([]);          // [{ path, color, isEraser }]
    const [roundOver, setRoundOver] = useState(null);    // { word, scores }
    const [guessedCorrect, setGuessedCorrect] = useState(null); // guestId who guessed correctly (first)
    const [overlay, setOverlay] = useState(null);        // transient message string

    // Drawer drawing state
    const [color, setColor] = useState('#000000');
    const [brushWidth, setBrushWidth] = useState(4);
    const [isEraser, setIsEraser] = useState(false);
    const currentPoints = useRef([]);
    const isDrawing = useRef(false);
    const svgRef = useRef(null);

    // Guesser state
    const [guessInput, setGuessInput] = useState('');
    const [inputDisabled, setInputDisabled] = useState(false);

    const isDrawer = round && guestId === round.drawerGuestId;
    const isSpectator = roomRole === 'spectator';

    // Expire callback — only drawer emits timeout
    const handleTimerExpire = useCallback(() => {
        if (isDrawer) {
            emit('move', { type: 'pict.timeout' });
        }
    }, [isDrawer, emit]);

    const timeRemaining = useCountdown(round ? round.timeLimit : 0, handleTimerExpire);

    // ------------------------------------------------------------------
    // Event bus — receiveEvent() pushes here
    // ------------------------------------------------------------------
    useEffect(() => {
        const handler = (name, payload) => {
            if (name === 'pict.round_started') {
                setRound({
                    round: payload.round,
                    totalRounds: payload.totalRounds,
                    drawerGuestId: payload.drawerGuestId,
                    word: null,   // fetched via HTTP below when this client is the drawer
                    timeLimit: payload.timeLimit,
                });
                setStrokes([]);
                setRoundOver(null);
                setGuessedCorrect(null);
                setInputDisabled(false);
                setOverlay(null);
            } else if (name === 'pict.word_hint') {
                // Unused — word is fetched via HTTP; kept for forward compatibility
            } else if (name === 'pict.stroke') {
                // Guesser/spectator receives completed strokes from server relay
                const path = strokeToPath(
                    payload.points.map((p) => [p.x, p.y]),
                    payload.width
                );
                setStrokes((prev) => [
                    ...prev,
                    { path, color: payload.isEraser ? '#ffffff' : payload.color, isEraser: payload.isEraser },
                ]);
            } else if (name === 'pict.canvas_clear') {
                setStrokes([]);
            } else if (name === 'pict.guess_correct') {
                if (payload.guestId === guestId) {
                    setInputDisabled(true);
                    setOverlay('You got it!');
                } else {
                    setOverlay(`${payload.displayName} guessed it!`);
                    setTimeout(() => setOverlay(null), 3000);
                }
                setGuessedCorrect(payload.guestId);
            } else if (name === 'pict.round_ended') {
                setRoundOver({ word: payload.word, scores: payload.scores });
                // Clear canvas after 3 seconds and await next round_started
                setTimeout(() => {
                    setStrokes([]);
                    setRoundOver(null);
                }, 3000);
            }
        };

        eventBus.on('event', handler);
        return () => {
            // Remove just this handler by rebuilding the listener array
            const list = eventBus._listeners['event'];
            if (list) {
                const idx = list.indexOf(handler);
                if (idx !== -1) list.splice(idx, 1);
            }
        };
    }, [guestId, eventBus]);

    // Fetch word from server when this client is the drawer for the current round
    useEffect(() => {
        if (!round || round.drawerGuestId !== guestId || round.word) return;
        fetch(`/api/v1/games/${gameId}/word`, {
            headers: { 'X-Guest-ID': guestId, 'Accept': 'application/json' },
        })
            .then((r) => r.ok ? r.json() : null)
            .then((data) => {
                if (data?.word) setRound((prev) => prev ? { ...prev, word: data.word } : prev);
            })
            .catch(() => {});
    }, [round?.round, round?.drawerGuestId, guestId, gameId]);

    // ------------------------------------------------------------------
    // Drawing handlers (drawer only)
    // ------------------------------------------------------------------
    const getSVGPoint = (e) => {
        const svg = svgRef.current;
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return [
            ((clientX - rect.left) / rect.width) * 600,
            ((clientY - rect.top) / rect.height) * 400,
        ];
    };

    const onPointerDown = (e) => {
        if (!isDrawer || !round) return;
        e.preventDefault();
        isDrawing.current = true;
        const pt = getSVGPoint(e);
        if (pt) currentPoints.current = [pt];
    };

    const onPointerMove = (e) => {
        if (!isDrawer || !isDrawing.current) return;
        e.preventDefault();
        const pt = getSVGPoint(e);
        if (!pt) return;
        currentPoints.current = [...currentPoints.current, pt];
        // Force a re-render for live preview
        setStrokes((prev) => prev); // triggers re-render; preview is in currentPoints
    };

    const onPointerUp = (e) => {
        if (!isDrawer || !isDrawing.current) return;
        e.preventDefault();
        isDrawing.current = false;

        const pts = currentPoints.current;
        if (!pts.length) return;

        const activeColor = isEraser ? '#ffffff' : color;
        const path = strokeToPath(pts, brushWidth);

        // Add to local strokes
        setStrokes((prev) => [...prev, { path, color: activeColor, isEraser }]);

        // Emit to server
        emit('move', {
            type: 'pict.stroke',
            points: pts.map(([x, y]) => ({ x, y })),
            color: activeColor,
            width: brushWidth,
            isEraser,
        });

        currentPoints.current = [];
    };

    const handleClear = () => {
        if (!isDrawer) return;
        setStrokes([]);
        currentPoints.current = [];
        emit('move', { type: 'pict.canvas_clear' });
    };

    // ------------------------------------------------------------------
    // Guess handler (guesser only)
    // ------------------------------------------------------------------
    const handleGuessSubmit = (e) => {
        e.preventDefault();
        const trimmed = guessInput.trim();
        if (!trimmed || inputDisabled) return;
        emit('move', { type: 'pict.guess', guess: trimmed });
        setGuessInput('');
    };

    // ------------------------------------------------------------------
    // Live preview path (drawer only, current stroke in progress)
    // ------------------------------------------------------------------
    const previewPath = isDrawer && isDrawing.current && currentPoints.current.length
        ? strokeToPath(currentPoints.current, brushWidth)
        : null;

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------

    // Waiting for first round
    if (!round) {
        return (
            <div style={styles.container}>
                <div style={styles.waiting}>Waiting for the round to start…</div>
            </div>
        );
    }

    const drawerName = getDisplayName(round.drawerGuestId);
    const timerColor = timeRemaining <= 10 ? '#dc2626' : '#374151';

    return (
        <div style={styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <span style={styles.roundLabel}>
                    Round {round.round} of {round.totalRounds} — {drawerName} is drawing!
                </span>
                <span style={{ ...styles.timer, color: timerColor }}>{timeRemaining}s</span>
            </div>

            {/* Word (drawer only) */}
            {isDrawer && round.word && (
                <div style={styles.word}>Draw: <strong>{round.word}</strong></div>
            )}

            {/* Canvas area */}
            <div style={styles.canvasWrapper}>
                <svg
                    ref={svgRef}
                    viewBox="0 0 600 400"
                    style={styles.svg}
                    onPointerDown={isDrawer ? onPointerDown : undefined}
                    onPointerMove={isDrawer ? onPointerMove : undefined}
                    onPointerUp={isDrawer ? onPointerUp : undefined}
                    onPointerLeave={isDrawer ? onPointerUp : undefined}
                    onTouchStart={isDrawer ? onPointerDown : undefined}
                    onTouchMove={isDrawer ? onPointerMove : undefined}
                    onTouchEnd={isDrawer ? onPointerUp : undefined}
                >
                    <rect width="600" height="400" fill="#ffffff" />
                    {strokes.map((s, i) => (
                        <path key={i} d={s.path} fill={s.color} stroke="none" />
                    ))}
                    {/* Live preview */}
                    {previewPath && (
                        <path
                            d={previewPath}
                            fill={isEraser ? '#ffffff' : color}
                            stroke="none"
                        />
                    )}
                </svg>

                {/* Overlays */}
                {overlay && (
                    <div style={styles.overlay}>{overlay}</div>
                )}
                {roundOver && (
                    <div style={styles.roundOverlay}>
                        <div style={styles.roundOverCard}>
                            <div style={styles.roundOverTitle}>Round over!</div>
                            <div style={styles.roundOverWord}>The word was: <strong>{roundOver.word}</strong></div>
                            <div style={styles.scoreList}>
                                {roundOver.scores.map((s) => (
                                    <div key={s.guestId} style={styles.scoreRow}>
                                        <span>{getDisplayName(s.guestId)}</span>
                                        <span>+{s.score ?? s.roundScore ?? 0}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Drawer toolbar */}
            {isDrawer && (
                <div style={styles.toolbar}>
                    {['#000000', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed'].map((c) => (
                        <button
                            key={c}
                            onClick={() => { setColor(c); setIsEraser(false); }}
                            style={{
                                ...styles.colorBtn,
                                background: c,
                                outline: color === c && !isEraser ? '3px solid #374151' : 'none',
                            }}
                            title={c}
                        />
                    ))}
                    <div style={styles.separator} />
                    <label style={styles.widthLabel}>
                        Size
                        <input
                            type="range"
                            min="1"
                            max="12"
                            value={brushWidth}
                            onChange={(e) => setBrushWidth(Number(e.target.value))}
                            style={{ marginLeft: 6, width: 80 }}
                        />
                    </label>
                    <div style={styles.separator} />
                    <button
                        onClick={() => setIsEraser((e) => !e)}
                        style={{ ...styles.toolBtn, background: isEraser ? '#e5e7eb' : 'transparent' }}
                    >
                        Eraser
                    </button>
                    <button onClick={handleClear} style={styles.toolBtn}>Clear</button>
                </div>
            )}

            {/* Guesser input */}
            {!isDrawer && !isSpectator && (
                <form onSubmit={handleGuessSubmit} style={styles.guessForm}>
                    <input
                        type="text"
                        value={guessInput}
                        onChange={(e) => setGuessInput(e.target.value)}
                        disabled={inputDisabled}
                        placeholder={inputDisabled ? 'You guessed it!' : 'Type your guess…'}
                        style={styles.guessInput}
                        autoComplete="off"
                    />
                    <button type="submit" disabled={inputDisabled} style={styles.guessBtn}>
                        Guess
                    </button>
                </form>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = {
    container: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#f9fafb',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        userSelect: 'none',
    },
    waiting: {
        margin: 'auto',
        fontSize: 20,
        color: '#6b7280',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        background: '#ffffff',
        borderBottom: '1px solid #e5e7eb',
    },
    roundLabel: {
        fontSize: 16,
        color: '#374151',
        fontWeight: 500,
    },
    timer: {
        fontSize: 20,
        fontWeight: 700,
        minWidth: 48,
        textAlign: 'right',
    },
    word: {
        padding: '6px 16px',
        background: '#fef9c3',
        borderBottom: '1px solid #fde68a',
        fontSize: 18,
        color: '#92400e',
        textAlign: 'center',
    },
    canvasWrapper: {
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'stretch',
    },
    svg: {
        width: '100%',
        height: '100%',
        display: 'block',
        touchAction: 'none',
        cursor: 'crosshair',
    },
    overlay: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(0,0,0,0.65)',
        color: '#ffffff',
        fontSize: 28,
        fontWeight: 700,
        padding: '16px 32px',
        borderRadius: 12,
        pointerEvents: 'none',
    },
    roundOverlay: {
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    roundOverCard: {
        background: '#ffffff',
        borderRadius: 12,
        padding: '24px 32px',
        minWidth: 240,
        textAlign: 'center',
        boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
    },
    roundOverTitle: {
        fontSize: 22,
        fontWeight: 700,
        color: '#374151',
        marginBottom: 8,
    },
    roundOverWord: {
        fontSize: 16,
        color: '#6b7280',
        marginBottom: 16,
    },
    scoreList: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
    },
    scoreRow: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 15,
        color: '#374151',
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        background: '#ffffff',
        borderTop: '1px solid #e5e7eb',
        flexWrap: 'wrap',
    },
    colorBtn: {
        width: 28,
        height: 28,
        borderRadius: '50%',
        border: '2px solid #d1d5db',
        cursor: 'pointer',
        padding: 0,
    },
    separator: {
        width: 1,
        height: 24,
        background: '#e5e7eb',
        margin: '0 4px',
    },
    widthLabel: {
        fontSize: 13,
        color: '#6b7280',
        display: 'flex',
        alignItems: 'center',
    },
    toolBtn: {
        padding: '4px 12px',
        fontSize: 13,
        borderRadius: 6,
        border: '1px solid #d1d5db',
        cursor: 'pointer',
        background: 'transparent',
        color: '#374151',
    },
    guessForm: {
        display: 'flex',
        gap: 8,
        padding: '8px 16px',
        background: '#ffffff',
        borderTop: '1px solid #e5e7eb',
    },
    guessInput: {
        flex: 1,
        padding: '8px 12px',
        fontSize: 15,
        border: '1px solid #d1d5db',
        borderRadius: 6,
        outline: 'none',
    },
    guessBtn: {
        padding: '8px 20px',
        fontSize: 15,
        background: '#2563eb',
        color: '#ffffff',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        fontWeight: 600,
    },
};

// ---------------------------------------------------------------------------
// PictionaryGame — shell↔game contract
// ---------------------------------------------------------------------------
export default class PictionaryGame extends SimpleEmitter {
    constructor(container, config) {
        super();
        // Internal event bus to push server events into the React component
        this._eventBus = new SimpleEmitter();
        this._root = ReactDOM.createRoot(container);
        this._root.render(
            <PictionaryApp
                config={config}
                eventBus={this._eventBus}
                emit={(event, data) => this.emit(event, data)}
            />
        );
    }

    receiveEvent(name, payload) {
        this._eventBus.emit('event', name, payload);
    }

    destroy() {
        this._root.unmount();
        this._eventBus.removeAllListeners();
        this.removeAllListeners();
    }
}
