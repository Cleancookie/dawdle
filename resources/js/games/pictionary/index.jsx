import ReactDOM from 'react-dom/client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getStroke } from 'perfect-freehand';

// ---------------------------------------------------------------------------
// SimpleEmitter — same pattern as tic-tac-toe
// ---------------------------------------------------------------------------
class SimpleEmitter {
    constructor() { this._listeners = {}; }
    on(event, fn) { (this._listeners[event] ??= []).push(fn); return this; }
    off(event, fn) {
        const list = this._listeners[event];
        if (list) this._listeners[event] = list.filter((f) => f !== fn);
    }
    emit(event, ...args) { (this._listeners[event] ?? []).forEach((fn) => fn(...args)); }
    removeAllListeners() { this._listeners = {}; }
}

// ---------------------------------------------------------------------------
// Canvas drawing helpers
// ---------------------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 500;

function drawStroke(ctx, points, strokeColor, width) {
    if (points.length < 2) return;
    const outline = getStroke(points, { size: width * 3, smoothing: 0.5, thinning: 0.5 });
    if (!outline.length) return;
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length - 1; i++) {
        const mx = (outline[i][0] + outline[i + 1][0]) / 2;
        const my = (outline[i][1] + outline[i + 1][1]) / 2;
        ctx.quadraticCurveTo(outline[i][0], outline[i][1], mx, my);
    }
    ctx.closePath();
    ctx.fill();
}

function makeCommitted() {
    const c = document.createElement('canvas');
    c.width  = CANVAS_W;
    c.height = CANVAS_H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    return c;
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
    }, [initialSeconds, onExpire]);

    return seconds;
}

