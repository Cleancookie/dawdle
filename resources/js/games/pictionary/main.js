// ---------------------------------------------------------------------------
// PictionaryEngine — logical state + timer + server-event routing.
// Canvas rendering lives in the React shell (ref-bound), driven by engine
// events (`canvasClear`, `commitStroke`, `remoteStrokeDelta`).
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

const STROKE_EMIT_THROTTLE_MS = 50;
const OVERLAY_HOLD_MS         = 3000;
const ROUND_OVER_HOLD_MS      = 3000;

export default class PictionaryEngine extends SimpleEmitter {
    constructor(config, onMove) {
        super();
        this._config = config;
        this._onMove = onMove;

        this._timerInterval    = null;
        this._overlayTimeout   = null;
        this._roundOverTimeout = null;

        this._strokeId    = null;
        this._lastSentIdx = 0;
        this._lastEmitMs  = 0;

        this.state = {
            round:         null,
            roundOver:     null,
            overlay:       null,
            inputDisabled: false,
            timeRemaining: 0,
        };
    }

    _setState(patch) {
        this.state = { ...this.state, ...patch };
        this.emit('stateChanged', this.state);
    }

    isDrawer() {
        return this.state.round?.drawerGuestId === this._config.guestId;
    }

    // -----------------------------------------------------------------------
    // Server → engine
    // -----------------------------------------------------------------------
    receiveEvent(name, payload) {
        if (name === 'pict.round_started') {
            this._clearTimers();
            this._setState({
                round: {
                    round:         payload.round,
                    totalRounds:   payload.totalRounds,
                    drawerGuestId: payload.drawerGuestId,
                    word:          null,
                    timeLimit:     payload.timeLimit,
                },
                roundOver:     null,
                overlay:       null,
                inputDisabled: false,
                timeRemaining: payload.timeLimit,
            });
            this._startTimer(payload.timeLimit);
            this.emit('canvasClear');
            if (this._config.guestId === payload.drawerGuestId) this._fetchWord();
            return;
        }

        if (name === 'pict.stroke') {
            this.emit('commitStroke', {
                points: payload.points.map((p) => [p.x, p.y]),
                color:  payload.isEraser ? '#ffffff' : payload.color,
                width:  payload.width,
            });
            return;
        }

        if (name === 'pict.stroke_delta') {
            this.emit('remoteStrokeDelta', {
                strokeId: payload.strokeId,
                points:   payload.points.map((p) => [p.x, p.y]),
                color:    payload.isEraser ? '#ffffff' : payload.color,
                width:    payload.width,
                final:    payload.final,
            });
            return;
        }

        if (name === 'pict.canvas_clear') {
            this.emit('canvasClear');
            return;
        }

        if (name === 'pict.guess_correct') {
            if (payload.guestId === this._config.guestId) {
                this._setState({ inputDisabled: true, overlay: 'You got it!' });
                this.emit('guessSuccess');
            } else {
                this._setState({ overlay: `${payload.displayName} guessed it!` });
                clearTimeout(this._overlayTimeout);
                this._overlayTimeout = setTimeout(
                    () => this._setState({ overlay: null }),
                    OVERLAY_HOLD_MS,
                );
            }
            return;
        }

        if (name === 'pict.round_ended') {
            this._clearTimers();
            this._setState({ roundOver: { word: payload.word, scores: payload.scores } });
            clearTimeout(this._roundOverTimeout);
            this._roundOverTimeout = setTimeout(() => {
                this._setState({ roundOver: null });
                this.emit('canvasClear');
            }, ROUND_OVER_HOLD_MS);
            return;
        }

        if (name === 'game.ended') {
            this.emit('complete', { scores: payload.scores, winner: payload.winner });
            return;
        }
    }

    // -----------------------------------------------------------------------
    // Drawer actions → server (stroke lifecycle)
    // -----------------------------------------------------------------------
    startStroke() {
        if (!this.isDrawer() || !this.state.round) return null;
        this._strokeId    = crypto.randomUUID();
        this._lastSentIdx = 0;
        this._lastEmitMs  = 0;
        return this._strokeId;
    }

    // Shell passes the current full points buffer + brush settings on each
    // pointermove; engine throttles outbound deltas to the wire.
    maybeSendStrokeDelta(pts, { color, width, isEraser }) {
        if (!this._strokeId) return;
        const now = Date.now();
        if (now - this._lastEmitMs <= STROKE_EMIT_THROTTLE_MS) return;
        const newPts = pts.slice(this._lastSentIdx);
        if (newPts.length === 0) return;
        this._lastSentIdx = pts.length;
        this._lastEmitMs  = now;
        this._onMove({
            type:     'pict.stroke_delta',
            strokeId: this._strokeId,
            points:   newPts.map(([x, y]) => ({ x, y })),
            color:    isEraser ? '#ffffff' : color,
            width,
            isEraser,
            final:    false,
        });
    }

    endStroke(pts, { color, width, isEraser }) {
        if (!this._strokeId) return;
        const remaining = pts.slice(this._lastSentIdx);
        this._onMove({
            type:     'pict.stroke_delta',
            strokeId: this._strokeId,
            points:   remaining.map(([x, y]) => ({ x, y })),
            color:    isEraser ? '#ffffff' : color,
            width,
            isEraser,
            final:    true,
        });
        this._strokeId = null;
    }

    clearBoard() {
        if (!this.isDrawer()) return;
        this.emit('canvasClear');
        this._onMove({ type: 'pict.canvas_clear' });
    }

    // -----------------------------------------------------------------------
    // Guesser action → server
    // -----------------------------------------------------------------------
    submitGuess(text) {
        const trimmed = text.trim();
        if (!trimmed || this.state.inputDisabled) return false;
        this._onMove({ type: 'pict.guess', guess: trimmed });
        return true;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------
    _fetchWord() {
        const { gameId, guestId } = this._config;
        fetch(`/api/v1/games/${gameId}/word`, {
            headers: { 'X-Guest-ID': guestId, 'Accept': 'application/json' },
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data?.word && this.state.round) {
                    this._setState({ round: { ...this.state.round, word: data.word } });
                }
            })
            .catch(() => {});
    }

    _startTimer(seconds) {
        clearInterval(this._timerInterval);
        this._setState({ timeRemaining: seconds });
        this._timerInterval = setInterval(() => {
            const next = this.state.timeRemaining - 1;
            if (next <= 0) {
                clearInterval(this._timerInterval);
                this._timerInterval = null;
                this._setState({ timeRemaining: 0 });
                if (this.isDrawer()) this._onMove({ type: 'pict.timeout' });
            } else {
                this._setState({ timeRemaining: next });
            }
        }, 1000);
    }

    _clearTimers() {
        clearInterval(this._timerInterval);
        clearTimeout(this._overlayTimeout);
        clearTimeout(this._roundOverTimeout);
        this._timerInterval    = null;
        this._overlayTimeout   = null;
        this._roundOverTimeout = null;
    }

    destroy() {
        this._clearTimers();
        this.removeAllListeners();
    }
}
