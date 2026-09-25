-- Capture the subscriber document as seen from SQL (duality view cp_subscriber_dv),
-- serialized to one JSON string, for cross-API parity against the MongoDB API.
SET HEADING OFF PAGESIZE 0 FEEDBACK OFF VERIFY OFF TRIMSPOOL ON
SET LINESIZE 32767 LONG 100000000 LONGCHUNKSIZE 1000000
SELECT JSON_SERIALIZE(data RETURNING CLOB)
FROM   cp_subscriber_dv
WHERE  JSON_VALUE(data, '$._id') = 'S-001';
