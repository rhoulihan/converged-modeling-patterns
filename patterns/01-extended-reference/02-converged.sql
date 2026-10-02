-- ============================================================================
-- Pattern 01 · Extended Reference · THE CONVERGED ALTERNATIVE
-- "Project, don't copy."
--
-- The advisor is stored ONCE, in its own table. Each client references it by FK.
-- A JSON Relational Duality View projects the SAME client document the document
-- developer wanted (advisor block inline), but the advisor block is assembled
-- through the FK at read time, not stored as a copy.
--
-- THE TRADEOFF: every read pays a primary-key join (about 15% more read work in
-- the deck's model); in exchange an advisor moving offices is ONE row, and every
-- client document that projects that advisor reflects it at the same commit, with
-- no fan-out and no stale copy. The read shape is identical; the write cost goes
-- from O(documents embedding the advisor) to O(1). On a normal day (~300 edits)
-- embedding is still cheaper; break-even is ~930 edits a day, and a reorg day
-- (8,000) is where projecting wins on cost and on correctness.
--
-- When the document shape stays: snapshot the IMMUTABLE (a trade's execution
-- price, the advisor of record on a signed statement: freeze it in the doc),
-- project the MUTABLE (an advisor's CURRENT office is reference data: project it).
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @02-converged.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables
            WHERE table_name IN ('XR_CLIENTS','XR_ADVISORS')
            ORDER BY table_name) LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' CASCADE CONSTRAINTS PURGE';
  END LOOP;
END;
/

-- Relational projection: the advisor is stored ONCE, as one row.
CREATE TABLE xr_advisors (
  advisor_id  VARCHAR2(12)  PRIMARY KEY,
  full_name   VARCHAR2(120) NOT NULL,
  office      VARCHAR2(24)  NOT NULL,
  desk        VARCHAR2(24)  NOT NULL
);

CREATE TABLE xr_clients (
  client_id          VARCHAR2(12)  PRIMARY KEY,
  full_name          VARCHAR2(120) NOT NULL,
  segment            VARCHAR2(12)  NOT NULL,
  primary_advisor_id VARCHAR2(12)  NOT NULL REFERENCES xr_advisors(advisor_id)
);

INSERT INTO xr_advisors VALUES ('A-001','Grace Advisor','NYC-01','+1-212-555-0101');
INSERT INTO xr_advisors VALUES ('A-002','Alan Advisor','CHI-04','+1-312-555-0144');
INSERT INTO xr_clients VALUES ('C-001','Ada Client','HNW','A-001');
INSERT INTO xr_clients VALUES ('C-002','Ben Client','MASS','A-001');
INSERT INTO xr_clients VALUES ('C-003','Cara Client','HNW','A-002');
COMMIT;

-- The document the document dev wanted: assembled at read time from the rows.
-- Advisor block is WITH NOUPDATE: it is a PROJECTION of reference data, not a
-- copy this view is allowed to overwrite (per-field governance, engine-enforced:
-- writing advisor.office through the view fails with ORA-40940).
CREATE OR REPLACE JSON RELATIONAL DUALITY VIEW xr_client_dv AS
SELECT JSON {
  '_id'      : c.client_id,
  'fullName' : c.full_name WITH UPDATE,
  'segment'  : c.segment   WITH UPDATE,
  'advisor'  : ( SELECT JSON { 'advisorId' : a.advisor_id,
                               'fullName'  : a.full_name,
                               'office'    : a.office,
                               'desk'      : a.desk }
                 FROM xr_advisors a WITH NOUPDATE
                 WHERE a.advisor_id = c.primary_advisor_id )
} FROM xr_clients c WITH INSERT UPDATE DELETE;

-- Same read the document model served: identical shape, zero stored copies.
-- @step Read the projected client document
-- @note Same shape as the document model's read: the advisor block is a live projection through the FK, not a stored copy.
-- @why Diversity is served without copies: the duality view assembles the advisor block through the foreign key on every read. That primary-key join is real read work, about 15% more per read in the deck's model.
-- @look The same client and advisor_office columns as the document model's read, now from xr_client_dv.
-- @figure erd.svg Advisor, client, account and trade in canonical form, each fact once, beside the fan-out one advisor change causes in the embedded model
-- @mongo db.xr_client_dv.find(
-- @mongo   {},
-- @mongo   { _id: 0, fullName: 1, "advisor.office": 1 }
-- @mongo )
SELECT JSON_VALUE(data, '$.fullName') AS client,
       JSON_VALUE(data, '$.advisor.office') AS advisor_office
FROM   xr_client_dv;

-- ---------------------------------------------------------------------------
-- THE NEEDLE-FLIP, RESOLVED. Advisor A-001 moves offices: ONE row. Every client
-- document that projects A-001 is correct at the same commit. No fan-out, no
-- stale copy, no CDC job to reconcile the portal with the copilot. The price was
-- paid on the read side, as a join on every document read.
-- ---------------------------------------------------------------------------
-- @step Move advisor A-001 to a new office
-- @note One row: every client document that projects A-001 is correct in the same transaction, no fan-out, no stale copy.
-- @why Update locality collapses: the advisor is one row, so an office change is one small row write however many clients project it.
-- @look Rows affected is 1; compare its redo with the document model's in Measure it.
-- @measure advisor-move
-- @mongo db.aggregate([{ $sql: `
-- @mongo   UPDATE xr_advisors SET office = 'NYC-09', desk = '+1-212-555-0999'
-- @mongo   WHERE  advisor_id = 'A-001'
-- @mongo ` }])
UPDATE xr_advisors SET office = 'NYC-09', desk = '+1-212-555-0999'
WHERE  advisor_id = 'A-001';
COMMIT;

-- @step Confirm every client reflects the move
-- @note Both C-001 and C-002 now read NYC-09: from one write to one row.
-- @why Update locality, resolved: both clients project the advisor row live, so they changed at the same commit with nothing to reconcile.
-- @look C-001 and C-002 both show NYC-09 in advisor_office_now.
-- @mongo db.xr_client_dv.find(
-- @mongo   {},
-- @mongo   { _id: 1, "advisor.office": 1 }
-- @mongo ).sort({ _id: 1 })
SELECT JSON_VALUE(data, '$._id') AS client,
       JSON_VALUE(data, '$.advisor.office') AS advisor_office_now
FROM   xr_client_dv
ORDER  BY 1;
-- ^ C-001 and C-002 both read NYC-09: from one write to one row.
