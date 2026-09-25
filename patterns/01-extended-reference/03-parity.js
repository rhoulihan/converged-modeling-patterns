// ============================================================================
// Pattern 01 · Extended Reference · CROSS-API PARITY (mongosh) — the flagship proof
// "One truth, many shapes." The SAME projected client document, read TWO ways:
//   * SQL lane   — SELECT ... FROM xr_client_dv (injected as $SQL_RESULT by run.sh)
//   * Mongo lane — db.xr_client_dv.findOne({_id:"C-001"}) over the Mongo wire
// Asserts the documents are byte-equal after canonicalizing JSON and ignoring the
// duality _metadata (etag/asof). Exits non-zero on mismatch.
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

const viaMongo = db.xr_client_dv.findOne({ _id: "C-001" });
if (!viaMongo) { print("[FAIL] MongoDB API returned no document for C-001 (is xr_client_dv exposed?)"); quit(1); }

if (!eq(viaSql, viaMongo)) {
  print("[FAIL] cross-API document mismatch for client C-001");
  print("  SQL  lane: " + JSON.stringify(canon(viaSql)));
  print("  Mongo lane: " + JSON.stringify(canon(viaMongo)));
  quit(1);
}
print("[PASS] xr_client_dv document byte-equal across SQL and MongoDB API (C-001)");
print("       advisor.office via Mongo lane = " + viaMongo.advisor.office + " (projected, not copied)");
quit(0);
