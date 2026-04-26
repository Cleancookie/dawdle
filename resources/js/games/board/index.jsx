import { SimpleEmitter } from './engine.js';
import BoardEngine        from './engine.js';
import HtmlBoardView      from './view-html.js';

export default class BoardGame extends SimpleEmitter {
    static roomConfig = {};
    static maxPlayers = 40;

    /** @param {HTMLElement} container @param {import('./engine.js').GameConfig} config */
    constructor(container, config) {
        super();
        this._engine = new BoardEngine(config, (data) => this.emit('move', data));
        this._view   = new HtmlBoardView(container, this._engine, config);
    }

    receiveEvent(name, payload) {
        this._engine.receiveEvent(name, payload);
    }

    destroy() {
        this._view.destroy();
        this._engine.destroy();
        this.removeAllListeners();
    }
}
