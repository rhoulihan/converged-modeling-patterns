-- ============================================================================
-- Pattern 02 · Computed · THE DOCUMENT MODEL (the starting point)
-- Industry: telecom. Access pattern: show a subscriber's current-cycle usage
-- (total MB, minutes, cost) instantly on the account page, and rank the top
-- talkers for the ops dashboard.
--
-- The document move: keep a precomputed cycleUsage summary on the subscriber
-- document. Compute once on write, then serve the account page from the stored
-- answer instead of re-aggregating the cycle's CDRs. CDRs themselves are stored
-- separately, one small document each, in both designs.
--
-- THE WRITE-AMPLIFICATION COST: the subscriber document is not small. It carries
-- the profile (plan, devices, addresses, preferences, consents, account history:
-- ~6 KB here) next to the three summary counters. Every Call Detail Record (CDR)
-- updates the summary, and updating three counters rewrites the WHOLE subscriber
-- document. The document does not grow; it is just far bigger than the change.
-- Redo tracks the document's size (measured on 26ai Free: ~8.3 KB per summary
-- update at ~3.5 KB of document, against ~1.0 KB for a narrow summary row).
-- At 400 CDRs a day for a heavy user (one every 3.6 minutes) nothing waits on a
-- lock: the cost is bytes, paid on every CDR, to speed up an account-page read
-- that happens a couple of times a day. And the Top-N dashboard has no rollup
-- to seek on across subscribers: it must SORT -> LIMIT the collection every load.
--
-- Where a document still works: a rollup-only document (the counters alone,
-- the profile elsewhere) measured within 1.5x of a summary row, and a closed
-- cycle's final bill, written once and read.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables WHERE table_name IN ('CP_SUBSCRIBER_DOC', 'CP_CDR_DOC')) LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE cp_subscriber_doc;
CREATE JSON COLLECTION TABLE cp_cdr_doc;
-- The equivalent of MongoDB's built-in _id index, so SQL lookups by _id are key lookups.
CREATE INDEX cp_ix_sub_id ON cp_subscriber_doc (JSON_VALUE(data, '$._id'));

-- The cycle's CDRs, one small document each: 1,000 for S-001 mid-cycle, one each
-- for S-002 and S-003. Generated, not pasted.
INSERT INTO cp_cdr_doc
SELECT JSON_OBJECT('_id' VALUE 'S-001-' || LEVEL, 'subscriberId' VALUE 'S-001',
         'ts' VALUE TIMESTAMP '2026-09-01 00:00:00' + NUMTODSINTERVAL(LEVEL * 40, 'MINUTE'),
         'mb' VALUE 50 + MOD(LEVEL * 37, 200), 'min' VALUE 1 + MOD(LEVEL * 13, 30),
         'cost' VALUE ROUND((1 + MOD(LEVEL * 13, 30)) * 0.03, 2) RETURNING JSON)
FROM   dual CONNECT BY LEVEL <= 1000;
INSERT INTO cp_cdr_doc VALUES (JSON('{"_id":"S-002-1","subscriberId":"S-002","ts":"2026-09-02T09:00:00","mb":50,"min":5,"cost":0.15}'));
INSERT INTO cp_cdr_doc VALUES (JSON('{"_id":"S-003-1","subscriberId":"S-003","ts":"2026-09-03T14:00:00","mb":900,"min":40,"cost":2.7}'));

