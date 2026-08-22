import { copyFileSync } from 'node:fs'

// The browser loader serves /plugins/<id>/client.js while the Host-side
// client-modules registry resolves exports["./client"] on disk; ship the
// identical bundle under both names so every consumer finds a file.
copyFileSync('client/client.js', 'client/client.cjs')
