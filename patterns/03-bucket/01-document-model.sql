-- ============================================================================
-- Pattern 03 · Bucket (time-series) · THE DOCUMENT MODEL (the starting point)
-- Industry: manufacturing / IoT. Access pattern: ingest millions of tiny sensor
-- readings; read back per-machine, per-hour summaries.
--
-- The document move: don't store a document per reading (millions of tiny docs).
-- Group them into a bucket doc per machine per hour, push each reading into an
-- array, and keep running counters on the bucket. Fewer, fatter documents.
--
-- THE WRITE-AMPLIFICATION COST -- this is THE canonical write-amp pattern. Each
-- reading is an array $push PLUS a counter re-update, and because the storage
-- engine never edits a block in place, the ENTIRE growing bucket page is
-- re-serialized into a new block on every single append. The bucket only grows,
-- so the rewrite cost climbs all cycle -- and a hot sensor marches its bucket
-- straight at the 16 MB document ceiling, where writes simply start failing.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables WHERE table_name = 'BK_SENSOR_DOC') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE bk_sensor_doc;

-- One bucket: machine M-100, metric TEMP, hour starting 10:00. Starts small.
INSERT INTO bk_sensor_doc VALUES (JSON('{"_id":"M-100|TEMP|2026-08-01T10",
  "machineId":"M-100","metric":"TEMP","hourStart":"2026-08-01T10:00:00Z",
  "count":0,"sum":0,"max":null,"readings":[]}'));
COMMIT;

-- Three readings arrive. Each one PUSHES to the array AND re-updates the
-- counters -- and each re-serializes the whole (growing) bucket document.
-- @step Ingest three readings into the bucket
-- @note Each reading is an array APPEND plus a counter update — the storage engine re-serializes the WHOLE (growing) bucket on every append.
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
--   re-serialized on every tick and only gets more expensive as it fills.

-- The read the pattern optimizes for: one bucket, counters already there.
-- @step Read the bucket (counters already there)
-- @note One document, running counters already maintained — cheap, until the bucket has to grow again.
SELECT JSON_VALUE(data,'$.machineId') AS machine,
       JSON_VALUE(data,'$.count' RETURNING NUMBER) AS n,
       ROUND(JSON_VALUE(data,'$.sum' RETURNING NUMBER)
             / JSON_VALUE(data,'$.count' RETURNING NUMBER), 3) AS avg_temp,
       JSON_VALUE(data,'$.max' RETURNING NUMBER) AS max_temp
FROM   bk_sensor_doc
WHERE  JSON_VALUE(data,'$._id') = 'M-100|TEMP|2026-08-01T10';
