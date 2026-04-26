/** @import { GameConfig, CursorEntry } from './engine.js' */
/** @typedef {{ container: Phaser.GameObjects.Container, gfx: Phaser.GameObjects.Graphics, label: Phaser.GameObjects.Text }} CursorObj */

import { Game as PhaserGame, Scene, AUTO, Scale } from 'phaser';

const GRID_SIZE          = 32;
const CURSOR_THROTTLE_MS = 56;

function hexToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

// ── Scene factory ─────────────────────────────────────────────────────────────

/**
 * @param {import('./engine.js').default} engine
 * @param {HTMLElement} domContainer
 * @param {function(number, number, import('./engine.js').CameraState): void} onCursorMove
 */
function makeBoardScene(engine, domContainer, onCursorMove) {
    return class BoardScene extends Scene {
        constructor() { super('Board'); }

        create() {
            // Dot-grid texture (32×32, single centred dot)
            if (!this.textures.exists('dot-light')) {
                const tg = this.make.graphics({ add: false });
                tg.fillStyle(0xc4cedb, 1);
                tg.fillCircle(GRID_SIZE / 2, GRID_SIZE / 2, 1.5);
                tg.generateTexture('dot-light', GRID_SIZE, GRID_SIZE);
                tg.destroy();
            }

            // TileSprite grid — scrollFactor 0 keeps it in screen-space
            this._grid = this.add
                .tileSprite(0, 0, this.scale.width, this.scale.height, 'dot-light')
                .setOrigin(0, 0)
                .setScrollFactor(0)
                .setDepth(-1);

            /** @type {Record<string, CursorObj>} */
            this._cursors = {};

            this._setupInput(onCursorMove);

            this._onState = (state) => this._syncCursors(state.cursors);
            engine.on('stateChanged', this._onState);

            this.scale.on('resize', (sz) => this._grid.setSize(sz.width, sz.height), this);
        }

        update() {
            const cam = this.cameras.main;

            // Align tile grid to world origin as camera pans
            const ox = ((cam.scrollX % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
            const oy = ((cam.scrollY % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
            this._grid.setTilePosition(ox, oy);
        }

        // ── Input ─────────────────────────────────────────────────────────────

        _setupInput(onCursorMove) {
            let drag     = null;
            let lastSent = 0;

            this.input.on('pointerdown', (p) => {
                const cam = this.cameras.main;
                drag = { startScrollX: cam.scrollX, startScrollY: cam.scrollY, startX: p.x, startY: p.y };
            });

            this.input.on('pointermove', (p) => {
                const cam = this.cameras.main;

                if (p.isDown && drag) {
                    cam.scrollX = drag.startScrollX - (p.x - drag.startX);
                    cam.scrollY = drag.startScrollY - (p.y - drag.startY);
                }

                const now = Date.now();
                if (now - lastSent >= CURSOR_THROTTLE_MS) {
                    lastSent = now;
                    const wp = cam.getWorldPoint(p.x, p.y);
                    onCursorMove(wp.x, wp.y, {
                        x: cam.scrollX,
                        y: cam.scrollY,
                        w: cam.width,
                        h: cam.height,
                    });
                }
            });

            this.input.on('pointerup',     () => { drag = null; });
            this.input.on('pointercancel', () => { drag = null; });
        }

        // ── Cursor sync ───────────────────────────────────────────────────────

        /** @param {Record<string, CursorEntry>} cursors */
        _syncCursors(cursors) {
            for (const [id, obj] of Object.entries(this._cursors)) {
                if (!cursors[id]) { obj.container.destroy(); delete this._cursors[id]; }
            }
            for (const [id, c] of Object.entries(cursors)) {
                if (!this._cursors[id]) {
                    this._cursors[id] = this._spawnCursor(c);
                } else {
                    this._cursors[id].container.setPosition(c.boardX, c.boardY);
                }
            }
        }

        /** @param {CursorEntry} c @returns {CursorObj} */
        _spawnCursor(c) {
            const col = hexToInt(c.color);
            const gfx = this.add.graphics();
            gfx.lineStyle(1.2, 0xffffff, 1);
            gfx.fillStyle(col, 1);
            gfx.beginPath();
            gfx.moveTo(1, 1);
            gfx.lineTo(1, 15);
            gfx.lineTo(5, 10.5);
            gfx.lineTo(8, 17.5);
            gfx.lineTo(10, 16.5);
            gfx.lineTo(7, 9.5);
            gfx.lineTo(13, 9.5);
            gfx.closePath();
            gfx.fillPath();
            gfx.strokePath();

            const label = this.add.text(14, 0, c.name, {
                fontSize: '11px',
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                color: '#ffffff',
                backgroundColor: c.color,
                padding: { x: 4, y: 2 },
            });

            const container = this.add.container(c.boardX, c.boardY, [gfx, label]);
            return { container, gfx, label };
        }

        shutdown() {
            engine.off('stateChanged', this._onState);
        }
    };
}

// ── PhaserBoardView ───────────────────────────────────────────────────────────

export default class PhaserBoardView {
    constructor(container, engine, config) {
        container.style.position = 'relative'; // scale label needs this
        const Scene = makeBoardScene(engine, container, (bx, by, cam) => engine.sendCursor(bx, by, cam));

        this._game = new PhaserGame({
            type:            AUTO,
            parent:          container,
            backgroundColor: 0xf8fafc,
            scale: { mode: Scale.RESIZE, autoCenter: Scale.NO_CENTER },
            input:  { activePointers: 4 },
            scene:  Scene,
            banner: false,
        });
    }

    destroy() {
        this._game.destroy(true);
    }
}
