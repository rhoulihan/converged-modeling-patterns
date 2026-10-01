-- ============================================================================
-- Pattern 04 · Subset (hot inline / vertical partition) · THE CONVERGED ALTERNATIVE
-- "Stop maintaining the subset. Query it."
--
-- The canonical form is policy, claim and claim event; a claim event is an
-- immutable fact recorded once. Here it is projected as rows on ONE claims
-- table: hot and cold live together. A composite index on
-- (policy_id, claim_ts DESC) makes "the recent N" an index range scan that stops
-- after N rows: no maintenance rewrite, no history collection, no trimming. Every
-- claim is one insert plus one index entry; the "recent" slice is derived on
-- read, not maintained on write. SQL/JSON assembles the same policy document
-- (policy header plus its recent claims) at read time, so hot and cold are
-- reunited by the query, never by a maintenance job.
--
-- The tradeoff: each write drops from a document rewrite plus a history insert
-- to one plain insert, and the rarer full-history read is the same query without
-- the FETCH FIRST. The price is the read: the summary now does more work than a
-- single document fetch (~25% in the deck's model). Below ~83k events/day the
-- subset is cheaper; a 300k-event catastrophe day is where querying wins. If the
-- inline slice is frozen at write time (the coverages on the declarations page),
-- keep it in the document. The subset stops being state you maintain and becomes
-- a projected shape you ask for.
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
-- CL-1004 is just one plain insert -- no trim, no history write, no doc rewrite.
-- @step Insert claim CL-1004
-- @note One plain insert: no trim, no history write, no policy document to rewrite.
-- @why Update locality stops concentrating: the claim is one row and one index entry, with no policy document to rewrite and no history to keep in step. On a CAT day that is 300,000 inserts, not 300,000 policy rewrites.
-- @look Rows affected is 1; Measure it shows redo near 1 KB whatever the size of the inline list.
-- @figure erd.svg Policy, claim and claim event in canonical form, beside how one claim event lands in the subset model
-- @measure claim-event
-- @mongo db.aggregate([{ $sql: `
-- @mongo   INSERT INTO sb_claims VALUES ('CL-1004','P-001',4200, TIMESTAMP '2026-08-01 09:00:00')
-- @mongo ` }])
INSERT INTO sb_claims VALUES ('CL-1004','P-001',4200, TIMESTAMP '2026-08-01 09:00:00');
COMMIT;

-- The hot read: recent 3 claims = index range scan on sb_ix_claims_recent + FETCH
-- FIRST. Nothing was maintained to make this fast; the read pays for a short scan instead. (EXPLAIN PLAN shows the range
-- scan stops after 3 rows -- no sort of the full history.)
-- @step Read the recent 3 claims (index range scan)
-- @note CL-1004 is already the top row: nothing was maintained to make this fast, the index just stops after 3.
-- @why Read/write, priced honestly: the recent list is an index range scan that stops after 3 rows, more work than one document fetch, about 25% more per summary read in the deck's model.
-- @look The 3 newest claims in claim_ts order, with nothing stored to keep them current.
-- @mongo db.aggregate([{ $sql: `
-- @mongo   SELECT claim_id, amount, claim_ts
-- @mongo   FROM   sb_claims
-- @mongo   WHERE  policy_id = 'P-001'
-- @mongo   ORDER  BY claim_ts DESC
-- @mongo   FETCH  FIRST 3 ROWS ONLY
-- @mongo ` }])
SELECT claim_id, amount, claim_ts
FROM   sb_claims
WHERE  policy_id = 'P-001'
ORDER  BY claim_ts DESC
FETCH  FIRST 3 ROWS ONLY;

-- The full policy document -- hot + cold reunited AT READ TIME by SQL/JSON. No
-- inline subset stored, no history collection to keep in step.
-- @step Assemble the full policy document at read time
-- @note Header plus recent claims, reunited by the query: no inline subset stored, no history collection to keep in step.
-- @why Diversity: agents get the policy document they had, assembled by SQL/JSON, and adjusters get the full history from the same rows by dropping FETCH FIRST.
-- @look policy_document shows the header with recentClaims newest first, built by the query rather than stored.
-- @mongo db.aggregate([{ $sql: `
-- @mongo   SELECT JSON_OBJECT(
-- @mongo            'policyId' VALUE p.policy_id,
-- @mongo            'holder'   VALUE p.holder,
-- @mongo            'product'  VALUE p.product,
-- @mongo            'recentClaims' VALUE (
-- @mongo               SELECT JSON_ARRAYAGG(
-- @mongo                        JSON_OBJECT('claimId' VALUE claim_id, 'amount' VALUE amount,
-- @mongo                                    'ts' VALUE TO_CHAR(claim_ts,'YYYY-MM-DD'))
-- @mongo                        ORDER BY claim_ts DESC RETURNING CLOB)
-- @mongo               FROM ( SELECT claim_id, amount, claim_ts FROM sb_claims
-- @mongo                      WHERE policy_id = p.policy_id
-- @mongo                      ORDER BY claim_ts DESC FETCH FIRST 3 ROWS ONLY ))
-- @mongo            RETURNING CLOB) AS policy_document
-- @mongo   FROM   sb_policies p
-- @mongo   WHERE  p.policy_id = 'P-001'
-- @mongo ` }])
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
