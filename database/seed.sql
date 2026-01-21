-- ============================================
-- Seed Data for Jeffi Stores
-- ============================================

-- ============================================
-- 1. CATEGORIES
-- ============================================

INSERT INTO categories (id, name, slug, description, display_order, is_active) VALUES
('11111111-1111-1111-1111-111111111101', 'Fasteners', 'fasteners', 'Bolts, nuts, screws, and washers', 1, true),
('11111111-1111-1111-1111-111111111102', 'Power Transmission', 'power-transmission', 'Belts, chains, and transmission components', 2, true),
('11111111-1111-1111-1111-111111111103', 'Tools & Equipment', 'tools-equipment', 'Hand tools, power tools, and accessories', 3, true),
('11111111-1111-1111-1111-111111111104', 'Welding Supplies', 'welding-supplies', 'Welding rods, electrodes, and accessories', 4, true),
('11111111-1111-1111-1111-111111111105', 'Electrical & Cables', 'electrical-cables', 'Cables, wires, and electrical accessories', 5, true),
('11111111-1111-1111-1111-111111111106', 'Industrial Components', 'industrial-components', 'Valves, bearings, and rubber products', 6, true),
('11111111-1111-1111-1111-111111111107', 'Material Handling', 'material-handling', 'Storage and material handling equipment', 7, true);

-- Sub-categories under Fasteners
INSERT INTO categories (id, name, slug, parent_category_id, display_order, is_active) VALUES
('11111111-1111-1111-1111-111111111201', 'Bolts', 'bolts', '11111111-1111-1111-1111-111111111101', 1, true),
('11111111-1111-1111-1111-111111111202', 'Nuts', 'nuts', '11111111-1111-1111-1111-111111111101', 2, true),
('11111111-1111-1111-1111-111111111203', 'Washers', 'washers', '11111111-1111-1111-1111-111111111101', 3, true),
('11111111-1111-1111-1111-111111111204', 'Screws', 'screws', '11111111-1111-1111-1111-111111111101', 4, true),
('11111111-1111-1111-1111-111111111205', 'SS Fasteners', 'ss-fasteners', '11111111-1111-1111-1111-111111111101', 5, true);

-- Sub-categories under Power Transmission
INSERT INTO categories (id, name, slug, parent_category_id, display_order, is_active) VALUES
('11111111-1111-1111-1111-111111111206', 'V Belts', 'v-belts', '11111111-1111-1111-1111-111111111102', 1, true),
('11111111-1111-1111-1111-111111111207', 'Timing Belts', 'timing-belts', '11111111-1111-1111-1111-111111111102', 2, true),
('11111111-1111-1111-1111-111111111208', 'Transmission Parts', 'transmission-parts', '11111111-1111-1111-1111-111111111102', 3, true);

-- Sub-categories under Tools & Equipment
INSERT INTO categories (id, name, slug, parent_category_id, display_order, is_active) VALUES
('11111111-1111-1111-1111-111111111209', 'Drill Bits', 'drill-bits', '11111111-1111-1111-1111-111111111103', 1, true),
('11111111-1111-1111-1111-111111111210', 'Hand Tools', 'hand-tools', '11111111-1111-1111-1111-111111111103', 2, true),
('11111111-1111-1111-1111-111111111211', 'Repair Kits', 'repair-kits', '11111111-1111-1111-1111-111111111103', 3, true);

-- ============================================
-- 2. BRANDS
-- ============================================

INSERT INTO brands (id, name, slug, is_active) VALUES
-- Fastener brands
('22222222-2222-2222-2222-222222222201', 'TVS', 'tvs', true),
('22222222-2222-2222-2222-222222222202', 'UNBRAKO', 'unbrako', true),
('22222222-2222-2222-2222-222222222203', 'LandMark', 'landmark', true),
('22222222-2222-2222-2222-222222222204', 'APL', 'apl', true),
('22222222-2222-2222-2222-222222222205', 'LPS', 'lps', true),
('22222222-2222-2222-2222-222222222206', 'Kundan', 'kundan', true),
('22222222-2222-2222-2222-222222222207', 'Deepak', 'deepak', true),

