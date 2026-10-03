-- Calibration resize for Measure it: the whale advisor A-900 has :n clients on BOTH sides,
-- generated as the lab's 800 are. Ids start at C-700001 so they never collide with the
-- measured C-900801 when :n exceeds 800.
-- Background documents, once per sweep: a realistically populated collection, so the
-- lookup by _id is an index lookup as in production rather than a scan of a one-row table.
BEGIN
  FOR r IN (SELECT 1 FROM dual WHERE NOT EXISTS (SELECT 1 FROM ol_advisor_doc WHERE JSON_VALUE(data, '$._id') = 'A-BG00001')) LOOP
    INSERT INTO ol_advisor_doc SELECT JSON_OBJECT('_id' VALUE 'A-BG' || LPAD(k, 5, '0'), 'name' VALUE 'Advisor ' || k, 'hasExtras' VALUE FALSE, 'clients' VALUE JSON_ARRAY(JSON_OBJECT('clientId' VALUE 'C-B' || k, 'aum' VALUE 250000)) RETURNING JSON) FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= 2000);
    INSERT INTO ol_advisor_overflow SELECT JSON_OBJECT('_id' VALUE 'OF-BG' || LPAD(k, 4, '0'), 'advisorId' VALUE 'A-BG' || LPAD(k, 5, '0'), 'clients' VALUE JSON_ARRAY(JSON_OBJECT('clientId' VALUE 'C-BO' || k, 'aum' VALUE 100000)) RETURNING JSON) FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= 200);
    COMMIT;
    DBMS_STATS.GATHER_SCHEMA_STATS(USER);
  END LOOP;
END;
/
DELETE FROM ol_advisor_doc WHERE JSON_VALUE(data, '$._id') = 'A-900';
INSERT INTO ol_advisor_doc
SELECT JSON_OBJECT('_id' VALUE 'A-900', 'name' VALUE 'Institutional Desk', 'hasExtras' VALUE FALSE,
         'clients' VALUE clients RETURNING JSON)
FROM  (SELECT JSON_ARRAYAGG(JSON_OBJECT('clientId' VALUE 'C-' || TO_CHAR(700000 + LEVEL),
                                        'aum'      VALUE 9000000 - (LEVEL - 1) * 1000)
                            ORDER BY LEVEL RETURNING JSON) AS clients
       FROM   dual CONNECT BY LEVEL <= :n);
DELETE FROM ol_clients WHERE advisor_id = 'A-900';
INSERT INTO ol_clients (client_id, advisor_id, aum)
SELECT 'C-' || TO_CHAR(700000 + LEVEL), 'A-900', 9000000 - (LEVEL - 1) * 1000
FROM   dual CONNECT BY LEVEL <= :n;
COMMIT;
