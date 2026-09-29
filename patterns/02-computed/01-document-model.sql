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
-- Record (CDR) re-ticks the rollup, and each re-tick re-reads and rewrites the
-- WHOLE subscriber document (copy-on-write of the leaf page; OSON re-encode).
-- On a hot subscriber that is a write storm, and the counter becomes a
-- contention hotspot -> the pattern's own escape hatch is counter-sharding
-- (split into N docs, fan the read back in), which leaves the write amp exactly
-- where it was. And the Top-N dashboard has no rollup to lean on across
-- subscribers: it must SUM -> SORT -> LIMIT over the collection every load.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables WHERE table_name = 'CP_SUBSCRIBER_DOC') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE cp_subscriber_doc;

INSERT INTO cp_subscriber_doc VALUES (JSON('{"_id":"S-001","msisdn":"+1-202-555-0111",
  "plan":"UNLIMITED","cycleUsage":{"totalMB":0,"totalMin":0,"cost":0.0}}'));
INSERT INTO cp_subscriber_doc VALUES (JSON('{"_id":"S-002","msisdn":"+1-202-555-0122",
  "plan":"METERED","cycleUsage":{"totalMB":0,"totalMin":0,"cost":0.0}}'));
COMMIT;

-- One CDR arrives for S-001. In the baked-rollup model this is NOT an append —
-- it is a read-modify-WRITE of the entire subscriber document. Do this per CDR,
-- thousands of times a cycle, on your busiest subscribers.
-- @step Post one Call Detail Record for S-001
-- @note Not an append — a read-modify-write of the WHOLE subscriber document, once per CDR.
-- @measure record-cdr
UPDATE cp_subscriber_doc
SET data = JSON_TRANSFORM(data,
             SET '$.cycleUsage.totalMB'  = JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) + 120,
             SET '$.cycleUsage.totalMin' = JSON_VALUE(data,'$.cycleUsage.totalMin' RETURNING NUMBER) + 12,
             SET '$.cycleUsage.cost'     = JSON_VALUE(data,'$.cycleUsage.cost' RETURNING NUMBER) + 0.36)
WHERE JSON_VALUE(data,'$._id') = 'S-001';
COMMIT;
-- ^ every CDR => a full-document rewrite of S-001. That is the write amplification.

-- The account page read the pattern optimizes for (cheap):
-- @step Read the account page (rollup already there)
-- @note One document, one lookup — the CDR's cost already landed on the write.
SELECT JSON_VALUE(data,'$._id') AS subscriber,
       JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) AS mb_this_cycle
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
