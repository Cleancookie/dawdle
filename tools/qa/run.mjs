#!/usr/bin/env node
import { fileURLToPath } from 'url'
import { join, dirname }  from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))

const SCENARIOS = {
    room:       'scenarios/room.mjs',
    ttt:        'scenarios/ttt.mjs',
    pictionary: 'scenarios/pictionary.mjs',
}

const target = process.argv[2]

if (target && !SCENARIOS[target]) {
    console.error(`Unknown scenario: "${target}". Options: ${Object.keys(SCENARIOS).join(', ')}`)
    process.exit(1)
}

const toRun = target ? [target] : Object.keys(SCENARIOS)
let allPassed = true

for (const name of toRun) {
    const mod    = await import(join(__dir, SCENARIOS[name]))
    const passed = await mod.run()
    if (!passed) allPassed = false
}

process.exit(allPassed ? 0 : 1)
