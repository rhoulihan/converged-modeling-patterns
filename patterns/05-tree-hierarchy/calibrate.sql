-- Calibration resize for Measure it: the wheelset subtree (P-1100, P-1110, P-1111) holds :n
-- parts on BOTH sides -- the lab's 3 plus :n - 3 generated spokes under the wheel P-1110.
DELETE FROM tr_bom_doc WHERE JSON_VALUE(data, '$._id') LIKE 'P-S%';
INSERT INTO tr_bom_doc (data)
SELECT JSON_OBJECT('_id' VALUE 'P-S' || LPAD(k, 6, '0'), 'name' VALUE 'Spoke ' || k,
         'path' VALUE '/P-1000/P-1100/P-1110/P-S' || LPAD(k, 6, '0') RETURNING JSON)
FROM  (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= :n)
WHERE  k <= :n - 3;
DELETE FROM tr_bom_edges WHERE child_id LIKE 'P-S%';
DELETE FROM tr_parts WHERE part_id LIKE 'P-S%';
INSERT INTO tr_parts (part_id, name)
SELECT 'P-S' || LPAD(k, 6, '0'), 'Spoke ' || k
FROM  (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= :n)
WHERE  k <= :n - 3;
INSERT INTO tr_bom_edges (parent_id, child_id, qty)
SELECT 'P-1110', 'P-S' || LPAD(k, 6, '0'), 1
FROM  (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= :n)
WHERE  k <= :n - 3;
COMMIT;
