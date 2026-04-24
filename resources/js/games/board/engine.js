const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

export class SimpleEmitter {
    constructor() { this._listeners = {}; }
    on(event, fn)  { (this._listeners[event] ??= []).push(fn); return this; }
    off(event, fn) {
        const list = this._listeners[event];
        if (list) this._listeners[event] = list.filter((f) => f !== fn);
    }
    emit(event, ...args) { (this._listeners[event] ?? []).forEach((fn) => fn(...args)); }
    removeAllListeners() { this._listeners = {}; }
}

export default class BoardEngine extends SimpleEmitter {
    constructor(config, onMove) {
        super();
        this._config  = config;
        this._onMove  = onMove;

        const colorMap = {};
        config.players.forEach((p, i) => {
            colorMap[p.guestId] = PLAYER_COLORS[i % PLAYER_COLORS.length];
        });
        this._colorMap = colorMap;

        this.state = { cursors: {} };
    }

    receiveEvent(name, payload) {
        if (name === 'game.player_joined') {
            payload.players.forEach((p, i) => {
                if (!this._colorMap[p.guestId]) {
                    this._colorMap[p.guestId] = PLAYER_COLORS[i % PLAYER_COLORS.length];
                }
            });
            return;
        }

        if (name === 'board.cursor_moved') {
            if (payload.guestId === this._config.guestId) return;
            this._setState({
                cursors: {
                    ...this.state.cursors,
                    [payload.guestId]: {
                        boardX: payload.x,
                        boardY: payload.y,
                        name:   payload.displayName,
                        color:  this._colorMap[payload.guestId] ?? '#6b7280',
                    },
                },
            });
        }
    }

    sendCursor(bx, by) { this._onMove({ type: 'board.cursor', x: bx, y: by }); }
    endSession()        { this._onMove({ type: 'board.end' }); }

    _setState(patch) {
        this.state = { ...this.state, ...patch };
        this.emit('stateChanged', this.state);
    }

    destroy() { this.removeAllListeners(); }
}
