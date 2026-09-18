-- 0009_knowledge_library_seed.sql — the initial Knowledge Library hierarchy.
--
-- Apply with the DIRECT host:
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f migrations/0009_knowledge_library_seed.sql
--
-- Folders only. No resource rows are invented here: a resource exists once its
-- file has been uploaded through the admin console and run through the existing
-- extract -> chunk -> embed pipeline. Where the source hierarchy lists a file
-- that has not been uploaded yet, its name and link are recorded as a comment
-- beneath its folder so whoever uploads it knows where it belongs.
--
-- Re-runnable: every node is matched on (parent, name) and updated in place, so
-- applying this twice changes nothing and never duplicates a branch.
--
-- Kept separate from 0008 on the same principle as 0001/0002 — schema and data
-- are applied and reviewed independently.

BEGIN;

-- Session-local helper. pg_temp is dropped when the connection closes, so this
-- leaves nothing behind in the database.
CREATE FUNCTION pg_temp.folder(
  p_parent uuid,
  p_name   text,
  p_kind   text,
  p_owner  text,
  p_url    text,
  p_ord    int
) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
    FROM knowledge_folders
   WHERE name = p_name
     AND parent_id IS NOT DISTINCT FROM p_parent;

  IF v_id IS NULL THEN
    INSERT INTO knowledge_folders (parent_id, name, kind, owner_name, drive_url, sort_order)
    VALUES (p_parent, p_name, p_kind, p_owner, p_url, p_ord)
    RETURNING id INTO v_id;
  ELSE
    UPDATE knowledge_folders
       SET kind = p_kind, owner_name = p_owner, drive_url = p_url, sort_order = p_ord
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END $fn$;

DO $seed$
DECLARE
  d  CONSTANT text := 'https://drive.google.com/drive/folders/';
  root      uuid;
  amazon    uuid;
  ebay      uuid;
  shopify   uuid;
  model     uuid;
  section   uuid;
