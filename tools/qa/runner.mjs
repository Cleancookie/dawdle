export class Runner {
    constructor(name) {
        this.name    = name
        this.passed  = 0
        this.failed  = 0
        this._clients = []
    }

    step(msg)        { console.log(`\n[STEP] ${msg}`) }
    log(msg)         { console.log(`       ${msg}`) }

    assert(condition, msg) {
        if (condition) {
            console.log(`  ✓  ${msg}`)
            this.passed++
        } else {
            console.log(`  ✗  ${msg}`)
            this.failed++
        }
    }

    assertEqual(actual, expected, label) {
        const ok = actual === expected
        if (ok) {
            this.assert(true, label)
        } else {
            this.assert(false, `${label}\n         got:      ${JSON.stringify(actual)}\n         expected: ${JSON.stringify(expected)}`)
        }
    }

    assertExists(value, label) {
        this.assert(value !== null && value !== undefined && value !== '', label)
    }

    track(client) {
        this._clients.push(client)
        return client
    }

    async run(fn) {
        console.log(`\n${'═'.repeat(52)}`)
        console.log(`  QA Scenario: ${this.name}`)
        console.log('═'.repeat(52))
        try {
            await fn(this)
        } catch (err) {
            const msg = err.message.length > 200 ? err.message.slice(0, 200) + '…' : err.message
            console.log(`\n  ✗  FATAL: ${msg}`)
            const frame = err.stack?.split('\n')[1]?.trim()
            if (frame) console.log(`       ${frame}`)
            this.failed++
        } finally {
            this._clients.forEach(c => c.disconnect())
        }
        const total = this.passed + this.failed
        console.log(`\n${'─'.repeat(52)}`)
        const summary = this.failed === 0
            ? `  ✓  All ${total} assertions passed`
            : `  ✗  ${this.failed}/${total} failed`
        console.log(summary)
        console.log('─'.repeat(52))
        return this.failed === 0
    }
}
