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
 * @typedef {{ cursors: Record<string, CursorEntry>, objects: Record<string, BoardObject>, grabbed: Record<string, string>, dragging: Record<string, {x:number,y:number}> }} BoardState
 * @typedef {{ type: 'board.cursor',          x: number, y: number, camX: number, camY: number, camW: number, camH: number }
 *         | { type: 'board.object_grab',     id: string }
 *         | { type: 'board.object_drag',     id: string, x: number, y: number }
 *         | { type: 'board.object_move',     id: string, x: number, y: number }
 *         | { type: 'board.object_take',     id: string }
 *         | { type: 'board.object_place',    id: string, x: number, y: number }
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
        this._config  = config;
        this._onMove  = onMove;
        this._myName  = config.players.find((p) => p.guestId === config.guestId)?.displayName ?? '';

        /** @type {Record<string, string>} guestId → hex color */
        const colorMap = {};
        config.players.forEach((p, i) => {
            colorMap[p.guestId] = PLAYER_COLORS[i % PLAYER_COLORS.length];
        });
        this._colorMap = colorMap;

        /** @type {BoardState} */
        this.state = { cursors: {}, objects: {}, grabbed: {}, dragging: {} };

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
            // Re-fetch state when we ourselves join mid-game (spectator → player)
            if (payload.guestId === this._config.guestId) this._fetchInitialObjects();
            return;
        }

        if (name === 'board.object_grabbed') {
            this._setState({ grabbed: { ...this.state.grabbed, [payload.objectId]: payload.guestId } });
            return;
        }

        // Received via WebSocket whisper from the dragging client
        if (name === 'board.object_drag') {
            this._setState({
                grabbed:  { ...this.state.grabbed,  [payload.objectId]: payload.guestId },
                dragging: { ...this.state.dragging, [payload.objectId]: { x: payload.x, y: payload.y } },
            });
            return;
        }

        // Received via WebSocket whisper from the moving client
        if (name === 'board.cursor') {
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
            // Clear grab/drag locks for any objects that just settled
            const newGrabbed  = { ...this.state.grabbed };
            const newDragging = { ...this.state.dragging };
            for (const obj of payload.objects) {
                delete newGrabbed[obj.id];
                delete newDragging[obj.id];
            }
            this._setState({ objects: { ...this.state.objects, ...patch }, grabbed: newGrabbed, dragging: newDragging });
        }
    }

    /** @param {string} id — one-shot broadcast marking this object as grabbed */
    grabObject(id) { this._onMove({ type: 'board.object_grab', id }); }

    /** @param {string} id @param {number} x @param {number} y — throttled live position during drag */
    sendObjectDrag(id, x, y) {
        this.emit('whisper', {
            event:   'board.object_drag',
            payload: { guestId: this._config.guestId, objectId: id, x, y },
        });
    }

    /** @param {number} bx @param {number} by @param {CameraState} cam */
    sendCursor(bx, by, cam) {
        this.emit('whisper', {
            event:   'board.cursor',
            payload: { guestId: this._config.guestId, displayName: this._myName, x: bx, y: by, camX: cam.x, camY: cam.y, camW: cam.w, camH: cam.h },
        });
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
