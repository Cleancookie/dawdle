import ReactDOM from 'react-dom/client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import SpottoEngine from './main.js';

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
@keyframes cardShake {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-8px); }
  40%       { transform: translateX(8px); }
  60%       { transform: translateX(-6px); }
  80%       { transform: translateX(6px); }
}
@keyframes scorePop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.3); color: #f59e0b; }
  100% { transform: scale(1); }
}
@keyframes cardDealIn {
  0%   { opacity: 0; transform: translateY(-12px) scale(0.92); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
`;

if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = KEYFRAMES;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CARD_SIZE = 250;
const CENTER    = CARD_SIZE / 2;

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

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
// useViewport — track window width so cards can shrink on mobile
// ---------------------------------------------------------------------------
function useViewportWidth() {
    const [w, setW] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
    useEffect(() => {
        const onResize = () => setW(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return w;
}

// ---------------------------------------------------------------------------
// Card — renders at CARD_SIZE internally, then CSS-scales to `scale`
// ---------------------------------------------------------------------------
function Card({
    symbolIndices,
    symbols,
    layout,
    cardId,
    onSymbolClick,
    onSymbolHover,
    highlightIdx,
    hoverHighlights,
    disabled,
    scale = 1,
    innerCircleStyle,
}) {
    return (
        <div style={{
            position:  'relative',
            width:     CARD_SIZE * scale,
            height:    CARD_SIZE * scale,
            flexShrink: 0,
        }}>
            <div style={{
                position:        'absolute',
                width:           CARD_SIZE,
                height:          CARD_SIZE,
                transformOrigin: '0 0',
                transform:       `scale(${scale})`,
            }}>
                <div style={{
                    position:     'absolute',
                    inset:        0,
                    borderRadius: '50%',
                    border:       '4px solid #1f2937',
                    background:   '#ffffff',
                    boxShadow:    '0 6px 20px rgba(0,0,0,0.15)',
                    ...innerCircleStyle,
                }} />

                {symbolIndices.map((symIdx, i) => {
                    const pos      = layout?.[i];
                    const x        = CENTER + (pos?.x ?? 0);
                    const y        = CENTER + (pos?.y ?? 0);
                    const boxSize  = Math.min(Math.max(pos?.size ?? 28, 20), 42);
                    const fontSize = Math.round(boxSize * 0.82);
                    const rot      = pos?.rotation ?? 0;
                    const isMatch  = symIdx === highlightIdx;

                    const hoverers   = (hoverHighlights ?? []).filter(h => h.symbolIdx === symIdx);
                    const firstColor = hoverers[0]?.color ?? null;

                    return (
                        <React.Fragment key={symIdx}>
                            {hoverers.map(({ color }, hi) => (
                                <div
                                    key={hi}
                                    style={{
                                        position:      'absolute',
                                        left:          x - 6 + hi * 15,
                                        top:           y - boxSize / 2 - 20,
                                        width:         0,
                                        height:        0,
                                        borderLeft:    '6px solid transparent',
                                        borderRight:   '6px solid transparent',
                                        borderTop:     `11px solid ${color}`,
                                        pointerEvents: 'none',
                                        zIndex:        3,
                                    }}
                                />
                            ))}

                            <div
                                onClick={() => !disabled && onSymbolClick?.(symIdx)}
                                onMouseEnter={() => onSymbolHover?.(symIdx, cardId)}
                                onMouseLeave={() => onSymbolHover?.(null, cardId)}
                                style={{
                                    position:       'absolute',
                                    left:           x - boxSize / 2,
                                    top:            y - boxSize / 2,
                                    width:          boxSize,
                                    height:         boxSize,
                                    display:        'flex',
                                    alignItems:     'center',
                                    justifyContent: 'center',
                                    fontSize,
                                    cursor:         disabled ? 'default' : 'pointer',
                                    borderRadius:   '50%',
                                    background:     isMatch ? 'rgba(250,204,21,0.55)' : 'transparent',
                                    outline:        firstColor
                                        ? `3px solid ${firstColor}`
                                        : isMatch ? '2px solid #ca8a04' : 'none',
                                    outlineOffset:  firstColor ? '5px' : isMatch ? '3px' : '0',
                                    transform:      `rotate(${rot}deg)`,
                                    transition:     'background 0.12s, outline-color 0.12s',
                                    userSelect:     'none',
                                    lineHeight:     1,
                                    zIndex:         1,
                                }}
                                onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = `rotate(${rot}deg) scale(0.88)`; }}
                                onMouseUp={e   => { e.currentTarget.style.transform = `rotate(${rot}deg) scale(1)`; }}
                            >
                                {symbols[symIdx]}
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// SpottoApp — thin React shell. Mirrors engine.state; delegates all actions.
// ---------------------------------------------------------------------------
function SpottoApp({ engine, config }) {
    const { guestId, players } = config;
    const [state, setState]     = useState(engine.state);

    // Animation 2: wrong tap shake
    const [shaking, setShaking] = useState(false);

    // Animation 1: card replacement
    const [cardAnim, setCardAnim] = useState('idle');
    // 'in' starts offscreen, then we flip to the final position 1 frame later
    const [cardInActive, setCardInActive] = useState(false);

    // Animation 3: score pop
    const [poppingScores, setPoppingScores] = useState(() => new Set());
    const prevScoresRef = useRef({});

    // Animation 4: staggered deal
    const [dealKey, setDealKey] = useState(0);
    const prevRoundRef = useRef(null);

    // Mirror engine state
    useEffect(() => {
        const handler = (s) => setState(s);
        engine.on('stateChanged', handler);
        return () => engine.off('stateChanged', handler);
    }, [engine]);

    // Animation 2: listen for invalidGuess from engine
    useEffect(() => {
        const handler = () => {
            setShaking(true);
            setTimeout(() => setShaking(false), ANIM.settle.duration);
        };
        engine.on('invalidGuess', handler);
        return () => engine.off('invalidGuess', handler);
    }, [engine]);

    // Animation 1: card flies out when locked (point scored)
    const prevLockedRef = useRef(false);
    useEffect(() => {
        if (state.locked && !prevLockedRef.current) {
            setCardAnim('out');
            setCardInActive(false);
        }
        prevLockedRef.current = state.locked;
    }, [state.locked]);

    // Animation 1: card flies in when round increments
    useEffect(() => {
        if (state.round?.round == null) return;
        const roundNum = state.round.round;
        if (prevRoundRef.current !== null && roundNum !== prevRoundRef.current) {
            setCardAnim('in');
            setCardInActive(false);
            // 1 frame later activate the transition to final position
            requestAnimationFrame(() => {
                requestAnimationFrame(() => setCardInActive(true));
            });
            setTimeout(() => setCardAnim('idle'), ANIM.dramatic.duration + 50);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.round?.round]);

    // Animation 3: detect score increases
    useEffect(() => {
        const prev = prevScoresRef.current;
        const curr = state.scores;
        const increased = Object.keys(curr).filter(id => (curr[id] ?? 0) > (prev[id] ?? 0));
        if (increased.length > 0) {
            setPoppingScores(prev => {
                const next = new Set(prev);
                increased.forEach(id => next.add(id));
                return next;
            });
            setTimeout(() => {
                setPoppingScores(prev => {
                    const next = new Set(prev);
                    increased.forEach(id => next.delete(id));
                    return next;
                });
            }, ANIM.dramatic.duration);
        }
        prevScoresRef.current = curr;
    }, [state.scores]);

    // Animation 4: increment dealKey on new round
    useEffect(() => {
        const roundNum = state.round?.round ?? null;
        if (roundNum !== null && roundNum !== prevRoundRef.current) {
            setDealKey(k => k + 1);
        }
        prevRoundRef.current = roundNum;
    }, [state.round?.round]);

    const { round, scores, lastPoint, locked, playerHovers } = state;

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

    // Scale cards so 2 fit side-by-side on narrow screens
    const viewportW = useViewportWidth();
    const cardScale = useMemo(() => {
        const avail  = Math.max(viewportW - 40, 240);
        const needed = CARD_SIZE * 2 + 32;
        return Math.min(1, avail / needed);
    }, [viewportW]);

    const handleSymbolClick = useCallback((symIdx) => engine.guess(symIdx), [engine]);
    const handleSymbolHover = useCallback((symIdx, cardId) => engine.hover(symIdx, cardId), [engine]);

    const hoverHighlightsForCard = useCallback((cardId) => {
        return Object.entries(playerHovers)
            .filter(([id, h]) => h.cardId === cardId && id !== guestId)
            .map(([id, h]) => ({ color: playerColorMap[id] ?? '#888', symbolIdx: h.symbolIdx }));
    }, [playerHovers, playerColorMap, guestId]);

    if (!round) {
        return (
            <div style={styles.container}>
                <div style={styles.waiting}>Waiting for game to start…</div>
            </div>
        );
    }

    const isSpectator = config.role === 'spectator';
    const opponentIds = players.map(p => p.guestId).filter(id => id !== guestId);

    const sortedScores = Object.entries(scores)
        .map(([id, score]) => ({ id, score, name: getDisplayName(id) }))
        .sort((a, b) => b.score - a.score);

    const pointBannerText = lastPoint
        ? (lastPoint.guestId === guestId
            ? `🎉 You got it! ${round.symbols[lastPoint.symbolIdx]}`
            : `${lastPoint.displayName} got it! ${round.symbols[lastPoint.symbolIdx]}`)
        : null;

    // Animation 1: compute inline style for the player's own card wrapper
    const myCardWrapperStyle = (() => {
        if (cardAnim === 'out') {
            return {
                transform:  'scale(0.3)',
                opacity:    0,
                transition: `transform ${ANIM.standard.duration}ms cubic-bezier(0.4,0,1,1), opacity ${ANIM.standard.duration}ms ease-in`,
            };
        }
        if (cardAnim === 'in') {
            if (!cardInActive) {
                return {
                    transform:  'scale(0.5) translateY(-30px)',
                    opacity:    0,
                    transition: 'none',
                };
            }
            return {
                transform:  'scale(1) translateY(0)',
                opacity:    1,
                transition: `transform ${ANIM.dramatic.duration}ms cubic-bezier(0.34,1.56,0.64,1), opacity ${ANIM.settle.duration}ms ease-out`,
            };
        }
        return {};
    })();

    // Animation 2: shake + red glow on wrong tap
    const myCardShakeStyle = shaking
        ? { animation: `cardShake ${ANIM.settle.duration}ms ease-out` }
        : { animation: 'none' };

    const myCardInnerCircleStyle = shaking
        ? { boxShadow: '0 6px 20px rgba(0,0,0,0.15), inset 0 0 0 3px rgba(220,38,38,0.5)' }
        : undefined;

    // Animation 4: deal animation for each column
    const dealAnim = `cardDealIn ${ANIM.settle.duration}ms cubic-bezier(0.34,1.56,0.64,1)`;

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <span style={styles.roundLabel}>Round {round.round} / {round.totalRounds}</span>
                <div style={styles.scoreboard}>
                    {sortedScores.map(({ id, score, name }) => (
                        <span key={id} style={{
                            ...styles.scoreEntry,
                            fontWeight: id === guestId ? 700 : 400,
                            color: playerColorMap[id] ?? '#374151',
                            // Animation 3: score pop
                            animation: poppingScores.has(id)
                                ? `scorePop ${ANIM.dramatic.duration}ms cubic-bezier(0.34,1.56,0.64,1)`
                                : 'none',
                            display: 'inline-block',
                        }}>
                            {name}: {score}
                        </span>
                    ))}
                </div>
            </div>

            {pointBannerText && (
                <div style={styles.banner}>{pointBannerText}</div>
            )}

            <div style={styles.gameArea}>
                {isSpectator ? (
                    Object.entries(round.playerCards ?? {}).map(([id, card]) => (
                        // Animation 4: remount with key to retrigger deal
                        <div key={`${id}-${dealKey}`} style={{ ...styles.cardColumn, animation: dealAnim }}>
                            <div style={{ ...styles.cardLabel, color: playerColorMap[id] ?? '#6b7280' }}>
                                {getDisplayName(id)}
                            </div>
                            <Card
                                symbolIndices={card}
                                symbols={round.symbols}
                                layout={round.playerLayouts?.[id]}
                                cardId={id}
                                onSymbolHover={handleSymbolHover}
                                highlightIdx={lastPoint?.symbolIdx}
                                hoverHighlights={hoverHighlightsForCard(id)}
                                scale={cardScale}
                                disabled
                            />
                        </div>
                    ))
                ) : (
                    // Animation 1 + 2: player's own card column
                    // Animation 4: deal on round start
                    <div
                        key={`my-${dealKey}`}
                        style={{
                            ...styles.cardColumn,
                            animation: dealAnim,
                        }}
                    >
                        <div style={{ ...styles.cardLabel, color: playerColorMap[guestId] ?? '#6b7280' }}>
                            Your card
                        </div>
                        {/* Animation 1 wrapper: scale/fade on card replacement */}
                        <div style={myCardWrapperStyle}>
                            {/* Animation 2 wrapper: shake + red flash */}
                            <div style={myCardShakeStyle}>
                                <Card
                                    symbolIndices={round.myCard}
                                    symbols={round.symbols}
                                    layout={round.myLayout}
                                    cardId={guestId}
                                    onSymbolClick={handleSymbolClick}
                                    onSymbolHover={handleSymbolHover}
                                    highlightIdx={lastPoint?.symbolIdx}
                                    hoverHighlights={hoverHighlightsForCard(guestId)}
                                    scale={cardScale}
                                    disabled={locked}
                                    innerCircleStyle={myCardInnerCircleStyle}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Animation 4: center card column */}
                <div
                    key={`center-${dealKey}`}
                    style={{
                        ...styles.cardColumn,
                        animation: dealAnim,
                        animationDelay: '80ms',
                        // fill-mode so it doesn't flash visible before the delay
                        animationFillMode: 'both',
                    }}
                >
                    <div style={styles.cardLabel}>Center card</div>
                    <Card
                        symbolIndices={round.centerCard}
                        symbols={round.symbols}
                        layout={round.centerLayout}
                        cardId="center"
                        onSymbolHover={handleSymbolHover}
                        highlightIdx={lastPoint?.symbolIdx}
                        hoverHighlights={hoverHighlightsForCard('center')}
                        scale={cardScale}
                        disabled
                    />
                </div>

                {/* Animation 4: opponent card columns */}
                {!isSpectator && opponentIds.map(id => (
                    <div
                        key={`${id}-${dealKey}`}
                        style={{
                            ...styles.cardColumn,
                            animation: dealAnim,
                            animationDelay: '160ms',
                            animationFillMode: 'both',
                        }}
                    >
                        <div style={{ ...styles.cardLabel, color: playerColorMap[id] ?? '#6b7280' }}>
                            {getDisplayName(id)}'s card
                        </div>
                        <Card
                            symbolIndices={round.playerCards[id] ?? []}
                            symbols={round.symbols}
                            layout={round.playerLayouts?.[id]}
                            cardId={id}
                            onSymbolHover={handleSymbolHover}
                            highlightIdx={lastPoint?.symbolIdx}
                            hoverHighlights={hoverHighlightsForCard(id)}
                            scale={cardScale * 0.6}
                            disabled
                        />
                    </div>
                ))}
            </div>

            {!isSpectator && !locked && (
                <div style={styles.hint}>Tap the symbol that appears on both cards!</div>
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
    banner: {
        padding:      '8px 20px',
        background:   '#fef9c3',
        borderBottom: '1px solid #fde68a',
        fontSize:     16,
        fontWeight:   600,
        color:        '#92400e',
        textAlign:    'center',
        flexShrink:   0,
    },
    gameArea: {
        flex:           1,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            32,
        padding:        '16px 16px',
        overflow:       'auto',
        flexWrap:       'wrap',
    },
    cardColumn: {
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           10,
    },
    cardLabel: {
        fontSize:      12,
        fontWeight:    700,
        color:         '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
    },
    hint: {
        textAlign:  'center',
        fontSize:   13,
        color:      '#9ca3af',
        padding:    '8px 0 12px',
        flexShrink: 0,
    },
};

// ---------------------------------------------------------------------------
// SpottoGame — shell↔game contract. Glue between engine and React.
// ---------------------------------------------------------------------------
export default class SpottoGame extends SimpleEmitter {
    static roomConfig = {
        collapseChat: true,
    };
    static maxPlayers = 8;
    static whisperEvents = ['spotto.hover'];

    constructor(container, config) {
        super();
        this._engine = new SpottoEngine(config, (moveData) => this.emit('move', moveData));
        this._engine.on('complete', (result) => this.emit('complete', result));
        this._engine.on('whisper', (w) => this.emit('whisper', w));

        this._root = ReactDOM.createRoot(container);
        this._root.render(<SpottoApp engine={this._engine} config={config} />);
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
