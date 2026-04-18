import { useState } from 'react';

export function useGuest() {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const [guestId] = useState(() => {
        let id = localStorage.getItem('dawdle_guest_id');
        if (!id || !UUID_REGEX.test(id)) {
            id = crypto.randomUUID();
            localStorage.setItem('dawdle_guest_id', id);
        }
        return id;
    });

    const [displayName, setDisplayNameState] = useState(
        () => localStorage.getItem('dawdle_display_name') ?? ''
    );

    function setDisplayName(name) {
        localStorage.setItem('dawdle_display_name', name);
        setDisplayNameState(name);
    }

    return { guestId, displayName, setDisplayName };
}
