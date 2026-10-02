-- Calibration resize for Measure it: :n is the subscriber document's size in KB.
-- S-001's profile is rebuilt on BOTH sides with enough account-history entries to
-- reach ~:n KB (about 153 B per entry over a ~0.7 KB base, measured). Only the
-- document model's write feels it: the summary update rewrites the whole document,
-- while the converged summary row never touches the profile.
-- Document model: rebuild the S-001 document at ~:n KB, summary unchanged.
UPDATE cp_subscriber_doc
SET    data = JSON_TRANSFORM(data, SET '$.profile' =
       JSON_OBJECT(
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
           FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= GREATEST(1, ROUND((:n * 1024 - 743) / 153))))
         RETURNING JSON))
WHERE  JSON_VALUE(data, '$._id') = 'S-001';
-- Converged: the same profile on cp_subscribers (a CDR never reads or writes it).
UPDATE cp_subscribers
SET    profile =
       JSON_OBJECT(
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
           FROM (SELECT LEVEL AS k FROM dual CONNECT BY LEVEL <= GREATEST(1, ROUND((:n * 1024 - 743) / 153))))
         RETURNING JSON)
WHERE  subscriber_id = 'S-001';
COMMIT;