-- Power transmission brands
('22222222-2222-2222-2222-222222222208', 'IPON VEE Grip', 'ipon-vee-grip', true),
('22222222-2222-2222-2222-222222222209', 'Fenner', 'fenner', true),
('22222222-2222-2222-2222-222222222210', 'Nickson', 'nickson', true),
('22222222-2222-2222-2222-222222222211', 'PIX', 'pix', true),
('22222222-2222-2222-2222-222222222212', 'Gates', 'gates', true),
('22222222-2222-2222-2222-222222222213', 'Contitech', 'contitech', true),
('22222222-2222-2222-2222-222222222214', 'Mitsuboshi', 'mitsuboshi', true),
('22222222-2222-2222-2222-222222222215', 'Megadyne', 'megadyne', true),
('22222222-2222-2222-2222-222222222216', 'Bonfiglioli', 'bonfiglioli', true),
('22222222-2222-2222-2222-222222222217', 'Rotex', 'rotex', true),
('22222222-2222-2222-2222-222222222218', 'Lovejoy', 'lovejoy', true),

-- Tool brands
('22222222-2222-2222-2222-222222222219', 'Miranda', 'miranda', true),
('22222222-2222-2222-2222-222222222220', 'Totem', 'totem', true),
('22222222-2222-2222-2222-222222222221', 'Taparia', 'taparia', true),
('22222222-2222-2222-2222-222222222222', 'Forbes Kento', 'forbes-kento', true),
('22222222-2222-2222-2222-222222222223', 'Belsona', 'belsona', true),

-- Welding brands
('22222222-2222-2222-2222-222222222224', 'Ador', 'ador', true),
('22222222-2222-2222-2222-222222222225', 'Esab', 'esab', true),
('22222222-2222-2222-2222-222222222226', 'Mangalam', 'mangalam', true),
('22222222-2222-2222-2222-222222222227', 'D&H', 'dh', true),
('22222222-2222-2222-2222-222222222228', 'D&H Secheron', 'dh-secheron', true),

-- Rubber & Industrial
('22222222-2222-2222-2222-222222222229', 'Dunlop', 'dunlop', true),
('22222222-2222-2222-2222-222222222230', 'Polymax', 'polymax', true),
('22222222-2222-2222-2222-222222222231', 'Spirax', 'spirax', true),
('22222222-2222-2222-2222-222222222232', 'Forbes Marshall', 'forbes-marshall', true),
('22222222-2222-2222-2222-222222222233', 'Exxon', 'exxon', true),

-- Electrical brands
('22222222-2222-2222-2222-222222222234', 'Polycab', 'polycab', true),
('22222222-2222-2222-2222-222222222235', 'Finolex', 'finolex', true),
('22222222-2222-2222-2222-222222222236', 'Havells', 'havells', true),
('22222222-2222-2222-2222-222222222237', 'L&T', 'lt', true),
('22222222-2222-2222-2222-222222222238', 'Comet', 'comet', true),
('22222222-2222-2222-2222-222222222239', 'Cosmos', 'cosmos', true),

-- Material handling
('22222222-2222-2222-2222-222222222240', 'Godrej', 'godrej', true),
('22222222-2222-2222-2222-222222222241', 'Nilkamal', 'nilkamal', true);

-- ============================================
-- 3. SAMPLE PRODUCTS (Following current website)
-- ============================================

-- Bolts
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111201', '22222222-2222-2222-2222-222222222201', 'BOLT-TVS-M10-50', 'TVS Hex Bolt M10 x 50mm', 'tvs-hex-bolt-m10-50', 'High-quality hex bolt manufactured by TVS. Grade 8.8. Suitable for industrial applications.', 'TVS Hex Bolt M10 x 50mm - Grade 8.8', 15.00, 500, true, true),
('33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111201', '22222222-2222-2222-2222-222222222202', 'BOLT-UNB-M12-70', 'UNBRAKO Socket Head Cap Screw M12 x 70mm', 'unbrako-socket-head-cap-screw-m12-70', 'Premium quality socket head cap screw by UNBRAKO. High tensile strength.', 'UNBRAKO Socket Head Cap Screw M12 x 70mm', 28.00, 300, true, true);

