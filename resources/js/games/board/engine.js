/**
 * @typedef {{ guestId: string, displayName: string, isMe: boolean }} Player
 * @typedef {{ guestId: string, displayName: string }} Spectator
 * @typedef {{
 *   roomId:     string,
 *   gameId:     string,
 *   guestId:    string,
 *   players:    Player[],
 *   spectators: Spectator[],
 *   role:       'player' | 'spectator',
 *   isHost:     boolean,
 *   maxPlayers: number,
 *   gameType:   string,
 *   gameState:  object,
 * }} GameConfig
 *
 * @typedef {{ x: number, y: number, w: number, h: number }} CameraState  scroll position (world) + viewport pixel dimensions
 * @typedef {{ boardX: number, boardY: number, name: string, color: string, cam: CameraState }} CursorEntry
 * @typedef {{ id: string, type: string, label: string, color: string, x: number, y: number, holderId: string|null }} BoardObject
 * @typedef {{ cursors: Record<string, CursorEntry>, objects: Record<string, BoardObject> }} BoardState
 * @typedef {{ type: 'board.cursor',       x: number, y: number, camX: number, camY: number, camW: number, camH: number }
 *         | { type: 'board.object_move',  id: string, x: number, y: number }
 *         | { type: 'board.object_take',  id: string }
 *         | { type: 'board.object_place', id: string, x: number, y: number }
 *         | { type: 'board.end' }} BoardMove
 */

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
    /** @param {GameConfig} config @param {function(BoardMove): void} onMove */
    constructor(config, onMove) {
        super();
        this._config = config;
        this._onMove = onMove;

        /** @type {Record<string, string>} guestId → hex color */
        const colorMap = {};
        config.players.forEach((p, i) => {
            colorMap[p.guestId] = PLAYER_COLORS[i % PLAYER_COLORS.length];
        });
        this._colorMap = colorMap;

        /** @type {BoardState} */
        this.state = { cursors: {}, objects: {} };

        this._fetchInitialObjects();
    }

    /** @param {string} name @param {object} payload */
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
                        cam:    { x: payload.camX, y: payload.camY, w: payload.camW, h: payload.camH },
                    },
                },
            });
            return;
        }

        if (name === 'board.objects_changed') {
            const patch = {};
            for (const obj of payload.objects) patch[obj.id] = obj;
            this._setState({ objects: { ...this.state.objects, ...patch } });
        }
    }

    /** @param {number} bx @param {number} by @param {CameraState} cam */
    sendCursor(bx, by, cam) {
        this._onMove({ type: 'board.cursor', x: bx, y: by, camX: cam.x, camY: cam.y, camW: cam.w, camH: cam.h });
    }

    /** @param {string} id @param {number} x @param {number} y */
    moveObject(id, x, y) {
        this._optimisticObject(id, { x, y, holderId: null });
        this._onMove({ type: 'board.object_move', id, x, y });
    }

    /** @param {string} id */
    takeObject(id) {
        this._optimisticObject(id, { holderId: this._config.guestId });
        this._onMove({ type: 'board.object_take', id });
    }

    /** @param {string} id @param {number} x @param {number} y */
    placeObject(id, x, y) {
        this._optimisticObject(id, { x, y, holderId: null });
        this._onMove({ type: 'board.object_place', id, x, y });
    }

    endSession() { this._onMove({ type: 'board.end' }); }

    /** @param {string} id @param {Partial<BoardObject>} patch */
    _optimisticObject(id, patch) {
        if (!this.state.objects[id]) return;
        this._setState({ objects: { ...this.state.objects, [id]: { ...this.state.objects[id], ...patch } } });
    }

    /** @param {Partial<BoardState>} patch */
    _setState(patch) {
        this.state = { ...this.state, ...patch };
        this.emit('stateChanged', this.state);
    }

    _fetchInitialObjects() {
        const { gameId, guestId } = this._config;
        fetch(`/api/v1/games/${gameId}/state`, {
            headers: { 'X-Guest-ID': guestId, Accept: 'application/json' },
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data?.objects) this._setState({ objects: data.objects });
            })
            .catch(() => {});
    }

    destroy() { this.removeAllListeners(); }
}
