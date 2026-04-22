import { Game as PhaserGame, Scene, AUTO, Scale } from 'phaser';

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
        this.hoverRects = [];

        const { gameState, guestId } = this.gc;
        this.mySymbol = gameState.players.X === guestId ? 'X' : 'O';
        this.currentTurn = gameState.currentTurn;
        this.playersMap = gameState.players;
    }

    create() {
        const W = this.scale.width;
        const H = this.scale.height;
        const gridSize = Math.min(W, H) * 0.62;
        const cell = gridSize / 3;

        this.cell = cell;
        this.ox = (W - gridSize) / 2;
        this.oy = (H - gridSize) / 2 + 20;

        this.cameras.main.setBackgroundColor('#f9fafb');
        this.drawGrid();

        this.statusText = this.add.text(W / 2, this.oy - 36, '', {
            fontSize: '20px',
            color: '#6b7280',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }).setOrigin(0.5);

        this.updateStatus();

        if (this.gc.role === 'player') {
            this.input.on('pointermove', this.onMove, this);
            this.input.on('pointerdown', this.onClick, this);
            this.input.on('gameout', this.onOut, this);
        }
    }

    drawGrid() {
        const { ox, oy, cell } = this;
        const size = cell * 3;
        const gfx = this.add.graphics();
        gfx.lineStyle(3, 0x374151, 1);

        for (let i = 1; i < 3; i++) {
            gfx.beginPath();
            gfx.moveTo(ox + i * cell, oy);
            gfx.lineTo(ox + i * cell, oy + size);
            gfx.strokePath();

            gfx.beginPath();
            gfx.moveTo(ox, oy + i * cell);
            gfx.lineTo(ox + size, oy + i * cell);
            gfx.strokePath();
        }

        // hover highlight rectangles, hidden by default
        for (let i = 0; i < 9; i++) {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const r = this.add.graphics();
            r.fillStyle(0xe5e7eb, 1);
            r.fillRect(ox + col * cell + 2, oy + row * cell + 2, cell - 4, cell - 4);
            r.setVisible(false);
            this.hoverRects.push(r);
        }
    }

    cellAt(x, y) {
        const { ox, oy, cell } = this;
        const col = Math.floor((x - ox) / cell);
        const row = Math.floor((y - oy) / cell);
        if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
        return row * 3 + col;
    }

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
    }

    handleServerEvent(eventName, payload) {
        if (eventName !== 'ttt.move_made') return;
        const { index, symbol, nextTurn, status, winner } = payload;

        this.board[index] = symbol;
        this.drawSymbol(index, symbol);

        if (this.hoveredCell === index) {
            this.hoverRects[index].setVisible(false);
            this.hoveredCell = -1;
        }

        if (status === 'finished') {
            this.gameOver = true;
            this.updateStatus(winner);
            this.time.delayedCall(1800, () => {
                this.emitter.emit('complete', { scores: [], winner: winner ?? null });
            });
        } else {
            this.currentTurn = nextTurn;
            this.updateStatus();
        }
    }

    drawSymbol(index, symbol) {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const x = this.ox + col * this.cell + this.cell / 2;
        const y = this.oy + row * this.cell + this.cell / 2;
        this.add.text(x, y, symbol, {
            fontSize: `${Math.floor(this.cell * 0.52)}px`,
            color: symbol === 'X' ? '#dc2626' : '#2563eb',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontStyle: 'bold',
        }).setOrigin(0.5);
    }

    updateStatus(winner) {
        const { guestId, role } = this.gc;
        if (winner !== undefined) {
            if (winner === null) {
                this.statusText.setColor('#374151').setText("It's a draw!");
            } else if (winner === guestId) {
                this.statusText.setColor('#16a34a').setText('You win!');
            } else {
                this.statusText.setColor('#dc2626').setText('You lose.');
            }
        } else if (role === 'spectator') {
            const sym = this.playersMap.X === this.currentTurn ? 'X' : 'O';
            this.statusText.setColor('#6b7280').setText(`${sym}'s turn`);
        } else {
            const isMyTurn = this.currentTurn === guestId;
            this.statusText.setColor('#6b7280').setText(isMyTurn ? 'Your turn' : "Opponent's turn");
        }
    }
}

export default class TicTacToeGame extends SimpleEmitter {
    static roomConfig = {};   // use shell defaults

    constructor(container, config) {
        super();
        this._phaserGame = new PhaserGame({
            type: AUTO,
            parent: container,
            width: 600,
            height: 480,
            backgroundColor: '#f9fafb',
            scene: [],
            scale: {
                mode: Scale.FIT,
                autoCenter: Scale.CENTER_BOTH,
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