-- The subscriber documents: profile (~6 KB for S-001) plus the cycleUsage summary,
-- which equals the sums of each subscriber's CDRs.
INSERT INTO cp_subscriber_doc
SELECT JSON_OBJECT('_id' VALUE 'S-001', 'msisdn' VALUE '+1-202-555-0111', 'plan' VALUE 'UNLIMITED',
         'profile' VALUE JSON_OBJECT(
         'name' VALUE 'Avery Quinn', 'email' VALUE 'avery.quinn@example.net', 'since' VALUE '2019-04-12',
         'billingAddress' VALUE JSON_OBJECT('line1' VALUE '1450 Harbor Way', 'city' VALUE 'Alexandria', 'region' VALUE 'VA', 'postal' VALUE '22314'),
         'serviceAddress' VALUE JSON_OBJECT('line1' VALUE '1450 Harbor Way', 'city' VALUE 'Alexandria', 'region' VALUE 'VA', 'postal' VALUE '22314'),
         'devices' VALUE JSON_ARRAY(
           JSON_OBJECT('imei' VALUE '356938035643809', 'model' VALUE 'Pixel 9', 'sim' VALUE '8901410321111851072', 'activatedOn' VALUE '2024-10-03'),
           JSON_OBJECT('imei' VALUE '354812090211457', 'model' VALUE 'Galaxy Watch 7', 'sim' VALUE '8901410321111851099', 'activatedOn' VALUE '2025-02-18')),
         'addOns' VALUE JSON_ARRAY('INTL_ROAM', 'HOTSPOT_50GB', 'DEVICE_PROTECT'),
         'preferences' VALUE JSON_OBJECT('paperless' VALUE 'yes', 'language' VALUE 'en-US', 'alerts' VALUE JSON_ARRAY('usage-80', 'usage-100', 'bill-ready')),
         'consents' VALUE JSON_ARRAY('marketing-email:2024-01-05', 'cpni-share:none', 'analytics:2023-11-30'),
         'accountHistory' VALUE (
           SELECT JSON_ARRAYAGG(JSON_OBJECT(
                    'ts' VALUE TO_CHAR(DATE '2025-01-01' + k * 7, 'YYYY-MM-DD'),
                    'type' VALUE DECODE(MOD(k, 4), 0, 'payment', 1, 'plan-change', 2, 'support-case', 'device-update'),
                    'channel' VALUE DECODE(MOD(k, 3), 0, 'app', 1, 'store', 'call-center'),
                    'note' VALUE 'Entry ' || k || ': reviewed with the customer and recorded by the agent for the account file')
                  ORDER BY k RETURNING JSON)
           FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= 35))
         RETURNING JSON),
         'cycleUsage' VALUE (SELECT JSON_OBJECT('totalMB' VALUE SUM(JSON_VALUE(data, '$.mb' RETURNING NUMBER)),
                                                'totalMin' VALUE SUM(JSON_VALUE(data, '$.min' RETURNING NUMBER)),
                                                'cost' VALUE SUM(JSON_VALUE(data, '$.cost' RETURNING NUMBER)))
                             FROM cp_cdr_doc WHERE JSON_VALUE(data, '$.subscriberId') = 'S-001')
         RETURNING JSON)
FROM   dual;
INSERT INTO cp_subscriber_doc
SELECT JSON_OBJECT('_id' VALUE 'S-002', 'msisdn' VALUE '+1-202-555-0122', 'plan' VALUE 'METERED',
         'profile' VALUE JSON_OBJECT(
         'name' VALUE 'Jordan Ellis', 'email' VALUE 'jordan.ellis@example.net', 'since' VALUE '2019-04-12',
         'billingAddress' VALUE JSON_OBJECT('line1' VALUE '1450 Harbor Way', 'city' VALUE 'Alexandria', 'region' VALUE 'VA', 'postal' VALUE '22314'),
         'serviceAddress' VALUE JSON_OBJECT('line1' VALUE '1450 Harbor Way', 'city' VALUE 'Alexandria', 'region' VALUE 'VA', 'postal' VALUE '22314'),
         'devices' VALUE JSON_ARRAY(
           JSON_OBJECT('imei' VALUE '356938035643809', 'model' VALUE 'Pixel 9', 'sim' VALUE '8901410321111851072', 'activatedOn' VALUE '2024-10-03'),
           JSON_OBJECT('imei' VALUE '354812090211457', 'model' VALUE 'Galaxy Watch 7', 'sim' VALUE '8901410321111851099', 'activatedOn' VALUE '2025-02-18')),
         'addOns' VALUE JSON_ARRAY('INTL_ROAM', 'HOTSPOT_50GB', 'DEVICE_PROTECT'),
         'preferences' VALUE JSON_OBJECT('paperless' VALUE 'yes', 'language' VALUE 'en-US', 'alerts' VALUE JSON_ARRAY('usage-80', 'usage-100', 'bill-ready')),
         'consents' VALUE JSON_ARRAY('marketing-email:2024-01-05', 'cpni-share:none', 'analytics:2023-11-30'),
         'accountHistory' VALUE (
           SELECT JSON_ARRAYAGG(JSON_OBJECT(
                    'ts' VALUE TO_CHAR(DATE '2025-01-01' + k * 7, 'YYYY-MM-DD'),
                    'type' VALUE DECODE(MOD(k, 4), 0, 'payment', 1, 'plan-change', 2, 'support-case', 'device-update'),
                    'channel' VALUE DECODE(MOD(k, 3), 0, 'app', 1, 'store', 'call-center'),
                    'note' VALUE 'Entry ' || k || ': reviewed with the customer and recorded by the agent for the account file')
                  ORDER BY k RETURNING JSON)
           FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= 6))
         RETURNING JSON),
         'cycleUsage' VALUE JSON_OBJECT('totalMB' VALUE 50, 'totalMin' VALUE 5, 'cost' VALUE 0.15)
         RETURNING JSON)
