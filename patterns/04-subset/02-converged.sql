-- ============================================================================
-- Pattern 04 · Subset (hot inline / vertical partition) · THE CONVERGED ALTERNATIVE
-- "Stop maintaining the subset. Query it."
--
-- There is one claims table -- hot and cold live together. A composite index on
-- (policy_id, claim_ts DESC) makes "the recent N" an index range scan that stops
-- after N rows: O(log n) seek, no maintenance write, no overflow collection, no
-- trimming. Every claim is a single append; the "recent" slice is derived on
-- read, not maintained on write. The full policy document -- policy header plus
-- its recent claims -- is assembled at read time with SQL/JSON, so hot and cold
-- are reunited by the query, never by a maintenance job.
--
-- The needle-flip, resolved: the write goes from three writes + a document
-- rewrite down to one plain insert, and the rare full-history read is just the
-- same query without the FETCH FIRST. The subset stops being state you maintain
-- and becomes a projection you ask for.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @02-converged.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables
            WHERE table_name IN ('SB_CLAIMS','SB_POLICIES')
            ORDER BY table_name) LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' CASCADE CONSTRAINTS PURGE';
  END LOOP;
END;
/

CREATE TABLE sb_policies (
  policy_id VARCHAR2(12)  PRIMARY KEY,
  holder    VARCHAR2(120) NOT NULL,
  product   VARCHAR2(16)  NOT NULL
);

CREATE TABLE sb_claims (
  claim_id  VARCHAR2(12)  PRIMARY KEY,
  policy_id VARCHAR2(12)  NOT NULL REFERENCES sb_policies(policy_id),
  amount    NUMBER(14,2)  NOT NULL,
  claim_ts  TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL
);

-- The index that turns "recent N" into a range scan that stops after N rows.
CREATE INDEX sb_ix_claims_recent ON sb_claims (policy_id, claim_ts DESC);

INSERT INTO sb_policies VALUES ('P-001','Dana Holder','AUTO');
INSERT INTO sb_claims VALUES ('CL-1001','P-001', 800, TIMESTAMP '2026-01-10 09:00:00');
INSERT INTO sb_claims VALUES ('CL-1002','P-001',1500, TIMESTAMP '2026-03-22 09:00:00');
INSERT INTO sb_claims VALUES ('CL-1003','P-001',2300, TIMESTAMP '2026-05-30 09:00:00');
-- CL-1004 is just one plain insert -- no trim, no overflow write, no doc rewrite.
-- @step Insert claim CL-1004
-- @note One plain insert — no trim, no overflow write, no policy document to rewrite.
-- @measure claim-event
INSERT INTO sb_claims VALUES ('CL-1004','P-001',4200, TIMESTAMP '2026-08-01 09:00:00');
COMMIT;

-- The hot read: recent 3 claims = index range scan on sb_ix_claims_recent + FETCH
-- FIRST. Nothing was maintained to make this fast. (EXPLAIN PLAN shows the range
-- scan stops after 3 rows -- no sort of the full history.)
-- @step Read the recent 3 claims (index range scan)
-- @note CL-1004 is already the top row — nothing was maintained to make this fast, the index just stops after 3.
SELECT claim_id, amount, claim_ts
FROM   sb_claims
WHERE  policy_id = 'P-001'
ORDER  BY claim_ts DESC
FETCH  FIRST 3 ROWS ONLY;

-- The full policy document -- hot + cold reunited AT READ TIME by SQL/JSON. No
-- inline subset stored, no overflow collection to keep in step.
-- @step Assemble the full policy document at read time
-- @note Header plus recent claims, reunited by the query — no inline subset stored, no overflow collection to keep in step.
SELECT JSON_OBJECT(
         'policyId' VALUE p.policy_id,
         'holder'   VALUE p.holder,
         'product'  VALUE p.product,
         'recentClaims' VALUE (
            SELECT JSON_ARRAYAGG(
                     JSON_OBJECT('claimId' VALUE claim_id, 'amount' VALUE amount,
                                 'ts' VALUE TO_CHAR(claim_ts,'YYYY-MM-DD'))
                     ORDER BY claim_ts DESC RETURNING CLOB)
            FROM ( SELECT claim_id, amount, claim_ts FROM sb_claims
                   WHERE policy_id = p.policy_id
                   ORDER BY claim_ts DESC FETCH FIRST 3 ROWS ONLY ))
         RETURNING CLOB) AS policy_document
FROM   sb_policies p
WHERE  p.policy_id = 'P-001';
