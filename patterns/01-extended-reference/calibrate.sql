-- Calibration resize for Measure it: advisor A-001 serves :n clients on BOTH sides.
-- Document model: :n client docs embed a copy of A-001. Converged: :n client rows
-- reference the one A-001 row. C-003 (advisor A-002) stays as in the lab.
-- Background documents, once per sweep: a realistically populated collection, so the
-- lookup by _id is an index lookup as in production rather than a scan of a tiny table.
BEGIN
  FOR r IN (SELECT 1 FROM dual WHERE NOT EXISTS (SELECT 1 FROM xr_client_doc WHERE JSON_VALUE(data, '$._id') = 'C-BG00001')) LOOP
    INSERT INTO xr_client_doc SELECT JSON_OBJECT('_id' VALUE 'C-BG' || LPAD(k, 5, '0'), 'fullName' VALUE 'Client ' || k, 'segment' VALUE 'MASS', 'advisor' VALUE JSON_OBJECT('advisorId' VALUE 'A-BG', 'fullName' VALUE 'Background Advisor', 'office' VALUE 'CHI-02', 'desk' VALUE '+1-312-555-0100') RETURNING JSON) FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= 2000);
    COMMIT;
    DBMS_STATS.GATHER_SCHEMA_STATS(USER);
  END LOOP;
END;
/
DELETE FROM xr_client_doc WHERE JSON_VALUE(data, '$.advisor.advisorId') = 'A-001';
INSERT INTO xr_client_doc (data)
SELECT JSON_OBJECT('_id' VALUE 'C-' || TO_CHAR(100000 + LEVEL), 'fullName' VALUE 'Client ' || LEVEL, 'segment' VALUE 'HNW',
         'advisor' VALUE JSON_OBJECT('advisorId' VALUE 'A-001', 'fullName' VALUE 'Grace Advisor',
                                     'office' VALUE 'NYC-01', 'desk' VALUE '+1-212-555-0101') RETURNING JSON)
FROM   dual CONNECT BY LEVEL <= :n;
DELETE FROM xr_clients WHERE primary_advisor_id = 'A-001';
INSERT INTO xr_clients (client_id, full_name, segment, primary_advisor_id)
SELECT 'C-' || TO_CHAR(100000 + LEVEL), 'Client ' || LEVEL, 'HNW', 'A-001'
FROM   dual CONNECT BY LEVEL <= :n;
COMMIT;
