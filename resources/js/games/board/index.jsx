import { SimpleEmitter } from './engine.js';
import BoardEngine        from './engine.js';
import HtmlBoardView      from './view-html.js';

export default class BoardGame extends SimpleEmitter {
    static roomConfig    = {};
    static maxPlayers    = 40;
    static whisperEvents = ['board.cursor', 'board.object_drag'];

    /** @param {HTMLElement} container @param {import('./engine.js').GameConfig} config */
    constructor(container, config) {
        super();
        this._engine = new BoardEngine(config, (data) => this.emit('move', data));
        this._engine.on('whisper', (w) => this.emit('whisper', w));
        this._view   = new HtmlBoardView(container, this._engine, config);
    }

    receiveEvent(name, payload) {
        this._engine.receiveEvent(name, payload);
    }

    /** @param {number} ms — adaptive throttle derived from RTT + queue depth */
    setNetworkQuality(ms) {
        this._view.setThrottleMs(ms);
    }

    destroy() {
        this._view.destroy();
        this._engine.destroy();
        this.removeAllListeners();
    }
}
