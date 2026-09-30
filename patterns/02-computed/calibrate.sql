-- Calibration resize for Measure it: subscriber S-001 carries :n CDR line items on BOTH
-- sides, generated exactly as the lab's setup generates its 1,000.
-- Document model: rebuild the S-001 document with :n usage[] items and a matching rollup.
DELETE FROM cp_subscriber_doc WHERE JSON_VALUE(data, '$._id') = 'S-001';
INSERT INTO cp_subscriber_doc
SELECT JSON_OBJECT('_id' VALUE 'S-001', 'msisdn' VALUE '+1-202-555-0111', 'plan' VALUE 'UNLIMITED',
         'cycleUsage' VALUE JSON_OBJECT('totalMB' VALUE total_mb, 'totalMin' VALUE total_min, 'cost' VALUE total_cost),
         'usage' VALUE usage RETURNING JSON)
FROM  (SELECT SUM(mb) AS total_mb, SUM(mins) AS total_min, SUM(cost) AS total_cost,
              JSON_ARRAYAGG(JSON_OBJECT('cdrId' VALUE k, 'ts' VALUE ts, 'mb' VALUE mb, 'min' VALUE mins, 'cost' VALUE cost)
                            ORDER BY k RETURNING JSON) AS usage
       FROM  (SELECT LEVEL AS k,
                     50 + MOD(LEVEL * 37, 200)                  AS mb,
                     1 + MOD(LEVEL * 13, 30)                    AS mins,
                     ROUND((1 + MOD(LEVEL * 13, 30)) * 0.03, 2) AS cost,
                     TIMESTAMP '2026-09-01 00:00:00' + NUMTODSINTERVAL(LEVEL * 40, 'MINUTE') AS ts
              FROM   dual CONNECT BY LEVEL <= :n));
-- Converged: :n CDR rows for S-001; zero the summary first so the trigger rebuilds it.
DELETE FROM cp_cdr WHERE subscriber_id = 'S-001';
UPDATE cp_subscriber_usage SET total_mb = 0, total_min = 0, cost = 0 WHERE subscriber_id = 'S-001';
INSERT INTO cp_cdr (subscriber_id, mb, minutes, cost, cdr_ts)
SELECT 'S-001',
       50 + MOD(LEVEL * 37, 200),
       1 + MOD(LEVEL * 13, 30),
       ROUND((1 + MOD(LEVEL * 13, 30)) * 0.03, 2),
       TIMESTAMP '2026-09-01 00:00:00' + NUMTODSINTERVAL(LEVEL * 40, 'MINUTE')
FROM   dual CONNECT BY LEVEL <= :n;
COMMIT;
