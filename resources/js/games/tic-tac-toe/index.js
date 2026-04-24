import { Game as PhaserGame, Scene, AUTO, Scale } from 'phaser';
import { ANIM } from '../animation-tokens.js';

class SimpleEmitter {
    constructor() { this._listeners = {}; }
    on(event, fn) { (this._listeners[event] ??= []).push(fn); return this; }
    emit(event, ...args) { (this._listeners[event] ?? []).forEach((fn) => fn(...args)); }
    removeAllListeners() { this._listeners = {}; }
}

class TicTacToeScene extends Scene {
    constructor() {
        super({ key: 'TTT' });
    }

    init(data) {
        this.gc = data.config;
        this.emitter = data.emitter;
        this.board = Array(9).fill(null);
        this.gameOver = false;
        this.hoveredCell = -1;

        const { gameState, guestId } = this.gc;
        this.mySymbol = gameState.players.X === guestId ? 'X' : 'O';
        this.currentTurn = gameState.currentTurn;
        this.playersMap = gameState.players;
    }

    create() {
        this.cameras.main.setBackgroundColor('#f9fafb');

        // ── Create game objects (no positions yet) ───────────────────────────
        // Grid lines
        this.gridGfx = this.add.graphics();

        // Per-cell hover highlight rects
        this.hoverRects = Array.from({ length: 9 }, () => this.add.graphics().setVisible(false));

        // Placed symbol texts — null until a move lands
        this.symbolTexts = Array(9).fill(null);

        // Status text — origin centred, positioned by layout()
        this.statusText = this.add.text(0, 0, '', {
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            color: '#6b7280',
        }).setOrigin(0.5);

        // Track last status text to detect changes for the flip animation
        this._lastStatusText = '';

        // ── Initial layout + subscribe to future resizes ─────────────────────
        this.layout();
        this.scale.on('resize', this.layout, this);

        // ── Input ─────────────────────────────────────────────────────────────
        if (this.gc.role === 'player') {
            this.input.on('pointermove', this.onMove, this);
            this.input.on('pointerdown', this.onClick, this);
            this.input.on('gameout', this.onOut, this);
        }

        this.updateStatus();
    }

