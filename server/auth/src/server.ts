// Starts the sign-in service. Configuration: see config.ts (environment variables only).
import { serve } from '@hono/node-server'
import pg from 'pg'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { smtpMailer } from './mail.ts'

const config = loadConfig()
const db = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
const app = createApp({ config, db, mailer: smtpMailer(config) })

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => console.log(`vaksin-auth listening on ${port}`))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close()
    db.end().finally(() => process.exit(0))
  })
}
