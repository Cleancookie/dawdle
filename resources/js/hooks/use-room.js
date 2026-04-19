import { useState, useEffect } from 'react';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

let echoInstance = null;
let echoGuestId = null;

function getEcho(guestId) {
    if (echoInstance && echoGuestId === guestId) return echoInstance;

    if (echoInstance) {
        echoInstance.disconnect();
    }

    window.Pusher = Pusher;
    echoInstance = new Echo({
        broadcaster: 'reverb',
        key: import.meta.env.VITE_REVERB_APP_KEY,
        wsHost: import.meta.env.VITE_REVERB_HOST ?? 'localhost',
        wsPort: import.meta.env.VITE_REVERB_PORT ?? 8080,
        wssPort: import.meta.env.VITE_REVERB_PORT ?? 8080,
        forceTLS: false,
        enabledTransports: ['ws', 'wss'],
        auth: {
            headers: { 'X-Guest-ID': guestId, 'Accept': 'application/json' },
        },
    });
    window.Echo = echoInstance;
    echoGuestId = guestId;
    return echoInstance;
}

export function useRoom(roomId, guestId, { onJoining, onLeaving } = {}) {
    const [members, setMembers] = useState([]);
    const [channel, setChannel] = useState(null);

    useEffect(() => {
        if (!roomId || !guestId) return;

        const instance = getEcho(guestId);
        const channelName = `room.${roomId}`;

        const ch = instance.join(channelName)
            .here((here) => setMembers(here))
            .joining((member) => {
                setMembers((prev) => [...prev, member]);
                onJoining?.(member);
            })
            .leaving((member) => {
                setMembers((prev) => prev.filter((m) => m.id !== member.id));
                onLeaving?.(member);
            });

        setChannel(ch);

        return () => {
            instance.leave(channelName);
            setChannel(null);
        };
    }, [roomId, guestId]);

    return { members, channel };
}