    // ── layout() ─────────────────────────────────────────────────────────────
    // All positions and sizes are derived from current canvas dimensions.
    // Called on create() and every time the canvas is resized.
    layout() {
        const W = this.scale.width;
        const H = this.scale.height;

        const gridSize = Math.min(W, H) * 0.62;
        const cell     = gridSize / 3;
        const ox       = (W - gridSize) / 2;
        const oy       = (H - gridSize) / 2 + H * 0.04; // nudge down slightly for status text above

        // Store for hit-testing
        this._cell = cell;
        this._ox   = ox;
        this._oy   = oy;

        // Grid lines
        this.gridGfx.clear();
        this.gridGfx.lineStyle(3, 0x374151, 1);
        for (let i = 1; i < 3; i++) {
            this.gridGfx.beginPath();
            this.gridGfx.moveTo(ox + i * cell, oy);
            this.gridGfx.lineTo(ox + i * cell, oy + gridSize);
            this.gridGfx.strokePath();

            this.gridGfx.beginPath();
            this.gridGfx.moveTo(ox, oy + i * cell);
            this.gridGfx.lineTo(ox + gridSize, oy + i * cell);
            this.gridGfx.strokePath();
        }

        // Hover rects
        for (let i = 0; i < 9; i++) {
            const col = i % 3;
            const row = Math.floor(i / 3);
            this.hoverRects[i].clear();
            this.hoverRects[i].fillStyle(0xe5e7eb, 1);
            this.hoverRects[i].fillRect(
                ox + col * cell + 2,
                oy + row * cell + 2,
                cell - 4,
                cell - 4,
            );
        }

        // Status text — sits above the grid, font scales with height
        const statusFontSize = Math.max(14, Math.round(H * 0.038));
        this.statusText.setPosition(W / 2, oy - statusFontSize * 1.6);
        this.statusText.setFontSize(statusFontSize);

        // Reposition any symbols already placed on the board
        for (let i = 0; i < 9; i++) {
            if (this.symbolTexts[i]) {
                const col  = i % 3;
                const row  = Math.floor(i / 3);
                const symX = ox + col * cell + cell / 2;
                const symY = oy + row  * cell + cell / 2;
                this.symbolTexts[i]
                    .setPosition(symX, symY)
                    .setFontSize(Math.floor(cell * 0.52));
            }
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    shutdown() {
        this.scale.off('resize', this.layout, this);
    }

    // ── Hit-testing ──────────────────────────────────────────────────────────
    cellAt(x, y) {
        const { _ox: ox, _oy: oy, _cell: cell } = this;
        const col = Math.floor((x - ox) / cell);
        const row = Math.floor((y - oy) / cell);
        if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
        return row * 3 + col;
    }

    // ── Input handlers ────────────────────────────────────────────────────────
    onMove(pointer) {
        if (this.gameOver || this.currentTurn !== this.gc.guestId) return;
        const idx = this.cellAt(pointer.x, pointer.y);
        if (idx === this.hoveredCell) return;
        if (this.hoveredCell >= 0) this.hoverRects[this.hoveredCell].setVisible(false);
        this.hoveredCell = idx;
        if (idx >= 0 && this.board[idx] === null) this.hoverRects[idx].setVisible(true);
    }

    onOut() {
        if (this.hoveredCell >= 0) {
            this.hoverRects[this.hoveredCell].setVisible(false);
            this.hoveredCell = -1;
        }
    }

    onClick(pointer) {
        if (this.gameOver || this.currentTurn !== this.gc.guestId) return;
        const idx = this.cellAt(pointer.x, pointer.y);
        if (idx < 0 || this.board[idx] !== null) return;

        this.emitter.emit('move', { type: 'ttt.move', gameId: this.gc.gameId, index: idx });

        // Animation 3: click ripple
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const cx  = this._ox + col * this._cell + this._cell / 2;
        const cy  = this._oy + row  * this._cell + this._cell / 2;
        const ripple = this.add.graphics();
        const maxRadius = this._cell * 0.75;
        this.tweens.add({
            targets: {},
            value: { from: 0, to: 1 },
            duration: 400,
            ease: 'Quad.easeOut',
            onUpdate: (tween) => {
                const t = tween.getValue();
                const radius = 5 + (maxRadius - 5) * t;
                const alpha  = 0.5 * (1 - t);
                ripple.clear();
                ripple.fillStyle(0x374151, alpha);
                ripple.fillCircle(cx, cy, radius);
            },
            onComplete: () => ripple.destroy(),
        });
    }

    // ── Server event ──────────────────────────────────────────────────────────
    handleServerEvent(eventName, payload) {
        if (eventName !== 'ttt.move_made') return;
        const { index, symbol, nextTurn, status, winner } = payload;

        this.board[index] = symbol;
        this.placeSymbol(index, symbol);

        if (this.hoveredCell === index) {
            this.hoverRects[index].setVisible(false);
            this.hoveredCell = -1;
        }

        // Animation 5: opponent move shake
        if (symbol !== this.mySymbol) {
            const origX = this.gridGfx.x;
            this.tweens.killTweensOf(this.gridGfx);
            this.tweens.add({
                targets: this.gridGfx,
                x: { from: origX - 3, to: origX + 3 },
                duration: 80,
                yoyo: true,
                repeat: 3,
                ease: 'Sine.easeInOut',
                onComplete: () => { this.gridGfx.x = origX; },
            });
        }

        if (status === 'finished') {
            this.gameOver = true;
            this.updateStatus(winner);

            // Animation 4: win/loss/draw banner bounce
            this.tweens.killTweensOf(this.statusText);
            const bannerY = this.statusText.y;
            this.statusText.setAlpha(0);
            this.tweens.add({
                targets: this.statusText,
                alpha: 1,
                y: bannerY - 15,
                scaleX: 1.2,
                scaleY: 1.2,
                duration: 500,
                ease: 'Bounce.easeOut',
            });

            // Confetti for draw
            if (winner === null) {
                const colors  = [0xdc2626, 0x2563eb];
                const boardCx = this._ox + (this._cell * 3) / 2;
                const boardCy = this._oy + (this._cell * 3) / 2;
                for (let i = 0; i < 8; i++) {
                    const piece = this.add.graphics();
                    const color = colors[i % 2];
                    const startX = boardCx + (Math.random() - 0.5) * this._cell * 3;
                    const startY = boardCy + (Math.random() - 0.5) * this._cell * 3;
                    piece.fillStyle(color, 1);
                    if (i % 2 === 0) {
                        piece.fillCircle(startX, startY, 5);
                    } else {
                        piece.fillRect(startX - 4, startY - 4, 8, 8);
                    }
                    this.tweens.add({
                        targets: piece,
                        y: startY - 60,
                        alpha: 0,
                        angle: (Math.random() - 0.5) * 180,
                        duration: 600,
                        ease: 'Quad.easeOut',
                        delay: i * 30,
                        onComplete: () => piece.destroy(),
                    });
                }
            }

            this.time.delayedCall(1800, () => {
                this.emitter.emit('complete', { scores: [], winner: winner ?? null });
            });
        } else {
            this.currentTurn = nextTurn;
            this.updateStatus();
        }
    }

    placeSymbol(index, symbol) {
        const col  = index % 3;
        const row  = Math.floor(index / 3);
        const x    = this._ox + col * this._cell + this._cell / 2;
        const y    = this._oy + row  * this._cell + this._cell / 2;

        // Animation 2: symbol pop-in with glow punch
        const fontSize = `${Math.floor(this._cell * 0.52)}px`;
        const color    = symbol === 'X' ? '#dc2626' : '#2563eb';
        const style    = {
            fontSize,
            color,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontStyle:  'bold',
        };

        // Glow layer: identical text behind, fades out while scaling up
        const glow = this.add.text(x, y, symbol, style).setOrigin(0.5).setAlpha(0.2).setScale(0);
        this.tweens.add({
            targets: glow,
            scale: 1.5,
            alpha: 0,
            duration: 400,
            ease: 'Quad.easeOut',
            onComplete: () => glow.destroy(),
        });

        // Main symbol: pops in from scale 0
        const text = this.add.text(x, y, symbol, style).setOrigin(0.5).setScale(0);
        this.tweens.add({
            targets: text,
            scale: 1,
            duration: 350,
            ease: 'Back.easeOut',
        });

        this.symbolTexts[index] = text;
    }

    updateStatus(winner) {
        const { guestId, role } = this.gc;
        let newText  = '';
        let newColor = '#6b7280';

        if (winner !== undefined) {
            if (winner === null) {
                newText  = "It's a draw!";
                newColor = '#374151';
            } else if (winner === guestId) {
                newText  = 'You win!';
                newColor = '#16a34a';
            } else {
                newText  = 'You lose.';
                newColor = '#dc2626';
            }
        } else if (role === 'spectator') {
            const sym = this.playersMap.X === this.currentTurn ? 'X' : 'O';
            newText  = `${sym}'s turn`;
            newColor = '#6b7280';
        } else {
            const isMyTurn = this.currentTurn === guestId;
            newText  = isMyTurn ? 'Your turn' : "Opponent's turn";
            newColor = '#6b7280';
        }

        // Animation 1: status banner flip — only when text actually changes
        if (newText === this._lastStatusText) return;
        this._lastStatusText = newText;

        const st = this.statusText;
        this.tweens.killTweensOf(st);

        // If there is no current text, just set without animation
        if (!st.text) {
            st.setColor(newColor).setText(newText);
            return;
        }

        // Fold out (scaleX → 0)
        this.tweens.add({
            targets: st,
            scaleX: 0,
            duration: 200,
            ease: 'Quad.easeIn',
            onComplete: () => {
                st.setColor(newColor).setText(newText);
                // Unfold with slight overshoot
                this.tweens.add({
                    targets: st,
                    scaleX: 1,
                    duration: 250,
                    ease: 'Back.easeOut',
                });
            },
        });
    }
}

export default class TicTacToeGame extends SimpleEmitter {
    static roomConfig = {};
    static maxPlayers = 2;

    constructor(container, config) {
        super();
        this._phaserGame = new PhaserGame({
            type:   AUTO,
            parent: container,
            // No width/height — canvas fills the parent div (which is w-full h-full)
            backgroundColor: '#f9fafb',
            scene:  [],
            scale: {
                mode: Scale.RESIZE,
            },
        });
        this._phaserGame.events.once('ready', () => {
            this._phaserGame.scene.add('TTT', TicTacToeScene, true, { config, emitter: this });
        });
    }

    receiveEvent(eventName, payload) {
        const scene = this._phaserGame.scene.getScene('TTT');
        scene?.handleServerEvent(eventName, payload);
    }

    destroy() {
        this._phaserGame.destroy(true);
        this.removeAllListeners();
    }
}