FROM   dual;
INSERT INTO cp_subscriber_doc
SELECT JSON_OBJECT('_id' VALUE 'S-003', 'msisdn' VALUE '+1-202-555-0133', 'plan' VALUE 'UNLIMITED',
         'profile' VALUE JSON_OBJECT(
         'name' VALUE 'Riley Moreno', 'email' VALUE 'riley.moreno@example.net', 'since' VALUE '2019-04-12',
         'billingAddress' VALUE JSON_OBJECT('line1' VALUE '1450 Harbor Way', 'city' VALUE 'Alexandria', 'region' VALUE 'VA', 'postal' VALUE '22314'),
         'serviceAddress' VALUE JSON_OBJECT('line1' VALUE '1450 Harbor Way', 'city' VALUE 'Alexandria', 'region' VALUE 'VA', 'postal' VALUE '22314'),
         'devices' VALUE JSON_ARRAY(
           JSON_OBJECT('imei' VALUE '356938035643809', 'model' VALUE 'Pixel 9', 'sim' VALUE '8901410321111851072', 'activatedOn' VALUE '2024-10-03'),
           JSON_OBJECT('imei' VALUE '354812090211457', 'model' VALUE 'Galaxy Watch 7', 'sim' VALUE '8901410321111851099', 'activatedOn' VALUE '2025-02-18')),
         'addOns' VALUE JSON_ARRAY('INTL_ROAM', 'HOTSPOT_50GB', 'DEVICE_PROTECT'),
         'preferences' VALUE JSON_OBJECT('paperless' VALUE 'yes', 'language' VALUE 'en-US', 'alerts' VALUE JSON_ARRAY('usage-80', 'usage-100', 'bill-ready')),
         'consents' VALUE JSON_ARRAY('marketing-email:2024-01-05', 'cpni-share:none', 'analytics:2023-11-30'),
         'accountHistory' VALUE (
           SELECT JSON_ARRAYAGG(JSON_OBJECT(
                    'ts' VALUE TO_CHAR(DATE '2025-01-01' + k * 7, 'YYYY-MM-DD'),
                    'type' VALUE DECODE(MOD(k, 4), 0, 'payment', 1, 'plan-change', 2, 'support-case', 'device-update'),
                    'channel' VALUE DECODE(MOD(k, 3), 0, 'app', 1, 'store', 'call-center'),
                    'note' VALUE 'Entry ' || k || ': reviewed with the customer and recorded by the agent for the account file')
                  ORDER BY k RETURNING JSON)
           FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= 12))
         RETURNING JSON),
         'cycleUsage' VALUE JSON_OBJECT('totalMB' VALUE 900, 'totalMin' VALUE 40, 'cost' VALUE 2.7)
         RETURNING JSON)
FROM   dual;
COMMIT;

-- One CDR arrives for S-001. Two writes: the CDR document (small, append-only,
-- the same as the relational design), then the summary on the subscriber
-- document (three counters, and a rewrite of the whole ~6 KB document).
-- @step Record one CDR for S-001
-- @note The CDR is its own small document, appended once: this half of the write is the same in both designs.
-- @why The fact is immutable: a CDR's megabytes, minutes and cost never change, so storing it is a plain append.
-- @look Rows affected is 1; the next card is where the cost is.
-- @mongo db.cp_cdr_doc.insertOne(
-- @mongo   { _id: "S-001-1001", subscriberId: "S-001", ts: "2026-09-29T18:00:00", mb: 120, min: 12, cost: 0.36 }
-- @mongo )
INSERT INTO cp_cdr_doc
SELECT JSON_OBJECT('_id' VALUE 'S-001-1001', 'subscriberId' VALUE 'S-001',
         'ts' VALUE TIMESTAMP '2026-09-29 18:00:00', 'mb' VALUE 120, 'min' VALUE 12, 'cost' VALUE 0.36 RETURNING JSON)
FROM   dual;

