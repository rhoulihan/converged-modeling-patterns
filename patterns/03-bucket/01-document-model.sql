-- ============================================================================
-- Pattern 03 · Bucket (time-series) · THE DOCUMENT MODEL (the starting point)
-- Industry: manufacturing / IoT. Access pattern: ingest millions of tiny sensor
-- readings; read back per-machine, per-hour summaries.
--
-- The document move: don't store a document per reading (millions of tiny docs).
-- Group them into a bucket doc per sensor per hour, push each reading into an
-- array, and keep running counters on the bucket. Fewer, fatter documents, and a
-- one-document dashboard read. The read side is genuinely good.
--
-- THE WRITE-AMPLIFICATION COST -- this is THE textbook write-amp pattern. Each
-- reading is an array $push PLUS a counter re-update: a read-modify-write of the
-- WHOLE bucket document, on every single append. The bucket only grows, so the
-- redo each append costs grows with it all cycle -- and a hot sensor marches its bucket
-- straight at the 16 MB document ceiling, where writes simply start failing.
-- The readings themselves are immutable facts; the amplification comes from the
-- mutable bucket wrapped around them. Slow sensors (below ~900 readings a bucket,
-- e.g. one a minute) are where this shape still wins.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables WHERE table_name = 'BK_SENSOR_DOC') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE bk_sensor_doc;
-- The equivalent of MongoDB's built-in _id index, so SQL lookups by _id are key lookups.
CREATE INDEX bk_ix_doc_id ON bk_sensor_doc (JSON_VALUE(data, '$._id'));

-- One bucket: machine M-100, metric TEMP, hour starting 10:00. It already holds
-- the hour's first 30 readings (the same 30 the converged model stores as rows), so
-- Measure it samples a bucket mid-hour rather than the hour's very first writes.
INSERT INTO bk_sensor_doc
SELECT JSON_OBJECT('_id' VALUE 'M-100|TEMP|2026-08-01T10', 'machineId' VALUE 'M-100', 'metric' VALUE 'TEMP',
         'hourStart' VALUE '2026-08-01T10:00:00Z',
         'count' VALUE cnt, 'sum' VALUE total, 'max' VALUE mx, 'readings' VALUE readings
         RETURNING JSON)
FROM  (SELECT COUNT(*) AS cnt, SUM(val) AS total, MAX(val) AS mx,
              JSON_ARRAYAGG(JSON_OBJECT('ts' VALUE ts, 'val' VALUE val) ORDER BY k RETURNING JSON) AS readings
       FROM  (SELECT LEVEL AS k, 80 + MOD(LEVEL * 7, 150) / 10 AS val,
                     TO_CHAR(TIMESTAMP '2026-08-01 10:01:00' + NUMTODSINTERVAL(LEVEL, 'SECOND'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts
              FROM   dual CONNECT BY LEVEL <= 30));
COMMIT;

-- Three readings arrive. Each one PUSHES to the array AND re-updates the
-- counters -- each one a read-modify-write of the whole (growing) bucket document.
-- @step Ingest three readings into the bucket
-- @note Each reading is an array APPEND plus a counter update: a read-modify-write of the WHOLE (growing) bucket, once per reading.
-- @why Update locality is the hot knob: every reading lands on the same bucket, so each append is a read-modify-write of every reading already in it. Bytes moved per hour grow with the square of the readings.
-- @look The PL/SQL block completes with no row count; Measure it shows what its 3 whole-bucket rewrites cost next to 3 row inserts.
-- @figure doc-shape.svg The sensor-hour bucket as built: counters and an array that every reading rewrites
-- @mongo db.bk_sensor_doc.updateOne(
-- @mongo   { _id: "M-100|TEMP|2026-08-01T10" },
-- @mongo   { $push: { readings: { $each: [
-- @mongo       { ts: "2026-08-01T10:00:05Z", val: 88.4 },
-- @mongo       { ts: "2026-08-01T10:00:10Z", val: 89.1 },
-- @mongo       { ts: "2026-08-01T10:00:15Z", val: 91.7 } ] } },
-- @mongo     $inc:  { count: 3, sum: 269.2 },
-- @mongo     $max:  { max: 91.7 } }
-- @mongo )
-- @measure ingest-reading
BEGIN
  FOR v IN (SELECT * FROM (
              SELECT 88.4 val, '2026-08-01T10:00:05Z' ts FROM dual UNION ALL
              SELECT 89.1 val, '2026-08-01T10:00:10Z' ts FROM dual UNION ALL
              SELECT 91.7 val, '2026-08-01T10:00:15Z' ts FROM dual)) LOOP
    UPDATE bk_sensor_doc
    SET data = JSON_TRANSFORM(data,
                 APPEND '$.readings' = JSON_OBJECT('ts' VALUE v.ts, 'val' VALUE v.val),
                 SET '$.count' = JSON_VALUE(data,'$.count' RETURNING NUMBER) + 1,
                 SET '$.sum'   = JSON_VALUE(data,'$.sum'   RETURNING NUMBER) + v.val,
                 SET '$.max'   = GREATEST(NVL(JSON_VALUE(data,'$.max' RETURNING NUMBER), v.val), v.val))
    WHERE JSON_VALUE(data,'$._id') = 'M-100|TEMP|2026-08-01T10';
  END LOOP;
END;
/
COMMIT;
-- ^ 3 whole-document rewrites for 3 readings. At real cadence the bucket is
--   rewritten on every tick and only gets more expensive as it fills.

-- The read the pattern optimizes for: one bucket, counters already there.
-- @step Read the bucket (counters already there)
-- @measure-read read
-- @note One document, running counters already maintained: cheap, until the bucket has to grow again.
-- @why Read/write is the bucket's case: a dashboard that reads the hour 360 times gets one contiguous document with the counters already computed. Below about 900 readings a bucket, that read win beats the rewrites.
-- @look n, avg_temp and max_temp come straight off the counters, with no pass over the readings array.
-- @mongo db.bk_sensor_doc.aggregate([
-- @mongo   { $match: { _id: "M-100|TEMP|2026-08-01T10" } },
-- @mongo   { $project: { _id: 0, machine: "$machineId", n: "$count",
-- @mongo                 avg_temp: { $round: [ { $divide: [ "$sum", "$count" ] }, 3 ] },
-- @mongo                 max_temp: "$max" } }
-- @mongo ])
SELECT JSON_VALUE(data,'$.machineId') AS machine,
       JSON_VALUE(data,'$.count' RETURNING NUMBER) AS n,
       ROUND(JSON_VALUE(data,'$.sum' RETURNING NUMBER)
             / JSON_VALUE(data,'$.count' RETURNING NUMBER), 3) AS avg_temp,
       JSON_VALUE(data,'$.max' RETURNING NUMBER) AS max_temp
FROM   bk_sensor_doc
WHERE  JSON_VALUE(data,'$._id') = 'M-100|TEMP|2026-08-01T10';
