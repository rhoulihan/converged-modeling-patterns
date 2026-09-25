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
-- The "whale" -- stands in for a 100K-client institutional book. Just more rows.
INSERT INTO ol_clients VALUES ('C-900001','A-900',9000000);
INSERT INTO ol_clients VALUES ('C-900002','A-900',8500000);
INSERT INTO ol_clients VALUES ('C-900003','A-900',7800000);
INSERT INTO ol_clients VALUES ('C-900004','A-900',7100000);
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

SELECT JSON_SERIALIZE(data PRETTY) AS typical_advisor_document
FROM   ol_advisor_dv WHERE JSON_VALUE(data,'$._id') = 'A-001';

-- The WHALE -- exact same table, exact same optimizer. You do not stitch an
-- overflow collection; you page ordinary rows. Top 3 holdings for the desk:
SELECT client_id, aum
FROM   ol_clients
WHERE  advisor_id = 'A-900'
ORDER  BY aum DESC
FETCH  FIRST 3 ROWS ONLY;

-- The next page -- OFFSET, same index range scan. This is the whole "outlier"
-- story on a converged engine: pagination, not a special document shape.
SELECT client_id, aum
FROM   ol_clients
WHERE  advisor_id = 'A-900'
ORDER  BY aum DESC
OFFSET 3 ROWS FETCH NEXT 3 ROWS ONLY;
