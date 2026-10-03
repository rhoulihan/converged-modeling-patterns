-- Calibration resize for Measure it: policy P-001 keeps :n claims inline on the document
-- side; the converged side holds the same :n claims as rows. Generated claim ids
-- (CL-G000001...) never collide with the measured CL-1004.
-- Background documents, once per sweep: a realistically populated collection, so the
-- lookup by _id is an index lookup as in production rather than a scan of a one-row table.
BEGIN
  FOR r IN (SELECT 1 FROM dual WHERE NOT EXISTS (SELECT 1 FROM sb_policy_doc WHERE JSON_VALUE(data, '$._id') = 'P-BG00001')) LOOP
    INSERT INTO sb_policy_doc SELECT JSON_OBJECT('_id' VALUE 'P-BG' || LPAD(k, 5, '0'), 'holder' VALUE 'Holder ' || k, 'product' VALUE 'AUTO', 'recentClaims' VALUE JSON_ARRAY(JSON_OBJECT('claimId' VALUE 'CL-B' || k, 'amount' VALUE 900)) RETURNING JSON) FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= 2000);
    COMMIT;
    DBMS_STATS.GATHER_SCHEMA_STATS(USER);
  END LOOP;
END;
/
DELETE FROM sb_policy_doc WHERE JSON_VALUE(data, '$._id') = 'P-001';
INSERT INTO sb_policy_doc
SELECT JSON_OBJECT('_id' VALUE 'P-001', 'holder' VALUE 'Dana Holder', 'product' VALUE 'AUTO',
         'recentClaims' VALUE claims RETURNING JSON)
FROM  (SELECT JSON_ARRAYAGG(JSON_OBJECT('claimId' VALUE 'CL-G' || LPAD(LEVEL, 6, '0'), 'amount' VALUE 500 + MOD(LEVEL * 173, 4000))
                            ORDER BY LEVEL RETURNING JSON) AS claims
       FROM   dual CONNECT BY LEVEL <= :n);
DELETE FROM sb_claims WHERE policy_id = 'P-001';
INSERT INTO sb_claims (claim_id, policy_id, amount, claim_ts)
SELECT 'CL-G' || LPAD(LEVEL, 6, '0'), 'P-001', 500 + MOD(LEVEL * 173, 4000),
       TIMESTAMP '2026-01-01 00:00:00' + NUMTODSINTERVAL(LEVEL, 'MINUTE')
FROM   dual CONNECT BY LEVEL <= :n;
COMMIT;
