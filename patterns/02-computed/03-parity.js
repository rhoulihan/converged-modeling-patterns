// ============================================================================
// Pattern 02 · Computed · CROSS-API PARITY (mongosh)
// The SAME subscriber document — with its live rollup — read through the SQL
// duality view (cp_subscriber_dv, injected as $SQL_RESULT) and through the MongoDB
// API. Byte-equal after canonicalizing JSON and ignoring _metadata. Non-zero exit
// on mismatch.
// ============================================================================
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
  return x;
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const viaSql = JSON.parse(process.env.SQL_RESULT || "null");
if (!viaSql) { print("[FAIL] SQL_RESULT not provided by run.sh"); quit(1); }

const viaMongo = db.cp_subscriber_dv.findOne({ _id: "S-001" });
if (!viaMongo) { print("[FAIL] MongoDB API returned no document for S-001"); quit(1); }

if (!eq(viaSql, viaMongo)) {
  print("[FAIL] cross-API document mismatch for subscriber S-001");
  print("  SQL  lane: " + JSON.stringify(canon(viaSql)));
  print("  Mongo lane: " + JSON.stringify(canon(viaMongo)));
  quit(1);
}
print("[PASS] cp_subscriber_dv document byte-equal across SQL and MongoDB API (S-001)");
print("       cycleUsage.totalMB via Mongo lane = " + viaMongo.cycleUsage.totalMB);
quit(0);
