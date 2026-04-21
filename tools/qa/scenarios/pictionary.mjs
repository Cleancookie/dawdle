/**
 * Pictionary QA scenario — this will FAIL until the Pictionary backend and
 * frontend are implemented. It acts as the acceptance spec for that work.
 *
 * Sub-agents implementing Pictionary should run `make qa-pict` to verify.
 */
import { VirtualClient } from '../client.mjs'
import { Runner }        from '../runner.mjs'

export async function run() {
    const r = new Runner('Pictionary — Full Game')
    return r.run(async (r) => {
        const alice = r.track(new VirtualClient('Alice'))
        const bob   = r.track(new VirtualClient('Bob'))

        // ── Setup ────────────────────────────────────────────────────────────
        r.step('Create room, set game to pictionary, join, connect')
        const { code, roomId } = await alice.api('POST', '/rooms', { display_name: 'Alice' })
        await alice.api('POST', `/rooms/${code}/join`, { display_name: 'Alice' })
        await bob.api('POST',   `/rooms/${code}/join`, { display_name: 'Bob' })
        await alice.api('PATCH', `/rooms/${code}/game`, { game_type: 'pictionary' })
        await alice.connect(roomId)
        await bob.connect(roomId)
        r.assert(true, 'Setup complete')

        // ── Start ────────────────────────────────────────────────────────────
        r.step('Both ready up — game starts')
        await alice.api('POST', `/rooms/${code}/ready`)
        await bob.api('POST',   `/rooms/${code}/ready`)

        const started = await alice.waitForEvent('game.started', 8_000)
        r.assertEqual(started.gameType, 'pictionary', 'gameType = pictionary')
        r.assertExists(started.gameId,                'gameId present')
        r.assertExists(started.systemMessage,         'game.started has systemMessage')
        const { gameId } = started

        // ── Round 1 starts ───────────────────────────────────────────────────
        r.step('pict.round_started fires immediately')
        const round1 = await alice.waitForEvent('pict.round_started', 5_000)
        r.assertEqual(round1.round, 1,                           'Round number = 1')
        r.assert(round1.totalRounds >= 2,                        `totalRounds >= 2 (${round1.totalRounds})`)
        r.assertExists(round1.drawerGuestId,                     'drawerGuestId present')
        r.assertExists(round1.word,                              'Word included in payload')
        r.assert(round1.word.length > 0,                         'Word is non-empty')
        r.assertExists(round1.timeLimit,                         'timeLimit present')
        r.assertExists(round1.systemMessage,                     'pict.round_started has systemMessage')

        const drawer  = round1.drawerGuestId === alice.guestId ? alice : bob
        const guesser = drawer === alice ? bob : alice
        r.log(`Drawer: ${drawer.displayName} | Guesser: ${guesser.displayName} | Word: "${round1.word}"`)

        // ── Drawing ──────────────────────────────────────────────────────────
        r.step('Drawer sends a stroke — guesser receives pict.stroke')
        const stroke = { points: [{ x: 100, y: 100 }, { x: 150, y: 150 }, { x: 200, y: 100 }], color: '#000000', width: 4, isEraser: false }
        await drawer.api('POST', `/games/${gameId}/move`, { type: 'pict.stroke', ...stroke })
        const strokeEv = await guesser.waitForEvent('pict.stroke', 3_000)
        r.assertExists(strokeEv,                              'pict.stroke received')
        r.assert(Array.isArray(strokeEv.points),              'stroke.points is array')

        r.step('Non-drawer cannot send strokes')
        try {
            await guesser.api('POST', `/games/${gameId}/move`, { type: 'pict.stroke', ...stroke })
            r.assert(false, 'Should have rejected guesser stroke')
        } catch (e) {
            r.assertEqual(e.status, 403, 'Non-drawer stroke → 403')
        }

        r.step('Drawer can clear canvas — guesser receives pict.canvas_clear')
        await drawer.api('POST', `/games/${gameId}/move`, { type: 'pict.canvas_clear' })
        const clearEv = await guesser.waitForEvent('pict.canvas_clear', 3_000)
        r.assertExists(clearEv, 'pict.canvas_clear received')

        r.step('Non-drawer cannot clear canvas')
        try {
            await guesser.api('POST', `/games/${gameId}/move`, { type: 'pict.canvas_clear' })
            r.assert(false, 'Should have rejected guesser clear')
        } catch (e) {
            r.assertEqual(e.status, 403, 'Non-drawer clear → 403')
        }

        // ── Guessing ─────────────────────────────────────────────────────────
        r.step('Wrong guess — no events fire')
        const countBefore = guesser.getEvents().length
        await guesser.api('POST', `/games/${gameId}/move`, { type: 'pict.guess', guess: '__wrong_word__' })
        await new Promise(res => setTimeout(res, 600))
        r.assertEqual(guesser.getEvents().length, countBefore, 'No new events for wrong guess')

        r.step('Correct guess fires pict.guess_correct')
        // Snapshot before the guess — all three events (guess_correct, round_ended, round_started)
        // fire in the same PHP request and may all arrive before we finish awaiting any one of them.
        const beforeRound1Ended = alice.eventCount()
        const beforeRound2 = alice.eventCount()
        await guesser.api('POST', `/games/${gameId}/move`, { type: 'pict.guess', guess: round1.word })
        const guessEv = await drawer.waitForEvent('pict.guess_correct', 3_000)
        r.assertEqual(guessEv.guestId,     guesser.guestId,      'Correct guesser identified')
        r.assertExists(guessEv.displayName,                       'displayName present')

        r.step('pict.round_ended fires after correct guess')
        const round1Ended = await alice.waitForEvent('pict.round_ended', 3_000, beforeRound1Ended)
        r.assertEqual(round1Ended.word, round1.word,              'Word revealed')
        r.assert(Array.isArray(round1Ended.scores),               'Round scores present')
        r.assertExists(round1Ended.systemMessage,                  'pict.round_ended has systemMessage')

        // Check scoring: guesser should have points, drawer should have points
        const guesserRoundScore = round1Ended.scores.find(s => s.guestId === guesser.guestId)
        const drawerRoundScore  = round1Ended.scores.find(s => s.guestId === drawer.guestId)
        r.assert(guesserRoundScore?.score > 0, `Guesser earned points in round 1 (${guesserRoundScore?.score})`)
        r.assert(drawerRoundScore?.score > 0,  `Drawer earned points in round 1 (${drawerRoundScore?.score})`)

        // ── Round 2 ──────────────────────────────────────────────────────────
        r.step('Round 2 starts with the other player as drawer')
        const round2 = await alice.waitForEvent('pict.round_started', 5_000, beforeRound2)
        r.assertEqual(round2.round, 2,                                    'Round 2')
        r.assert(round2.drawerGuestId !== round1.drawerGuestId,            'Drawer rotated')
        r.assertExists(round2.word,                                        'Round 2 has a word')

        r.step('Round 2: drawer sends a stroke, then times out')
        const drawer2 = round2.drawerGuestId === alice.guestId ? alice : bob
        const beforeGameEnded = alice.eventCount()
        await drawer2.api('POST', `/games/${gameId}/move`, { type: 'pict.stroke', ...stroke })
        await drawer2.api('POST', `/games/${gameId}/move`, { type: 'pict.timeout' })

        const round2Ended = await alice.waitForEvent('pict.round_ended', 3_000, beforeGameEnded)
        r.assertExists(round2Ended,             'pict.round_ended fires on timeout')
        r.assertEqual(round2Ended.word, round2.word, 'Word revealed on timeout')

        // ── Game end ─────────────────────────────────────────────────────────
        r.step('game.ended fires with final scores after all rounds')
        const ended = await alice.waitForEvent('game.ended', 5_000, beforeGameEnded)
        r.assertExists(ended,                        'game.ended received')
        r.assert(Array.isArray(ended.scores),         'Final scores present')
        r.assertEqual(ended.scores.length, 2,         'Two player scores')
        r.assertExists(ended.systemMessage,           'game.ended has systemMessage')

        const guesserFinal = ended.scores.find(s => s.guestId === guesser.guestId)
        r.assert(guesserFinal?.score > 0, `Guesser has positive final score (${guesserFinal?.score})`)
    })
}
