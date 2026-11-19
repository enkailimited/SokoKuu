-- Correct the ImageKit CDN endpoint used by SokoKuu.
-- The account endpoint is https://ik.imagekit.io/ochspoiwa/sokokuutz, so any
-- row that was seeded/stored with the previous shorter path must be rewritten
-- to the real account-scoped path. This is a data-only migration.

UPDATE soko_global_catalog
   SET static_image_url = REPLACE(
         static_image_url,
         'https://ik.imagekit.io/sokokuutz/',
         'https://ik.imagekit.io/ochspoiwa/sokokuutz/'
       ),
       imagekit_cdn_url = REPLACE(
         imagekit_cdn_url,
         'https://ik.imagekit.io/sokokuutz/',
         'https://ik.imagekit.io/ochspoiwa/sokokuutz/'
       )
 WHERE static_image_url LIKE 'https://ik.imagekit.io/sokokuutz/%'
    OR imagekit_cdn_url LIKE 'https://ik.imagekit.io/sokokuutz/%';

UPDATE merchant_cloned_products
   SET imagekit_cdn_url = REPLACE(
         imagekit_cdn_url,
         'https://ik.imagekit.io/sokokuutz/',
         'https://ik.imagekit.io/ochspoiwa/sokokuutz/'
       )
 WHERE imagekit_cdn_url LIKE 'https://ik.imagekit.io/sokokuutz/%';

UPDATE supplier_catalog_listings
   SET imagekit_cdn_url = REPLACE(
         imagekit_cdn_url,
         'https://ik.imagekit.io/sokokuutz/',
         'https://ik.imagekit.io/ochspoiwa/sokokuutz/'
       )
 WHERE imagekit_cdn_url LIKE 'https://ik.imagekit.io/sokokuutz/%';

UPDATE business_profiles
   SET logo_cdn_url = REPLACE(
         logo_cdn_url,
         'https://ik.imagekit.io/sokokuutz/',
         'https://ik.imagekit.io/ochspoiwa/sokokuutz/'
       )
 WHERE logo_cdn_url LIKE 'https://ik.imagekit.io/sokokuutz/%';
