import { query, pool } from '../src/core/db.ts';
const rows = await query<Record<string, unknown>>('SELECT criterion_key, label, metric, required, unit, is_boolean, is_enabled, sort_order FROM monetization_criteria ORDER BY sort_order');
console.log(JSON.stringify(rows, null, 1));
await pool.end();
