// ---------------------------------------------------------------------------
// PackEngine — pure JS game engine. No React, no DOM.
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

export default class PackEngine extends SimpleEmitter {
    constructor(config, onMove) {
        super();
        this._config = config;
        this._onMove = onMove;

        this._timerInterval = null;
        this._timerFired    = false;

        this.state = {
            phase:         null,   // 'answering' | 'reveal' | 'ended' | null
            question:      null,
            round:         null,
            totalRounds:   null,
            timeRemaining: 0,
            timeLimit:     30,
            answeredCount: 0,
            totalCount:    0,
            result:        null,   // { answers, mostCommon, winners, scores } on reveal
            scores:        {},
            inputDisabled: false,
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
        if (name === 'pack.round_started') {
            this._clearTimer();
            this._timerFired = false;
            this._setState({
                phase:         'answering',
                question:      payload.question,
                round:         payload.round,
                totalRounds:   payload.totalRounds,
                timeLimit:     payload.timeLimit,
                timeRemaining: payload.timeLimit,
                answeredCount: 0,
                totalCount:    0,
                result:        null,
                inputDisabled: false,
            });
            this._startTimer(payload.timeLimit);
            return;
        }

        if (name === 'pack.answer_submitted') {
            this._setState({
                answeredCount: payload.answeredCount,
                totalCount:    payload.totalCount,
            });
            return;
        }

        if (name === 'pack.round_ended') {
            this._clearTimer();
            const scores = {};
            (payload.scores ?? []).forEach((s) => { scores[s.guestId] = s.score; });
            this._setState({
                phase:  'reveal',
                result: {
                    answers:    payload.answers,
                    mostCommon: payload.mostCommon,
                    winners:    payload.winners,
                    scores:     payload.scores,
                },
                scores,
            });
            return;
        }

        if (name === 'game.ended') {
            this._clearTimer();
            this._setState({ phase: 'ended' });
            this.emit('complete', { scores: payload.scores, winner: payload.winner });
            return;
        }
    }

    // -----------------------------------------------------------------------
    // User actions → server
    // -----------------------------------------------------------------------
    submitAnswer(text) {
        if (this.state.inputDisabled) return;
        const trimmed = (text ?? '').trim();
        if (!trimmed) return;
        this._setState({ inputDisabled: true });
        this._onMove({ type: 'pack.answer', answer: trimmed });
    }

    submitAdvance() {
        if (this.state.phase !== 'reveal') return;
        this._onMove({ type: 'pack.advance' });
    }

    // -----------------------------------------------------------------------
    // Timer
    // -----------------------------------------------------------------------
    _startTimer(seconds) {
        this._clearTimer();
        this._timerInterval = setInterval(() => {
            const next = this.state.timeRemaining - 1;
            if (next <= 0) {
                this._clearTimer();
                this._setState({ timeRemaining: 0 });
                if (!this._timerFired && !this.state.inputDisabled) {
                    this._timerFired = true;
                    this._onMove({ type: 'pack.timeout' });
                }
                return;
            }
            this._setState({ timeRemaining: next });
        }, 1000);
    }

    _clearTimer() {
        if (this._timerInterval !== null) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
    }

    // -----------------------------------------------------------------------
    // Teardown
    // -----------------------------------------------------------------------
    destroy() {
        this._clearTimer();
        this.removeAllListeners();
    }
}
