import { Game as PhaserGame, Scene, AUTO, Scale, Math as PMath } from 'phaser';

const GRID_SIZE          = 32;
const MIN_ZOOM           = 0.1;
const MAX_ZOOM           = 5;
const CURSOR_THROTTLE_MS = 56;

function hexToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

// ── Scene factory ─────────────────────────────────────────────────────────────

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

            // Scale label — DOM overlay, immune to camera zoom drift
            this._scaleEl = Object.assign(document.createElement('div'), {
                textContent: '100%',
            });
            Object.assign(this._scaleEl.style, {
                position: 'absolute', bottom: '12px', right: '12px',
                font: '600 11px ui-sans-serif, system-ui, sans-serif',
                color: '#64748b', background: '#e2e8f0',
                padding: '3px 8px', borderRadius: '6px',
                pointerEvents: 'none', zIndex: '10',
            });
            domContainer.appendChild(this._scaleEl);

            // Cursor pool { guestId → { container, gfx, label } }
            this._cursors = {};

            this._setupInput(onCursorMove);

            this._onState = (state) => this._syncCursors(state.cursors);
            engine.on('stateChanged', this._onState);

            this.scale.on('resize', (sz) => this._grid.setSize(sz.width, sz.height), this);
        }

        update() {
            const cam = this.cameras.main;
            const z   = cam.zoom;

            // Align tile grid to world origin
            const ox = ((cam.scrollX % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
            const oy = ((cam.scrollY % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
            this._grid.setTileScale(z).setTilePosition(ox * z, oy * z);

            // Keep cursors a fixed screen size regardless of zoom
            const inv = 1 / z;
            for (const obj of Object.values(this._cursors)) {
                obj.container.setScale(inv);
            }

            this._scaleEl.textContent = Math.round(z * 100) + '%';
        }

        // ── Input ─────────────────────────────────────────────────────────────

        _setupInput(onCursorMove) {
            const ptrs = new Map();
            let pinch0  = null; // { dist, wx0, wy0, midX, midY, zoom }
            let drag    = null; // { wx, wy } — world point locked under finger
            let lastSent = 0;

            this.input.on('pointerdown', (p) => {
                const cam = this.cameras.main;
                ptrs.set(p.id, { x: p.x, y: p.y });

                if (ptrs.size === 2) {
                    // Begin pinch — capture world point at current midpoint
                    const [a, b] = ptrs.values();
                    const midX = (a.x + b.x) / 2;
                    const midY = (a.y + b.y) / 2;
                    pinch0 = {
                        dist: Math.hypot(a.x - b.x, a.y - b.y),
                        zoom: cam.zoom,
                        wx0:  cam.scrollX + midX / cam.zoom,
                        wy0:  cam.scrollY + midY / cam.zoom,
                        midX, midY,
                    };
                    drag = null;
                } else if (ptrs.size === 1) {
                    drag = {
                        startScrollX: cam.scrollX, startScrollY: cam.scrollY,
                        startX: p.x, startY: p.y,
                    };
                }
            });

            this.input.on('pointermove', (p) => {
                ptrs.set(p.id, { x: p.x, y: p.y });
                const cam = this.cameras.main;

                if (ptrs.size >= 2 && pinch0) {
                    const [a, b] = ptrs.values();
                    const dist = Math.hypot(a.x - b.x, a.y - b.y);
                    const midX = (a.x + b.x) / 2;
                    const midY = (a.y + b.y) / 2;
                    const newZ = PMath.Clamp(pinch0.zoom * (dist / pinch0.dist), MIN_ZOOM, MAX_ZOOM);
                    // Keep the initial midpoint world-position under the current midpoint
                    cam.zoom    = newZ;
                    cam.scrollX = pinch0.wx0 - midX / newZ;
                    cam.scrollY = pinch0.wy0 - midY / newZ;
                    return;
                }

                if (p.isDown && drag && ptrs.size < 2) {
                    cam.scrollX = drag.startScrollX - (p.x - drag.startX);
                    cam.scrollY = drag.startScrollY - (p.y - drag.startY);
                }

                const now = Date.now();
                if (now - lastSent >= CURSOR_THROTTLE_MS) {
                    lastSent = now;
                    const wp = cam.getWorldPoint(p.x, p.y);
                    onCursorMove(wp.x, wp.y);
                }
            });

            this.input.on('pointerup', (p) => {
                ptrs.delete(p.id);
                if (ptrs.size < 2) pinch0 = null;
                if (ptrs.size === 0) drag = null;
            });
            this.input.on('pointercancel', (p) => {
                ptrs.delete(p.id);
                if (ptrs.size < 2) pinch0 = null;
                if (ptrs.size === 0) drag = null;
            });

            this.input.on('wheel', (p, _o, _dx, dy) => {
                const cam    = this.cameras.main;
                const factor = Math.exp(-dy * (p.event?.ctrlKey ? 0.01 : 0.001));
                const newZ   = PMath.Clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
                const wx = cam.scrollX + p.x / cam.zoom;
                const wy = cam.scrollY + p.y / cam.zoom;
                cam.zoom    = newZ;
                cam.scrollX = wx - p.x / cam.zoom;
                cam.scrollY = wy - p.y / cam.zoom;
            });
        }

        // ── Cursor sync ───────────────────────────────────────────────────────

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
            this._scaleEl.remove();
        }
    };
}

// ── PhaserBoardView ───────────────────────────────────────────────────────────

export default class PhaserBoardView {
    constructor(container, engine, config) {
        container.style.position = 'relative'; // scale label needs this
        const Scene = makeBoardScene(engine, container, (bx, by) => engine.sendCursor(bx, by));

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
