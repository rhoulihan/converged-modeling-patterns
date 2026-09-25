-- ============================================================================
-- Pattern 04 · Subset (hot inline / vertical partition) · THE DOCUMENT MODEL
-- Industry: insurance. Access pattern: the policy page shows the 3 most recent
-- claims instantly; the full claim history is opened rarely.
--
-- The document move: keep the hot subset (recent N claims) INLINE on the policy
-- doc so the common read touches one document, and push the cold tail into a
-- separate history collection. Keep the working set in RAM.
--
-- THE WRITE-AMPLIFICATION COST: to keep the inline subset "recent," EVERY new
-- claim must push into the inline array, TRIM the array back to N, AND insert the
-- full claim into the overflow collection -- two writes, plus a whole-document
-- rewrite of the policy, on every claim. You are paying a maintenance write on
-- every claim to serve a full-history read that hardly ever happens. Writes are
-- heavy; the read you optimized for is rare. That is the needle pointing the
-- wrong way.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables
            WHERE table_name IN ('SB_POLICY_DOC','SB_CLAIM_HISTORY')
            ORDER BY table_name) LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

-- sb_policy_doc = policy + inline recent claims (hot); sb_claim_history = cold overflow.
CREATE JSON COLLECTION TABLE sb_policy_doc;
CREATE JSON COLLECTION TABLE sb_claim_history;

-- Policy P-001 with 3 recent claims inline (oldest -> newest).
INSERT INTO sb_policy_doc VALUES (JSON('{"_id":"P-001","holder":"Dana Holder","product":"AUTO",
  "recentClaims":[
    {"claimId":"CL-1001","amount":800},
    {"claimId":"CL-1002","amount":1500},
    {"claimId":"CL-1003","amount":2300}]}'));
COMMIT;

-- A new claim CL-1004 arrives. To keep the inline subset at N=3 you must:
--   (a) append it to the inline array, (b) trim the oldest, (c) write the full
--   claim to the overflow collection. Three writes for one claim.
-- (a) append newest + (b) trim oldest: rewrites the whole policy document.
UPDATE sb_policy_doc
SET data = JSON_TRANSFORM(data,
             APPEND '$.recentClaims' = JSON_OBJECT('claimId' VALUE 'CL-1004', 'amount' VALUE 4200),
             REMOVE '$.recentClaims[0]')
WHERE JSON_VALUE(data,'$._id') = 'P-001';
-- (c) the full claim also goes to the overflow collection: the second write.
INSERT INTO sb_claim_history VALUES (JSON('{"_id":"CL-1004","policyId":"P-001","amount":4200}'));
COMMIT;

-- The common read the pattern optimizes for: recent claims, one document.
SELECT JSON_VALUE(data,'$._id') AS policy,
       JSON_QUERY(data,'$.recentClaims') AS recent_claims_inline
FROM   sb_policy_doc WHERE JSON_VALUE(data,'$._id') = 'P-001';
