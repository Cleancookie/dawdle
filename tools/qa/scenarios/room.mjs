import { VirtualClient } from '../client.mjs'
import { Runner }        from '../runner.mjs'

export async function run() {
    const r = new Runner('Room Lifecycle')
    return r.run(async (r) => {
        const alice   = r.track(new VirtualClient('Alice'))
        const bob     = r.track(new VirtualClient('Bob'))
        const charlie = r.track(new VirtualClient('Charlie'))

        // ── Create ──────────────────────────────────────────────────────────
        r.step('Alice creates a room')
        const { code, roomId } = await alice.api('POST', '/rooms', { display_name: 'Alice' })
        r.assertExists(code,   `Room code assigned: ${code}`)
        r.assertExists(roomId, 'Room ID assigned')

        // ── Join ────────────────────────────────────────────────────────────
        r.step('Alice and Bob join the room')
        const joinAlice = await alice.api('POST', `/rooms/${code}/join`, { display_name: 'Alice' })
        r.assertEqual(joinAlice.role, 'player', 'Alice joins as player')

        const joinBob = await bob.api('POST', `/rooms/${code}/join`, { display_name: 'Bob' })
        r.assertEqual(joinBob.role, 'player', 'Bob joins as player')

        // ── WebSocket ───────────────────────────────────────────────────────
        r.step('Both connect to WebSocket presence channel')
        await alice.connect(roomId)
        r.assert(true, 'Alice connected')
        await bob.connect(roomId)
        r.assert(true, 'Bob connected')

        // ── Room state ──────────────────────────────────────────────────────
        r.step('GET room returns correct metadata')
        const room = await alice.api('GET', `/rooms/${code}`)
        r.assertEqual(room.code,        code,            'Code matches')
        r.assertEqual(room.hostGuestId, alice.guestId,   'Alice is host')
        r.assertEqual(room.status,      'waiting',       'Status is waiting')
        r.assertExists(room.selectedGame,                'selectedGame present')

        // ── Chat ────────────────────────────────────────────────────────────
        r.step('Alice sends a chat message — Bob receives it')
        await alice.api('POST', `/rooms/${code}/chat`, { message: 'Hello Dawdle!' })
        const chat = await bob.waitForEvent('chat.message')
        r.assertEqual(chat.displayName, 'Alice',          'Sender name correct')
        r.assertEqual(chat.message,     'Hello Dawdle!',  'Message content correct')

        // ── Charlie joins after WS connected ────────────────────────────────
        r.step('Charlie joins — Alice sees player_joined with systemMessage')
        await charlie.api('POST', `/rooms/${code}/join`, { display_name: 'Charlie' })
        const joined = await alice.waitForEvent('room.player_joined')
        r.assertEqual(joined.displayName, 'Charlie',  'player_joined names Charlie')
        r.assertExists(joined.systemMessage,          'player_joined has systemMessage')

        // ── Charlie leaves ──────────────────────────────────────────────────
        r.step('Charlie leaves — Alice sees player_left with systemMessage')
        await charlie.api('DELETE', `/rooms/${code}/leave`)
        const left = await alice.waitForEvent('room.player_left')
        r.assertEqual(left.displayName, 'Charlie',  'player_left names Charlie')
        r.assertExists(left.systemMessage,          'player_left has systemMessage')

        // ── Game selection ──────────────────────────────────────────────────
        r.step('Alice (host) selects pictionary')
        await alice.api('PATCH', `/rooms/${code}/game`, { game_type: 'pictionary' })
        const selected = await bob.waitForEvent('room.game_selected')
        r.assertEqual(selected.gameType, 'pictionary', 'Bob sees game_selected')
        r.assertExists(selected.systemMessage,          'game_selected has systemMessage')

        r.step('Bob (non-host) cannot select game')
        try {
            await bob.api('PATCH', `/rooms/${code}/game`, { game_type: 'tic_tac_toe' })
            r.assert(false, 'Should have been rejected')
        } catch (e) {
            r.assertEqual(e.status, 403, 'Non-host game select → 403')
        }

        // ── Ready ───────────────────────────────────────────────────────────
        r.step('Bob sees ready state change when Alice readies up')
        await alice.api('POST', `/rooms/${code}/ready`)
        const readyEv = await bob.waitForEvent('room.player_ready')
        r.assertEqual(readyEv.guestId, alice.guestId, 'Correct guest in ready event')
        r.assertEqual(readyEv.ready,   true,          'ready = true')
    })
}
