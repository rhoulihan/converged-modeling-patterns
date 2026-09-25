// ============================================================================
// Pattern 03 · Bucket · THE DOCUMENT MODEL in the MongoDB lane (mongosh)
// The $push bucket: each reading grows the bucket document and re-updates its
// counters, so the storage engine re-serializes the WHOLE (growing) document on
// every append — the canonical write-amplification. Runnable illustration.
// Run via run.sh (Mongo lane) or:  mongosh "<uri>" --file 01-document-model.js
// ============================================================================
const C = db.bk_bucket_js;
C.drop();

// One bucket per machine per hour; starts empty.
C.insertOne({ _id: "M-100|TEMP|2026-08-01T10", machineId: "M-100", metric: "TEMP",
              hourStart: "2026-08-01T10:00:00Z", count: 0, sum: 0, max: null, readings: [] });

// Readings arrive. Each one is a $push + counter update — one whole-document
// rewrite per reading. On a hot sensor this bucket marches at the 16 MB ceiling.
const arrivals = [
  { ts: "2026-08-01T10:00:05Z", val: 88.4 },
  { ts: "2026-08-01T10:00:10Z", val: 89.1 },
  { ts: "2026-08-01T10:00:15Z", val: 91.7 }
];
for (const r of arrivals) {
  C.updateOne({ _id: "M-100|TEMP|2026-08-01T10" },
              { $push: { readings: { ts: r.ts, val: r.val } },
                $inc:  { count: 1, sum: r.val },
                $max:  { max: r.val } });
}

const b = C.findOne({ _id: "M-100|TEMP|2026-08-01T10" });
print(`bucket after ${b.count} appends: sum=${b.sum} max=${b.max} ` +
      `(each append re-serialized the whole document)`);

// Sanity: the maintained counters reflect the three readings.
const okCount = b.count === 3;
const okMax   = Math.abs(b.max - 91.7) < 1e-9;
const okSum   = Math.abs(b.sum - 269.2) < 1e-6;
if (!(okCount && okMax && okSum)) {
  print(`[FAIL] bucket counters wrong: count=${b.count} sum=${b.sum} max=${b.max}`);
  quit(1);
}
print("[OK] document-model bucket built (write-amp illustration)");
