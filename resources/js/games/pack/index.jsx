import ReactDOM from 'react-dom/client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import PackEngine from './main.js';

// ---------------------------------------------------------------------------
// Animation tokens
// ---------------------------------------------------------------------------
const ANIM = {
    micro:    { duration: 150 },
    standard: { duration: 300 },
    dramatic: { duration: 500 },
    settle:   { duration: 400 },
};

// ---------------------------------------------------------------------------
// CSS keyframes — injected once at module load
// ---------------------------------------------------------------------------
const KEYFRAMES = `
@keyframes answerReveal {
  0%   { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes winnerPulse {
  0%, 100% { background: #fef9c3; }
  50%       { background: #fde047; }
}
@keyframes scorePop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.3); color: #f59e0b; }
  100% { transform: scale(1); }
}
`;

if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = KEYFRAMES;
    document.head.appendChild(style);
}

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
// PLAYER_COLORS
// ---------------------------------------------------------------------------
const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

// ---------------------------------------------------------------------------
// TimerBar — thin bar that shrinks over timeLimit seconds
// ---------------------------------------------------------------------------
function TimerBar({ timeRemaining, timeLimit }) {
    const pct = timeLimit > 0 ? Math.max(0, timeRemaining / timeLimit) : 0;
    const color = pct > 0.5 ? '#10b981' : pct > 0.25 ? '#f59e0b' : '#ef4444';

    return (
        <div style={{ height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{
                height:           '100%',
                width:            `${pct * 100}%`,
                background:       color,
                transition:       'width 1s linear, background 0.5s ease',
                borderRadius:     2,
            }} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// PackApp — thin React shell. Mirrors engine.state; delegates all actions.
// ---------------------------------------------------------------------------
function PackApp({ engine, config }) {
    const { guestId, players } = config;
    const [state, setState] = useState(engine.state);
    const inputRef          = useRef(null);
    const [inputText, setInputText] = useState('');

    // Animation: score pop tracking
    const [poppingScores, setPoppingScores] = useState(() => new Set());
    const prevScoresRef = useRef({});

    // Auto-advance countdown text after reveal
    const [advanceCountdown, setAdvanceCountdown] = useState(null);
    const advanceTimerRef = useRef(null);

    // Mirror engine state
    useEffect(() => {
        const handler = (s) => setState(s);
        engine.on('stateChanged', handler);
        return () => engine.off('stateChanged', handler);
    }, [engine]);

    // Focus input on answering phase
    useEffect(() => {
        if (state.phase === 'answering') {
            setInputText('');
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [state.phase, state.round]);

    // Detect score increases → pop animation
    useEffect(() => {
        const prev = prevScoresRef.current;
        const curr = state.scores;
        const increased = Object.keys(curr).filter((id) => (curr[id] ?? 0) > (prev[id] ?? 0));
        if (increased.length > 0) {
            setPoppingScores((p) => {
                const next = new Set(p);
                increased.forEach((id) => next.add(id));
                return next;
            });
            setTimeout(() => {
                setPoppingScores((p) => {
                    const next = new Set(p);
                    increased.forEach((id) => next.delete(id));
                    return next;
                });
            }, ANIM.dramatic.duration);
        }
        prevScoresRef.current = curr;
    }, [state.scores]);

    // Auto-advance countdown on reveal
    useEffect(() => {
        if (state.phase === 'reveal') {
            setAdvanceCountdown(4);
            let remaining = 4;
            advanceTimerRef.current = setInterval(() => {
                remaining--;
                setAdvanceCountdown(remaining);
                if (remaining <= 0) {
                    clearInterval(advanceTimerRef.current);
                    advanceTimerRef.current = null;
                    engine.submitAdvance();
                }
            }, 1000);
        } else {
            clearInterval(advanceTimerRef.current);
            advanceTimerRef.current = null;
            setAdvanceCountdown(null);
        }
        return () => {
            clearInterval(advanceTimerRef.current);
            advanceTimerRef.current = null;
        };
    }, [state.phase, state.round]);

    const allParticipants = useMemo(
        () => [...players, ...(config.spectators ?? [])],
        [players, config.spectators],
    );

    const getDisplayName = useCallback(
        (id) => allParticipants.find((p) => p.guestId === id)?.displayName ?? id.slice(0, 8),
        [allParticipants],
    );

    const playerColorMap = useMemo(() => {
        const map = {};
        players.forEach((p, i) => { map[p.guestId] = PLAYER_COLORS[i % PLAYER_COLORS.length]; });
        return map;
    }, [players]);

    const handleSubmit = useCallback(() => {
        const val = inputText.trim();
        if (!val) return;
        engine.submitAnswer(val);
    }, [engine, inputText]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter') handleSubmit();
    }, [handleSubmit]);

    const sortedScores = useMemo(() => (
        Object.entries(state.scores)
            .map(([id, score]) => ({ id, score, name: getDisplayName(id) }))
            .sort((a, b) => b.score - a.score)
    ), [state.scores, getDisplayName]);

    // -----------------------------------------------------------------------
    // Loading / waiting
    // -----------------------------------------------------------------------
    if (!state.phase) {
        return (
            <div style={styles.container}>
                <div style={styles.waiting}>Waiting for game to start…</div>
            </div>
        );
    }

    // -----------------------------------------------------------------------
    // Ended
    // -----------------------------------------------------------------------
    if (state.phase === 'ended') {
        return (
            <div style={styles.container}>
                <div style={styles.waiting}>Game over! Final scores loading…</div>
            </div>
        );
    }

    const isSpectator = config.role === 'spectator';
    const { phase, question, round, totalRounds, timeRemaining, timeLimit,
            answeredCount, totalCount, result, inputDisabled } = state;

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    return (
        <div style={styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <span style={styles.roundLabel}>Round {round} / {totalRounds}</span>
                <div style={styles.scoreboard}>
                    {sortedScores.map(({ id, score, name }) => (
                        <span key={id} style={{
                            ...styles.scoreEntry,
                            fontWeight: id === guestId ? 700 : 400,
                            color:      playerColorMap[id] ?? '#374151',
                            animation:  poppingScores.has(id)
                                ? `scorePop ${ANIM.dramatic.duration}ms cubic-bezier(0.34,1.56,0.64,1)`
                                : 'none',
                            display: 'inline-block',
                        }}>
                            {name}: {score}
                        </span>
                    ))}
                </div>
            </div>

            {/* Main area */}
            <div style={styles.mainArea}>
                <div style={styles.card}>

                    {/* Timer bar (answering phase only) */}
                    {phase === 'answering' && (
                        <TimerBar timeRemaining={timeRemaining} timeLimit={timeLimit} />
                    )}

                    {/* Question */}
                    <div style={styles.question}>{question}</div>

                    {/* ---- ANSWERING PHASE ---- */}
                    {phase === 'answering' && (
                        <>
                            {!isSpectator && (
                                <>
                                    <div style={styles.inputRow}>
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            value={inputText}
                                            onChange={(e) => setInputText(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            disabled={inputDisabled}
                                            placeholder="Your answer…"
                                            style={{
                                                ...styles.input,
                                                opacity:   inputDisabled ? 0.5 : 1,
                                                cursor:    inputDisabled ? 'not-allowed' : 'text',
                                            }}
                                        />
                                        <button
                                            onClick={handleSubmit}
                                            disabled={inputDisabled}
                                            style={{
                                                ...styles.submitBtn,
                                                opacity: inputDisabled ? 0.5 : 1,
                                                cursor:  inputDisabled ? 'not-allowed' : 'pointer',
                                            }}
                                        >
                                            Submit
                                        </button>
                                    </div>

                                    {inputDisabled && (
                                        <div style={styles.waitingOthers}>Waiting for others…</div>
                                    )}
                                </>
                            )}

                            {isSpectator && (
                                <div style={styles.waitingOthers}>Spectating — players are answering…</div>
                            )}

                            {(totalCount > 0 || answeredCount > 0) && (
                                <div style={styles.progressText}>
                                    {answeredCount} / {totalCount || players.length} answered
                                </div>
                            )}
                        </>
                    )}

                    {/* ---- REVEAL PHASE ---- */}
                    {phase === 'reveal' && result && (
                        <>
                            {/* Most common answer banner */}
                            <div style={styles.herdBanner}>
                                {result.mostCommon
                                    ? `🐄 The Herd says: ${result.mostCommon}`
                                    : '🤷 Everyone answered differently — no points!'}
                            </div>

                            {/* Answer list */}
                            <div style={styles.answerList}>
                                {(result.answers ?? []).map((item, idx) => {
                                    const isWinner = item.isWinner ?? result.winners?.includes(item.guestId);
                                    const prevScore = (sortedScores.find(s => s.id === item.guestId)?.score ?? 0) - (isWinner ? 1 : 0);
                                    return (
                                        <div
                                            key={item.guestId}
                                            style={{
                                                ...styles.answerItem,
                                                background: isWinner ? '#fef9c3' : '#f9fafb',
                                                animation: `answerReveal ${ANIM.standard.duration}ms ease-out both`,
                                                animationDelay: `${idx * 80}ms`,
                                                ...(isWinner ? { animation: `answerReveal ${ANIM.standard.duration}ms ease-out both, winnerPulse 1.2s ease-in-out ${idx * 80}ms 2` } : {}),
                                            }}
                                        >
                                            <span style={{
                                                ...styles.playerName,
                                                color: playerColorMap[item.guestId] ?? '#374151',
                                            }}>
                                                {getDisplayName(item.guestId)}
                                            </span>
                                            <span style={styles.answerText}>{item.answer}</span>
                                            {isWinner && (
                                                <span style={styles.scoreDelta}>+1</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {advanceCountdown !== null && advanceCountdown > 0 && (
                                <div style={styles.advanceNote}>
                                    Next round in {advanceCountdown}s…
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
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
        background:    '#f0f4f8',
        fontFamily:    'ui-sans-serif, system-ui, sans-serif',
        userSelect:    'none',
        overflow:      'hidden',
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
        padding:        '10px 20px',
        background:     '#ffffff',
        borderBottom:   '1px solid #e5e7eb',
        flexShrink:     0,
        flexWrap:       'wrap',
        gap:            8,
    },
    roundLabel: {
        fontSize:   16,
        fontWeight: 600,
        color:      '#374151',
    },
    scoreboard: {
        display:  'flex',
        gap:      16,
        flexWrap: 'wrap',
    },
    scoreEntry: {
        fontSize: 14,
    },
    mainArea: {
        flex:           1,
        display:        'flex',
        alignItems:     'flex-start',
        justifyContent: 'center',
        padding:        '32px 16px',
        overflow:       'auto',
    },
    card: {
        width:        '100%',
        maxWidth:     520,
        background:   '#ffffff',
        borderRadius: 16,
        boxShadow:    '0 4px 20px rgba(0,0,0,0.08)',
        padding:      '28px 28px 24px',
    },
    question: {
        fontSize:     24,
        fontWeight:   700,
        color:        '#1f2937',
        textAlign:    'center',
        marginBottom: 24,
        lineHeight:   1.3,
    },
    inputRow: {
        display: 'flex',
        gap:     10,
    },
    input: {
        flex:         1,
        fontSize:     18,
        padding:      '10px 14px',
        borderRadius: 10,
        border:       '2px solid #d1d5db',
        outline:      'none',
        transition:   'border-color 0.15s',
        fontFamily:   'inherit',
    },
    submitBtn: {
        fontSize:     16,
        fontWeight:   600,
        padding:      '10px 20px',
        background:   '#3b82f6',
        color:        '#ffffff',
        border:       'none',
        borderRadius: 10,
        transition:   'background 0.15s',
        fontFamily:   'inherit',
    },
    waitingOthers: {
        marginTop: 14,
        fontSize:  14,
        color:     '#9ca3af',
        textAlign: 'center',
    },
    progressText: {
        marginTop: 10,
        fontSize:  13,
        color:     '#6b7280',
        textAlign: 'center',
    },
    herdBanner: {
        background:    '#fef9c3',
        border:        '1px solid #fde68a',
        borderRadius:  10,
        padding:       '12px 16px',
        fontSize:      17,
        fontWeight:    700,
        color:         '#92400e',
        textAlign:     'center',
        marginBottom:  20,
    },
    answerList: {
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
        marginBottom:  16,
    },
    answerItem: {
        display:        'flex',
        alignItems:     'center',
        gap:            10,
        padding:        '10px 14px',
        borderRadius:   10,
        border:         '1px solid #e5e7eb',
    },
    playerName: {
        fontSize:   13,
        fontWeight: 700,
        minWidth:   80,
        flexShrink: 0,
    },
    answerText: {
        flex:       1,
        fontSize:   16,
        color:      '#1f2937',
        fontWeight: 500,
    },
    scoreDelta: {
        fontSize:   14,
        fontWeight: 700,
        color:      '#16a34a',
        flexShrink: 0,
    },
    advanceNote: {
        textAlign:  'center',
        fontSize:   13,
        color:      '#9ca3af',
        marginTop:  4,
    },
};

// ---------------------------------------------------------------------------
// PackGame — shell↔game contract. Glue between engine and React.
// ---------------------------------------------------------------------------
export default class PackGame extends SimpleEmitter {
    static roomConfig = {};
    static maxPlayers = 8;

    constructor(container, config) {
        super();
        this._engine = new PackEngine(config, (moveData) => this.emit('move', moveData));
        this._engine.on('complete', (result) => this.emit('complete', result));

        this._root = ReactDOM.createRoot(container);
        this._root.render(<PackApp engine={this._engine} config={config} />);
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
