/**
 * tools/play.mjs — headless two-player game runner for manual testing
 *
 * Usage:
 *   node tools/play.mjs [game]   e.g.  node tools/play.mjs spotto
 *
 * Opens two browser contexts (Alice + Bob), creates a room, both players
 * ready up, then plays a full round of the chosen game.
 * Screenshots are saved to tools/screenshots/ at each key step.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const APP_URL   = process.env.APP_URL ?? 'http://localhost:8000';
const GAME      = process.argv[2] ?? 'spotto';
const SHOT_DIR  = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');

fs.mkdirSync(SHOT_DIR, { recursive: true });

let shotIdx = 0;
async function shot(page, label) {
    const file = path.join(SHOT_DIR, `${String(++shotIdx).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  📸 ${path.basename(file)}`);
}

async function setName(page, name) {
    await page.goto(APP_URL);
    const input = page.locator('input[placeholder="Enter your display name"]');
    await input.waitFor({ timeout: 10_000 });
    await input.fill(name);
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('input[placeholder="Enter your display name"]'));
}

async function waitForText(page, text, timeout = 15_000) {
    await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        text, { timeout }
    );
}

// ─── Main ────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: true });
const ctxA    = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctxB    = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const alice   = await ctxA.newPage();
const bob     = await ctxB.newPage();

// Pipe browser console errors to terminal for debugging
for (const [name, page] of [['Alice', alice], ['Bob', bob]]) {
    page.on('console', m => { if (m.type() === 'error') console.error(`  [${name} console] ${m.text()}`); });
    page.on('pageerror', e => console.error(`  [${name} page error] ${e.message}`));
}

try {
    // ── 1. Set display names ─────────────────────────────────────────────────
    console.log('\n[1] Setting display names');
    await setName(alice, 'Alice');
    await setName(bob, 'Bob');
    await shot(alice, 'alice-home');

    // ── 2. Alice creates a room ──────────────────────────────────────────────
    console.log('\n[2] Alice creates a room');
    await alice.locator('button', { hasText: 'Create Room' }).click();
    await alice.waitForURL(/\/room\//);
    const roomUrl = alice.url();
    const roomCode = roomUrl.match(/\/room\/([A-Z0-9]+)/i)?.[1];
    console.log(`  Room: ${roomCode}  (${roomUrl})`);
    await shot(alice, 'alice-lobby');

    // ── 3. Bob joins ─────────────────────────────────────────────────────────
    console.log('\n[3] Bob joins');
    await bob.goto(roomUrl);
    await waitForText(bob, 'Bob');

    // ── 4. Alice selects the game (after Bob joins so it broadcasts to him)
    console.log(`\n[4] Alice selects ${GAME}`);
    const gameSelect = alice.locator('select');
    if (await gameSelect.count()) {
        await gameSelect.selectOption(GAME);
        // Wait for the broadcast to reach Bob's presence channel
        await bob.waitForFunction(
            (label) => document.body.innerText.includes(label),
            ({ spotto: 'Spotto', pictionary: 'Pictionary', tic_tac_toe: 'Tic Tac Toe' })[GAME],
            { timeout: 5_000 },
        );
    }
    await shot(bob, 'bob-lobby');

    // ── 5. Both ready up ─────────────────────────────────────────────────────
    console.log('\n[5] Both players ready up');
    await alice.locator('button', { hasText: 'Ready' }).click();
    await bob.locator('button', { hasText: 'Ready' }).click();

    // Wait for game to start (game area should appear)
    await alice.waitForFunction(
        () => !document.body.innerText.includes('Ready') || document.body.innerText.includes('Round'),
        { timeout: 10_000 }
    );
    await alice.waitForTimeout(800);
    await shot(alice, 'alice-game-start');
    await shot(bob,   'bob-game-start');

    // ── 6. Game-specific play ────────────────────────────────────────────────
    console.log(`\n[6] Playing a round of ${GAME}`);

    if (GAME === 'spotto') {
        await playSpotto(alice, bob);
    } else if (GAME === 'pictionary') {
        await playPictionary(alice, bob);
    } else if (GAME === 'tic_tac_toe') {
        await playTtt(alice, bob);
    } else {
        console.log('  (no auto-play for this game — screenshotting current state)');
        await alice.waitForTimeout(1000);
        await shot(alice, 'game-state');
    }

    // ── 7. Final state ───────────────────────────────────────────────────────
    await alice.waitForTimeout(500);
    await shot(alice, 'alice-final');
    await shot(bob,   'bob-final');

    console.log(`\n✅ Done — screenshots in tools/screenshots/\n`);

} catch (err) {
    console.error('\n❌ Error:', err.message);
    await shot(alice, 'alice-error').catch(() => {});
    await shot(bob,   'bob-error').catch(() => {});
    process.exitCode = 1;
} finally {
    await browser.close();
}

// ─── Game-specific play routines ─────────────────────────────────────────────

async function playSpotto(alice, bob) {
    // Wait for round_started — both cards visible (CSS uppercases the label)
    await waitForText(alice, 'CENTER CARD');
    await waitForText(bob,   'CENTER CARD');
    await shot(alice, 'spotto-round1-alice');
    await shot(bob,   'spotto-round1-bob');

    // Read center card and alice's card symbols from the DOM
    // Cards render as divs with emoji text — try clicking each symbol on
    // alice's card until one is accepted (the matching one)
    console.log('  Alice hunting for the match…');
    const aliceSymbols = await alice.locator('[style*="cursor: pointer"]').all();
    let found = false;
    for (const sym of aliceSymbols) {
        await sym.click();
        await alice.waitForTimeout(200);
        const bannerVisible = await alice.locator('text=/got it/i').count();
        if (bannerVisible) { found = true; break; }
    }
    console.log(found ? '  Alice found the match!' : '  (match not found via click — Bob tries)');
    if (!found) {
        const bobSymbols = await bob.locator('[style*="cursor: pointer"]').all();
        for (const sym of bobSymbols) {
            await sym.click();
            await bob.waitForTimeout(200);
            const bannerVisible = await bob.locator('text=/got it/i').count();
            if (bannerVisible) { console.log('  Bob found the match!'); break; }
        }
    }

    await alice.waitForTimeout(600);
    await shot(alice, 'spotto-point-scored');
    await shot(bob,   'spotto-point-scored-bob');
}

async function playPictionary(alice, bob) {
    // One player is the drawer — wait for the word prompt to appear
    await alice.waitForTimeout(1000);
    const aliceIsDrawer = await alice.locator('text=/Draw:/').count() > 0;
    const [drawer, guesser, dName, gName] = aliceIsDrawer
        ? [alice, bob,   'Alice', 'Bob']
        : [bob,   alice, 'Bob',   'Alice'];

    console.log(`  ${dName} is drawing, ${gName} is guessing`);
    await shot(drawer,  'pict-drawer-view');
    await shot(guesser, 'pict-guesser-view');

    // Drawer scribbles a line
    const canvas = drawer.locator('canvas').first();
    const box    = await canvas.boundingBox();
    if (box) {
        await drawer.mouse.move(box.x + 100, box.y + 100);
        await drawer.mouse.down();
        for (let i = 0; i < 40; i++) {
            await drawer.mouse.move(box.x + 100 + i * 4, box.y + 100 + Math.sin(i / 5) * 30, { steps: 1 });
        }
        await drawer.mouse.up();
        await drawer.waitForTimeout(300);
    }
    await shot(drawer,  'pict-after-drawing');
    await shot(guesser, 'pict-guesser-sees-stroke');

    // Guesser types a guess (won't be right, just testing the flow)
    const guessInput = guesser.locator('input[placeholder*="guess"]');
    await guessInput.fill('test');
    await guesser.locator('button', { hasText: 'Guess' }).click();
    await guesser.waitForTimeout(300);
    await shot(guesser, 'pict-after-guess');
}

async function playTtt(alice, bob) {
    await waitForText(alice, "X's turn");
    await shot(alice, 'ttt-start');

    // X goes centre, O goes top-left, X wins diagonal
    const moves = [4, 0, 2, 6, 8]; // X wins: 4,2,8... wait let's just take turns
    let xTurn = true;
    for (const idx of [4, 0, 1, 2, 7]) {
        const page  = xTurn ? alice : bob;
        const cells = await page.locator('button.cell, [data-cell], td').all();
        if (cells[idx]) await cells[idx].click();
        await page.waitForTimeout(300);
        xTurn = !xTurn;
    }
    await shot(alice, 'ttt-midgame');
}
