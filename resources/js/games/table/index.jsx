import { SimpleEmitter } from '../board/engine.js';
import BoardEngine        from '../board/engine.js';
import HtmlBoardView      from '../board/view-html.js';

export default class TableGame extends SimpleEmitter {
    static roomConfig = { collapseChat: true };
    static maxPlayers = 40;

    /** @param {HTMLElement} container @param {import('../board/engine.js').GameConfig} config */
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
