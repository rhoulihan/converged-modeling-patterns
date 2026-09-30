-- Calibration resize for Measure it. x = readings in the M-100 / TEMP / 10:00 bucket AFTER
-- the measured write (the lab bucket starts empty and the measured write adds 3, so lab x = 3).
-- Both sides are pre-loaded with :n - 3 readings for that machine-hour (none when :n = 3).
-- Document model: rebuild the bucket with :n - 3 readings and matching counters.
DELETE FROM bk_sensor_doc WHERE JSON_VALUE(data, '$._id') = 'M-100|TEMP|2026-08-01T10';
INSERT INTO bk_sensor_doc
SELECT JSON_OBJECT('_id' VALUE 'M-100|TEMP|2026-08-01T10', 'machineId' VALUE 'M-100', 'metric' VALUE 'TEMP',
         'hourStart' VALUE '2026-08-01T10:00:00Z',
         'count' VALUE cnt, 'sum' VALUE NVL(total, 0), 'max' VALUE mx,
         'readings' VALUE COALESCE(readings, JSON_ARRAY(RETURNING JSON))
         RETURNING JSON)
FROM  (SELECT COUNT(*) AS cnt, SUM(val) AS total, MAX(val) AS mx,
              JSON_ARRAYAGG(JSON_OBJECT('ts' VALUE ts, 'val' VALUE val) ORDER BY k RETURNING JSON) AS readings
       FROM  (SELECT k, 80 + MOD(k * 7, 150) / 10 AS val,
                     TO_CHAR(TIMESTAMP '2026-08-01 10:00:00' + NUMTODSINTERVAL(k, 'SECOND'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts
              FROM  (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= :n)
              WHERE  k <= :n - 3));
-- Converged: the same :n - 3 readings as rows in that hour's partition.
DELETE FROM bk_sensor_readings
WHERE  machine_id = 'M-100' AND metric = 'TEMP'
AND    reading_ts >= TIMESTAMP '2026-08-01 10:00:00' AND reading_ts < TIMESTAMP '2026-08-01 11:00:00';
INSERT INTO bk_sensor_readings (machine_id, metric, reading_val, reading_ts)
SELECT 'M-100', 'TEMP', 80 + MOD(k * 7, 150) / 10, TIMESTAMP '2026-08-01 10:00:00' + NUMTODSINTERVAL(k, 'SECOND')
FROM  (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= :n)
WHERE  k <= :n - 3;
COMMIT;
