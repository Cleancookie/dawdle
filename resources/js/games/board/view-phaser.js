/**
 * @import { CursorEntry, BoardObject, CameraState } from './engine.js'
 * @typedef {{ container: Phaser.GameObjects.Container, gfx: Phaser.GameObjects.Graphics, label: Phaser.GameObjects.Text, badge: Phaser.GameObjects.Text }} CursorObj
 * @typedef {{ container: Phaser.GameObjects.Container, dragging: boolean }} BoardObjRef
 * @typedef {{ id: string, card: Phaser.GameObjects.Container }} HandDrag
 */

import { Game as PhaserGame, Scene, AUTO, Scale } from 'phaser';

const GRID_SIZE      = 32;
const CURSOR_THROTTLE_MS = 56;

const CARD_W         = 64;
const CARD_H         = 88;
const HAND_PEEK      = 32;   // px visible above screen bottom in collapsed mode
const HAND_PAD       = 8;    // px padding inside the hand tray
const HAND_CARD_GAP  = 6;    // px gap between cards in expanded mode
const HAND_OVERLAP_X = 20;   // px x-step per card in collapsed mode (heavy overlap)
const HAND_ZONE_H    = 80;   // px from screen bottom — dropping here takes object to hand
const HAND_TWEEN_MS  = 180;
const HAND_BG_COLOR  = 0xf1f5f9;

function hexToInt(hex) { return parseInt(hex.replace('#', ''), 16); }

// ── Scene factory ─────────────────────────────────────────────────────────────

/**
 * @param {import('./engine.js').default} engine
 * @param {string} myGuestId
 * @param {HTMLElement} domContainer
 * @param {function(number, number, CameraState): void} onCursorMove
 */
