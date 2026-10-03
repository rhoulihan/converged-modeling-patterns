-- ============================================================================
-- Pattern 05 · Tree / Hierarchy (materialized path) · THE DOCUMENT MODEL
-- Industry: manufacturing. Access pattern: explode a bill of materials -- read a
-- whole subassembly's components fast; ask "what is this part used in?"
--
-- The document move: store each part ONCE, with every MATERIALIZED PATH it sits
-- on -- the chain of ancestors as a string ("/P-1000/P-1100/P-1110"). A part
-- shared by two assemblies carries two paths in one array, and a multivalue
-- index covers every element. Then:
--
--   EXPLODE an assembly = one left-anchored prefix range scan on that index:
--   the cheapest hierarchy read there is, measured on 26ai at about 1.5x
--   cheaper than a CONNECT BY walk and 2.5x cheaper than a GRAPH_TABLE match.
--   WHERE-USED = read one document: its paths name every ancestor, shared
--   assemblies included. A change to the part (cost, revision) is one row.
--
-- THE COST, PAID ON THE WRITE: a path encodes position, so moving one
-- subassembly rewrites every descendant (one row each, whatever the number of
-- paths it carries). In the deck's workload that bill comes 200 times a day,
-- against 2 million explosions that each save on the read: the path wins until
-- a typical move passes roughly 80 times the size of a typical explosion.
-- On this engine the whole rewrite is one statement and one transaction.
-- Run:  sqlplus cmp_user/CmpUser2026@localhost:1521/FREEPDB1 @01-document-model.sql
-- ============================================================================

BEGIN
  FOR r IN (SELECT table_name FROM user_tables WHERE table_name = 'TR_BOM_DOC') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || r.table_name || ' PURGE';
  END LOOP;
END;
/

CREATE JSON COLLECTION TABLE tr_bom_doc;

-- A bicycle BOM, plus a trailer that shares the bicycle's wheel: the wheel and its
-- spoke are one document each, carrying both of their paths.
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1000","name":"Bicycle","paths":["/P-1000"]}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1100","name":"Wheelset","paths":["/P-1000/P-1100"]}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1110","name":"Wheel","paths":["/P-1000/P-1100/P-1110","/P-1300/P-1110"]}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1111","name":"Spoke","paths":["/P-1000/P-1100/P-1110/P-1111","/P-1300/P-1110/P-1111"]}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1200","name":"Frame","paths":["/P-1000/P-1200"]}'));
INSERT INTO tr_bom_doc VALUES (JSON('{"_id":"P-1300","name":"Trailer","paths":["/P-1300"]}'));
COMMIT;

-- One index entry per path: a prefix predicate on any element is a range scan.
-- (MongoDB API equivalent: db.tr_bom_doc.createIndex({ paths: 1 }), a multikey index.)
CREATE MULTIVALUE INDEX tr_ix_bom_paths ON tr_bom_doc t (t.data.paths.string());

-- The read the pattern is built for: everything under the wheelset, one range scan.
-- @step Explode the wheelset with one prefix scan
-- @measure-read read
-- @note Everything under the wheelset from one multivalue-index range scan: the genuine strength of the materialized path.
-- @why Read/write decides this pattern: two million explosions a day each become one left-anchored prefix scan. Measured on 26ai, that is about 1.5x cheaper than walking edges with CONNECT BY and 2.5x cheaper than a GRAPH_TABLE match, on every explosion.
-- @look The wheel and the spoke come back from one starts-with predicate over the paths array.
-- @figure doc-shape.svg One part document as built: every path it sits on, in one array, under one multivalue index
-- @mongo db.tr_bom_doc.find(
-- @mongo   { paths: { $regex: "^/P-1000/P-1100/" } },
-- @mongo   { _id: 1, name: 1 }
-- @mongo ).sort({ _id: 1 })
SELECT JSON_VALUE(data,'$._id') AS part, JSON_VALUE(data,'$.name') AS name
FROM   tr_bom_doc
WHERE  JSON_EXISTS(data, '$.paths?(@ starts with "/P-1000/P-1100/")')
ORDER  BY part;

