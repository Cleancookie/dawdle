import ReactDOM from 'react-dom/client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getStroke } from 'perfect-freehand';
import PictionaryEngine from './main.js';

// ---------------------------------------------------------------------------
// Inject CSS keyframes once at module load
// ---------------------------------------------------------------------------
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes timerPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.65; transform: scale(1.12); }
        }
        @keyframes canvasBorderPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
            50% { box-shadow: 0 0 0 4px rgba(220,38,38,0.35); }
        }
        @keyframes confettiFly {
            0%   { transform: translate(0,0) rotate(0deg); opacity: 1; }
            100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes cardBounceIn {
            0%   { transform: scale(0.5) rotate(-3deg); opacity: 0; }
            60%  { transform: scale(1.08) rotate(0.5deg); opacity: 1; }
            80%  { transform: scale(0.97); }
            100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 500;

// ---------------------------------------------------------------------------
// SimpleEmitter — only needed for the outer shell class
// ---------------------------------------------------------------------------
class SimpleEmitter {
    constructor() { this._listeners = {}; }
    on(event, fn)  { (this._listeners[event] ??= []).push(fn); return this; }
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
// PictionaryApp — thin React shell. Owns canvas refs and toolbar UI state.
// Subscribes to engine for logical state + canvas-ops events.
// ---------------------------------------------------------------------------
function PictionaryApp({ engine, config }) {
    const { guestId, players, role: roomRole } = config;
    const allParticipants = [...players, ...(config.spectators ?? [])];
    const getDisplayName = (id) => allParticipants.find((p) => p.guestId === id)?.displayName ?? id.slice(0, 8);

    // Mirror engine state
    const [state, setEngineState] = useState(engine.state);
    useEffect(() => {
        const handler = (s) => setEngineState(s);
        engine.on('stateChanged', handler);
        return () => engine.off('stateChanged', handler);
    }, [engine]);
    const { round, roundOver, overlay, inputDisabled, timeRemaining } = state;

    // Confetti state for correct-guess burst
    const [confetti, setConfetti] = useState([]);

    // Toolbar UI state — purely local
    const [color, setColor]         = useState('#000000');
    const [brushWidth, setBrushWidth] = useState(4);
    const [isEraser, setIsEraser]   = useState(false);
    const [guessInput, setGuessInput] = useState('');

    // Canvas refs + drawing hot path (never setState during drawing)
    const canvasRef    = useRef(null);
    const committedRef = useRef(null);
    const currentPts   = useRef([]);
    const isDrawing    = useRef(false);
    const rafPending   = useRef(false);
    const remoteStroke = useRef({ strokeId: null, pts: [], color: '#000000', width: 4 });

    // Keep toolbar state readable from inside rAF/pointer callbacks
    const colorRef  = useRef(color);
    const widthRef  = useRef(brushWidth);
    const eraserRef = useRef(isEraser);
    useEffect(() => { colorRef.current  = color;      }, [color]);
    useEffect(() => { widthRef.current  = brushWidth; }, [brushWidth]);
    useEffect(() => { eraserRef.current = isEraser;   }, [isEraser]);

    const isDrawer    = round && guestId === round.drawerGuestId;
    const isSpectator = roomRole === 'spectator';

    // ------------------------------------------------------------------
    // Canvas ops — no React state touched
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
        if (!committed || !canvasRef.current) return;
        const ctx = committed.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        commitFlush();
    }, [commitFlush]);

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
            const remote = remoteStroke.current;
            if (remote.pts.length > 1) {
                drawStroke(ctx, remote.pts, remote.color, remote.width);
            }
        });
    }, []);

    // ------------------------------------------------------------------
    // Wire engine events to canvas ops
    // ------------------------------------------------------------------
    useEffect(() => {
        const onClear = () => {
            remoteStroke.current = { strokeId: null, pts: [], color: '#000000', width: 4 };
            clearCanvas();
        };
        const onCommit = ({ points, color, width }) => commitStroke(points, color, width);
        const onRemoteDelta = ({ strokeId, points, color, width, final }) => {
            const r = remoteStroke.current;
            if (r.strokeId !== strokeId) {
                remoteStroke.current = { strokeId, pts: points, color, width };
            } else {
                remoteStroke.current = { ...r, pts: [...r.pts, ...points] };
            }
            if (final) {
                commitStroke(remoteStroke.current.pts, remoteStroke.current.color, remoteStroke.current.width);
                remoteStroke.current = { strokeId: null, pts: [], color: '#000000', width: 4 };
            } else {
                scheduleFrame();
            }
        };
        const onGuessSuccess = () => {
            setConfetti(Array.from({ length: 24 }, (_, i) => ({
                id: i,
                x: 45 + Math.random() * 10,
                y: 40 + Math.random() * 10,
                tx: (Math.random() - 0.5) * 200,
                ty: (Math.random() - 0.5) * 160,
                rotation: Math.random() * 720,
                color: ['#f59e0b','#3b82f6','#10b981','#ef4444','#8b5cf6','#ec4899'][i % 6],
                shape: Math.random() > 0.5 ? 'circle' : 'rect',
                size: 6 + Math.random() * 6,
            })));
            setTimeout(() => setConfetti([]), 1200);
        };

        engine.on('canvasClear',       onClear);
        engine.on('commitStroke',      onCommit);
        engine.on('remoteStrokeDelta', onRemoteDelta);
        engine.on('guessSuccess',      onGuessSuccess);
        return () => {
            engine.off('canvasClear',       onClear);
            engine.off('commitStroke',      onCommit);
            engine.off('remoteStrokeDelta', onRemoteDelta);
            engine.off('guessSuccess',      onGuessSuccess);
        };
    }, [engine, clearCanvas, commitStroke, scheduleFrame]);

    // Initialise offscreen canvas once the visible canvas mounts
    const canvasCallbackRef = useCallback((el) => {
        canvasRef.current = el;
        if (!el) return;
        committedRef.current = makeCommitted();
        commitFlush();
    }, [commitFlush]);

    // ------------------------------------------------------------------
    // Pointer handlers
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
        if (!engine.startStroke()) return;
        isDrawing.current = true;
        const pt = getCanvasPt(e);
        if (pt) currentPts.current = [pt];
    }, [isDrawer, round, engine]);

    const onPointerMove = useCallback((e) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        const pt = getCanvasPt(e);
        if (!pt) return;
        currentPts.current = [...currentPts.current, pt];
        scheduleFrame();
        engine.maybeSendStrokeDelta(currentPts.current, {
            color:    colorRef.current,
            width:    widthRef.current,
            isEraser: eraserRef.current,
        });
    }, [scheduleFrame, engine]);

    const onPointerUp = useCallback((e) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        isDrawing.current = false;
        const pts = currentPts.current;
        currentPts.current = [];
        if (!pts.length) return;
        const strokeColor = eraserRef.current ? '#ffffff' : colorRef.current;
        commitStroke(pts, strokeColor, widthRef.current);
        engine.endStroke(pts, {
            color:    colorRef.current,
            width:    widthRef.current,
            isEraser: eraserRef.current,
        });
    }, [commitStroke, engine]);

    const handleClear = useCallback(() => {
        currentPts.current = [];
        engine.clearBoard();
    }, [engine]);

    const handleGuessSubmit = (e) => {
        e.preventDefault();
        if (engine.submitGuess(guessInput)) setGuessInput('');
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
    const isWarning = timeRemaining <= 10 && timeRemaining > 0;

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <span style={styles.roundLabel}>
                    Round {round.round} of {round.totalRounds} — {drawerName} is drawing!
                </span>
                <span style={{
                    ...styles.timer,
                    color:       isWarning ? '#dc2626' : '#374151',
                    fontWeight:  isWarning ? 700 : 600,
                    animation:   isWarning ? 'timerPulse 600ms ease-in-out infinite' : 'none',
                    display:     'inline-block',
                }}>{timeRemaining}s</span>
            </div>

            {isDrawer && round.word && (
                <div style={styles.word}>Draw: <strong>{round.word}</strong></div>
            )}

            <div style={{
                ...styles.canvasWrapper,
                animation: isWarning ? 'canvasBorderPulse 600ms ease-in-out infinite' : 'none',
            }}>
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
                        <div key={roundOver.word} style={{
                            ...styles.roundOverCard,
                            animation: 'cardBounceIn 550ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
                        }}>
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
                {confetti.length > 0 && (
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
                        {confetti.map(p => (
                            <div key={p.id} style={{
                                position:     'absolute',
                                left:         `${p.x}%`,
                                top:          `${p.y}%`,
                                width:        p.shape === 'circle' ? p.size : p.size * 1.2,
                                height:       p.size,
                                borderRadius: p.shape === 'circle' ? '50%' : 2,
                                background:   p.color,
                                animation:    'confettiFly 1.2s ease-out forwards',
                                '--tx':       `${p.tx}px`,
                                '--ty':       `${p.ty}px`,
                                '--rot':      `${p.rotation}deg`,
                            }} />
                        ))}
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
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        background:    '#f9fafb',
        fontFamily:    'ui-sans-serif, system-ui, sans-serif',
        userSelect:    'none',
    },
    waiting: {
        margin:   'auto',
        fontSize: 20,
        color:    '#6b7280',
    },
    header: {
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        padding:        '8px 16px',
        background:     '#ffffff',
        borderBottom:   '1px solid #e5e7eb',
        flexWrap:       'wrap',
        gap:            8,
    },
    roundLabel: {
        fontSize:   16,
        color:      '#374151',
        fontWeight: 500,
    },
    timer: {
        fontSize:   20,
        fontWeight: 700,
        minWidth:   48,
        textAlign:  'right',
    },
    word: {
        padding:      '6px 16px',
        background:   '#fef9c3',
        borderBottom: '1px solid #fde68a',
        fontSize:     18,
        color:        '#92400e',
        textAlign:    'center',
    },
    canvasWrapper: {
        flex:       1,
        position:   'relative',
        overflow:   'hidden',
        display:    'flex',
        alignItems: 'stretch',
        minHeight:  0,
    },
    canvas: {
        width:      '100%',
        height:     '100%',
        display:    'block',
        touchAction: 'none',
        cursor:     'crosshair',
    },
    overlay: {
        position:      'absolute',
        top:           '50%',
        left:          '50%',
        transform:     'translate(-50%, -50%)',
        background:    'rgba(0,0,0,0.65)',
        color:         '#ffffff',
        fontSize:      28,
        fontWeight:    700,
        padding:       '16px 32px',
        borderRadius:  12,
        pointerEvents: 'none',
    },
    roundOverlay: {
        position:       'absolute',
        inset:          0,
        background:     'rgba(0,0,0,0.5)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
    },
    roundOverCard: {
        background:   '#ffffff',
        borderRadius: 12,
        padding:      '24px 32px',
        minWidth:     240,
        textAlign:    'center',
        boxShadow:    '0 4px 24px rgba(0,0,0,0.2)',
    },
    roundOverTitle: {
        fontSize:     22,
        fontWeight:   700,
        color:        '#374151',
        marginBottom: 8,
    },
    roundOverWord: {
        fontSize:     16,
        color:        '#6b7280',
        marginBottom: 16,
    },
    scoreList: {
        display:       'flex',
        flexDirection: 'column',
        gap:           6,
    },
    scoreRow: {
        display:        'flex',
        justifyContent: 'space-between',
        fontSize:       15,
        color:          '#374151',
    },
    toolbar: {
        display:    'flex',
        alignItems: 'center',
        gap:        8,
        padding:    '8px 16px',
        background: '#ffffff',
        borderTop:  '1px solid #e5e7eb',
        flexWrap:   'wrap',
    },
    colorBtn: {
        width:        28,
        height:       28,
        borderRadius: '50%',
        border:       '2px solid #d1d5db',
        cursor:       'pointer',
        padding:      0,
    },
    separator: {
        width:      1,
        height:     24,
        background: '#e5e7eb',
        margin:     '0 4px',
    },
    widthLabel: {
        fontSize:   13,
        color:      '#6b7280',
        display:    'flex',
        alignItems: 'center',
    },
    toolBtn: {
        padding:      '4px 12px',
        fontSize:     13,
        borderRadius: 6,
        border:       '1px solid #d1d5db',
        cursor:       'pointer',
        background:   'transparent',
        color:        '#374151',
    },
    guessForm: {
        display:    'flex',
        gap:        8,
        padding:    '8px 16px',
        background: '#ffffff',
        borderTop:  '1px solid #e5e7eb',
    },
    guessInput: {
        flex:         1,
        padding:      '8px 12px',
        fontSize:     15,
        border:       '1px solid #d1d5db',
        borderRadius: 6,
        outline:      'none',
    },
    guessBtn: {
        padding:      '8px 20px',
        fontSize:     15,
        background:   '#2563eb',
        color:        '#ffffff',
        border:       'none',
        borderRadius: 6,
        cursor:       'pointer',
        fontWeight:   600,
    },
};

// ---------------------------------------------------------------------------
// PictionaryGame — shell↔game contract
// ---------------------------------------------------------------------------
export default class PictionaryGame extends SimpleEmitter {
    static roomConfig = {};
    static maxPlayers = 8;

    constructor(container, config) {
        super();
        this._engine = new PictionaryEngine(config, (moveData) => this.emit('move', moveData));
        this._engine.on('complete', (result) => this.emit('complete', result));

        this._root = ReactDOM.createRoot(container);
        this._root.render(<PictionaryApp engine={this._engine} config={config} />);
    }

    receiveEvent(name, payload) {
        this._engine.receiveEvent(name, payload);
    }

    destroy() {
        this._root.unmount();
        this._engine.destroy();
        this.removeAllListeners();
    }
}
