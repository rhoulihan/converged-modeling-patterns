-- Capture the SQL-lane hourly rollup (the 02-converged.sql GROUP BY) as ONE JSON
-- array string. run.sh runs this via sqlplus and injects the result into the
-- parity .js as $SQL_RESULT, which compares it to the Mongo $sql rollup.
SET HEADING OFF PAGESIZE 0 FEEDBACK OFF VERIFY OFF TRIMSPOOL ON
SET LINESIZE 32767 LONG 100000000 LONGCHUNKSIZE 1000000
SELECT JSON_ARRAYAGG(
         JSON_OBJECT('machineId' VALUE machine_id,
                     'metric'    VALUE metric,
                     'hourStart' VALUE TO_CHAR(hs,'YYYY-MM-DD"T"HH24'),
                     'n'         VALUE n,
                     'avg'       VALUE avg_val,
                     'max'       VALUE max_val)
         ORDER BY machine_id, metric, hs RETURNING CLOB)
FROM ( SELECT machine_id, metric, TRUNC(reading_ts,'HH24') hs,
              COUNT(*) n, ROUND(AVG(reading_val),3) avg_val, MAX(reading_val) max_val
       FROM   bk_sensor_readings
       GROUP  BY machine_id, metric, TRUNC(reading_ts,'HH24') );