BEGIN
  root := pg_temp.folder(NULL, 'LcMA_BGCT_Intern_mode', 'root', NULL,
                         d || '19udJAbkLw9G88vHUDb4Hk_CY3V17Mras', 0);

  -- =========================================================================
  -- Amazon
  -- =========================================================================
  amazon := pg_temp.folder(root, 'Amazon', 'platform', NULL,
                           d || '17UfJxQAQykJNWh4LJCO7Vjl1XL8mHoD4', 10);

  -- Amazon / Model_01 — sections, each holding one method folder.
  model := pg_temp.folder(amazon, 'Model_01', 'model', 'Thineshkaran''s',
                          d || '1O9XWiGu9XlcPA_Q6HWVB6mS1CLv8zWgY', 10);

  section := pg_temp.folder(model, '00. Platform approach', 'section', NULL,
                            d || '1S9GDOwLgdAIHsKfOGrkyA06gxkOh1lfp', 0);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '163AwnBOUCqcbV7e8IpFD31x1hc9JaseR', 0);

  section := pg_temp.folder(model, '01. Title', 'section', NULL,
                            d || '1x-aXQUKK9ZBuAboa0BUWHOHGjTj3jKEz', 10);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '191gdDudOWwgNusRCEJC27TjU8igeJb1s', 0);

  section := pg_temp.folder(model, '02. Bullet Points', 'section', NULL,
                            d || '1GnNmNTNFjWHU4o_QrFGiEj4GYR4_hXq4', 20);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1CzgHXqx-xl3QSP4E2YBWzbqgB7JJerRF', 0);

  section := pg_temp.folder(model, '03. Description / A+ Content', 'section', NULL,
                            d || '1tv9S8oOW5waBar2ish2LrMOk9xcweFsq', 30);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1jic-2VM0wUUpDgWeoJDLZkYY5QQHIrUK', 0);

  section := pg_temp.folder(model, '04. Images', 'section', NULL,
                            d || '19L1ZP8pJGB8Z2hAMzB3sxtBBA_dw6kA5', 40);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1YmQoW9sF1AWWcl6S6LdBx1-4I0lV7u1d', 0);

  section := pg_temp.folder(model, '05. Competitor analysis', 'section', NULL,
                            d || '1_I70dbEfA2J00E5al_SAPv8zyz3etqfE', 50);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1s-DE_doXlolkJOBzKbaxiD3cbL9sU8Zu', 0);

  section := pg_temp.folder(model, '06. Price', 'section', NULL,
                            d || '1VNYnPTFAu5gg_WTO4sc1G-zb3GAODAT7', 60);
  PERFORM pg_temp.folder(section, 'BLOS Price', 'method', NULL,
                         d || '1oGZ46IxhvXR1wwaJUa8h2w_Z1UP7FwWl', 0);

  section := pg_temp.folder(model, '07. Search terms', 'section', NULL,
                            d || '1F4mDvz2iTUZtZ78ub-cKT5UreQ2kTxRD', 70);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1B4toXrEt4tTedzFUqVC4UsnDQc_5Za0X', 0);

  -- Amazon / Model_02 — resources sit directly on the model (ragged depth).
  --   LcMA_amazon_new_listing_model_02_amazon_listing_standard_bietrick
  --     docs.google.com/document/d/1wEpNTwawLRWlb3uMbeBeB5Xf0uNDMd8R
  --   LcMA_amazon_new_listing_model_02_hand_book_bietrick
  --     docs.google.com/document/d/1qCeY9e2xnAHj2lO7OMSCSNG-xnQvh3XY
  PERFORM pg_temp.folder(amazon, 'Model_02', 'model', 'Bietrick''s',
                         d || '1zaUVKszUO8LNiZ1ph7FCDa25DfCRBfYW', 20);

  -- Amazon / Model_03 — resources sit on the section, with no method level.
  model := pg_temp.folder(amazon, 'Model_03', 'model', 'Farshad''s',
                          d || '1I9vfYiJfIgdZdwjruQsHuDNjJfdfEMJp', 30);
  --   .../document/d/1xWNaKZe5gq09QIKnWnDYUXE27A76DF63  (title)
  PERFORM pg_temp.folder(model, '01. Title', 'section', NULL,
                         d || '1EuAx5HuWDGDib8-c7Qd-vs2bMwyhWCsZ', 0);
  --   .../document/d/1d1wB4APRbb0A_cXv0ZL8WKl3LPdaAami  (bullet points)
  PERFORM pg_temp.folder(model, '02. Bullet points', 'section', NULL,
                         d || '13sihquIlEtnTQOE5Xm7KmAOLLc5kJQXk', 10);
  --   .../document/d/106wpXdCDf0vyVvWpXPysof7L-0tZyhn8  (keyword optimisation)
  PERFORM pg_temp.folder(model, '03. Keywords', 'section', NULL,
                         d || '10T4NeKSCIKNhRbK1jMSRK7536YnFyFxc', 20);
  --   .../document/d/1doxt7dKCbaJfi67_G8YbRIawpypv-Dhc  (description)
  PERFORM pg_temp.folder(model, '04. Description', 'section', NULL,
                         d || '1S4XtcDFjQk3rIgU02ksYEnzSSk-ECvZc', 30);

  -- =========================================================================
  -- eBay
  -- =========================================================================
  ebay := pg_temp.folder(root, 'eBay', 'platform', NULL,
                         d || '1-O9jBg_z6z3zX74UkxvVevg1brVjqRiO', 20);

  model := pg_temp.folder(ebay, 'Model_01', 'model', 'Thineshkaran''s',
                          d || '1JUvpP-IpWpMB3F3pl-To35p8z7tt2Q54', 10);

  section := pg_temp.folder(model, '00. Platform Approach', 'section', NULL,
                            d || '1ZwdQULMtE5SdsUzPqSWFtMCp4QfqhxK_', 0);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1sTY6ksjmM3gEx6uNL3ajSUGZ_yXtBArJ', 0);

  section := pg_temp.folder(model, '01. Title', 'section', NULL,
                            d || '1TOpASDOfRuCmHcQO3d2RpOCSijWZQoFT', 10);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1rEH3wAkysDBOeumslEcP0hnAKzpiLLEk', 0);

  section := pg_temp.folder(model, '02. Description', 'section', NULL,
                            d || '1R9weM4QpsRnonA2L_65QwZ2SdBK8xw3o', 20);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1Z-Wjfy1vdmNzJ_EcMz91Prp2hA_5KNUL', 0);

  section := pg_temp.folder(model, '03. Images+Video', 'section', NULL,
                            d || '1HPMWpeMRyHJG06tpR-frXhHMgba1R5s7', 30);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1xwMENa96c7t9_TvDE3fxaAu4XeScyGsk', 0);

  section := pg_temp.folder(model, '04. Competitor analysis', 'section', NULL,
                            d || '1c6qifm_lZ-0MZdo4aTkv9NI7c2mK-5zR', 40);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1oy5_moNUESR4KTBtvVvZ7XXq6Kaeax36', 0);

  section := pg_temp.folder(model, '05. Price', 'section', NULL,
                            d || '1SEaRxXmardAOhXvxhmIosJzFhyCIGYcb', 50);
  PERFORM pg_temp.folder(section, 'BLOS Price', 'method', NULL,
                         d || '1oGZ46IxhvXR1wwaJUa8h2w_Z1UP7FwWl', 0);

  section := pg_temp.folder(model, '06. Findability check', 'section', NULL,
                            d || '1wktwkDGDStm8sNZpTqT0c0BAs5ZOSRfa', 60);
  PERFORM pg_temp.folder(section, 'Method_01', 'method', NULL,
                         d || '1wHgAdJPme5Q3yyKFQjZDWKaqw7kIMqyh', 0);

  -- eBay / Model_02 — the same shared handbook as Amazon / Model_02.
  --   LcMA_amazon_new_listing_model_02_hand_book_bietrick
  --     docs.google.com/document/d/1qCeY9e2xnAHj2lO7OMSCSNG-xnQvh3XY
  PERFORM pg_temp.folder(ebay, 'Model_02', 'model', 'Bietrick''s',
                         d || '1zaUVKszUO8LNiZ1ph7FCDa25DfCRBfYW', 20);

  -- =========================================================================
  -- Shopify
  -- =========================================================================
  shopify := pg_temp.folder(root, 'Shopify', 'platform', NULL,
                            d || '1tqGps_KgOTQ1U75Yc5hqhJn7ZLxH8QlH', 30);

  -- Model_01 — one resource directly on the model.
  --   LcMA_shopify_new_listing_model_02_Ajintha
  --     drive.google.com/file/d/1lxrQaeS14m-sU4nz9W2TshbRgyPUcNrj
  PERFORM pg_temp.folder(shopify, 'Model_01', 'model', 'Ajintha''s',
                         d || '1rfmFFhnevZ6mfHEGNAgV-VkqtO-GwcvO', 10);

  -- Model_02 — seven workflow resources directly on the model.
  --   CNM-PRC-001__Product_Price_Optimisation__WORKFLOW_v1_0
  --     .../document/d/1ly29h2Bcd4iA_g1UE6tlXjkNTv8MoNIO
  --   CNM-SHP-DESC-001__SHOPIFY_Product_Description_Optimization_WORKFLOW_v2.0
  --     .../document/d/1SG28YQkoJe79T5kFZmjqfAJJFBZYAtHF
  --   CNM-SHP-FAQ-001__SHOPIFY_Product_FAQ_Optimization_WORKFLOW_v2.0
  --     .../document/d/1sfaNsq_PuR6oJK7Q_1EG1A03CfJuhUjR
  --   CNM-SHP-IMG-001__SHOPIFY_Image_Optimisation__WORKFLOW_v2_0
  --     .../document/d/17qlJff0HA-eqRdf4vm5WiTPjZlsMk9oY
  --   CNM-SHP-METADESC-001__SHOPIFY_MetaDescription_Optimisation__WORKFLOW_v2.0
  --     .../document/d/1nVP-40CVH24Ffq7o-wwRGzzaMHjrmnIe
  --   CNM-SHP-METATITLE-001__SHOPIFY_MetaTitle_Optimisation__WORKFLOW_v2.0
  --     .../document/d/1uhCdHcs_x5OfaMyYtW6BwPeAXbnrV54r
  --   CNM-SHP-TITLE-001__SHOPIFY_Title_Optimisation__WORKFLOW_v2.0
  --     .../document/d/1h5iGPXVMm8Y1jDo_R3to5xJo5XZXUvLA
  PERFORM pg_temp.folder(shopify, 'Model_02', 'model', 'Muguntha''s',
                         d || '1siuYkdKdEumG4XH30wowlmk2lWS-63IM', 20);

  -- Model_03 — three resources directly on the model.
  --   LcMA_shopify_new_listing_model_04_competitor_analysis_keyword_research_thinesh
  --     .../document/d/1RI6IvrvyI_vswp6rypYhRuB8EtYzo4FC
  --   LcMA_shopify_new_listing_model_04_guide_thinesh
  --     .../document/d/15l-6QxoMoH2dacb2LlL5J6NT-gZFjJQk
  --   LcMA_shopify_new_listing_model_04_title_meta_title_meta_description_thinesh
  --     .../document/d/1rdQp5zDrBES9yx4fxLSA1PJCguV2LidH
  PERFORM pg_temp.folder(shopify, 'Model_03', 'model', 'Thineshkaran''s',
                         d || '1TpWzjR3VfGq3_Tv2rofQFwgHsOuzs1WZ', 30);

  -- Model_04 — thirteen sections, no resources uploaded yet.
  model := pg_temp.folder(shopify, 'Model_04', 'model', 'Meshika''s',
                          d || '1ISDb8CZeIpqveTkjOqctzxQ4xP9yUeSY', 40);

  PERFORM pg_temp.folder(model, '01. Product Reference', 'section', NULL,
                         d || '17oYNVHJIvTZdhreNQHBuxwlWV_W4gvpe', 0);
  PERFORM pg_temp.folder(model, '02. Product Organization', 'section', NULL,
                         d || '1jQi6qRBq576HJuni-eUmJdkFe6zbrzxv', 10);
  PERFORM pg_temp.folder(model, '03. Keyword research', 'section', NULL,
                         d || '1G1MrHSi996rbmv3mXIVCbPhItrR5cJBD', 20);
  PERFORM pg_temp.folder(model, '04. Competitor analysis', 'section', NULL,
                         d || '1tG11IdOb-rbwPmgLYq87S3foj9Mb76DO', 30);
  PERFORM pg_temp.folder(model, '05. Title and description', 'section', NULL,
                         d || '1cJm3qBdWi4Gx7WAiRiLbHUYOopn2tW1T', 40);
  PERFORM pg_temp.folder(model, '06. Meta title and description', 'section', NULL,
                         d || '1JrXwhMGryeP0SxQwpREjDhO42lUbut6Q', 50);
  PERFORM pg_temp.folder(model, '07. Images', 'section', NULL,
                         d || '1KyiclgnxJDWG1g_6JLT0PyXMN95AC4uY', 60);
  PERFORM pg_temp.folder(model, '08. Videos', 'section', NULL,
                         d || '1OjwdQh9u4qITX_9zYF88tExJ9-jKwMxC', 70);
  PERFORM pg_temp.folder(model, '09. Specification', 'section', NULL,
                         d || '1XylXubmPyL3G7K7RcQPkvYr0Y4B5Tq9u', 80);
  PERFORM pg_temp.folder(model, '10. Feed optimisation', 'section', NULL,
                         d || '1oeiu9Y3t01l-gmjLb-aJJRn9T9-JpAGa', 90);
  PERFORM pg_temp.folder(model, '11. PPC Addition', 'section', NULL,
                         d || '1apvjtYf222in-WrpUuJC6c438LtZPX-h', 100);
  PERFORM pg_temp.folder(model, '12. Listing creation', 'section', NULL,
                         d || '1stTCKsGMFu1TfZhsPECkTuJpVQUcLu2i', 110);
  PERFORM pg_temp.folder(model, '13. Final check', 'section', NULL,
                         d || '1KtLq2OQlpmMRn2gu08hV8TKKG09uTLST', 120);
END $seed$;

COMMIT;
