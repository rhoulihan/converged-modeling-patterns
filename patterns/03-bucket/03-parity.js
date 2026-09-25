// ============================================================================
// Pattern 03 · Bucket · CROSS-LANE PARITY (mongosh)
// Proves the hourly rollup is identical whether issued through SQL*Plus (the SQL
// lane's 02-converged.sql GROUP BY, injected as $SQL_RESULT by run.sh) or through
// the Oracle API for MongoDB via a $sql-in-pipeline stage. Same machine/hour, same
// COUNT/AVG/MAX. Exits non-zero on any mismatch.
// ============================================================================

// --- canonicalize: sort keys, sort arrays, coerce BSON numerics, drop _metadata
function canon(x) {
  if (x === null || x === undefined) return null;
  if (Array.isArray(x)) return x.map(canon).sort((a, b) =>
    JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  if (typeof x === "object") {
    const cn = x.constructor && x.constructor.name;
    if (x._bsontype || /Decimal128|Double|Long|Int32/.test(cn || "")) return Number(x.toString());
    const o = {};
    for (const k of Object.keys(x).sort()) { if (k === "_metadata") continue; o[k] = canon(x[k]); }
    return o;
  }
  if (typeof x === "number") return x;
  return x;
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// SQL lane (from sqlplus, via run.sh) vs Mongo lane ($sql over the wire).
const sqlResult = JSON.parse(process.env.SQL_RESULT || "null");
if (!sqlResult) { print("[FAIL] SQL_RESULT not provided by run.sh"); quit(1); }

const mongoResult = db.aggregate([{ $sql: `
  select json {
           'machineId' : machine_id,
           'metric'    : metric,
           'hourStart' : to_char(trunc(reading_ts,'HH24'),'YYYY-MM-DD"T"HH24'),
           'n'         : count(*),
           'avg'       : round(avg(reading_val),3),
           'max'       : max(reading_val)
         }
  from   bk_sensor_readings
  group  by machine_id, metric, trunc(reading_ts,'HH24')
  order  by machine_id, metric, trunc(reading_ts,'HH24')` }]).toArray();

if (!eq(sqlResult, mongoResult)) {
  print("[FAIL] rollup parity mismatch");
  print("  SQL  lane: " + JSON.stringify(canon(sqlResult)));
  print("  Mongo lane: " + JSON.stringify(canon(mongoResult)));
  quit(1);
}
print(`[PASS] rollup parity: SQL GROUP BY == Mongo $sql (${mongoResult.length} rows, COUNT/AVG/MAX equal)`);

// Extra signal: the converged rollup for M-100/hour-10 equals the hand-maintained
// document-model bucket counters (from 01-document-model.js).
const bucket = db.bk_bucket_js.findOne({ _id: "M-100|TEMP|2026-08-01T10" });
if (bucket) {
  const cell = mongoResult.find(r => r.machineId === "M-100" && r.hourStart === "2026-08-01T10");
  const bAvg = Math.round((bucket.sum / bucket.count) * 1000) / 1000;
  const okN = bucket.count === cell.n, okA = Math.abs(bAvg - cell.avg) < 1e-9, okM = Math.abs(bucket.max - cell.max) < 1e-9;
  if (!(okN && okA && okM)) {
    print(`[FAIL] bucket vs converged mismatch: bucket{n:${bucket.count},avg:${bAvg},max:${bucket.max}} converged{n:${cell.n},avg:${cell.avg},max:${cell.max}}`);
    quit(1);
  }
  print("[PASS] maintained bucket counters == converged GROUP BY (M-100/hour-10)");
}
quit(0);
