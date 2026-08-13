// DB-backed rate limiter. Unlike an in-memory Map, this survives serverless
// cold starts and is shared across all lambda instances, so the limit is
// actually enforced under concurrency.
//
// The claim is atomic: a single INSERT ... ON CONFLICT either creates the row
// (first request) or updates last_at ONLY if the window has elapsed. RETURNING
// yields a row exactly when the action is allowed; an empty result means the
// caller is still inside the window. Concurrent requests are serialized by
// Postgres row locking, so two simultaneous posts can't both slip through.
export async function checkRateLimit(sql, ip, action, windowMinutes) {
  await sql`
    CREATE TABLE IF NOT EXISTS rate_limits (
      ip      TEXT NOT NULL,
      action  TEXT NOT NULL,
      last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ip, action)
    )
  `;
  const rows = await sql`
    INSERT INTO rate_limits (ip, action, last_at)
    VALUES (${ip}, ${action}, now())
    ON CONFLICT (ip, action)
    DO UPDATE SET last_at = now()
    WHERE rate_limits.last_at < now() - (${windowMinutes} * interval '1 minute')
    RETURNING ip
  `;
  return rows.length > 0;
}
