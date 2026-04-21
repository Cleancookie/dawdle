import ReactDOM from 'react-dom/client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

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
// Card — circular card with emoji symbols
// ---------------------------------------------------------------------------
const CARD_SIZE = 260;
const CENTER    = CARD_SIZE / 2;

// Symbol sizes cycle through small→large to mimic real Dobble card variety
const SYM_SIZES    = [22, 28, 32, 36, 28, 24];
const SYM_FONT_PX  = [20, 24, 28, 30, 24, 22];

// Positions for 6 symbols: 1 near-centre + 5 on outer ring
const POSITIONS_6 = (() => {
    const inner = [{ r: 38, a: 0 }];
    const outer = Array.from({ length: 5 }, (_, i) => ({
        r: 88,
        a: (i / 5) * 2 * Math.PI - Math.PI / 2,
    }));
    return [...inner, ...outer];
})();

function Card({ symbolIndices, symbols, onSymbolClick, highlightIdx, disabled }) {
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
                const pos      = POSITIONS_6[i] ?? POSITIONS_6[0];
                const x        = CENTER + pos.r * Math.cos(pos.a);
                const y        = CENTER + pos.r * Math.sin(pos.a);
                const boxSize  = SYM_SIZES[i % SYM_SIZES.length];
                const fontSize = SYM_FONT_PX[i % SYM_FONT_PX.length];
                const isMatch  = symIdx === highlightIdx;

                return (
                    <div
                        key={symIdx}
                        onClick={() => !disabled && onSymbolClick(symIdx)}
                        style={{
                            position:    'absolute',
                            left:        x - boxSize / 2,
                            top:         y - boxSize / 2,
                            width:       boxSize,
                            height:      boxSize,
                            display:     'flex',
                            alignItems:  'center',
                            justifyContent: 'center',
                            fontSize,
                            cursor:      disabled ? 'default' : 'pointer',
                            borderRadius: '50%',
                            background:  isMatch ? 'rgba(250,204,21,0.6)' : 'transparent',
                            border:      isMatch ? '2px solid #ca8a04' : '2px solid transparent',
                            transition:  'background 0.15s, transform 0.1s',
                            transform:   'scale(1)',
                            userSelect:  'none',
                            lineHeight:  1,
                            zIndex:      1,
                        }}
                        onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.88)'; }}
                        onMouseUp={(e)   => { e.currentTarget.style.transform = 'scale(1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                        {symbols[symIdx]}
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// SpottoApp — main React component
// ---------------------------------------------------------------------------
function SpottoApp({ config, eventBus, emit }) {
    const { guestId, players } = config;
    const allParticipants = [...players, ...(config.spectators ?? [])];

    const getDisplayName = useCallback((id) => {
        const p = allParticipants.find((p) => p.guestId === id);
        return p ? p.displayName : id.slice(0, 8);
    }, [allParticipants]);

    const [round, setRound]         = useState(null);
    const [scores, setScores]       = useState({});
    const [lastPoint, setLastPoint] = useState(null); // { guestId, displayName, symbolIdx }
    const [locked, setLocked]       = useState(false);
    const lockTimer                 = useRef(null);

    useEffect(() => {
        const handler = (name, payload) => {
            if (name === 'spotto.round_started') {
                setRound({
                    round:       payload.round,
                    totalRounds: payload.totalRounds,
                    centerCard:  payload.centerCard,
                    myCard:      payload.playerCards[guestId] ?? [],
                    symbols:     payload.symbols,
                });
                setLastPoint(null);
                setLocked(false);
                if (lockTimer.current) clearTimeout(lockTimer.current);
            } else if (name === 'spotto.point_scored') {
                setLastPoint({ guestId: payload.guestId, displayName: payload.displayName, symbolIdx: payload.symbolIdx });
                setScores(Object.fromEntries(payload.scores.map((s) => [s.guestId, s.score])));
                setLocked(true);
            }
        };
        eventBus.on('event', handler);
        return () => eventBus.off('event', handler);
    }, [guestId, eventBus]);

    const handleSymbolClick = useCallback((symIdx) => {
        if (!round || locked) return;
        if (!round.centerCard.includes(symIdx) || !round.myCard.includes(symIdx)) return;
        setLocked(true);
        emit('move', { type: 'spotto.guess', symbolIdx: symIdx });
    }, [round, locked, emit]);

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
                        <span key={id} style={{ ...styles.scoreEntry, fontWeight: id === guestId ? 700 : 400 }}>
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
                <div style={styles.cardColumn}>
                    <div style={styles.cardLabel}>Center card</div>
                    <Card
                        symbolIndices={round.centerCard}
                        symbols={round.symbols}
                        onSymbolClick={handleSymbolClick}
                        highlightIdx={lastPoint?.symbolIdx}
                        disabled={isSpectator || locked}
                    />
                </div>

                <div style={styles.divider}>
                    <span style={styles.vs}>vs</span>
                </div>

                <div style={styles.cardColumn}>
                    <div style={styles.cardLabel}>{isSpectator ? 'Players\' cards' : 'Your card'}</div>
                    {isSpectator ? (
                        <div style={styles.spectatorCards}>
                            {Object.entries(round.myCard.length ? { [guestId]: round.myCard } : {}).concat(
                                Object.entries(round.playerCards ?? {})
                            ).slice(0, 4).map(([id, card]) => (
                                <div key={id} style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>
                                        {getDisplayName(id)}
                                    </div>
                                    <Card
                                        symbolIndices={card}
                                        symbols={round.symbols}
                                        onSymbolClick={() => {}}
                                        highlightIdx={lastPoint?.symbolIdx}
                                        disabled
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Card
                            symbolIndices={round.myCard}
                            symbols={round.symbols}
                            onSymbolClick={handleSymbolClick}
                            highlightIdx={lastPoint?.symbolIdx}
                            disabled={locked}
                        />
                    )}
                </div>
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
        color:    '#374151',
    },
    banner: {
        padding:    '8px 20px',
        background: '#fef9c3',
        borderBottom: '1px solid #fde68a',
        fontSize:   16,
        fontWeight: 600,
        color:      '#92400e',
        textAlign:  'center',
        flexShrink: 0,
    },
    gameArea: {
        flex:           1,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            24,
        padding:        '16px 20px',
        overflow:       'hidden',
        flexWrap:       'wrap',
    },
    cardColumn: {
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        gap:            12,
    },
    cardLabel: {
        fontSize:      13,
        fontWeight:    600,
        color:         '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
    },
    divider: {
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        width:          40,
    },
    vs: {
        fontSize:   18,
        fontWeight: 700,
        color:      '#d1d5db',
    },
    spectatorCards: {
        display:   'flex',
        gap:       16,
        flexWrap:  'wrap',
        justifyContent: 'center',
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
