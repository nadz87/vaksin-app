// Sends the emails the database queues in notify.email_outbox (migration 20261030000017):
// parents told that an officer cancelled their child's appointment. The database signals
// "email_outbox" when it queues one, so mail goes out within seconds; a timer catches anything
// missed (service restarted, listener dropped). A row that keeps failing stops after 5 tries
// with its last error kept for the owner to read.
import pg from 'pg'
import type { CancelNotice, Mailer } from './mail.ts'

const BATCH = 20
const MAX_ATTEMPTS = 5

type Row = { id: string; kind: string; to_email: string; payload: CancelNotice }

/** Sends what is waiting; returns how many were sent. Safe to run from several places at once. */
export async function drainOutbox(db: pg.Pool, mailer: Mailer, siteUrl: string): Promise<number> {
  const client = await db.connect()
  let sent = 0
  try {
    await client.query('begin')
    // skip locked: two runs at once never send the same email twice.
    const { rows } = await client.query<Row>(
      `select id, kind, to_email, payload from notify.email_outbox
       where sent_at is null and attempts < $1 order by id limit $2 for update skip locked`,
      [MAX_ATTEMPTS, BATCH],
    )
    for (const row of rows) {
      try {
        if (row.kind !== 'appointment_cancelled') throw new Error(`unknown kind ${row.kind}`)
        await mailer.sendCancelled(row.to_email, row.payload, `${siteUrl}#/book`)
        await client.query('update notify.email_outbox set sent_at = now(), attempts = attempts + 1 where id = $1', [row.id])
        sent++
      } catch (e) {
        await client.query('update notify.email_outbox set attempts = attempts + 1, last_error = $2 where id = $1', [
          row.id,
          String(e instanceof Error ? e.message : e).slice(0, 500),
        ])
      }
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return sent
}

/** Listens for the database signal and checks every minute. Returns a stop function. */
export function startOutbox(databaseUrl: string, db: pg.Pool, mailer: Mailer, siteUrl: string): () => void {
  let running = false
  let again = false
  let stopped = false
  const run = () => {
    if (stopped) return
    if (running) return void (again = true)
    running = true
    drainOutbox(db, mailer, siteUrl)
      .catch((e) => console.error('outbox:', e instanceof Error ? e.message : e))
      .finally(() => {
        running = false
        if (again) {
          again = false
          run()
        }
      })
  }

  let listener: pg.Client | null = null
  const listen = async () => {
    if (stopped) return
    listener = new pg.Client({ connectionString: databaseUrl })
    listener.on('notification', run)
    listener.on('error', (e) => {
      console.error('outbox listener:', e.message)
      listener = null
      setTimeout(listen, 10_000)
    })
    try {
      await listener.connect()
      await listener.query('listen email_outbox')
    } catch (e) {
      console.error('outbox listener:', e instanceof Error ? e.message : e)
      listener?.end().catch(() => {})
      listener = null
      setTimeout(listen, 10_000)
    }
  }

  listen()
  run()
  const timer = setInterval(run, 60_000)
  return () => {
    stopped = true
    clearInterval(timer)
    listener?.end().catch(() => {})
  }
}
