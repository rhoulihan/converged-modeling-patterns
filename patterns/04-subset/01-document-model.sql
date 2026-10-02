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
-- claim pays twice: a push-and-trim rewrite of the WHOLE policy document, AND an
-- insert of the full claim into the history collection. Two writes, two places,
-- for one fact. The bet is that the summary read dwarfs the claim write, and on a
-- normal day it does (deck: ~2M summary reads vs ~30k events, break-even ~83k
-- events/day). On a catastrophe day (~300k events) the bet loses: the subset
-- costs ~40% more than querying, all of it on the hottest policy documents.
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

-- sb_policy_doc = policy + inline recent claims (hot); sb_claim_history = cold history.
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
--   claim to the history collection. Two writes, two places, for one claim.
-- (a) append newest + (b) trim oldest: one statement that rewrites the whole policy document.
-- @step Push CL-1004 in, trim the oldest claim
-- @note Append plus trim rewrites the WHOLE policy document: the first of two writes for a single new claim.
-- @why Update locality is the hot knob: every claim event lands on the parent policy, and keeping the list recent is a read-modify-write of the whole policy document (append, trim, rewrite) on every event.
-- @look Rows affected is 1; Measure it shows the redo of rewriting the policy next to one claim insert.
-- @figure doc-shape.svg The policy document as built: recent claim events inline, every event also written to a history collection
-- @measure claim-event
-- @mongo db.sb_policy_doc.updateOne(
-- @mongo   { _id: "P-001" },
-- @mongo   [ { $set: { recentClaims: { $slice: [
-- @mongo       { $concatArrays: [ "$recentClaims", [ { claimId: "CL-1004", amount: 4200 } ] ] },
-- @mongo       -3 ] } } } ]
-- @mongo )
UPDATE sb_policy_doc
SET data = JSON_TRANSFORM(data,
             APPEND '$.recentClaims' = JSON_OBJECT('claimId' VALUE 'CL-1004', 'amount' VALUE 4200),
             REMOVE '$.recentClaims[0]')
WHERE JSON_VALUE(data,'$._id') = 'P-001';
-- (c) the full claim also goes to the history collection: the second write.
-- @step Write the full claim to the history collection
-- @note The second write for the same claim: the history collection must be kept in step with the inline subset by hand.
-- @why Update locality again: the same fact lands in a second place, and if this write fails after the first, the summary and the history disagree.
-- @look Rows affected is 1, the second write for a single claim.
-- @mongo db.sb_claim_history.insertOne(
-- @mongo   { _id: "CL-1004", policyId: "P-001", amount: 4200 }
-- @mongo )
INSERT INTO sb_claim_history VALUES (JSON('{"_id":"CL-1004","policyId":"P-001","amount":4200}'));
COMMIT;

-- The common read the pattern optimizes for: recent claims, one document.
-- @step Read the recent claims (one document)
-- @note recentClaims now shows CL-1004 in, CL-1001 trimmed out: two writes paid so this read is one document fetch.
-- @why Read/write is the subset's case: at about 67 summary reads per claim event, the policy page reads one document with the list already built.
-- @look recent_claims_inline holds 3 claims, the list every event paid to keep sorted and trimmed.
-- @mongo db.sb_policy_doc.find(
-- @mongo   { _id: "P-001" },
-- @mongo   { _id: 1, recentClaims: 1 }
-- @mongo )
SELECT JSON_VALUE(data,'$._id') AS policy,
       JSON_QUERY(data,'$.recentClaims') AS recent_claims_inline
FROM   sb_policy_doc WHERE JSON_VALUE(data,'$._id') = 'P-001';