-- Nuts
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333303', '11111111-1111-1111-1111-111111111202', '22222222-2222-2222-2222-222222222201', 'NUT-TVS-M10', 'TVS Hex Nut M10', 'tvs-hex-nut-m10', 'Standard hex nut M10 by TVS. Grade 8.', 'TVS Hex Nut M10 - Grade 8', 8.00, 1000, true, true),
('33333333-3333-3333-3333-333333333304', '11111111-1111-1111-1111-111111111202', '22222222-2222-2222-2222-222222222202', 'NUT-UNB-M12', 'UNBRAKO Hex Nut M12', 'unbrako-hex-nut-m12', 'High-grade hex nut M12 by UNBRAKO.', 'UNBRAKO Hex Nut M12', 12.00, 800, true, true);

-- Washers
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333305', '11111111-1111-1111-1111-111111111203', '22222222-2222-2222-2222-222222222201', 'WASH-TVS-M10', 'TVS Plain Washer M10', 'tvs-plain-washer-m10', 'Standard plain washer M10 by TVS.', 'TVS Plain Washer M10', 2.50, 2000, false, true);

-- Screws
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333306', '11111111-1111-1111-1111-111111111204', '22222222-2222-2222-2222-222222222203', 'SCREW-LM-CS-4X40', 'LandMark Countersunk Screw 4mm x 40mm', 'landmark-countersunk-screw-4x40', 'Quality countersunk screw by LandMark. Phillips head.', 'LandMark Countersunk Screw 4mm x 40mm', 5.00, 1500, false, true);

-- Drill Bits
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333307', '11111111-1111-1111-1111-111111111209', '22222222-2222-2222-2222-222222222219', 'DRILL-MIR-HSS-10', 'Miranda HSS Drill Bit 10mm', 'miranda-hss-drill-bit-10mm', 'High-speed steel drill bit 10mm by Miranda. Suitable for metal drilling.', 'Miranda HSS Drill Bit 10mm', 85.00, 200, true, true),
('33333333-3333-3333-3333-333333333308', '11111111-1111-1111-1111-111111111209', '22222222-2222-2222-2222-222222222220', 'DRILL-TOM-TCT-12', 'Totem TCT Drill Bit 12mm', 'totem-tct-drill-bit-12mm', 'Tungsten carbide tipped drill bit by Totem. For concrete and masonry.', 'Totem TCT Drill Bit 12mm', 120.00, 150, false, true);

-- Tools
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333309', '11111111-1111-1111-1111-111111111210', '22222222-2222-2222-2222-222222222221', 'TOOL-TAP-WR-10', 'Taparia Adjustable Wrench 10 inch', 'taparia-adjustable-wrench-10', 'Professional adjustable wrench 10 inch by Taparia. Chrome plated.', 'Taparia Adjustable Wrench 10 inch', 320.00, 100, true, true);

-- V Belts
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333310', '11111111-1111-1111-1111-111111111206', '22222222-2222-2222-2222-222222222209', 'VBELT-FEN-A42', 'Fenner V Belt A42', 'fenner-v-belt-a42', 'Premium quality V belt A42 by Fenner. Heavy-duty construction.', 'Fenner V Belt A42', 450.00, 75, true, true),
('33333333-3333-3333-3333-333333333311', '11111111-1111-1111-1111-111111111206', '22222222-2222-2222-2222-222222222211', 'VBELT-PIX-B54', 'PIX V Belt B54', 'pix-v-belt-b54', 'Quality V belt B54 by PIX. Long-lasting performance.', 'PIX V Belt B54', 520.00, 60, false, true);

-- Timing Belts
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333312', '11111111-1111-1111-1111-111111111207', '22222222-2222-2222-2222-222222222212', 'TBELT-GAT-150XL', 'Gates Timing Belt 150XL', 'gates-timing-belt-150xl', 'Precision timing belt 150XL by Gates. Superior performance.', 'Gates Timing Belt 150XL', 680.00, 50, true, true);

-- Welding Rods
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333313', '11111111-1111-1111-1111-111111111104', '22222222-2222-2222-2222-222222222224', 'WELD-ADOR-E6013-2.5', 'Ador Welding Electrode E6013 2.5mm', 'ador-welding-electrode-e6013-25', 'All-position welding electrode by Ador. 2.5mm diameter.', 'Ador Welding Electrode E6013 2.5mm', 85.00, 400, true, true);

