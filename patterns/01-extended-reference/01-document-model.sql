-- ============================================================================
-- Pattern 01 · Extended Reference · THE DOCUMENT MODEL (the starting point)
-- Industry: wealth management. Access pattern: open any client or account and
-- show the servicing advisor's name, office, and desk line. No join needed.
--
-- The document move: copy the most-read advisor fields INTO every client doc so
-- the read never has to look them up. "Only copy fields that rarely change."
--
-- On a read-heavy workload this is a correct bet: about 50M client-360 reads a
-- day against ~300 advisor edits, and four consumers want the card inline.
--
-- THE WRITE-AMPLIFICATION COST (made explicit below): the advisor is now stored
-- once per document that embeds it. The moment a copied value changes (advisor
-- moves offices, changes desk line) you must find and rewrite EVERY embedded copy.
-- In the deck's book that is ~2,700 documents per advisor (790 client docs plus
-- 1,920 account docs), not one transaction, and until the last rewrite lands the
-- client portal and the AI copilot can read different offices.
-- "Write amplification in, update anomaly out."
--
-- Runs SQL-native (JSON Collection Table) on the same 26ai engine, so the
-- comparison is about shape, not vendor; the same shape is what a MongoDB-API
-- developer would model as a collection.
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
-- @step Read the embedded advisor block
-- @note Zero-join read: every client doc already carries its own copy of the advisor's office and desk.
-- @why Read/write is why teams embed: at 50 million client-360 reads a day against about 300 advisor edits, a read with no lookup is the right thing to optimize.
-- @look Every client row returns its own advisor_office, and the statement touches one table.
-- @figure doc-shape.svg The client document as built: the advisor card copied into every client and account
SELECT JSON_VALUE(data, '$.fullName') AS client,
       JSON_VALUE(data, '$.advisor.office') AS advisor_office
FROM   xr_client_doc;

-- ---------------------------------------------------------------------------
-- THE NEEDLE FLIPS HERE. Advisor A-001 moves from NYC-01 to NYC-09. There is no
-- advisor record to update: the advisor only exists as copies. So the write
-- fans out across EVERY client doc that embeds A-001, and each JSON_TRANSFORM
-- re-serializes the whole document into a new block (WiredTiger copy-on-write;
-- OSON re-encode on Oracle). 2 rows here; ~2,700 documents per advisor on the
-- deck's book, and ~22M rewrites on a reorg day of 8,000 changes.
-- ---------------------------------------------------------------------------
-- @step Move advisor A-001 to a new office
-- @note Every client document that embeds A-001 gets rewritten: one logical change fans out to every embedded copy, not to one row.
-- @why Update locality is the hot knob: the advisor exists only as copies, so one office change is a read-modify-write of every document that embeds A-001. At 2,700 embedding documents per advisor, that is 2,700 rewrites per edit.
-- @look Rows affected is 2 here, one per embedded copy; Measure it shows the redo those copies cost.
-- @measure advisor-move
UPDATE xr_client_doc c
SET    data = JSON_TRANSFORM(data,
                SET '$.advisor.office' = 'NYC-09',
                SET '$.advisor.desk'   = '+1-212-555-0999')
WHERE  JSON_VALUE(data, '$.advisor.advisorId') = 'A-001';
-- ^ rows updated = every client of A-001. Miss one (or crash mid-fan-out) and
--   that client doc now serves a STALE office to the portal and to the copilot.
COMMIT;

-- @step Confirm the fan-out
-- @note Count of client docs now showing the new office: one logical change touched every embedded copy.
-- @why Update locality again: the count is how far one logical change had to travel. At 2,700 copies per advisor that fan-out is a job, not one transaction, and until it finishes the portal and the copilot can read different offices.
-- @look The write_amplification line reports 2 client docs, the number that becomes 2,700 at production scale.
SELECT 'document model: advisor change fanned out to ' ||
       COUNT(*) || ' client docs' AS write_amplification
FROM   xr_client_doc
WHERE  JSON_VALUE(data, '$.advisor.office') = 'NYC-09';
