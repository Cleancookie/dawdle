import React from 'react';
import { createRoot } from 'react-dom/client';
import { useGuest } from './hooks/use-guest';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import '../css/app.css';

function App() {
    const guest = useGuest();
    const [path, setPath] = React.useState(window.location.pathname);

    function navigate(to) {
        window.history.pushState({}, '', to);
        setPath(to);
    }

    React.useEffect(() => {
        const onPop = () => setPath(window.location.pathname);
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const roomCode = path.match(/^\/room\/([A-Za-z0-9]{6})/)?.[1] ?? null;

    if (roomCode) {
        return <RoomPage guest={guest} roomCode={roomCode} navigate={navigate} />;
    }

    return <HomePage guest={guest} navigate={navigate} />;
}

const container = document.getElementById('app');
const root = container._reactRoot ?? (container._reactRoot = createRoot(container));
root.render(<App />);