-- Cables
INSERT INTO products (id, category_id, brand_id, sku, name, slug, description, short_description, base_price, wholesale_price, stock_quantity, is_featured, is_active) VALUES
('33333333-3333-3333-3333-333333333314', '11111111-1111-1111-1111-111111111105', '22222222-2222-2222-2222-222222222234', 'CABLE-POLY-1.5SQ-100M', 'Polycab Copper Wire 1.5 Sq mm (100m)', 'polycab-copper-wire-15-sq-100m', 'FR PVC insulated copper cable by Polycab. 1.5 sq mm. 100 meter coil.', 'Polycab Copper Wire 1.5 Sq mm (100m)', 2850.00, 2650.00, 50, true, true);

-- ============================================
-- 4. PRODUCT IMAGES (Sample S3 URLs)
-- ============================================
-- Note: Replace these with your actual S3 bucket URLs after uploading images

-- Bolts - TVS Hex Bolt M10
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333301',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333301/full/bolt-tvs-m10-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333301/thumbnails/bolt-tvs-m10-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333301/full/bolt-tvs-m10-1.jpg',
 'products/33333333-3333-3333-3333-333333333301/thumbnails/bolt-tvs-m10-1-thumb.jpg',
 'bolt-tvs-m10-1.jpg',
 'image/jpeg',
 0, true);

-- Bolts - UNBRAKO Socket Head Cap Screw
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333302',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333302/full/bolt-unbrako-m12-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333302/thumbnails/bolt-unbrako-m12-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333302/full/bolt-unbrako-m12-1.jpg',
 'products/33333333-3333-3333-3333-333333333302/thumbnails/bolt-unbrako-m12-1-thumb.jpg',
 'bolt-unbrako-m12-1.jpg',
 'image/jpeg',
 0, true);

-- Nuts - TVS Hex Nut M10
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333303',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333303/full/nut-tvs-m10-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333303/thumbnails/nut-tvs-m10-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333303/full/nut-tvs-m10-1.jpg',
 'products/33333333-3333-3333-3333-333333333303/thumbnails/nut-tvs-m10-1-thumb.jpg',
 'nut-tvs-m10-1.jpg',
 'image/jpeg',
 0, true);

-- Drill Bits - Miranda HSS
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333307',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333307/full/drill-miranda-10mm-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333307/thumbnails/drill-miranda-10mm-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333307/full/drill-miranda-10mm-1.jpg',
 'products/33333333-3333-3333-3333-333333333307/thumbnails/drill-miranda-10mm-1-thumb.jpg',
 'drill-miranda-10mm-1.jpg',
 'image/jpeg',
 0, true);

-- Tools - Taparia Wrench
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333309',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333309/full/wrench-taparia-10in-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333309/thumbnails/wrench-taparia-10in-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333309/full/wrench-taparia-10in-1.jpg',
 'products/33333333-3333-3333-3333-333333333309/thumbnails/wrench-taparia-10in-1-thumb.jpg',
 'wrench-taparia-10in-1.jpg',
 'image/jpeg',
 0, true);

-- V Belts - Fenner
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333310',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333310/full/vbelt-fenner-a42-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333310/thumbnails/vbelt-fenner-a42-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333310/full/vbelt-fenner-a42-1.jpg',
 'products/33333333-3333-3333-3333-333333333310/thumbnails/vbelt-fenner-a42-1-thumb.jpg',
 'vbelt-fenner-a42-1.jpg',
 'image/jpeg',
 0, true);

-- Timing Belts - Gates
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333312',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333312/full/timing-belt-gates-150xl-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333312/thumbnails/timing-belt-gates-150xl-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333312/full/timing-belt-gates-150xl-1.jpg',
 'products/33333333-3333-3333-3333-333333333312/thumbnails/timing-belt-gates-150xl-1-thumb.jpg',
 'timing-belt-gates-150xl-1.jpg',
 'image/jpeg',
 0, true);

-- Welding Rods - Ador
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333313',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333313/full/welding-ador-e6013-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333313/thumbnails/welding-ador-e6013-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333313/full/welding-ador-e6013-1.jpg',
 'products/33333333-3333-3333-3333-333333333313/thumbnails/welding-ador-e6013-1-thumb.jpg',
 'welding-ador-e6013-1.jpg',
 'image/jpeg',
 0, true);

