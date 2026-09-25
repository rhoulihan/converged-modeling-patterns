-- ============================================================================
-- Pattern 06 · Outlier (whale documents) · THE DOCUMENT MODEL (the starting point)
-- Industry: financial / wealth management. Access pattern: open an advisor and
-- read their book of clients as one document.
--
-- The document move: embed the client book on the advisor doc. This is fine for
-- the TYPICAL advisor -- a few dozen to a few hundred clients fits comfortably.
--
-- THE OUTLIER PROBLEM: a handful of institutional advisors carry 100,000-client
-- books. Their document blows past the 16 MB ceiling, so the pattern adds a
-- `hasExtras` flag, spills the tail into an OVERFLOW collection, and every reader
-- must now branch: "if hasExtras, go fetch the overflow and stitch it back."
-- That is the 16 MB storage-engine limit LEAKING INTO YOUR APPLICATION CODE. The
-- pattern does not solve the outlier -- it ADMITS the model breaks for the fat
-- tail and pushes the special case up into every consumer.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables
            WHERE table_name IN ('OL_ADVISOR_DOC','OL_ADVISOR_OVERFLOW')
            ORDER BY table_name) LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE ol_advisor_doc;
CREATE JSON COLLECTION TABLE ol_advisor_overflow;

-- Typical advisor: whole book embedded, hasExtras=false. The model works.
INSERT INTO ol_advisor_doc VALUES (JSON('{"_id":"A-001","name":"Grace Advisor","hasExtras":false,
  "clients":[{"clientId":"C-001","aum":250000},
             {"clientId":"C-002","aum":180000},
             {"clientId":"C-003","aum":420000}]}'));

-- Whale advisor: 100K-client institutional book. Only the first slice fits in the
-- document; hasExtras=true says "the rest is elsewhere." Now every reader must
-- special-case this advisor.
INSERT INTO ol_advisor_doc VALUES (JSON('{"_id":"A-900","name":"Institutional Desk","hasExtras":true,
  "clients":[{"clientId":"C-900001","aum":9000000},
             {"clientId":"C-900002","aum":8500000}]}'));
INSERT INTO ol_advisor_overflow VALUES (JSON('{"_id":"A-900#part-2","advisorId":"A-900",
  "clients":[{"clientId":"C-900003","aum":7800000},
             {"clientId":"C-900004","aum":7100000}]}'));
COMMIT;

-- The read for a TYPICAL advisor: one document, done.
SELECT JSON_VALUE(data,'$._id') AS advisor,
       JSON_VALUE(data,'$.hasExtras') AS has_extras,
       JSON_QUERY(data,'$.clients') AS clients_inline
FROM   ol_advisor_doc WHERE JSON_VALUE(data,'$._id') = 'A-001';

-- The read for the WHALE: the application must notice hasExtras and go stitch the
-- overflow back in. The 16 MB limit is now branching logic in every consumer
-- (including the LLM's context builder).
SELECT JSON_VALUE(d.data,'$._id')  AS advisor,
       JSON_VALUE(d.data,'$.hasExtras') AS has_extras,
       JSON_QUERY(d.data,'$.clients') AS clients_page1,
       JSON_QUERY(o.data,'$.clients') AS clients_overflow
FROM   ol_advisor_doc d
LEFT   JOIN ol_advisor_overflow o
       ON JSON_VALUE(o.data,'$.advisorId') = JSON_VALUE(d.data,'$._id')
WHERE  JSON_VALUE(d.data,'$._id') = 'A-900';