// ---------------------------------------------------------------------------
// Main Pictionary component
// ---------------------------------------------------------------------------
function PictionaryApp({ config, eventBus, emit }) {
    const { guestId, gameId, players, role: roomRole } = config;

    const allParticipants = [...players, ...(config.spectators ?? [])];
    const getDisplayName = (id) => {
        const p = allParticipants.find((p) => p.guestId === id);
        return p ? p.displayName : id.slice(0, 8);
    };

    // React state — only UI, never updated during drawing
    const [round, setRound]               = useState(null);
    const [roundOver, setRoundOver]       = useState(null);
    const [overlay, setOverlay]           = useState(null);
    const [color, setColor]               = useState('#000000');
    const [brushWidth, setBrushWidth]     = useState(4);
    const [isEraser, setIsEraser]         = useState(false);
    const [guessInput, setGuessInput]     = useState('');
    const [inputDisabled, setInputDisabled] = useState(false);

    // Canvas refs — all drawing is direct, no React re-renders
    const canvasRef    = useRef(null);   // visible canvas (in DOM)
    const committedRef = useRef(null);   // offscreen canvas: all finished strokes
    const currentPts   = useRef([]);
    const isDrawing    = useRef(false);
    const rafPending   = useRef(false);
    // Keep mutable copies of toolbar state for use inside rAF/pointer callbacks
    const colorRef      = useRef(color);
    const widthRef      = useRef(brushWidth);
    const eraserRef     = useRef(isEraser);
    useEffect(() => { colorRef.current  = color;      }, [color]);
    useEffect(() => { widthRef.current  = brushWidth; }, [brushWidth]);
    useEffect(() => { eraserRef.current = isEraser;   }, [isEraser]);
    // Throttled delta streaming
    const strokeIdRef    = useRef(null);
    const lastSentIdx    = useRef(0);
    const lastEmitTime   = useRef(0);
    // Incoming remote stroke accumulator (guesser/spectator preview)
    const remoteStroke   = useRef({ strokeId: null, pts: [], color: '#000000', width: 4 });

    const isDrawer   = round && guestId === round.drawerGuestId;
    const isSpectator = roomRole === 'spectator';

    // ------------------------------------------------------------------
    // Canvas helpers — never touch React state
    // ------------------------------------------------------------------
    const commitFlush = useCallback(() => {
        const canvas    = canvasRef.current;
        const committed = committedRef.current;
        if (!canvas || !committed) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.drawImage(committed, 0, 0);
    }, []);

    const commitStroke = useCallback((pts, strokeColor, width) => {
        const committed = committedRef.current;
        if (!committed) return;
        drawStroke(committed.getContext('2d'), pts, strokeColor, width);
        commitFlush();
    }, [commitFlush]);

    const clearCanvas = useCallback(() => {
        const committed = committedRef.current;
        const canvas    = canvasRef.current;
        if (!committed || !canvas) return;
        const cCtx = committed.getContext('2d');
        cCtx.fillStyle = '#ffffff';
        cCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        commitFlush();
    }, [commitFlush]);

    // ------------------------------------------------------------------
    // Initialise offscreen canvas when the visible canvas mounts
    // ------------------------------------------------------------------
    const canvasCallbackRef = useCallback((el) => {
        canvasRef.current = el;
        if (!el) return;
        committedRef.current = makeCommitted();
        commitFlush();
    }, [commitFlush]);

    // Defined here so the event-bus useEffect below can reference it in its
    // dependency array without hitting the temporal dead zone.
    const scheduleFrame = useCallback(() => {
        if (rafPending.current) return;
        rafPending.current = true;
        requestAnimationFrame(() => {
            rafPending.current = false;
            const canvas    = canvasRef.current;
            const committed = committedRef.current;
            if (!canvas || !committed) return;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
            ctx.drawImage(committed, 0, 0);
            const pts = currentPts.current;
            if (pts.length > 1) {
                const strokeColor = eraserRef.current ? '#ffffff' : colorRef.current;
                drawStroke(ctx, pts, strokeColor, widthRef.current);
            }
            // Remote in-progress stroke preview (guesser sees drawer drawing live)
            const remote = remoteStroke.current;
            if (remote.pts.length > 1) {
                drawStroke(ctx, remote.pts, remote.color, remote.width);
            }
        });
    }, []);

    // ------------------------------------------------------------------
    // Event bus — server events land here
    // ------------------------------------------------------------------
    useEffect(() => {
        const handler = (name, payload) => {
            if (name === 'pict.round_started') {
                setRound({
                    round: payload.round, totalRounds: payload.totalRounds,
                    drawerGuestId: payload.drawerGuestId, word: null, timeLimit: payload.timeLimit,
                });
                setRoundOver(null); setOverlay(null); setInputDisabled(false);
                clearCanvas();
            } else if (name === 'pict.stroke') {
                const pts   = payload.points.map((p) => [p.x, p.y]);
                const color = payload.isEraser ? '#ffffff' : payload.color;
                commitStroke(pts, color, payload.width);
            } else if (name === 'pict.stroke_delta') {
                const newPts      = payload.points.map((p) => [p.x, p.y]);
                const strokeColor = payload.isEraser ? '#ffffff' : payload.color;
                const remote      = remoteStroke.current;
                if (remote.strokeId !== payload.strokeId) {
                    remoteStroke.current = { strokeId: payload.strokeId, pts: newPts, color: strokeColor, width: payload.width };
                } else {
                    remoteStroke.current = { ...remote, pts: [...remote.pts, ...newPts] };
                }
                if (payload.final) {
                    commitStroke(remoteStroke.current.pts, remoteStroke.current.color, remoteStroke.current.width);
                    remoteStroke.current = { strokeId: null, pts: [], color: '#000000', width: 4 };
                } else {
                    scheduleFrame();
                }
            } else if (name === 'pict.canvas_clear') {
                remoteStroke.current = { strokeId: null, pts: [], color: '#000000', width: 4 };
                clearCanvas();
            } else if (name === 'pict.guess_correct') {
                if (payload.guestId === guestId) {
                    setInputDisabled(true); setOverlay('You got it!');
                } else {
                    setOverlay(`${payload.displayName} guessed it!`);
                    setTimeout(() => setOverlay(null), 3000);
                }
            } else if (name === 'pict.round_ended') {
                setRoundOver({ word: payload.word, scores: payload.scores });
                setTimeout(() => { clearCanvas(); setRoundOver(null); }, 3000);
            }
        };
        eventBus.on('event', handler);
        return () => eventBus.off('event', handler);
    }, [guestId, eventBus, clearCanvas, commitStroke, scheduleFrame]);

    // Fetch word when this client becomes drawer
    useEffect(() => {
        if (!round || round.drawerGuestId !== guestId || round.word) return;
        fetch(`/api/v1/games/${gameId}/word`, {
            headers: { 'X-Guest-ID': guestId, 'Accept': 'application/json' },
        })
            .then((r) => r.ok ? r.json() : null)
            .then((data) => { if (data?.word) setRound((prev) => prev ? { ...prev, word: data.word } : prev); })
            .catch(() => {});
    }, [round?.round, round?.drawerGuestId, guestId, gameId]);

    // ------------------------------------------------------------------
    // Timer
    // ------------------------------------------------------------------
    const handleTimerExpire = useCallback(() => {
        if (isDrawer) emit('move', { type: 'pict.timeout' });
    }, [isDrawer, emit]);
    const timeRemaining = useCountdown(round ? round.timeLimit : 0, handleTimerExpire);

    // ------------------------------------------------------------------
    // Pointer handlers — draw directly to canvas, no setState
    // ------------------------------------------------------------------
    const getCanvasPt = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return [
            ((clientX - rect.left) / rect.width)  * CANVAS_W,
            ((clientY - rect.top)  / rect.height) * CANVAS_H,
        ];
    };

    const onPointerDown = useCallback((e) => {
        if (!isDrawer || !round) return;
        e.preventDefault();
        canvasRef.current?.setPointerCapture(e.pointerId);
        isDrawing.current = true;
        strokeIdRef.current  = crypto.randomUUID();
        lastSentIdx.current  = 0;
        lastEmitTime.current = 0;
        const pt = getCanvasPt(e);
        if (pt) currentPts.current = [pt];
    }, [isDrawer, round]);

    const onPointerMove = useCallback((e) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        const pt = getCanvasPt(e);
        if (!pt) return;
        currentPts.current = [...currentPts.current, pt];
        scheduleFrame();

        const now = Date.now();
        if (now - lastEmitTime.current > 50) {
            const newPts = currentPts.current.slice(lastSentIdx.current);
            if (newPts.length > 0) {
                lastSentIdx.current  = currentPts.current.length;
                lastEmitTime.current = now;
                emit('move', {
                    type:     'pict.stroke_delta',
                    strokeId: strokeIdRef.current,
                    points:   newPts.map(([x, y]) => ({ x, y })),
                    color:    eraserRef.current ? '#ffffff' : colorRef.current,
                    width:    widthRef.current,
                    isEraser: eraserRef.current,
                    final:    false,
                });
            }
        }
    }, [scheduleFrame, emit]);

    const onPointerUp = useCallback((e) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        isDrawing.current = false;
        const pts = currentPts.current;
        currentPts.current = [];
        if (!pts.length) return;
        const strokeColor = eraserRef.current ? '#ffffff' : colorRef.current;
        commitStroke(pts, strokeColor, widthRef.current);
        // Send remaining unshipped points as the final delta
        const remainingPts = pts.slice(lastSentIdx.current);
        emit('move', {
            type:     'pict.stroke_delta',
            strokeId: strokeIdRef.current,
            points:   remainingPts.map(([x, y]) => ({ x, y })),
            color:    strokeColor,
            width:    widthRef.current,
            isEraser: eraserRef.current,
            final:    true,
        });
    }, [commitStroke, emit]);

    const handleClear = useCallback(() => {
        if (!isDrawer) return;
        clearCanvas();
        currentPts.current = [];
        emit('move', { type: 'pict.canvas_clear' });
    }, [isDrawer, clearCanvas, emit]);

    // ------------------------------------------------------------------
    // Guess
    // ------------------------------------------------------------------
    const handleGuessSubmit = (e) => {
        e.preventDefault();
        const trimmed = guessInput.trim();
        if (!trimmed || inputDisabled) return;
        emit('move', { type: 'pict.guess', guess: trimmed });
        setGuessInput('');
    };

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------
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
            <div style={styles.header}>
                <span style={styles.roundLabel}>
                    Round {round.round} of {round.totalRounds} — {drawerName} is drawing!
                </span>
                <span style={{ ...styles.timer, color: timerColor }}>{timeRemaining}s</span>
            </div>

            {isDrawer && round.word && (
                <div style={styles.word}>Draw: <strong>{round.word}</strong></div>
            )}

            <div style={styles.canvasWrapper}>
                <canvas
                    ref={canvasCallbackRef}
                    width={CANVAS_W}
                    height={CANVAS_H}
                    style={styles.canvas}
                    onPointerDown={isDrawer ? onPointerDown : undefined}
                    onPointerMove={isDrawer ? onPointerMove : undefined}
                    onPointerUp={isDrawer ? onPointerUp : undefined}
                    onPointerLeave={isDrawer ? onPointerUp : undefined}
                />

                {overlay && <div style={styles.overlay}>{overlay}</div>}
                {roundOver && (
                    <div style={styles.roundOverlay}>
                        <div style={styles.roundOverCard}>
                            <div style={styles.roundOverTitle}>Round over!</div>
                            <div style={styles.roundOverWord}>The word was: <strong>{roundOver.word}</strong></div>
                            <div style={styles.scoreList}>
                                {roundOver.scores.map((s) => (
                                    <div key={s.guestId} style={styles.scoreRow}>
                                        <span>{getDisplayName(s.guestId)}</span>
                                        <span>+{s.score ?? 0}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

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
                        />
                    ))}
                    <div style={styles.separator} />
                    <label style={styles.widthLabel}>
                        Size
                        <input type="range" min="1" max="12" value={brushWidth}
                            onChange={(e) => setBrushWidth(Number(e.target.value))}
                            style={{ marginLeft: 6, width: 80 }} />
                    </label>
                    <div style={styles.separator} />
                    <button onClick={() => setIsEraser((v) => !v)}
                        style={{ ...styles.toolBtn, background: isEraser ? '#e5e7eb' : 'transparent' }}>
                        Eraser
                    </button>
                    <button onClick={handleClear} style={styles.toolBtn}>Clear</button>
                </div>
            )}

            {!isDrawer && !isSpectator && (
                <form onSubmit={handleGuessSubmit} style={styles.guessForm}>
                    <input type="text" value={guessInput}
                        onChange={(e) => setGuessInput(e.target.value)}
                        disabled={inputDisabled}
                        placeholder={inputDisabled ? 'You guessed it!' : 'Type your guess…'}
                        style={styles.guessInput} autoComplete="off" />
                    <button type="submit" disabled={inputDisabled} style={styles.guessBtn}>Guess</button>
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
    canvas: {
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
    static roomConfig = {
        showCursors: false,   // cursors over the canvas are distracting
    };

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