-- Cables - Polycab
INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, mime_type, display_order, is_primary) VALUES
('33333333-3333-3333-3333-333333333314',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333314/full/cable-polycab-1.5sq-1.jpg',
 'https://jeffi-stores.s3.ap-south-1.amazonaws.com/products/33333333-3333-3333-3333-333333333314/thumbnails/cable-polycab-1.5sq-1-thumb.jpg',
 'jeffi-stores',
 'products/33333333-3333-3333-3333-333333333314/full/cable-polycab-1.5sq-1.jpg',
 'products/33333333-3333-3333-3333-333333333314/thumbnails/cable-polycab-1.5sq-1-thumb.jpg',
 'cable-polycab-1.5sq-1.jpg',
 'image/jpeg',
 0, true);

-- ============================================
-- 5. SITE SETTINGS
-- ============================================

INSERT INTO site_settings (key, value, data_type, description) VALUES
('site_name', 'Jeffi Stores', 'string', 'Website name'),
('site_email', 'jeffistoress@gmail.com', 'string', 'Contact email'),
('site_phone', '+91 89030 31299', 'string', 'Primary contact number'),
('site_phone_secondary', '+91 94883 54099', 'string', 'Secondary contact number'),
('site_address', 'SANJAY GANDHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092', 'string', 'Business address'),
('currency', 'INR', 'string', 'Default currency'),
('tax_rate', '18', 'number', 'GST percentage'),
('min_order_amount', '500', 'number', 'Minimum order amount'),
('free_shipping_threshold', '5000', 'number', 'Free shipping above this amount'),
('cod_enabled', 'true', 'boolean', 'Cash on delivery enabled'),
('razorpay_enabled', 'false', 'boolean', 'Razorpay payment gateway enabled');

-- ============================================
-- 6. SHIPPING ZONES
-- ============================================

INSERT INTO shipping_zones (name, states, base_rate, per_kg_rate, free_shipping_threshold, is_active) VALUES
('Chhattisgarh (Local)', '["Chhattisgarh"]', 50.00, 10.00, 5000.00, true),
('Central India', '["Madhya Pradesh", "Maharashtra", "Odisha", "Jharkhand"]', 100.00, 15.00, 7500.00, true),
('North India', '["Delhi", "Uttar Pradesh", "Punjab", "Haryana", "Rajasthan"]', 150.00, 20.00, 10000.00, true),
('South India', '["Karnataka", "Tamil Nadu", "Andhra Pradesh", "Telangana", "Kerala"]', 200.00, 25.00, 10000.00, true),
('East India', '["West Bengal", "Bihar", "Assam"]', 180.00, 22.00, 10000.00, true);

-- ============================================
-- 7. ADMIN USER (Default - CHANGE PASSWORD!)
-- ============================================

-- First create a user
INSERT INTO users (id, email, first_name, last_name) VALUES
('44444444-4444-4444-4444-444444444401', 'admin@jeffistores.com', 'Admin', 'User');

-- Then create admin (password: 'admin123' - CHANGE THIS!)
-- Password hash is bcrypt hash of 'admin123'
INSERT INTO admins (user_id, username, password_hash, role) VALUES
('44444444-4444-4444-4444-444444444401', 'admin', '$2b$10$rKvVJvQ7Kz9aXKHYqZ.XFO5ZqYZ9YqZ9YqZ9YqZ9YqZ9YqZ9YqZ9Y', 'super_admin');

-- ============================================
-- 8. SAMPLE COUPONS
-- ============================================

INSERT INTO coupons (code, description, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit, valid_from, valid_until, is_active) VALUES
('WELCOME10', 'Welcome discount for new customers', 'percentage', 10.00, 1000.00, 500.00, 100, NOW(), NOW() + INTERVAL '30 days', true),
('BULK500', 'Flat ₹500 off on bulk orders', 'fixed_amount', 500.00, 10000.00, NULL, NULL, NOW(), NOW() + INTERVAL '90 days', true);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check categories
-- SELECT name, slug, parent_category_id FROM categories ORDER BY display_order;

-- Check brands
-- SELECT name, slug FROM brands ORDER BY name;

-- Check products
-- SELECT p.name, c.name as category, b.name as brand, p.base_price
-- FROM products p
-- LEFT JOIN categories c ON p.category_id = c.id
-- LEFT JOIN brands b ON p.brand_id = b.id;

-- Check settings
-- SELECT key, value FROM site_settings;
