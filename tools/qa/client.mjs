import { Pusher } from 'pusher-js'

const APP_URL     = process.env.QA_APP_URL      ?? 'http://app:8000'
const REVERB_HOST = process.env.QA_REVERB_HOST  ?? 'reverb'
const REVERB_PORT = parseInt(process.env.QA_REVERB_PORT ?? '8080')
const APP_KEY     = process.env.QA_REVERB_KEY   ?? 'dawdle-key'

export class VirtualClient {
    constructor(displayName) {
        this.guestId     = crypto.randomUUID()
        this.displayName = displayName
        this._events     = []
        this._pusher     = null
        this._channel    = null
    }

    async api(method, path, body = null) {
        const url     = `${APP_URL}/api/v1${path}`
        const headers = {
            'X-Guest-ID': this.guestId,
            'Accept':     'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(this._pusher?.connection?.socket_id
                ? { 'X-Socket-ID': this._pusher.connection.socket_id }
                : {}),
        }
        const res  = await fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
            const err    = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`)
            err.status   = res.status
            err.data     = data
            throw err
        }
        return data
    }

    connect(roomId) {
        return new Promise((resolve, reject) => {
            const pusher = new Pusher(APP_KEY, {
                cluster:            'mt1',
                wsHost:             REVERB_HOST,
                wsPort:             REVERB_PORT,
                wssPort:            REVERB_PORT,
                forceTLS:           false,
                enabledTransports:  ['ws'],
                authEndpoint:       `${APP_URL}/broadcasting/auth`,
                auth: {
                    headers: {
                        'X-Guest-ID': this.guestId,
                        'Accept':     'application/json',
                    },
                },
            })

            const channel = pusher.subscribe(`presence-room.${roomId}`)

            channel.bind('pusher:subscription_succeeded', () => {
                this._pusher  = pusher
                this._channel = channel
                channel.bind_global((event, data) => {
                    if (!event.startsWith('pusher:')) {
                        this._events.push({ event, data, at: Date.now() })
                    }
                })
                resolve()
            })

            channel.bind('pusher:subscription_error', (err) => {
                reject(new Error(`WS subscription failed for ${this.displayName}: ${JSON.stringify(err)}`))
            })

            setTimeout(() => reject(new Error(`WS connect timeout for ${this.displayName}`)), 10_000)
        })
    }

    subscribePrivate(channelName) {
        return new Promise((resolve, reject) => {
            const ch = this._pusher.subscribe(`private-${channelName}`)
            ch.bind('pusher:subscription_succeeded', () => {
                ch.bind_global((event, data) => {
                    if (!event.startsWith('pusher:')) {
                        this._events.push({ event, data, at: Date.now() })
                    }
                })
                resolve(ch)
            })
            ch.bind('pusher:subscription_error', (err) => {
                reject(new Error(`Private channel subscription failed: ${JSON.stringify(err)}`))
            })
            setTimeout(() => reject(new Error(`Private channel subscribe timeout: ${channelName}`)), 5_000)
        })
    }

    waitForEvent(name, timeoutMs = 5_000, afterIndex = 0) {
        const start = Date.now()
        return new Promise((resolve, reject) => {
            const check = () => {
                const found = this._events.slice(afterIndex).find(e => e.event === name)
                if (found) return resolve(found.data)
                if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout (${timeoutMs}ms) waiting for: ${name}`))
                setTimeout(check, 50)
            }
            check()
        })
    }

    eventCount() { return this._events.length }

    getEvents(name = null) {
        return name ? this._events.filter(e => e.event === name) : [...this._events]
    }

    get socketId() { return this._pusher?.connection?.socket_id ?? null }

    disconnect() {
        try { this._pusher?.disconnect() } catch {}
    }
}
