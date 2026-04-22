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

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
function Card({
    symbolIndices,
    symbols,
    layout,
    cardId,           // 'center' or guestId — used to scope hover
    onSymbolClick,
    onSymbolHover,    // (symIdx | null, cardId) → void  — always enabled
    highlightIdx,
    hoverHighlights,  // [{ color, symbolIdx }, …]
    disabled,         // click-only; hover always works
}) {
    return (
        <div style={{ position: 'relative', width: CARD_SIZE, height: CARD_SIZE, flexShrink: 0 }}>
            {/* Card circle */}
            <div style={{
                position:     'absolute',
                inset:        0,
                borderRadius: '50%',
                border:       '4px solid #1f2937',
                background:   '#ffffff',
                boxShadow:    '0 6px 20px rgba(0,0,0,0.15)',
            }} />

            {symbolIndices.map((symIdx, i) => {
                const pos      = layout?.[i];
                const x        = CENTER + (pos?.x ?? 0);
                const y        = CENTER + (pos?.y ?? 0);
                const boxSize  = Math.min(Math.max(pos?.size ?? 28, 20), 42);
                const fontSize = Math.round(boxSize * 0.82);
                const rot      = pos?.rotation ?? 0;
                const isMatch  = symIdx === highlightIdx;

                const hoverers = (hoverHighlights ?? []).filter(h => h.symbolIdx === symIdx);
                const firstColor = hoverers[0]?.color ?? null;

                return (
                    <React.Fragment key={symIdx}>
                        {/* Downward-pointing arrows above the symbol, one per hoverer */}
                        {hoverers.map(({ color }, hi) => (
                            <div
                                key={hi}
                                style={{
                                    position:     'absolute',
                                    left:         x - 6 + hi * 15,
                                    top:          y - boxSize / 2 - 20,
                                    width:        0,
                                    height:       0,
                                    borderLeft:   '6px solid transparent',
                                    borderRight:  '6px solid transparent',
                                    borderTop:    `11px solid ${color}`,
                                    pointerEvents: 'none',
                                    zIndex:       3,
                                }}
                            />
                        ))}

                        {/* Symbol — rotated, hover always active */}
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

    const playerColorMap = useMemo(() => {
        const map = {};
        players.forEach((p, i) => { map[p.guestId] = PLAYER_COLORS[i % PLAYER_COLORS.length]; });
        return map;
    }, [players]);

    const [round, setRound]               = useState(null);
    const [scores, setScores]             = useState({});
    const [lastPoint, setLastPoint]       = useState(null);
    const [locked, setLocked]             = useState(false);
    // { [guestId]: { cardId, symbolIdx } }
    const [playerHovers, setPlayerHovers] = useState({});

    const lockTimer    = useRef(null);
    const hoverTimer   = useRef(null);
    const lastHoverRef = useRef(null); // "cardId:symIdx"

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
                lastHoverRef.current = null;
                if (lockTimer.current) clearTimeout(lockTimer.current);
            } else if (name === 'spotto.point_scored') {
                setLastPoint({ guestId: payload.guestId, displayName: payload.displayName, symbolIdx: payload.symbolIdx });
                setScores(Object.fromEntries(payload.scores.map((s) => [s.guestId, s.score])));
                setLocked(true);
                clearTimeout(lockTimer.current);
                lockTimer.current = setTimeout(() => setLocked(false), 3000);
            } else if (name === 'spotto.hover') {
                setPlayerHovers(prev => ({
                    ...prev,
                    [payload.guestId]: { cardId: payload.cardId, symbolIdx: payload.symbolIdx },
                }));
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

    // Hover works on any card — broadcasts symbolIdx + which card
    const handleSymbolHover = useCallback((symIdx, cardId) => {
        const key = symIdx !== null ? `${cardId}:${symIdx}` : null;
        if (key === lastHoverRef.current) return;
        lastHoverRef.current = key;
        clearTimeout(hoverTimer.current);
        if (symIdx !== null) {
            hoverTimer.current = setTimeout(() => {
                emit('move', { type: 'spotto.hover', symbolIdx: symIdx, cardId });
            }, 60);
        }
    }, [emit]);

    // Returns hover highlights for a given card, from all other players hovering that card
    const hoverHighlightsForCard = useCallback((cardId) => {
        return Object.entries(playerHovers)
            .filter(([id, h]) => h.cardId === cardId && id !== guestId)
            .map(([id, h]) => ({ color: playerColorMap[id] ?? '#888', symbolIdx: h.symbolIdx }));
    }, [playerHovers, playerColorMap, guestId]);

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
                {isSpectator ? (
                    Object.entries(round.playerCards ?? {}).map(([id, card]) => (
                        <div key={id} style={styles.cardColumn}>
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
                                disabled
                            />
                        </div>
                    ))
                ) : (
                    <div style={styles.cardColumn}>
                        <div style={{ ...styles.cardLabel, color: playerColorMap[guestId] ?? '#6b7280' }}>
                            Your card
                        </div>
                        <Card
                            symbolIndices={round.myCard}
                            symbols={round.symbols}
                            layout={round.myLayout}
                            cardId={guestId}
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
                        cardId="center"
                        onSymbolHover={handleSymbolHover}
                        highlightIdx={lastPoint?.symbolIdx}
                        hoverHighlights={hoverHighlightsForCard('center')}
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
                            cardId={id}
                            onSymbolHover={handleSymbolHover}
                            highlightIdx={lastPoint?.symbolIdx}
                            hoverHighlights={hoverHighlightsForCard(id)}
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
