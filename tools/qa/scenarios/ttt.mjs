import { VirtualClient } from '../client.mjs'
import { Runner }        from '../runner.mjs'

export async function run() {
    const r = new Runner('Tic Tac Toe — Full Game')
    return r.run(async (r) => {
        const alice = r.track(new VirtualClient('Alice'))
        const bob   = r.track(new VirtualClient('Bob'))

        // ── Setup ────────────────────────────────────────────────────────────
        r.step('Create room, join, connect')
        const { code, roomId } = await alice.api('POST', '/rooms', { display_name: 'Alice' })
        await alice.api('POST', `/rooms/${code}/join`, { display_name: 'Alice' })
        await bob.api('POST',   `/rooms/${code}/join`, { display_name: 'Bob' })
        await alice.connect(roomId)
        await bob.connect(roomId)
        r.assert(true, 'Setup complete')

        // ── Start ────────────────────────────────────────────────────────────
        r.step('Both ready up — game starts')
        await alice.api('POST', `/rooms/${code}/ready`)
        await bob.api('POST',   `/rooms/${code}/ready`)

        const started = await alice.waitForEvent('game.started', 8_000)
        r.assertEqual(started.gameType, 'tic_tac_toe', 'gameType = tic_tac_toe')
        r.assertExists(started.gameId,                 'gameId present')
        r.assertExists(started.firstTurn,              'firstTurn assigned')
        r.assertExists(started.systemMessage,          'game.started has systemMessage')

        const { gameId, firstTurn } = started
        const first  = alice.guestId === firstTurn ? alice : bob
        const second = first === alice ? bob : alice
        r.log(`${first.displayName} goes first (X)`)

        // ── Play a winning game ───────────────────────────────────────────────
        // X: 0, 1, 2 → top row win. O: 3, 4 (never wins)
        r.step('Play moves — X wins top row (0,1,2)')
        await first.api('POST',  `/games/${gameId}/move`, { index: 0 })
        await second.api('POST', `/games/${gameId}/move`, { index: 3 })
        await first.api('POST',  `/games/${gameId}/move`, { index: 1 })
        await second.api('POST', `/games/${gameId}/move`, { index: 4 })
        await first.api('POST',  `/games/${gameId}/move`, { index: 2 })

        // ── Verify events ────────────────────────────────────────────────────
        r.step('Both clients receive all move events')
        const ended = await alice.waitForEvent('game.ended', 8_000)
        r.assertExists(ended,                  'game.ended received')
        r.assertEqual(ended.winner, first.guestId, 'Correct winner')
        r.assert(Array.isArray(ended.scores),  'scores is array')
        r.assert(ended.scores.length === 2,    'Two score entries')

        const aliceMoves = alice.getEvents('ttt.move_made')
        const bobMoves   = bob.getEvents('ttt.move_made')
        r.assert(aliceMoves.length >= 4, `Alice received ${aliceMoves.length} move events`)
        r.assert(bobMoves.length >= 4,   `Bob received ${bobMoves.length} move events`)

        r.step('Wrong-turn move is rejected')
        // Game is over now; start a new one to test turn enforcement
        const after = alice.eventCount()
        await alice.api('POST', `/rooms/${code}/ready`)
        await bob.api('POST',   `/rooms/${code}/ready`)
        const started2 = await alice.waitForEvent('game.started', 8_000, after)
        const { gameId: gameId2, firstTurn: firstTurn2 } = started2
        const notFirst = alice.guestId === firstTurn2 ? bob : alice
        try {
            await notFirst.api('POST', `/games/${gameId2}/move`, { index: 0 })
            r.assert(false, 'Should have rejected out-of-turn move')
        } catch (e) {
            r.assertEqual(e.status, 422, 'Out-of-turn move → 422')
        }
    })
}
