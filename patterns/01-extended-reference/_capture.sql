-- Capture the projected client document AS SEEN FROM SQL (the duality view
-- xr_client_dv), serialized to one JSON string. run.sh injects this into
-- 03-parity.js as $SQL_RESULT to compare against the same document read through
-- the MongoDB API.
SET HEADING OFF PAGESIZE 0 FEEDBACK OFF VERIFY OFF TRIMSPOOL ON
SET LINESIZE 32767 LONG 100000000 LONGCHUNKSIZE 1000000
SELECT JSON_SERIALIZE(data RETURNING CLOB)
FROM   xr_client_dv
WHERE  JSON_VALUE(data, '$._id') = 'C-001';
