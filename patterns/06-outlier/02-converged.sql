-- ============================================================================
-- Pattern 06 · Outlier (whale documents) · THE CONVERGED ALTERNATIVE
-- "The outlier is just more rows, and the optimizer plans for it."
--
-- Clients are rows in one table, referenced by advisor. There is no special
-- document shape, no hasExtras flag, no overflow collection, no branch in the
-- reader. The typical advisor's book is projected as a document by a duality
-- view; the institutional whale is the SAME query -- it just returns more rows,
-- and you page them with FETCH FIRST / OFFSET. One table, one access path, one
-- optimizer that already knows how to range-scan a big child set.
--
-- The needle-flip, resolved: the 16 MB document ceiling never enters the picture,
-- because the book was never one physical document. The fat tail stops being an
-- application special case and becomes ordinary pagination over ordinary rows.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @02-converged.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables
            WHERE table_name IN ('OL_CLIENTS','OL_ADVISORS')
            ORDER BY table_name) LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' CASCADE CONSTRAINTS PURGE';
  END LOOP;
END;
/

CREATE TABLE ol_advisors (
  advisor_id VARCHAR2(12)  PRIMARY KEY,
  name       VARCHAR2(120) NOT NULL
);

CREATE TABLE ol_clients (
  client_id  VARCHAR2(12)  PRIMARY KEY,
  advisor_id VARCHAR2(12)  NOT NULL REFERENCES ol_advisors(advisor_id),
  aum        NUMBER(18,2)  NOT NULL
);
-- The access path that makes a whale's book a range scan, not a scan-the-world.
CREATE INDEX ol_ix_client_advisor ON ol_clients (advisor_id, aum DESC);

INSERT INTO ol_advisors VALUES ('A-001','Grace Advisor');
INSERT INTO ol_advisors VALUES ('A-900','Institutional Desk');
INSERT INTO ol_clients VALUES ('C-001','A-001',250000);
INSERT INTO ol_clients VALUES ('C-002','A-001',180000);
INSERT INTO ol_clients VALUES ('C-003','A-001',420000);
-- The "whale" -- stands in for a 100K-client institutional book: the same 800
-- clients the document model embeds, generated, not pasted. Just more rows.
INSERT INTO ol_clients (client_id, advisor_id, aum)
SELECT 'C-' || TO_CHAR(900000 + LEVEL), 'A-900', 9000000 - (LEVEL - 1) * 10000
FROM   dual CONNECT BY LEVEL <= 800;
COMMIT;
-- @step Add one more client to the whale's book
-- @note Just another row — no ceiling, no overflow shard, no reader branch, and the same cost at 800 clients as at 3.
-- @why Update locality stops scaling with the book: a new client is one row and one index entry, the same cost at 3 clients or 148,000.
-- @look Rows affected is 1; Measure it shows redo near 1.2 KB at any book size.
-- @figure erd.svg Desk, advisor and client in canonical form, beside the typical one-document book and the institutional book split into overflow documents
-- @measure add-client
INSERT INTO ol_clients VALUES ('C-900801','A-900',1000000);
COMMIT;

-- Where the document model spills to overflow, the converged book just grows.
-- @step Add the next two clients to the whale's book
-- @note No spill — just two more rows.
-- @why Update locality: where the document model spilled to a second collection, the book just gets two more rows.
-- @look Rows affected is 2, with no flag and no overflow write.
INSERT INTO ol_clients (client_id, advisor_id, aum)
SELECT 'C-900802', 'A-900', 990000 FROM dual UNION ALL
SELECT 'C-900803', 'A-900', 980000 FROM dual;
COMMIT;

-- The typical advisor as a document -- assembled by the duality view over the
-- SAME rows. No special case, no flag. (For a bounded book this is the whole doc.)
CREATE OR REPLACE JSON RELATIONAL DUALITY VIEW ol_advisor_dv AS
SELECT JSON {
  '_id'  : a.advisor_id,
  'name' : a.name WITH UPDATE,
  'clients' : [ SELECT JSON { 'clientId' : c.client_id,
                              'aum'       : c.aum WITH UPDATE }
                FROM ol_clients c WITH INSERT UPDATE DELETE
                WHERE c.advisor_id = a.advisor_id ]
} FROM ol_advisors a WITH INSERT UPDATE DELETE;

-- @step Read the typical advisor as a projected document
-- @note Same shape the document model served — no flag, no branch.
-- @why Diversity: the duality view projects the same advisor document from rows, assembling the client array on read rather than storing it.
-- @look typical_advisor_document shows A-001's clients array, with no hasExtras field.
SELECT JSON_SERIALIZE(data PRETTY) AS typical_advisor_document
FROM   ol_advisor_dv WHERE JSON_VALUE(data,'$._id') = 'A-001';

-- The WHALE -- exact same table, exact same optimizer. You do not stitch an
-- overflow collection; you page ordinary rows. Top 3 holdings for the desk:
-- @step Read the whale's top 3 holdings
-- @note Exact same table, exact same optimizer — no overflow collection to stitch back in.
-- @why Read/write, priced honestly: a top-N range scan on (advisor_id, aum DESC) reads index entries and assembles rows on every read, but the same amount at 180 clients or 148,000.
-- @look The 3 largest holdings by aum, from ol_clients with no overflow to stitch.
SELECT client_id, aum
FROM   ol_clients
WHERE  advisor_id = 'A-900'
ORDER  BY aum DESC
FETCH  FIRST 3 ROWS ONLY;

-- The next page -- OFFSET, same index range scan. This is the whole "outlier"
-- story on a converged engine: pagination, not a special document shape.
-- @step Page to the next 3 holdings
-- @note OFFSET, same index range scan — ordinary pagination, not a special document shape.
-- @why Update locality's skew becomes a statistic, not a code path: the next page is the same query with OFFSET.
-- @look Holdings 4 to 6 by aum, from the same index range.
SELECT client_id, aum
FROM   ol_clients
WHERE  advisor_id = 'A-900'
ORDER  BY aum DESC
OFFSET 3 ROWS FETCH NEXT 3 ROWS ONLY;