-- @step Update the summary on the subscriber document
-- @note Three counters change; the whole ~6 KB subscriber document is rewritten. Once per CDR.
-- @why Update locality is the hot knob: every CDR updates the summary, and the summary lives inside the subscriber's full profile, so each update pays for every byte of it.
-- @look Rows affected is 1, but Measure it shows what that one row cost against a narrow summary row.
-- @figure doc-shape.svg The subscriber document as built: a full profile with the cycle-usage summary that every CDR updates
-- @mongo db.cp_subscriber_doc.updateOne(
-- @mongo   { _id: "S-001" },
-- @mongo   { $inc: { "cycleUsage.totalMB": 120, "cycleUsage.totalMin": 12, "cycleUsage.cost": 0.36 } }
-- @mongo )
UPDATE cp_subscriber_doc
SET data = JSON_TRANSFORM(data,
             SET '$.cycleUsage.totalMB'  = JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) + 120,
             SET '$.cycleUsage.totalMin' = JSON_VALUE(data,'$.cycleUsage.totalMin' RETURNING NUMBER) + 12,
             SET '$.cycleUsage.cost'     = JSON_VALUE(data,'$.cycleUsage.cost' RETURNING NUMBER) + 0.36)
WHERE JSON_VALUE(data,'$._id') = 'S-001';
COMMIT;

-- Measure it: the whole cost of one CDR in this design, both writes together.
-- @measure record-cdr
BEGIN
  INSERT INTO cp_cdr_doc
  SELECT JSON_OBJECT('_id' VALUE 'S-001-M', 'subscriberId' VALUE 'S-001',
           'ts' VALUE TIMESTAMP '2026-09-29 18:05:00', 'mb' VALUE 120, 'min' VALUE 12, 'cost' VALUE 0.36 RETURNING JSON)
  FROM   dual;
  UPDATE cp_subscriber_doc
  SET data = JSON_TRANSFORM(data,
               SET '$.cycleUsage.totalMB'  = JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) + 120,
               SET '$.cycleUsage.totalMin' = JSON_VALUE(data,'$.cycleUsage.totalMin' RETURNING NUMBER) + 12,
               SET '$.cycleUsage.cost'     = JSON_VALUE(data,'$.cycleUsage.cost' RETURNING NUMBER) + 0.36)
  WHERE JSON_VALUE(data,'$._id') = 'S-001';
END;
/
ROLLBACK;

-- The account page read the pattern optimizes for (one document, already summed):
-- @step Read the account page (summary already there)
-- @measure-read read
-- @note One document, one lookup: the CDRs' cost already landed on the writes. subscriber_doc_bytes is what every CDR rewrites.
-- @why Read/write: this is the read the pattern pays for, and it happens a couple of times a day; the 28 daily rate checks need only the three counters.
-- @look mb_this_cycle comes straight off the document; subscriber_doc_bytes shows the ~6 KB that every summary update rewrites.
-- @mongo db.cp_subscriber_doc.find(
-- @mongo   { _id: "S-001" },
-- @mongo   { _id: 1, "cycleUsage.totalMB": 1, "cycleUsage.cost": 1 }
-- @mongo )
SELECT JSON_VALUE(data,'$._id') AS subscriber,
       JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) AS mb_this_cycle,
       DBMS_LOB.GETLENGTH(JSON_SERIALIZE(data RETURNING CLOB)) AS subscriber_doc_bytes
FROM   cp_subscriber_doc
WHERE  JSON_VALUE(data,'$._id') = 'S-001';

-- The Top-N dashboard read the pattern does NOT help (full scan + sort every load):
-- @step Rank the top talkers (full scan + sort)
-- @note No rollup to seek on across subscribers: SORT and LIMIT the whole collection, every load.
-- @why Diversity bites here: the ops dashboard ranks usage across subscribers, and a summary inside each document gives it nothing to seek on, so every load sorts the whole collection.
-- @look Up to 5 subscribers ranked by mb_this_cycle, produced by sorting every document in the collection.
-- @mongo db.cp_subscriber_doc.find(
-- @mongo   {},
-- @mongo   { _id: 1, "cycleUsage.totalMB": 1 }
-- @mongo ).sort({ "cycleUsage.totalMB": -1 }).limit(5)
SELECT JSON_VALUE(data,'$._id') AS subscriber,
       JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) AS mb_this_cycle
FROM   cp_subscriber_doc
ORDER  BY JSON_VALUE(data,'$.cycleUsage.totalMB' RETURNING NUMBER) DESC
FETCH  FIRST 5 ROWS ONLY;
