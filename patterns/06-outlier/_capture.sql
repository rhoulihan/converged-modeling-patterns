-- Capture the typical advisor document as seen from SQL (duality view
-- ol_advisor_dv), serialized to one JSON string, for cross-API parity.
SET HEADING OFF PAGESIZE 0 FEEDBACK OFF VERIFY OFF TRIMSPOOL ON
SET LINESIZE 32767 LONG 100000000 LONGCHUNKSIZE 1000000
SELECT JSON_SERIALIZE(data RETURNING CLOB)
FROM   ol_advisor_dv
WHERE  JSON_VALUE(data, '$._id') = 'A-001';
