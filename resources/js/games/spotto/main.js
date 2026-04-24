// ---------------------------------------------------------------------------
// SpottoEngine — pure JS game engine. No React, no DOM.
// React shell subscribes to 'stateChanged' and mirrors engine.state.
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

const HOVER_DEBOUNCE_MS = 60;
const POINT_LOCK_MS     = 3000;

export default class SpottoEngine extends SimpleEmitter {
    constructor(config, onMove) {
        super();
        this._config = config;
        this._onMove = onMove;

        this._lockTimer    = null;
        this._hoverTimer   = null;
        this._lastHoverKey = null;

        this.state = {
            round:        null,
            scores:       {},
            lastPoint:    null,
            locked:       false,
            playerHovers: {},     // { [guestId]: { cardId, symbolIdx } }
        };
    }

    _setState(patch) {
        this.state = { ...this.state, ...patch };
        this.emit('stateChanged', this.state);
    }

    // -----------------------------------------------------------------------
    // Server → engine
    // -----------------------------------------------------------------------
    receiveEvent(name, payload) {
        const { guestId } = this._config;

        if (name === 'spotto.round_started') {
            this._setState({
                round: {
                    round:         payload.round,
                    totalRounds:   payload.totalRounds,
                    centerCard:    payload.centerCard,
                    centerLayout:  payload.centerLayout ?? [],
                    myCard:        payload.playerCards[guestId] ?? [],
                    myLayout:      payload.playerLayouts?.[guestId] ?? [],
                    playerCards:   payload.playerCards,
                    playerLayouts: payload.playerLayouts ?? {},
                    symbols:       payload.symbols,
                },
                lastPoint:    null,
                locked:       false,
                playerHovers: {},
            });
            this._lastHoverKey = null;
            clearTimeout(this._lockTimer);
            return;
        }

        if (name === 'spotto.point_scored') {
            const scores = Object.fromEntries(payload.scores.map((s) => [s.guestId, s.score]));
            this._setState({
                lastPoint: {
                    guestId:     payload.guestId,
                    displayName: payload.displayName,
                    symbolIdx:   payload.symbolIdx,
                },
                scores,
                locked: true,
            });
            clearTimeout(this._lockTimer);
            this._lockTimer = setTimeout(() => this._setState({ locked: false }), POINT_LOCK_MS);
            return;
        }

        if (name === 'spotto.hover') {
            this._setState({
                playerHovers: {
                    ...this.state.playerHovers,
                    [payload.guestId]: { cardId: payload.cardId, symbolIdx: payload.symbolIdx },
                },
            });
            return;
        }

        if (name === 'game.ended') {
            this.emit('complete', { scores: payload.scores, winner: payload.winner });
            return;
        }
    }

    // -----------------------------------------------------------------------
    // User actions → server
    // -----------------------------------------------------------------------
    guess(symbolIdx) {
        const { round, locked } = this.state;
        if (!round || locked) return;
        if (!round.myCard.includes(symbolIdx)) return;
        if (!round.centerCard.includes(symbolIdx)) {
            this.emit('invalidGuess');
            return;
        }
        this._setState({ locked: true });
        this._onMove({ type: 'spotto.guess', symbolIdx });
    }

    hover(symbolIdx, cardId) {
        const key = symbolIdx !== null ? `${cardId}:${symbolIdx}` : null;
        if (key === this._lastHoverKey) return;
        this._lastHoverKey = key;
        clearTimeout(this._hoverTimer);
        if (symbolIdx !== null) {
            this._hoverTimer = setTimeout(() => {
                this._onMove({ type: 'spotto.hover', symbolIdx, cardId });
            }, HOVER_DEBOUNCE_MS);
        }
    }

    destroy() {
        clearTimeout(this._lockTimer);
        clearTimeout(this._hoverTimer);
        this.removeAllListeners();
    }
}
