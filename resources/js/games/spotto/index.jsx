import ReactDOM from 'react-dom/client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ---------------------------------------------------------------------------
// SimpleEmitter
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
// Constants
// ---------------------------------------------------------------------------
const CARD_SIZE = 250;
const CENTER    = CARD_SIZE / 2;

// One colour per player (index into playerOrder)
const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
function Card({
    symbolIndices,
    symbols,
    layout,           // [{x, y, size, rotation}, …] from server, relative to card centre
    onSymbolClick,
    onSymbolHover,    // (symIdx | null) → void
    highlightIdx,     // winning symbol index
    hoverHighlights,  // [{color, symbolIdx}, …] — other players currently hovering
    disabled,
}) {
    return (
        <div style={{ position: 'relative', width: CARD_SIZE, height: CARD_SIZE, flexShrink: 0 }}>
            {/* Card circle */}
            <div style={{
                position: 'absolute', inset: 0,
                borderRadius: '50%',
                border: '4px solid #1f2937',
                background: '#ffffff',
                boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
            }} />

            {symbolIndices.map((symIdx, i) => {
                const pos      = layout?.[i];
                const x        = CENTER + (pos?.x ?? 0);
                const y        = CENTER + (pos?.y ?? 0);
                const boxSize  = Math.min(Math.max(pos?.size ?? 28, 20), 42);
                const fontSize = Math.round(boxSize * 0.82);
                const rot      = pos?.rotation ?? 0;
                const isMatch  = symIdx === highlightIdx;

                // Collect any opponent hover highlights for this symbol
                const hoverers = (hoverHighlights ?? []).filter(h => h.symbolIdx === symIdx);
                const hoverColor = hoverers.length > 0 ? hoverers[0].color : null;

                return (
                    <div
                        key={symIdx}
                        onClick={() => !disabled && onSymbolClick?.(symIdx)}
                        onMouseEnter={() => !disabled && onSymbolHover?.(symIdx)}
                        onMouseLeave={() => !disabled && onSymbolHover?.(null)}
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
                            border:         hoverColor
                                ? `3px solid ${hoverColor}`
                                : isMatch
                                    ? '2px solid #ca8a04'
                                    : '2px solid transparent',
                            boxShadow:      hoverColor ? `0 0 10px ${hoverColor}88` : 'none',
                            transform:      `rotate(${rot}deg)`,
                            transition:     'background 0.12s, border-color 0.12s, box-shadow 0.12s',
                            userSelect:     'none',
                            lineHeight:     1,
                            zIndex:         1,
                        }}
                        onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = `rotate(${rot}deg) scale(0.88)`; }}
                        onMouseUp={e   => { e.currentTarget.style.transform = `rotate(${rot}deg) scale(1)`; }}
                    >
                        {symbols[symIdx]}
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// SpottoApp
// ---------------------------------------------------------------------------
function SpottoApp({ config, eventBus, emit }) {
    const { guestId, players } = config;
    const allParticipants = useMemo(
        () => [...players, ...(config.spectators ?? [])],
        [players, config.spectators],
    );

    const getDisplayName = useCallback(
        (id) => allParticipants.find((p) => p.guestId === id)?.displayName ?? id.slice(0, 8),
        [allParticipants],
    );

    // Map guestId → color by position in playerOrder
    const playerColorMap = useMemo(() => {
        const map = {};
        players.forEach((p, i) => { map[p.guestId] = PLAYER_COLORS[i % PLAYER_COLORS.length]; });
        return map;
    }, [players]);

    const [round, setRound]             = useState(null);
    const [scores, setScores]           = useState({});
    const [lastPoint, setLastPoint]     = useState(null);
    const [locked, setLocked]           = useState(false);
    const [playerHovers, setPlayerHovers] = useState({}); // { guestId: symbolIdx }

    const lockTimer    = useRef(null);
    const hoverTimer   = useRef(null);
    const lastHoverRef = useRef(null);

    useEffect(() => {
        const handler = (name, payload) => {
            if (name === 'spotto.round_started') {
                setRound({
                    round:         payload.round,
                    totalRounds:   payload.totalRounds,
                    centerCard:    payload.centerCard,
                    centerLayout:  payload.centerLayout ?? [],
                    myCard:        payload.playerCards[guestId] ?? [],
                    myLayout:      payload.playerLayouts?.[guestId] ?? [],
                    playerCards:   payload.playerCards,
                    playerLayouts: payload.playerLayouts ?? {},
                    symbols:       payload.symbols,
                });
                setLastPoint(null);
                setLocked(false);
                setPlayerHovers({});
                if (lockTimer.current) clearTimeout(lockTimer.current);
            } else if (name === 'spotto.point_scored') {
                setLastPoint({ guestId: payload.guestId, displayName: payload.displayName, symbolIdx: payload.symbolIdx });
                setScores(Object.fromEntries(payload.scores.map((s) => [s.guestId, s.score])));
                setLocked(true);
                clearTimeout(lockTimer.current);
                lockTimer.current = setTimeout(() => setLocked(false), 3000);
            } else if (name === 'spotto.hover') {
                setPlayerHovers(prev => ({ ...prev, [payload.guestId]: payload.symbolIdx }));
            } else if (name === 'game.ended') {
                emit('complete', { scores: payload.scores, winner: payload.winner });
            }
        };
        eventBus.on('event', handler);
        return () => eventBus.off('event', handler);
    }, [guestId, eventBus, emit]);

    const handleSymbolClick = useCallback((symIdx) => {
        if (!round || locked) return;
        if (!round.centerCard.includes(symIdx) || !round.myCard.includes(symIdx)) return;
        setLocked(true);
        emit('move', { type: 'spotto.guess', symbolIdx: symIdx });
    }, [round, locked, emit]);

    // Debounced hover broadcast — only to others via backend relay
    const handleSymbolHover = useCallback((symIdx) => {
        if (symIdx === lastHoverRef.current) return;
        lastHoverRef.current = symIdx;
        clearTimeout(hoverTimer.current);
        if (symIdx !== null) {
            hoverTimer.current = setTimeout(() => {
                emit('move', { type: 'spotto.hover', symbolIdx: symIdx });
            }, 60);
        }
    }, [emit]);

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    if (!round) {
        return (
            <div style={styles.container}>
                <div style={styles.waiting}>Waiting for game to start…</div>
            </div>
        );
    }

    const isSpectator  = config.role === 'spectator';
    const opponentIds  = players.map(p => p.guestId).filter(id => id !== guestId);

    const sortedScores = Object.entries(scores)
        .map(([id, score]) => ({ id, score, name: getDisplayName(id) }))
        .sort((a, b) => b.score - a.score);

    const pointBannerText = lastPoint
        ? (lastPoint.guestId === guestId
            ? `🎉 You got it! ${round.symbols[lastPoint.symbolIdx]}`
            : `${lastPoint.displayName} got it! ${round.symbols[lastPoint.symbolIdx]}`)
        : null;

    // Build hover highlight arrays for each card
    // Other players' hovers on MY card (broadcast to others; they'd see their own cursor naturally)
    const hoverHighlightsForCard = (cardOwnerId) => {
        // Show hovers from all players OTHER than the card's own player
        // (you don't need a coloured ring on your own card — your cursor is already there)
        return Object.entries(playerHovers)
            .filter(([id]) => id !== cardOwnerId)
            .map(([id, symIdx]) => ({ color: playerColorMap[id] ?? '#888', symbolIdx: symIdx }));
    };

    return (
        <div style={styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <span style={styles.roundLabel}>Round {round.round} / {round.totalRounds}</span>
                <div style={styles.scoreboard}>
                    {sortedScores.map(({ id, score, name }) => (
                        <span key={id} style={{
                            ...styles.scoreEntry,
                            fontWeight: id === guestId ? 700 : 400,
                            color: playerColorMap[id] ?? '#374151',
                        }}>
                            {name}: {score}
                        </span>
                    ))}
                </div>
            </div>

            {/* Point flash banner */}
            {pointBannerText && (
                <div style={styles.banner}>{pointBannerText}</div>
            )}

            {/* Cards */}
            <div style={styles.gameArea}>
                {/* Your card (or spectator view of all cards) */}
                {isSpectator ? (
                    <>
                        {Object.entries(round.playerCards ?? {}).map(([id, card]) => (
                            <div key={id} style={styles.cardColumn}>
                                <div style={{ ...styles.cardLabel, color: playerColorMap[id] ?? '#6b7280' }}>
                                    {getDisplayName(id)}
                                </div>
                                <Card
                                    symbolIndices={card}
                                    symbols={round.symbols}
                                    layout={round.playerLayouts?.[id]}
                                    highlightIdx={lastPoint?.symbolIdx}
                                    hoverHighlights={hoverHighlightsForCard(id)}
                                    disabled
                                />
                            </div>
                        ))}
                    </>
                ) : (
                    <div style={styles.cardColumn}>
                        <div style={{ ...styles.cardLabel, color: playerColorMap[guestId] ?? '#6b7280' }}>
                            Your card
                        </div>
                        <Card
                            symbolIndices={round.myCard}
                            symbols={round.symbols}
                            layout={round.myLayout}
                            onSymbolClick={handleSymbolClick}
                            onSymbolHover={handleSymbolHover}
                            highlightIdx={lastPoint?.symbolIdx}
                            hoverHighlights={hoverHighlightsForCard(guestId)}
                            disabled={locked}
                        />
                    </div>
                )}

                {/* Center card */}
                <div style={styles.cardColumn}>
                    <div style={styles.cardLabel}>Center card</div>
                    <Card
                        symbolIndices={round.centerCard}
                        symbols={round.symbols}
                        layout={round.centerLayout}
                        highlightIdx={lastPoint?.symbolIdx}
                        disabled
                    />
                </div>

                {/* Opponent cards */}
                {!isSpectator && opponentIds.map(id => (
                    <div key={id} style={styles.cardColumn}>
                        <div style={{ ...styles.cardLabel, color: playerColorMap[id] ?? '#6b7280' }}>
                            {getDisplayName(id)}'s card
                        </div>
                        <Card
                            symbolIndices={round.playerCards[id] ?? []}
                            symbols={round.symbols}
                            layout={round.playerLayouts?.[id]}
                            highlightIdx={lastPoint?.symbolIdx}
                            hoverHighlights={hoverHighlightsForCard(id)}
                            disabled
                        />
                    </div>
                ))}
            </div>

            {/* Hint */}
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
    },
    roundLabel: {
        fontSize:   16,
        fontWeight: 600,
        color:      '#374151',
    },
    scoreboard: {
        display: 'flex',
        gap:     16,
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
        padding:        '16px 24px',
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
// SpottoGame — shell↔game contract
// ---------------------------------------------------------------------------
export default class SpottoGame extends SimpleEmitter {
    constructor(container, config) {
        super();
        this._eventBus = new SimpleEmitter();
        this._root = ReactDOM.createRoot(container);
        this._root.render(
            <SpottoApp
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
