import { useState, useEffect, useRef } from 'react';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

let echo = null;

function getEcho(guestId) {
    if (echo) return echo;

    window.Pusher = Pusher;

    echo = new Echo({
        broadcaster: 'reverb',
        key: import.meta.env.VITE_REVERB_APP_KEY,
        wsHost: import.meta.env.VITE_REVERB_HOST ?? 'localhost',
        wsPort: import.meta.env.VITE_REVERB_PORT ?? 8080,
        wssPort: import.meta.env.VITE_REVERB_PORT ?? 8080,
        forceTLS: false,
        enabledTransports: ['ws', 'wss'],
        auth: {
            headers: { 'X-Guest-ID': guestId },
        },
    });

    return echo;
}

export function useRoom(roomId, guestId) {
    const [members, setMembers] = useState([]);
    const channelRef = useRef(null);

    useEffect(() => {
        if (!roomId || !guestId) return;

        const instance = getEcho(guestId);
        const channelName = `presence-room.${roomId}`;

        const channel = instance.join(channelName)
            .here((here) => setMembers(here))
            .joining((member) => setMembers((prev) => [...prev, member]))
            .leaving((member) => setMembers((prev) => prev.filter((m) => m.id !== member.id)));

        channelRef.current = channel;

        return () => {
            instance.leave(channelName);
            channelRef.current = null;
        };
    }, [roomId, guestId]);

    return { members, channel: channelRef.current };
}
