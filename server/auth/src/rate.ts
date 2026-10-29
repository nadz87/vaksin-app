// Counters for rate limits and lockouts, kept in auth_private.rate_events.
import type pg from 'pg'

type Queryable = Pick<pg.Pool, 'query'>

/** How many events with this key happened in the last `seconds`. */
export async function recent(db: Queryable, key: string, seconds: number): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from auth_private.rate_events
      where key = $1 and created_at > now() - make_interval(secs => $2)`,
    [key, seconds],
  )
  return rows[0].n
}

export async function record(db: Queryable, ...keys: string[]): Promise<void> {
  await db.query('insert into auth_private.rate_events (key) select unnest($1::text[])', [keys])
}

export async function forget(db: Queryable, key: string): Promise<void> {
  await db.query('delete from auth_private.rate_events where key = $1', [key])
}

/** Old counters and expired codes are no longer needed. Cheap; called now and then. */
export async function tidy(db: Queryable): Promise<void> {
  await db.query(`delete from auth_private.rate_events where created_at < now() - interval '1 day'`)
  await db.query(`delete from auth_private.email_codes where expires_at < now() - interval '1 day'`)
  await db.query(
    `delete from auth_private.sessions where expires_at < now() - interval '7 days'
        or revoked_at < now() - interval '7 days'`,
  )
}
