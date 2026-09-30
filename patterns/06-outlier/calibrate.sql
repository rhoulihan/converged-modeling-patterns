-- Calibration resize for Measure it: the whale advisor A-900 has :n clients on BOTH sides,
-- generated as the lab's 800 are. Ids start at C-700001 so they never collide with the
-- measured C-900801 when :n exceeds 800.
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
