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
--
-- AND THE WRITES: until it spills, the whale's book is one growing document, so
-- adding a client is a read-modify-write of the whole 800-client book. Spilling
-- to overflow is itself cheap -- the outlier pattern costs you the growth
-- rewrite of the document before the spill, plus a branch in every reader.
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

-- Whale advisor: stands in for a 100K-client institutional book. 800 clients are
-- already embedded (the x800 skew over the typical book; ~30 KB of JSON),
-- generated, not pasted. It has not spilled yet: hasExtras=false.
INSERT INTO ol_advisor_doc
SELECT JSON_OBJECT('_id' VALUE 'A-900', 'name' VALUE 'Institutional Desk', 'hasExtras' VALUE FALSE,
         'clients' VALUE clients RETURNING JSON)
FROM  (SELECT JSON_ARRAYAGG(JSON_OBJECT('clientId' VALUE 'C-' || TO_CHAR(900000 + LEVEL),
                                        'aum'      VALUE 9000000 - (LEVEL - 1) * 10000)
                            ORDER BY LEVEL RETURNING JSON) AS clients
       FROM   dual CONNECT BY LEVEL <= 800);
COMMIT;

-- @step Add one client to the whale's embedded book
-- @note Appending one client is a read-modify-write of the whole 800-client book — the growth rewrite you pay on every add until the document spills.
-- @why Update locality is the hot knob: writes land in the biggest documents on the platform, and appending one client is a read-modify-write of the whole 800-client book.
-- @look Rows affected is 1; Measure it shows the redo of rewriting the whole book next to one client row.
-- @figure doc-shape.svg The advisor document as built: the client book embedded as an array, with a hasExtras flag for books that overflow
-- @measure add-client
UPDATE ol_advisor_doc
SET    data = JSON_TRANSFORM(data, APPEND '$.clients' = JSON_OBJECT('clientId' VALUE 'C-900801', 'aum' VALUE 1000000))
WHERE  JSON_VALUE(data,'$._id') = 'A-900';
COMMIT;

-- Once the book outgrows the document (the real whale's 100K clients cannot fit
-- under 16 MB; this 800-client book stands in for it), the tail spills into an
-- overflow document.
-- @step Spill the next clients to an overflow document
-- @note Spilling to overflow is itself cheap — the outlier pattern costs you the growth rewrite of the document before the spill, plus a branch in every reader.
-- @why Update locality: the spill write itself is small. What the pattern costs is the growth rewrite before it and the branch every reader gains after it.
-- @look Rows affected is 1, a new overflow document holding 2 clients.
INSERT INTO ol_advisor_overflow VALUES (JSON('{"_id":"A-900#part-2","advisorId":"A-900",
  "clients":[{"clientId":"C-900802","aum":990000},
             {"clientId":"C-900803","aum":980000}]}'));
COMMIT;

-- @step Flag the whale: hasExtras = true
-- @note From here on, every reader has to check this flag and go fetch the overflow.
-- @why Diversity is low, yet every consumer of the book still has to learn this flag: the portal, the batch and the AI assistant's context builder.
-- @look Rows affected is 1, and has_extras on the whale read now shows true.
UPDATE ol_advisor_doc
SET    data = JSON_TRANSFORM(data, SET '$.hasExtras' = TRUE)
WHERE  JSON_VALUE(data,'$._id') = 'A-900';
COMMIT;

-- The read for a TYPICAL advisor: one document, done.
-- @step Read a typical advisor (one document)
-- @note The ordinary case: one document, done — no branch needed.
-- @why Read/write is the pattern's case: for the 180-client median, one document read is about 3× cheaper than a query in the deck's model.
-- @look has_extras is false and clients_inline holds A-001's whole book.
SELECT JSON_VALUE(data,'$._id') AS advisor,
       JSON_VALUE(data,'$.hasExtras') AS has_extras,
       JSON_QUERY(data,'$.clients' RETURNING CLOB) AS clients_inline
FROM   ol_advisor_doc WHERE JSON_VALUE(data,'$._id') = 'A-001';

-- The read for the WHALE: the application must notice hasExtras and go stitch the
-- overflow back in. The 16 MB limit is now branching logic in every consumer
-- (including the LLM's context builder).
-- @step Read the whale advisor (branch on hasExtras)
-- @note Every reader must notice hasExtras and go stitch the overflow back in — the 16 MB limit is now application logic. Shows counts and the first 5 embedded clients, not the whole 800-client array.
-- @why Update locality's skew shows up in the reader: the 16 MB cap has become a branch, and the rare path is the one least tested.
-- @look clients_embedded is 801 and clients_in_overflow is 2 if you ran the two cards above (800 and 0 on fresh data): one advisor, read from two collections and stitched together.
SELECT JSON_VALUE(d.data,'$._id')  AS advisor,
       JSON_VALUE(d.data,'$.hasExtras') AS has_extras,
       JSON_VALUE(d.data,'$.clients.size()' RETURNING NUMBER) AS clients_embedded,
       JSON_QUERY(d.data,'$.clients[0 to 4]' RETURNING CLOB WITH ARRAY WRAPPER) AS clients_embedded_first5,
       JSON_VALUE(o.data,'$.clients.size()' RETURNING NUMBER) AS clients_in_overflow,
       JSON_QUERY(o.data,'$.clients' RETURNING CLOB) AS clients_overflow
FROM   ol_advisor_doc d
LEFT   JOIN ol_advisor_overflow o
       ON JSON_VALUE(o.data,'$.advisorId') = JSON_VALUE(d.data,'$._id')
WHERE  JSON_VALUE(d.data,'$._id') = 'A-900';