function makeBoardScene(engine, myGuestId, domContainer, onCursorMove) {
    return class BoardScene extends Scene {
        constructor() { super('Board'); }

        create() {
            if (!this.textures.exists('dot-light')) {
                const tg = this.make.graphics({ add: false });
                tg.fillStyle(0xc4cedb, 1);
                tg.fillCircle(GRID_SIZE / 2, GRID_SIZE / 2, 1.5);
                tg.generateTexture('dot-light', GRID_SIZE, GRID_SIZE);
                tg.destroy();
            }

            this._grid = this.add
                .tileSprite(0, 0, this.scale.width, this.scale.height, 'dot-light')
                .setOrigin(0, 0).setScrollFactor(0).setDepth(-1);

            /** @type {Record<string, CursorObj>} */
            this._cursors = {};

            /** @type {Record<string, BoardObjRef>} */
            this._objects = {};

            /** @type {Record<string, Phaser.GameObjects.Container>} hand card pool */
            this._handCards = {};

            this._handExpanded = false;
            /** @type {HandDrag|null} */
            this._handDrag = null;
            this._anyDragging = false;

            this._createHandArea();
            this._setupBoardDragEvents();
            this._setupInput(onCursorMove);

            this._onState = (state) => {
                this._syncObjects(state.objects);
                this._syncHand(state.objects);
                this._syncCursors(state.cursors, state.objects);
            };
            engine.on('stateChanged', this._onState);

            this.scale.on('resize', (sz) => {
                this._grid.setSize(sz.width, sz.height);
                this._repositionHand();
            }, this);
        }

        update() {
            const cam = this.cameras.main;
            const ox = ((cam.scrollX % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
            const oy = ((cam.scrollY % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
            this._grid.setTilePosition(ox, oy);
        }

        // ── Hand area ─────────────────────────────────────────────────────────

        _createHandArea() {
            const sw = this.scale.width;
            const sh = this.scale.height;

            this._handContainer = this.add.container(0, sh - HAND_PEEK)
                .setScrollFactor(0)
                .setDepth(100);

            // Background tray — tap to toggle expand/collapse
            this._handBg = this.add.rectangle(0, 0, sw, CARD_H + HAND_PAD * 2, HAND_BG_COLOR, 0.96)
                .setOrigin(0, 0)
                .setInteractive();

            let tapStartY = null;
            this._handBg.on('pointerdown', (p) => { tapStartY = p.y; });
            this._handBg.on('pointerup',   (p) => {
                if (tapStartY !== null && Math.abs(p.y - tapStartY) < 8) this._toggleHand();
                tapStartY = null;
            });

            this._handContainer.add(this._handBg);
        }

        _repositionHand() {
            const sw = this.scale.width;
            const sh = this.scale.height;
            this._handBg.setSize(sw, CARD_H + HAND_PAD * 2);
            this._handContainer.setY(this._handExpanded ? sh - CARD_H - HAND_PAD * 2 : sh - HAND_PEEK);
        }

        _toggleHand() {
            this._handExpanded = !this._handExpanded;
            const sh = this.scale.height;
            const targetY = this._handExpanded ? sh - CARD_H - HAND_PAD * 2 : sh - HAND_PEEK;
            this.tweens.add({
                targets:  this._handContainer,
                y:        targetY,
                duration: HAND_TWEEN_MS,
                ease:     'Quad.easeOut',
                onComplete: () => this._layoutHandCards(),
            });
            this._layoutHandCards();
        }

        _layoutHandCards() {
            const cards = Object.values(this._handCards);
            const spacing = this._handExpanded ? CARD_W + HAND_CARD_GAP : HAND_OVERLAP_X;
            cards.forEach((card, i) => card.setPosition(HAND_PAD + i * spacing, HAND_PAD));
        }

        // ── Board objects (world space) ────────────────────────────────────────

        /** @param {Record<string, BoardObject>} objects */
        _syncObjects(objects) {
            for (const [id, ref] of Object.entries(this._objects)) {
                if (!objects[id] || objects[id].holderId !== null) {
                    ref.container.destroy();
                    delete this._objects[id];
                }
            }
            for (const [id, obj] of Object.entries(objects)) {
                if (obj.holderId !== null) continue;
                if (!this._objects[id]) {
                    this._objects[id] = this._spawnBoardObject(obj);
                } else if (!this._objects[id].dragging) {
                    this._objects[id].container.setPosition(obj.x, obj.y);
                }
            }
        }

        /** @param {BoardObject} obj @returns {BoardObjRef} */
        _spawnBoardObject(obj) {
            const rect = this.add.rectangle(0, 0, CARD_W, CARD_H, hexToInt(obj.color))
                .setStrokeStyle(1.5, 0xffffff, 0.4);
            const label = this.add.text(0, 0, obj.label, {
                fontSize: '14px', fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#ffffff',
            }).setOrigin(0.5, 0.5);

            const container = this.add.container(obj.x, obj.y, [rect, label])
                .setSize(CARD_W, CARD_H)
                .setInteractive({ draggable: true });
            this.input.setDraggable(container);

            return { container, dragging: false };
        }

        _setupBoardDragEvents() {
            this.input.on('dragstart', (_ptr, go) => {
                if (this._handDrag) return;
                const id = this._findObjId(go);
                if (id) { this._objects[id].dragging = true; this._anyDragging = true; }
            });

            this.input.on('drag', (_ptr, go, dragX, dragY) => {
                go.setPosition(dragX, dragY);
            });

            this.input.on('dragend', (ptr, go) => {
                const id = this._findObjId(go);
                if (!id) return;
                this._objects[id].dragging = false;
                this._anyDragging = false;

                if (ptr.y > this.scale.height - HAND_ZONE_H) {
                    engine.takeObject(id);
                } else {
                    engine.moveObject(id, go.x, go.y);
                }
            });
        }

        /** @param {Phaser.GameObjects.GameObject} go @returns {string|null} */
        _findObjId(go) {
            return Object.keys(this._objects).find((id) => this._objects[id].container === go) ?? null;
        }

        // ── Hand cards ────────────────────────────────────────────────────────

        /** @param {Record<string, BoardObject>} objects */
        _syncHand(objects) {
            const myCards = Object.values(objects).filter((o) => o.holderId === myGuestId);
            const myIds   = new Set(myCards.map((o) => o.id));

            for (const [id, card] of Object.entries(this._handCards)) {
                if (!myIds.has(id)) { card.destroy(); delete this._handCards[id]; }
            }
            for (const obj of myCards) {
                if (!this._handCards[obj.id]) {
                    const card = this._spawnHandCard(obj);
                    this._handContainer.add(card);
                    this._handCards[obj.id] = card;
                }
            }
            this._layoutHandCards();
        }

        /** @param {BoardObject} obj @returns {Phaser.GameObjects.Container} */
        _spawnHandCard(obj) {
            const rect = this.add.rectangle(0, 0, CARD_W, CARD_H, hexToInt(obj.color))
                .setStrokeStyle(1.5, 0xffffff, 0.4);
            const label = this.add.text(0, 0, obj.label, {
                fontSize: '14px', fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#ffffff',
            }).setOrigin(0.5, 0.5);

            const card = this.add.container(HAND_PAD, HAND_PAD, [rect, label])
                .setSize(CARD_W, CARD_H)
                .setInteractive();

            card.on('pointerdown', (ptr) => this._startHandDrag(obj.id, card, ptr));
            return card;
        }

        /** Detach card from tray and float it at pointer position for cross-space drag */
        _startHandDrag(objId, card, ptr) {
            delete this._handCards[objId];
            this._handContainer.remove(card, false);
            this.children.add(card);
            card.setScrollFactor(0).setDepth(500).setPosition(ptr.x, ptr.y);
            this._handDrag = { id: objId, card };
        }

        _endHandDrag(ptr) {
            const { id, card } = this._handDrag;
            this._handDrag = null;
            card.destroy();

            if (ptr.y < this.scale.height - HAND_ZONE_H) {
                const cam = this.cameras.main;
                engine.placeObject(id, cam.scrollX + ptr.x, cam.scrollY + ptr.y);
            } else {
                // Dropped back in hand zone — restore from current engine state
                this._syncHand(engine.state.objects);
            }
        }

        _cancelHandDrag() {
            const { card } = this._handDrag;
            this._handDrag = null;
            card.destroy();
            this._syncHand(engine.state.objects);
        }

        // ── Cursor sync ───────────────────────────────────────────────────────

        /**
         * @param {Record<string, CursorEntry>} cursors
         * @param {Record<string, BoardObject>} objects
         */
        _syncCursors(cursors, objects) {
            for (const [id, obj] of Object.entries(this._cursors)) {
                if (!cursors[id]) { obj.container.destroy(); delete this._cursors[id]; }
            }
            for (const [id, c] of Object.entries(cursors)) {
                const count = Object.values(objects).filter((o) => o.holderId === id).length;
                if (!this._cursors[id]) {
                    this._cursors[id] = this._spawnCursor(c, count);
                } else {
                    this._cursors[id].container.setPosition(c.boardX, c.boardY);
                    this._cursors[id].badge.setText(count > 0 ? String(count) : '');
                }
            }
        }

        /**
         * @param {CursorEntry} c
         * @param {number} handCount
         * @returns {CursorObj}
         */
        _spawnCursor(c, handCount) {
            const col = hexToInt(c.color);
            const gfx = this.add.graphics();
            gfx.lineStyle(1.2, 0xffffff, 1);
            gfx.fillStyle(col, 1);
            gfx.beginPath();
            gfx.moveTo(1, 1); gfx.lineTo(1, 15); gfx.lineTo(5, 10.5);
            gfx.lineTo(8, 17.5); gfx.lineTo(10, 16.5); gfx.lineTo(7, 9.5);
            gfx.lineTo(13, 9.5); gfx.closePath();
            gfx.fillPath(); gfx.strokePath();

            const label = this.add.text(14, 0, c.name, {
                fontSize: '11px', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                color: '#ffffff', backgroundColor: c.color, padding: { x: 4, y: 2 },
            });

            const badge = this.add.text(14, 16, handCount > 0 ? String(handCount) : '', {
                fontSize: '10px', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                color: '#ffffff', backgroundColor: c.color, padding: { x: 3, y: 1 },
            });

            const container = this.add.container(c.boardX, c.boardY, [gfx, label, badge]);
            return { container, gfx, label, badge };
        }

        // ── Input (pan + hand drag relay) ─────────────────────────────────────

        _setupInput(onCursorMove) {
            let drag     = null;
            let lastSent = 0;

            this.input.on('pointerdown', (p) => {
                // Don't start pan if pointer is in the hand zone
                if (p.y > this.scale.height - HAND_ZONE_H) return;
                const cam = this.cameras.main;
                drag = { startScrollX: cam.scrollX, startScrollY: cam.scrollY, startX: p.x, startY: p.y };
            });

            this.input.on('pointermove', (p) => {
                if (this._handDrag) {
                    this._handDrag.card.setPosition(p.x, p.y);
                    return;
                }

                const cam = this.cameras.main;
                if (p.isDown && drag && !this._anyDragging) {
                    cam.scrollX = drag.startScrollX - (p.x - drag.startX);
                    cam.scrollY = drag.startScrollY - (p.y - drag.startY);
                }

                const now = Date.now();
                if (now - lastSent >= CURSOR_THROTTLE_MS) {
                    lastSent = now;
                    const wp = cam.getWorldPoint(p.x, p.y);
                    onCursorMove(wp.x, wp.y, { x: cam.scrollX, y: cam.scrollY, w: cam.width, h: cam.height });
                }
            });

            this.input.on('pointerup', (p) => {
                if (this._handDrag) this._endHandDrag(p);
                drag = null;
            });

            this.input.on('pointercancel', () => {
                if (this._handDrag) this._cancelHandDrag();
                drag = null;
            });
        }

        shutdown() {
            engine.off('stateChanged', this._onState);
        }
    };
}

// ── PhaserBoardView ───────────────────────────────────────────────────────────

export default class PhaserBoardView {
    /** @param {HTMLElement} container @param {import('./engine.js').default} engine @param {import('./engine.js').GameConfig} config */
    constructor(container, engine, config) {
        container.style.position = 'relative';
        const Scene = makeBoardScene(
            engine,
            config.guestId,
            container,
            (bx, by, cam) => engine.sendCursor(bx, by, cam),
        );

        this._game = new PhaserGame({
            type:            AUTO,
            parent:          container,
            backgroundColor: 0xf8fafc,
            scale:           { mode: Scale.RESIZE, autoCenter: Scale.NO_CENTER },
            input:           { activePointers: 4 },
            scene:           Scene,
            banner:          false,
        });
    }

    destroy() { this._game.destroy(true); }
}
