// Coarse global guard for /api/ask. Gemini's free tier is account-wide
// (shared across every visitor), not per-IP, so the per-visitor rate limiter
// in _rateLimit.js isn't enough on its own — this caps total daily volume.
// Same atomic INSERT ... ON CONFLICT ... WHERE ... RETURNING pattern as
// checkRateLimit, so it's safe under concurrent requests.
export async function checkDailyCap(sql, limit = 900) {
  await sql`
    CREATE TABLE IF NOT EXISTS daily_counters (
      day   DATE PRIMARY KEY,
      count INT NOT NULL DEFAULT 0
    )
  `;
  const rows = await sql`
    INSERT INTO daily_counters (day, count)
    VALUES (current_date, 1)
    ON CONFLICT (day)
    DO UPDATE SET count = daily_counters.count + 1
    WHERE daily_counters.count < ${limit}
    RETURNING count
  `;
  return rows.length > 0;
}
