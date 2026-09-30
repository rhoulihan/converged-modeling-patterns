-- ============================================================================
-- Pattern 02 · Computed · THE DOCUMENT MODEL (the starting point)
-- Industry: telecom. Access pattern: show a subscriber's current-cycle usage
-- (total MB, minutes, cost) instantly on the account page — and rank the top
-- talkers for the ops dashboard.
--
-- The document move: bake the rollup onto the subscriber doc. Compute once on
-- write, read a thousand times for free. Mongo's own math: 1M reads/hr vs 1K
-- writes/hr => "compute on write divides work by 1000."
--
-- THE WRITE-AMPLIFICATION COST: usage is not written once. Every Call Detail
-- Record (CDR) appends a line item to the subscriber's usage[] and re-ticks the
-- rollup, and each one is a read-modify-write of the WHOLE subscriber document.
-- The document grows with every call, so the redo per CDR grows with it: here
-- S-001 already carries 1,000 CDR line items this cycle. The pattern's own escape
-- hatch for a hot subscriber -- counter-sharding (split into N docs, fan the read
-- back in) -- leaves the write amp exactly where it was. And the Top-N dashboard
-- has no rollup to lean on across subscribers: it must SUM -> SORT -> LIMIT over
-- the collection every load.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables WHERE table_name = 'CP_SUBSCRIBER_DOC') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE cp_subscriber_doc;

-- S-001 mid-cycle: 1,000 prior CDR line items in usage[] (~70 KB of JSON), with
-- the baked cycleUsage rollup equal to their sums. Generated, not pasted.
INSERT INTO cp_subscriber_doc
SELECT JSON_OBJECT('_id' VALUE 'S-001', 'msisdn' VALUE '+1-202-555-0111', 'plan' VALUE 'UNLIMITED',
         'cycleUsage' VALUE JSON_OBJECT('totalMB' VALUE total_mb, 'totalMin' VALUE total_min, 'cost' VALUE total_cost),
         'usage' VALUE usage RETURNING JSON)
FROM  (SELECT SUM(mb) AS total_mb, SUM(mins) AS total_min, SUM(cost) AS total_cost,
              JSON_ARRAYAGG(JSON_OBJECT('cdrId' VALUE n, 'ts' VALUE ts, 'mb' VALUE mb, 'min' VALUE mins, 'cost' VALUE cost)
                            ORDER BY n RETURNING JSON) AS usage
       FROM  (SELECT LEVEL AS n,
                     50 + MOD(LEVEL * 37, 200)                  AS mb,
                     1 + MOD(LEVEL * 13, 30)                    AS mins,
                     ROUND((1 + MOD(LEVEL * 13, 30)) * 0.03, 2) AS cost,
                     TIMESTAMP '2026-09-01 00:00:00' + NUMTODSINTERVAL(LEVEL * 40, 'MINUTE') AS ts
              FROM   dual CONNECT BY LEVEL <= 1000));
-- S-002 and S-003: one CDR each. Built the same way as S-001, so usage[].ts is
-- the same ISO-8601 string (no zone) in every document and in the appended CDR.
INSERT INTO cp_subscriber_doc
SELECT JSON_OBJECT('_id' VALUE 'S-002', 'msisdn' VALUE '+1-202-555-0122', 'plan' VALUE 'METERED',
         'cycleUsage' VALUE JSON_OBJECT('totalMB' VALUE 50, 'totalMin' VALUE 5, 'cost' VALUE 0.15),
         'usage' VALUE JSON_ARRAY(JSON_OBJECT('cdrId' VALUE 1, 'ts' VALUE TIMESTAMP '2026-09-02 09:00:00',
                                              'mb' VALUE 50, 'min' VALUE 5, 'cost' VALUE 0.15) RETURNING JSON)
         RETURNING JSON)
FROM   dual;
INSERT INTO cp_subscriber_doc
SELECT JSON_OBJECT('_id' VALUE 'S-003', 'msisdn' VALUE '+1-202-555-0133', 'plan' VALUE 'UNLIMITED',
         'cycleUsage' VALUE JSON_OBJECT('totalMB' VALUE 900, 'totalMin' VALUE 40, 'cost' VALUE 2.7),
         'usage' VALUE JSON_ARRAY(JSON_OBJECT('cdrId' VALUE 1, 'ts' VALUE TIMESTAMP '2026-09-03 14:00:00',
                                              'mb' VALUE 900, 'min' VALUE 40, 'cost' VALUE 2.7) RETURNING JSON)
         RETURNING JSON)
FROM   dual;
COMMIT;

-- One CDR arrives for S-001. In the baked-rollup model this is a read-modify-WRITE
-- of the entire subscriber document: append the line item, re-tick the rollup.
-- Do this per CDR, thousands of times a cycle, on your busiest subscribers.
-- @step Post one Call Detail Record for S-001
-- @note Append the line item and re-tick the rollup — a read-modify-write of the WHOLE subscriber document (1,000 prior CDRs), once per CDR.
-- @measure record-cdr
UPDATE cp_subscriber_doc
SET data = JSON_TRANSFORM(data,
             APPEND '$.usage' = JSON_OBJECT('cdrId' VALUE 1001, 'ts' VALUE TIMESTAMP '2026-09-29 18:00:00',
                                            'mb' VALUE 120, 'min' VALUE 12, 'cost' VALUE 0.36),
             SET '$.cycleUsage.totalMB'  = JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) + 120,
             SET '$.cycleUsage.totalMin' = JSON_VALUE(data,'$.cycleUsage.totalMin' RETURNING NUMBER) + 12,
             SET '$.cycleUsage.cost'     = JSON_VALUE(data,'$.cycleUsage.cost' RETURNING NUMBER) + 0.36)
WHERE JSON_VALUE(data,'$._id') = 'S-001';
COMMIT;
-- ^ every CDR => a rewrite of the whole, growing S-001 document. That is the write amplification.

-- The account page read the pattern optimizes for (cheap):
-- @step Read the account page (rollup already there)
-- @note One document, one lookup — the CDR's cost already landed on the write. Shows the line-item count, not the usage[] array itself.
SELECT JSON_VALUE(data,'$._id') AS subscriber,
       JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) AS mb_this_cycle,
       JSON_VALUE(data,'$.usage.size()' RETURNING NUMBER) AS cdrs_in_document
FROM   cp_subscriber_doc
WHERE  JSON_VALUE(data,'$._id') = 'S-001';

-- The Top-N dashboard read the pattern does NOT help (full scan + sort every load):
-- @step Rank the top talkers (full scan + sort)
-- @note No rollup to lean on across subscribers — SUM/SORT/LIMIT the whole collection, every load.
SELECT JSON_VALUE(data,'$._id') AS subscriber,
       JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) AS mb_this_cycle
FROM   cp_subscriber_doc
ORDER  BY JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) DESC
FETCH  FIRST 5 ROWS ONLY;
