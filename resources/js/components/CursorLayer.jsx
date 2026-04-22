import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';

const CURSOR_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const CURSOR_LERP   = 0.12;   // lerp factor per rAF frame (~60fps) — tune for more/less tail
const SEND_INTERVAL = 167;    // ms between outgoing whispers (~6fps)
const STALE_AFTER   = 4000;   // ms before a silent cursor is removed

// ---------------------------------------------------------------------------
// RemoteCursor — single other-player cursor rendered at position:fixed
// ---------------------------------------------------------------------------
function RemoteCursor({ x, y, displayName, color }) {
    const divRef = useRef(null);
    const rafRef = useRef(null);
    const cur    = useRef({ x, y });
    const tgt    = useRef({ x, y });

    useEffect(() => { tgt.current = { x, y }; }, [x, y]);

    useEffect(() => {
        const tick = () => {
            cur.current.x += (tgt.current.x - cur.current.x) * CURSOR_LERP;
            cur.current.y += (tgt.current.y - cur.current.y) * CURSOR_LERP;
            if (divRef.current) {
                divRef.current.style.transform =
                    `translate(${cur.current.x * window.innerWidth}px, ${cur.current.y * window.innerHeight}px)`;
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return (
        <div
            ref={divRef}
            style={{
                position:      'fixed',
                left:          0,
                top:           0,
                transform:     `translate(${x * window.innerWidth}px, ${y * window.innerHeight}px)`,
                pointerEvents: 'none',
                zIndex:        9999,
            }}
        >
            <svg
                width="14" height="19"
                viewBox="0 0 10 14"
                style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}
            >
                <path
                    d="M0 0 L0 12 L3 9 L5.5 13.5 L7 12.8 L4.5 8.5 L8.5 8.5 Z"
                    fill={color}
                    stroke="white"
                    strokeWidth="0.8"
                    strokeLinejoin="round"
                />
            </svg>
            <div style={{
                position:     'absolute',
                left:         14,
                top:          1,
                background:   color,
                color:        'white',
                padding:      '1px 6px',
                borderRadius: 4,
                fontSize:     11,
                fontWeight:   700,
                whiteSpace:   'nowrap',
                boxShadow:    '0 1px 3px rgba(0,0,0,0.25)',
            }}>
                {displayName}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// useCursors — internal hook: send, receive, expire
// ---------------------------------------------------------------------------
function useCursors(channel, myGuestId, myDisplayName) {
    const [cursors, setCursors]   = useState({});
    const lastSentRef             = useRef(0);

    const send = useCallback((e) => {
        if (!channel) return;
        const now = Date.now();
        if (now - lastSentRef.current < SEND_INTERVAL) return;
        lastSentRef.current = now;
        channel.whisper('cursor', {
            guestId:     myGuestId,
            displayName: myDisplayName,
            x:           e.clientX / window.innerWidth,
            y:           e.clientY / window.innerHeight,
        });
    }, [channel, myGuestId, myDisplayName]);

    // Attach to window so tracking works regardless of which element has focus
    useEffect(() => {
        window.addEventListener('pointermove', send);
        return () => window.removeEventListener('pointermove', send);
    }, [send]);

    // Receive whispers + expire stale cursors
    useEffect(() => {
        if (!channel) return;

        channel.listenForWhisper('cursor', ({ guestId, displayName, x, y }) => {
            if (guestId === myGuestId) return;
            setCursors(prev => ({
                ...prev,
                [guestId]: { x, y, displayName, lastSeen: Date.now() },
            }));
        });

        const timer = setInterval(() => {
            const cutoff = Date.now() - STALE_AFTER;
            setCursors(prev => {
                const next = Object.fromEntries(
                    Object.entries(prev).filter(([, c]) => c.lastSeen > cutoff)
                );
                return Object.keys(next).length === Object.keys(prev).length ? prev : next;
            });
        }, 1000);

        return () => {
            channel.stopListeningForWhisper('cursor');
            clearInterval(timer);
        };
    }, [channel, myGuestId]);

    return cursors;
}

// ---------------------------------------------------------------------------
// CursorLayer — drop in anywhere; portals to document.body
// ---------------------------------------------------------------------------
export default function CursorLayer({ channel, myGuestId, myDisplayName, members }) {
    const cursors = useCursors(channel, myGuestId, myDisplayName);

    const colorMap = useMemo(() => {
        const map = {};
        members.forEach((m, i) => { map[m.id] = CURSOR_COLORS[i % CURSOR_COLORS.length]; });
        return map;
    }, [members]);

    return createPortal(
        Object.entries(cursors).map(([id, c]) => (
            <RemoteCursor
                key={id}
                x={c.x}
                y={c.y}
                displayName={c.displayName}
                color={colorMap[id] ?? '#6b7280'}
            />
        )),
        document.body,
    );
}
