/**
 * @import { CursorEntry, BoardObject, CameraState } from './engine.js'
 */

const GRID_SIZE = 32;
const CARD_W             = 64;
const CARD_H             = 88;
const HAND_PEEK          = 32;
const HAND_PAD           = 8;
const HAND_CARD_GAP      = 6;
const HAND_OVERLAP_X     = 20;
const HAND_EXPAND_H      = CARD_H + HAND_PAD * 2;  // 104
const HAND_TWEEN_MS      = 180;
const HAND_HOVER_ZONE    = 60;

function css(el, s) { el.style.cssText = s; }

// ── HtmlBoardView ─────────────────────────────────────────────────────────────

export default class HtmlBoardView {
    /** @param {HTMLElement} container @param {import('./engine.js').default} engine @param {import('./engine.js').GameConfig} config */
    constructor(container, engine, config) {
        this._engine           = engine;
        this._myId             = config.guestId;
        this._scrollX          = 0;
        this._scrollY          = 0;
        this._expanded         = false;
        this._handCards        = {};   // id -> HTMLElement
        this._handOrder        = [];   // ordered card IDs
        this._boardObjs        = {};   // id -> { el, dragging }
        this._cursors          = {};   // guestId -> HTMLElement
        this._throttleMs       = 50;   // adaptive — updated by setThrottleMs()
        this._tweenMs          = 80;
        this._lastSent         = 0;
        this._lastObjDragSent  = 0;
        this._gesture          = null;
        this._pendingInsert    = null; // slot index for next arriving hand card

        this._build(container);
        this._setupInput(container);

        this._onState = (state) => this._render(state);
        engine.on('stateChanged', this._onState);
    }

    // ── DOM setup ─────────────────────────────────────────────────────────────

