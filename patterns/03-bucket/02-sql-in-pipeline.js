// ============================================================================
// Pattern 03 · Bucket · $sql-IN-PIPELINE through the MongoDB API (mongosh)
// The converged hourly rollup, issued as FULL SQL over the Mongo wire protocol via
// Oracle's own $sql aggregation stage: parallel execution, cost-based optimization,
// and NO 100 MB stage / 16 MB output caps. It reads the converged, INTERVAL-
// partitioned bk_sensor_readings table (created by the SQL lane's 02-converged.sql).
// This is the Mongo-lane developer's on-ramp to the converged rollup — no leaving
// the pipeline, no maintaining a bucket.
// ============================================================================
// @step Hourly rollup with $sql in the pipeline
// @note Full SQL over the Mongo wire protocol — parallel execution, cost-based optimization, no 100 MB stage / 16 MB output caps.
// @why Diversity: the anomaly scan keeps its pipeline over the MongoDB API, and the $sql stage hands the rollup to the optimizer with parallel execution and none of the pipeline's stage memory or output caps.
// @look One document per machine and hour with n, avg and max, the same values the SQL GROUP BY returns.
// @figure flow.svg Partitioned readings feed a pruned GROUP BY and a summary view, serving dashboards over SQL and the anomaly job through a $sql stage
const rows = db.aggregate([{ $sql: `
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

print("hourly rollup via $sql-in-pipeline (rows returned over the Mongo wire):");
for (const r of rows) {
  print(`  ${r.machineId} ${r.metric} ${r.hourStart}  n=${r.n} avg=${r.avg} max=${r.max}`);
}
if (rows.length === 0) { print("[FAIL] $sql rollup returned no rows"); quit(1); }
print(`[OK] $sql-in-pipeline returned ${rows.length} rollup rows`);
