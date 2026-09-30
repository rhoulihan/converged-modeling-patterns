-- ============================================================================
-- Pattern 05 · Tree / Hierarchy (materialized path) · THE DOCUMENT MODEL
-- Industry: manufacturing. Access pattern: explode a bill of materials -- read a
-- whole subassembly's components fast; ask "what is this part used in?"
--
-- The document move: store each component with a MATERIALIZED PATH -- the chain
-- of ancestors as a string ("/P-1000/P-1100/P-1110"). A subtree read becomes a
-- left-anchored prefix scan (LIKE '/P-1000/P-1100%'): an index range scan,
-- O(log n). Cheap subtree reads, and that is real.
--
-- THE WRITE-AMPLIFICATION COST: the path encodes position, so moving one
-- subassembly rewrites the path of EVERY descendant. Re-parent a wheelset and
-- you rewrite the wheelset, the wheel, the spoke, every node beneath it -- write
-- amplification proportional to the size of the subtree, for a single logical
-- move. And a genuine graph question -- "which assemblies use this spoke?"
-- (upward, multi-parent, N hops) -- a downward prefix string simply cannot express.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables WHERE table_name = 'TR_BOM_DOC') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE tr_bom_doc;

-- A bicycle BOM as a tree of materialized paths.
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1000","name":"Bicycle","path":"/P-1000"}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1100","name":"Wheelset","path":"/P-1000/P-1100"}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1110","name":"Wheel","path":"/P-1000/P-1100/P-1110"}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1111","name":"Spoke","path":"/P-1000/P-1100/P-1110/P-1111"}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1200","name":"Frame","path":"/P-1000/P-1200"}'));
COMMIT;

-- The read the pattern optimizes for: everything under the wheelset = one prefix
-- scan. This is the genuine strength of the materialized path.
-- @step Read a subtree with a prefix scan
-- @note Everything under the wheelset in one index range scan — the genuine strength of the materialized path.
-- @why Read/write is the path's case: two million explosions a day each become one left-anchored prefix scan, the cheapest hierarchy read there is.
-- @look Wheelset, wheel and spoke come back in path order from one LIKE prefix predicate.
-- @figure doc-shape.svg One part document as built: a materialized path encodes its position
SELECT JSON_VALUE(data,'$._id') AS part, JSON_VALUE(data,'$.name') AS name
FROM   tr_bom_doc
WHERE  JSON_VALUE(data,'$.path') LIKE '/P-1000/P-1100%'
ORDER  BY JSON_VALUE(data,'$.path');

-- ---------------------------------------------------------------------------
-- THE NEEDLE FLIPS HERE. Re-parent the wheelset under the frame. One logical
-- move, but every descendant's path must be rewritten -- a whole-document
-- rewrite per node in the subtree.
-- ---------------------------------------------------------------------------
-- @step Re-parent the wheelset under the frame
-- @note One logical move, but every descendant's path must be rewritten — a whole-document rewrite per node in the subtree.
-- @why Update locality is the hot knob: the path stores position, so one move is a read-modify-write of every part document beneath the moved node. A 40,000-part module move is 40,000 rewrites.
-- @look Rows affected is 3, one per part in the wheelset's subtree; Measure it shows the redo those rewrites cost.
-- @measure reparent
UPDATE tr_bom_doc
SET data = JSON_TRANSFORM(data,
             SET '$.path' = REPLACE(JSON_VALUE(data,'$.path'),
                                    '/P-1000/P-1100', '/P-1000/P-1200/P-1100'))
WHERE JSON_VALUE(data,'$.path') LIKE '/P-1000/P-1100%';
COMMIT;

-- @step Confirm every descendant moved
-- @note Count of docs now carrying the new path prefix — one logical move, one rewrite per descendant.
-- @why Update locality again: the count is how many documents one engineering change touched. At production scale those rewrites run as a batch, not one atomic change.
-- @look The write_amplification line reports 3 descendant docs rewritten.
SELECT 'reparent rewrote ' || COUNT(*) || ' descendant docs' AS write_amplification
FROM   tr_bom_doc
WHERE  JSON_VALUE(data,'$.path') LIKE '/P-1000/P-1200/P-1100%';
