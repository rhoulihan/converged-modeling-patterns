// ============================================================================
// Pattern 06 · Outlier · CROSS-API PARITY (mongosh)
// The SAME typical-advisor document (with its embedded client array projected from
// rows) read through the SQL duality view (ol_advisor_dv, injected as $SQL_RESULT)
// and through the MongoDB API. Byte-equal after canonicalizing JSON and ignoring
// _metadata. Non-zero exit on mismatch.
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

// @step Read the projected document over the MongoDB API
// @note Same typical-advisor document the SQL lane read: the client array projects from ol_clients, whichever wire protocol you read it over.
// @why Diversity: the CRM keeps find() over the MongoDB API while the book screen runs its top-N query in SQL over the same client rows, so there is one book and no branch.
// @look The A-001 document's clients array matches the SQL projection, with no hasExtras flag.
// @figure flow.svg Advisor and client tables feed a duality view for document consumers and one top-N query for the book screen
const viaMongo = db.ol_advisor_dv.findOne({ _id: "A-001" });
if (!viaMongo) { print("[FAIL] MongoDB API returned no document for A-001"); quit(1); }

if (!eq(viaSql, viaMongo)) {
  print("[FAIL] cross-API document mismatch for advisor A-001");
  print("  SQL  lane: " + JSON.stringify(canon(viaSql)));
  print("  Mongo lane: " + JSON.stringify(canon(viaMongo)));
  quit(1);
}
print("[PASS] ol_advisor_dv document byte-equal across SQL and MongoDB API (A-001)");
print("       clients projected via Mongo lane = " + viaMongo.clients.length);
quit(0);