-- Where-used: the part's own document names every ancestor, shared assemblies too.
-- @step Ask where the wheel is used
-- @note One document read: the wheel's paths name every assembly above it, including the trailer that shares it.
-- @why Diversity: where-used and recall impact run upward. Because the wheel is one document carrying every path it sits on, the answer is already stored: read it, and the ancestors are the path segments. No second structure, no traversal.
-- @look One row, two paths: one through the bicycle's wheelset, one through the trailer.
-- @mongo db.tr_bom_doc.find(
-- @mongo   { _id: "P-1110" },
-- @mongo   { name: 1, paths: 1 }
-- @mongo )
SELECT JSON_VALUE(data,'$.name') AS part, JSON_QUERY(data,'$.paths') AS paths
FROM   tr_bom_doc
WHERE  JSON_VALUE(data,'$._id') = 'P-1110';

-- ---------------------------------------------------------------------------
-- THE COST. Re-parent the wheelset under the frame. One logical move, but every
-- descendant's path changes: one rewrite per part in the subtree. The wheel's
-- trailer path is untouched, and the wheel is still one row.
-- ---------------------------------------------------------------------------
-- @step Re-parent the wheelset under the frame
-- @note One logical move, one rewrite per part in the moved subtree: the bill the path pays on every engineering change.
-- @why Update locality is where the path pays: position is stored, so a move rewrites every part beneath the moved node, one row each however many paths it carries. At 200 moves a day against 2 million explosions, that bill is the smaller one until a typical move passes about 80 times the size of a typical explosion. Here it is one statement in one transaction, so no explosion ever sees a half-moved subtree.
-- @look Rows affected is 3, one per part in the wheelset's subtree; Measure it shows the redo those rewrites cost.
-- @measure reparent
-- @mongo db.tr_bom_doc.updateMany(
-- @mongo   { paths: { $regex: "^/P-1000/P-1100" } },
-- @mongo   [{ $set: { paths: { $map: { input: "$paths", as: "p", in: { $cond: [
-- @mongo     { $eq: [{ $indexOfCP: ["$$p", "/P-1000/P-1100"] }, 0] },
-- @mongo     { $concat: ["/P-1000/P-1200", { $substrCP: ["$$p", 7, { $strLenCP: "$$p" }] }] },
-- @mongo     "$$p"
-- @mongo   ] } } } } }]
-- @mongo )
UPDATE tr_bom_doc t
SET data = JSON_TRANSFORM(data, SET '$.paths' =
             (SELECT JSON_ARRAYAGG(CASE WHEN p LIKE '/P-1000/P-1100%'
                                        THEN REPLACE(p, '/P-1000/P-1100', '/P-1000/P-1200/P-1100')
                                        ELSE p END ORDER BY n)
              FROM JSON_TABLE(t.data, '$.paths[*]' COLUMNS (n FOR ORDINALITY, p VARCHAR2(200) PATH '$')))
             FORMAT JSON)
WHERE JSON_EXISTS(data, '$.paths?(@ starts with "/P-1000/P-1100")');
COMMIT;

-- @step Confirm the subtree moved, and the shared path did not
-- @note The wheelset's parts now sit under the frame; the wheel's trailer path is unchanged.
-- @why Update locality again: the count is how many documents one engineering change rewrote, and the wheel shows a shared part keeps its other paths.
-- @look Three parts under /P-1000/P-1200/P-1100, and the wheel still lists /P-1300/P-1110.
-- @mongo db.tr_bom_doc.find(
-- @mongo   { paths: { $regex: "^/P-1000/P-1200/P-1100" } },
-- @mongo   { name: 1, paths: 1 }
-- @mongo ).sort({ _id: 1 })
SELECT JSON_VALUE(data,'$._id') AS part, JSON_QUERY(data,'$.paths') AS paths
FROM   tr_bom_doc
WHERE  JSON_EXISTS(data, '$.paths?(@ starts with "/P-1000/P-1200/P-1100")')
ORDER  BY part;
