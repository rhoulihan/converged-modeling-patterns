-- ============================================================================
-- Pattern 01 · Extended Reference · THE DOCUMENT MODEL (the starting point)
-- Industry: wealth management. Access pattern: open any client or account and
-- show the servicing advisor's name, office, and desk line — without a join.
--
-- The document move: copy the most-read advisor fields INTO every client doc so
-- the read never has to look them up. "Only copy fields that rarely change."
--
-- THE WRITE-AMPLIFICATION COST (made explicit below): the advisor is now stored
-- N times, once per client. The moment a copied value changes — advisor moves
-- offices, changes desk line — you must find and rewrite EVERY embedded copy.
-- On a book of 100K clients that is a 100K-document fan-out update, and every
-- doc you miss is now stale... and it feeds both the client portal AND the LLM.
-- "Write amplification in, update anomaly out."
--
-- Runs SQL-native (JSON Collection Table) so it validates in one lane; the same
-- shape is what a MongoDB-API developer would model as a collection.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

-- Idempotent: drop prior run cleanly.
BEGIN
  FOR r IN (SELECT table_name FROM user_tables WHERE table_name = 'XR_CLIENT_DOC') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE xr_client_doc;

-- Each client doc carries an EMBEDDED COPY of the advisor block (extended
-- reference). Two clients of advisor A-001 => two copies of A-001's office/desk.
INSERT INTO xr_client_doc VALUES (JSON('{"_id":"C-001","fullName":"Ada Client","segment":"HNW",
  "advisor":{"advisorId":"A-001","fullName":"Grace Advisor","office":"NYC-01","desk":"+1-212-555-0101"}}'));
INSERT INTO xr_client_doc VALUES (JSON('{"_id":"C-002","fullName":"Ben Client","segment":"MASS",
  "advisor":{"advisorId":"A-001","fullName":"Grace Advisor","office":"NYC-01","desk":"+1-212-555-0101"}}'));
INSERT INTO xr_client_doc VALUES (JSON('{"_id":"C-003","fullName":"Cara Client","segment":"HNW",
  "advisor":{"advisorId":"A-002","fullName":"Alan Advisor","office":"CHI-04","desk":"+1-312-555-0144"}}'));
COMMIT;

-- The read the pattern optimizes for: zero-join, everything inline. This is why
-- people reach for the embed.
SELECT JSON_VALUE(data, '$.fullName') AS client,
       JSON_VALUE(data, '$.advisor.office') AS advisor_office
FROM   xr_client_doc;

-- ---------------------------------------------------------------------------
-- THE NEEDLE FLIPS HERE. Advisor A-001 moves from NYC-01 to NYC-09. There is no
-- advisor record to update — the advisor only exists as copies. So the write
-- fans out across EVERY client doc that embeds A-001, and each JSON_TRANSFORM
-- re-serializes the whole document into a new block (WiredTiger copy-on-write;
-- OSON re-encode on Oracle). 3 rows here; 100,000 on a real book.
-- ---------------------------------------------------------------------------
UPDATE xr_client_doc c
SET    data = JSON_TRANSFORM(data,
                SET '$.advisor.office' = 'NYC-09',
                SET '$.advisor.desk'   = '+1-212-555-0999')
WHERE  JSON_VALUE(data, '$.advisor.advisorId') = 'A-001';
-- ^ rows updated = every client of A-001. Miss one (or crash mid-fan-out) and
--   that client doc now serves a STALE office to the portal and to the copilot.
COMMIT;

SELECT 'document model: advisor change fanned out to ' ||
       COUNT(*) || ' client docs' AS write_amplification
FROM   xr_client_doc
WHERE  JSON_VALUE(data, '$.advisor.office') = 'NYC-09';