    _build(container) {
        css(container, 'position:relative;overflow:hidden;background:#f8fafc;touch-action:none;');
        this._container = container;

        this._gridEl = document.createElement('div');
        css(this._gridEl, `
            position:absolute;inset:0;pointer-events:none;z-index:0;
            background-image:radial-gradient(circle,#c4cedb 1.5px,transparent 1.5px);
            background-size:${GRID_SIZE}px ${GRID_SIZE}px;
        `);

        this._worldEl = document.createElement('div');
        css(this._worldEl, 'position:absolute;top:0;left:0;width:0;height:0;z-index:1;');

        this._cursorLayer = document.createElement('div');
        css(this._cursorLayer, 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10;');

        this._handEl = document.createElement('div');
        css(this._handEl, `
            position:absolute;bottom:0;left:0;right:0;overflow:hidden;z-index:20;
            background:rgba(241,245,249,0.97);
            height:${HAND_PEEK}px;
            transition:height ${HAND_TWEEN_MS}ms cubic-bezier(.25,0,0,1);
        `);

        this._handCardsEl = document.createElement('div');
        css(this._handCardsEl, `position:absolute;top:${HAND_PAD}px;left:0;right:0;height:${CARD_H}px;`);
        this._handEl.appendChild(this._handCardsEl);

        container.appendChild(this._gridEl);
        container.appendChild(this._worldEl);
        container.appendChild(this._cursorLayer);
        container.appendChild(this._handEl);

        this._applyScroll();
    }

    // ── Scroll / grid sync ────────────────────────────────────────────────────

    _applyScroll() {
        const ox = ((-this._scrollX % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
        const oy = ((-this._scrollY % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
        this._gridEl.style.backgroundPosition = `${ox}px ${oy}px`;
        this._worldEl.style.transform = `translate(${-this._scrollX}px,${-this._scrollY}px)`;
        this._repositionCursors();
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _render(state) {
        const grabbed  = state.grabbed  ?? {};
        const dragging = state.dragging ?? {};
        this._syncObjects(state.objects, grabbed, dragging);
        this._syncHand(state.objects);
        this._syncCursors(state.cursors, state.objects, dragging);
    }

    // ── Board objects (world space) ───────────────────────────────────────────

    /**
     * @param {Record<string, BoardObject>} objects
     * @param {Record<string, string>} grabbed      objId → grabber guestId
     * @param {Record<string, {x:number,y:number}>} dragging  objId → live world pos
     */
    _syncObjects(objects, grabbed, dragging) {
        // Remove objects that left the board and are not being live-dragged
        for (const [id, ref] of Object.entries(this._boardObjs)) {
            if (!objects[id] || (objects[id].holderId !== null && !dragging[id])) {
                ref.el.remove();
                delete this._boardObjs[id];
            }
        }
        for (const [id, obj] of Object.entries(objects)) {
            const dragPos = dragging[id];
            // Skip if in someone's hand and no live drag position
            if (obj.holderId !== null && !dragPos) continue;

            const dx = dragPos ? dragPos.x : obj.x;
            const dy = dragPos ? dragPos.y : obj.y;

            if (!this._boardObjs[id]) {
                this._boardObjs[id] = this._spawnBoardObj({ ...obj, x: dx, y: dy });
            } else if (!this._boardObjs[id].dragging) {
                this._boardObjs[id].el.style.left = `${dx}px`;
                this._boardObjs[id].el.style.top  = `${dy}px`;
            }

            const isGrabbed = !!grabbed[id] || !!dragPos;
            this._boardObjs[id].el.style.opacity = isGrabbed ? '0.4' : '1';
            this._boardObjs[id].el.style.cursor  = isGrabbed ? 'not-allowed' : 'grab';
        }
    }

    /** @param {BoardObject} obj */
    _spawnBoardObj(obj) {
        const e = document.createElement('div');
        css(e, `
            position:absolute;
            left:${obj.x}px;top:${obj.y}px;
            width:${CARD_W}px;height:${CARD_H}px;
            transform:translate(-50%,-50%);
            background:${obj.color};
            border-radius:6px;
            border:1.5px solid rgba(255,255,255,0.35);
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-size:14px;font-family:ui-sans-serif,system-ui,sans-serif;
            cursor:grab;touch-action:none;user-select:none;
            box-shadow:0 2px 8px rgba(0,0,0,0.18);
        `);
        e.textContent = obj.label;
        e.dataset.objId = obj.id;
        this._worldEl.appendChild(e);
        return { el: e, dragging: false };
    }

    // ── Hand cards ────────────────────────────────────────────────────────────

    /** @param {Record<string, BoardObject>} objects */
    _syncHand(objects) {
        const mine    = Object.values(objects).filter((o) => o.holderId === this._myId);
        const mineIds = new Set(mine.map((o) => o.id));

        for (const [id, e] of Object.entries(this._handCards)) {
            if (!mineIds.has(id)) {
                e.remove();
                delete this._handCards[id];
                this._handOrder = this._handOrder.filter((x) => x !== id);
            }
        }
        for (const obj of mine) {
            if (!this._handCards[obj.id]) {
                const e = this._spawnHandCard(obj);
                this._handCardsEl.appendChild(e);
                this._handCards[obj.id] = e;
                if (this._pendingInsert !== null) {
                    this._handOrder.splice(this._pendingInsert, 0, obj.id);
                    this._pendingInsert = null;
                } else {
                    this._handOrder.push(obj.id);
                }
            }
        }
        this._layoutHand();
    }

    /** @param {BoardObject} obj @returns {HTMLElement} */
    _spawnHandCard(obj) {
        const e = document.createElement('div');
        css(e, `
            position:absolute;top:0;
            width:${CARD_W}px;height:${CARD_H}px;
            background:${obj.color};
            border-radius:6px;
            border:1.5px solid rgba(255,255,255,0.35);
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-size:14px;font-family:ui-sans-serif,system-ui,sans-serif;
            cursor:grab;touch-action:none;user-select:none;
            box-shadow:0 2px 8px rgba(0,0,0,0.18);
            transition:left ${HAND_TWEEN_MS}ms cubic-bezier(.25,0,0,1);
        `);
        e.textContent = obj.label;
        e.dataset.handId = obj.id;
        return e;
    }

    /**
     * @param {{ excludeId?: string, insertGapAt?: number }} [opts]
     *   excludeId   — card being dragged as a ghost (skipped in layout, gap reserved for it)
     *   insertGapAt — empty slot index showing where the dragged card will land
     */
    _layoutHand({ excludeId = null, insertGapAt = null } = {}) {
        const ids = excludeId
            ? this._handOrder.filter((id) => id !== excludeId)
            : [...this._handOrder];
        const cw = this._container.clientWidth;

        if (!this._expanded) {
            const n = ids.length;
            const totalW = n > 0 ? CARD_W + (n - 1) * HAND_OVERLAP_X : 0;
            const startX = Math.max(HAND_PAD, (cw - totalW) / 2);
            ids.forEach((id, i) => {
                const el = this._handCards[id];
                if (el) el.style.left = `${startX + i * HAND_OVERLAP_X}px`;
            });
            return;
        }

        // Expanded — with optional gap slot for live insert preview
        const nSlots = insertGapAt !== null ? ids.length + 1 : ids.length;
        const totalW = nSlots > 0 ? nSlots * CARD_W + Math.max(0, nSlots - 1) * HAND_CARD_GAP : 0;
        const startX = Math.max(HAND_PAD, (cw - totalW) / 2);

        let posI = 0;
        ids.forEach((id) => {
            const el = this._handCards[id];
            if (!el) { posI++; return; }
            const slotI = insertGapAt !== null && posI >= insertGapAt ? posI + 1 : posI;
            el.style.left = `${startX + slotI * (CARD_W + HAND_CARD_GAP)}px`;
            posI++;
        });
    }

    /** Returns the insert index (0…n) for a card dropped at screen x=sx. */
    _handInsertIndex(sx, excludeId = null) {
        const ids = excludeId
            ? this._handOrder.filter((id) => id !== excludeId)
            : [...this._handOrder];
        const n = ids.length;
        if (n === 0) return 0;
        const totalW = n * CARD_W + Math.max(0, n - 1) * HAND_CARD_GAP;
        const startX = Math.max(HAND_PAD, (this._container.clientWidth - totalW) / 2);
        for (let i = 0; i < n; i++) {
            if (sx < startX + i * (CARD_W + HAND_CARD_GAP) + CARD_W / 2) return i;
        }
        return n;
    }

    _setHandExpanded(expanded) {
        if (this._expanded === expanded) return;
        this._expanded = expanded;
        this._handEl.style.height = `${expanded ? HAND_EXPAND_H : HAND_PEEK}px`;
        this._layoutHand();
    }

    _toggleHand() { this._setHandExpanded(!this._expanded); }

    _handTop() {
        return this._container.clientHeight - (this._expanded ? HAND_EXPAND_H : HAND_PEEK);
    }

    _collapsedHandTop() {
        return this._container.clientHeight - HAND_PEEK;
    }

    /** @returns {string|null} */
    _handCardAt(sx, sy) {
        const localY = sy - this._handTop();
        if (localY < HAND_PAD || localY > HAND_PAD + CARD_H) return null;
        const n = this._handOrder.length;
        if (n === 0) return null;
        const spacing = this._expanded ? CARD_W + HAND_CARD_GAP : HAND_OVERLAP_X;
        const totalW  = this._expanded ? n * CARD_W + (n - 1) * HAND_CARD_GAP : CARD_W + (n - 1) * HAND_OVERLAP_X;
        const startX  = Math.max(HAND_PAD, (this._container.clientWidth - totalW) / 2);
        for (let i = this._handOrder.length - 1; i >= 0; i--) {
            const left = startX + i * spacing;
            if (sx >= left && sx <= left + CARD_W) return this._handOrder[i];
        }
        return null;
    }

    // ── Cursors ───────────────────────────────────────────────────────────────

    /**
     * @param {Record<string, CursorEntry>} cursors
     * @param {Record<string, BoardObject>} objects
     * @param {Record<string, {x:number,y:number}>} dragging
     */
    _syncCursors(cursors, objects, dragging) {
        for (const [id, e] of Object.entries(this._cursors)) {
            if (!cursors[id]) { e.remove(); delete this._cursors[id]; }
        }
        for (const [id, c] of Object.entries(cursors)) {
            // Don't count cards the player is actively dragging toward the board
            const count = Object.values(objects).filter(
                (o) => o.holderId === id && !dragging[o.id],
            ).length;
            if (!this._cursors[id]) {
                this._cursors[id] = this._spawnCursor(c);
                this._cursorLayer.appendChild(this._cursors[id]);
            }
            const e = this._cursors[id];
            e.style.transform = `translate(${c.boardX - this._scrollX}px,${c.boardY - this._scrollY}px)`;
            const badge = e.querySelector('[data-badge]');
            if (badge) badge.textContent = count > 0 ? String(count) : '';
        }
    }

    _repositionCursors() {
        for (const [id, e] of Object.entries(this._cursors)) {
            const c = this._engine.state.cursors[id];
            if (!c) continue;
            // Suppress tween during scroll — the viewport moved, not the cursor
            e.style.transition = 'none';
            e.style.transform  = `translate(${c.boardX - this._scrollX}px,${c.boardY - this._scrollY}px)`;
            e.getBoundingClientRect(); // force reflow
            e.style.transition = `transform ${this._tweenMs}ms linear`;
        }
    }

    /** @param {CursorEntry} c @returns {HTMLElement} */
    _spawnCursor(c) {
        const wrap = document.createElement('div');
        css(wrap, `position:absolute;top:0;left:0;will-change:transform;transition:transform ${this._tweenMs}ms linear;`);
        wrap.innerHTML = `
            <svg width="14" height="19" viewBox="0 0 14 19" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));display:block;">
                <path d="M1 1L1 15L5 10.5L8 17.5L10 16.5L7 9.5L13 9.5Z" fill="${c.color}" stroke="white" stroke-width="1.2"/>
            </svg>
            <span style="position:absolute;left:14px;top:0;background:${c.color};color:#fff;font-size:11px;font-family:ui-sans-serif,system-ui,sans-serif;padding:2px 4px;border-radius:3px;white-space:nowrap;">${c.name}</span>
            <span data-badge style="position:absolute;left:14px;top:16px;background:${c.color};color:#fff;font-size:10px;font-family:ui-sans-serif,system-ui,sans-serif;padding:1px 3px;border-radius:3px;min-width:14px;text-align:center;"></span>
        `;
        return wrap;
    }

    // ── Input ─────────────────────────────────────────────────────────────────

    _setupInput(container) {
        container.addEventListener('pointerdown',   (e) => this._onDown(e));
        container.addEventListener('pointermove',   (e) => this._onMove(e));
        container.addEventListener('pointerup',     (e) => this._onUp(e));
        container.addEventListener('pointercancel', (e) => this._onUp(e));
    }

    _screenXY(e) {
        const r = this._container.getBoundingClientRect();
        return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    }

    _onDown(e) {
        if (this._gesture) return;
        e.preventDefault();
        const { sx, sy } = this._screenXY(e);

        if (sy >= this._handTop()) {
            const cardId = this._handCardAt(sx, sy);
            if (cardId) {
                this._container.setPointerCapture(e.pointerId);
                const ghost = this._makeGhost(cardId, sx, sy);
                this._handCards[cardId].style.opacity = '0.3';
                this._gesture = {
                    type: 'handDrag', id: cardId, pointerId: e.pointerId,
                    ghost, moved: false, sx, sy,
                    wasExpanded: this._expanded, autoExpanded: false,
                    insertIndex: this._handOrder.indexOf(cardId),
                };
            } else {
                this._gesture = { type: 'handTap', pointerId: e.pointerId, sx, sy };
            }
            return;
        }

        const hit = e.target.closest?.('[data-obj-id]');
        if (hit && this._worldEl.contains(hit)) {
            const id  = hit.dataset.objId;
            const ref = this._boardObjs[id];
            if (ref) {
                this._container.setPointerCapture(e.pointerId);
                ref.dragging = true;
                ref.el.style.cursor  = 'grabbing';
                ref.el.style.zIndex  = '5';
                const objWx = parseFloat(ref.el.style.left);
                const objWy = parseFloat(ref.el.style.top);
                const offX  = (sx + this._scrollX) - objWx;
                const offY  = (sy + this._scrollY) - objWy;
                this._gesture = {
                    type: 'boardDrag', id, pointerId: e.pointerId, offX, offY,
                    wasExpanded: this._expanded, autoExpanded: false, insertIndex: 0,
                };
                this._engine.grabObject(id);
                return;
            }
        }

        this._container.setPointerCapture(e.pointerId);
        this._gesture = {
            type: 'pan', pointerId: e.pointerId,
            startScrollX: this._scrollX, startScrollY: this._scrollY, startX: sx, startY: sy,
        };
    }

    _onMove(e) {
        const { sx, sy } = this._screenXY(e);
        const now = Date.now();

        // Bug 1 fix: cursor broadcast is NOT gated by gesture — always fires on any pointer move
        if (now - this._lastSent >= this._throttleMs) {
            this._lastSent = now;
            this._engine.sendCursor(
                sx + this._scrollX, sy + this._scrollY,
                { x: this._scrollX, y: this._scrollY, w: this._container.clientWidth, h: this._container.clientHeight },
            );
        }

        const g = this._gesture;
        if (!g || g.pointerId !== e.pointerId) return;
        e.preventDefault();

        if (g.type === 'pan') {
            this._scrollX = g.startScrollX - (sx - g.startX);
            this._scrollY = g.startScrollY - (sy - g.startY);
            this._applyScroll();
        }

        if (g.type === 'boardDrag') {
            const wx = sx + this._scrollX - g.offX;
            const wy = sy + this._scrollY - g.offY;
            const ref = this._boardObjs[g.id];
            if (ref) {
                ref.el.style.left = `${wx}px`;
                ref.el.style.top  = `${wy}px`;
            }
            // Bug 3 fix: broadcast live world position to other players
            if (now - this._lastObjDragSent >= this._throttleMs) {
                this._lastObjDragSent = now;
                this._engine.sendObjectDrag(g.id, wx, wy);
            }
        }

        if (g.type === 'handDrag') {
            g.moved = g.moved || Math.hypot(sx - g.sx, sy - g.sy) > 6;
            g.ghost.style.left = `${sx - CARD_W / 2}px`;
            g.ghost.style.top  = `${sy - CARD_H / 2}px`;
            // Bug 4: broadcast live position when card is above the hand zone
            if (sy < this._handTop() && now - this._lastObjDragSent >= this._throttleMs) {
                this._lastObjDragSent = now;
                this._engine.sendObjectDrag(g.id, sx + this._scrollX, sy + this._scrollY);
            }
        }

        // Auto-expand hand when dragging card close to the bottom
        if (g.type === 'boardDrag' || g.type === 'handDrag') {
            const nearHand = sy >= this._collapsedHandTop() - HAND_HOVER_ZONE;
            if (nearHand && !this._expanded) {
                this._setHandExpanded(true);
                g.autoExpanded = true;
            } else if (!nearHand && g.autoExpanded) {
                this._setHandExpanded(false);
                g.autoExpanded = false;
            }
        }

        // Sort gap preview while hovering over the hand tray
        if (g.type === 'boardDrag' && this._expanded) {
            if (sy >= this._handTop()) {
                const idx = this._handInsertIndex(sx);
                if (idx !== g.insertIndex) {
                    g.insertIndex = idx;
                    this._layoutHand({ insertGapAt: idx });
                }
            } else if (g.insertIndex !== null) {
                g.insertIndex = null;
                this._layoutHand();
            }
        }

        if (g.type === 'handDrag' && this._expanded) {
            if (sy >= this._handTop()) {
                const idx = this._handInsertIndex(sx, g.id);
                if (idx !== g.insertIndex) {
                    g.insertIndex = idx;
                    this._layoutHand({ excludeId: g.id, insertGapAt: idx });
                }
            } else {
                this._layoutHand({ excludeId: g.id });
            }
        }
    }

    _onUp(e) {
        const g = this._gesture;
        if (!g || g.pointerId !== e.pointerId) return;
        e.preventDefault();
        this._gesture = null;
        const { sx, sy } = this._screenXY(e);

        if (g.type === 'pan') return;

        if (g.type === 'handTap') {
            this._toggleHand();
            return;
        }

        if (g.type === 'boardDrag') {
            const ref = this._boardObjs[g.id];
            if (!ref) return;
            ref.dragging        = false;
            ref.el.style.cursor = 'grab';
            ref.el.style.zIndex = '';

            if (sy >= this._handTop()) {
                this._pendingInsert = this._expanded ? this._handInsertIndex(sx) : this._handOrder.length;
                this._engine.takeObject(g.id);
            } else {
                this._layoutHand(); // clear any gap preview
                const wx = sx + this._scrollX - g.offX;
                const wy = sy + this._scrollY - g.offY;
                this._engine.moveObject(g.id, wx, wy);
            }
            if (g.autoExpanded) this._setHandExpanded(false);
            return;
        }

        if (g.type === 'handDrag') {
            g.ghost.remove();
            if (this._handCards[g.id]) this._handCards[g.id].style.opacity = '';

            if (!g.moved) {
                this._layoutHand();
                if (g.autoExpanded) this._setHandExpanded(false);
                return;
            }

            if (sy < this._handTop()) {
                // Placed on board
                this._handOrder = this._handOrder.filter((id) => id !== g.id);
                this._layoutHand();
                this._engine.placeObject(g.id, sx + this._scrollX, sy + this._scrollY);
                if (g.autoExpanded) this._setHandExpanded(false);
            } else {
                // Dropped back in hand — commit sort order
                const finalIdx = this._expanded ? this._handInsertIndex(sx, g.id) : g.insertIndex;
                const without   = this._handOrder.filter((id) => id !== g.id);
                without.splice(finalIdx, 0, g.id);
                this._handOrder = without;

                // Bug 2 fix: snap source card to drop position, then animate to sorted slot.
                // Without this, the card was visible at its old position before _layoutHand moved it.
                const srcEl = this._handCards[g.id];
                if (srcEl) {
                    srcEl.style.transition = 'none';
                    srcEl.style.left = `${sx - CARD_W / 2}px`;
                    srcEl.getBoundingClientRect(); // force reflow so the snap renders first
                    srcEl.style.transition = `left ${HAND_TWEEN_MS}ms cubic-bezier(.25,0,0,1)`;
                }
                this._layoutHand();
                if (g.autoExpanded) this._setHandExpanded(false);
            }
        }
    }

    _makeGhost(cardId, sx, sy) {
        const obj = this._engine.state.objects[cardId];
        const ghost = document.createElement('div');
        css(ghost, `
            position:absolute;pointer-events:none;z-index:100;
            width:${CARD_W}px;height:${CARD_H}px;
            left:${sx - CARD_W / 2}px;top:${sy - CARD_H / 2}px;
            background:${obj?.color ?? '#6b7280'};
            border-radius:6px;border:1.5px solid rgba(255,255,255,0.4);
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-size:14px;font-family:ui-sans-serif,system-ui,sans-serif;
            box-shadow:0 8px 24px rgba(0,0,0,0.28);opacity:0.9;
        `);
        ghost.textContent = obj?.label ?? '';
        this._container.appendChild(ghost);
        return ghost;
    }

    // ── Network quality ───────────────────────────────────────────────────────

    /** Called by RoomPage when RTT/queue-depth measurement changes. */
    setThrottleMs(ms) {
        this._throttleMs = ms;
        this._tweenMs    = Math.round(ms * 1.6);
        for (const el of Object.values(this._cursors)) {
            el.style.transition = `transform ${this._tweenMs}ms linear`;
        }
    }

    // ── Teardown ──────────────────────────────────────────────────────────────

    destroy() {
        this._engine.off('stateChanged', this._onState);
        this._container.innerHTML = '';
        this._container.style.cssText = '';
    }
}
