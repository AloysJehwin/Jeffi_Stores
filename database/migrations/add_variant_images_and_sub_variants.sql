-- Migration: add variant_images and product_sub_variants tables
-- Run once against the live database.

-- 1. Per-variant image gallery
CREATE TABLE IF NOT EXISTS variant_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,

    image_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),

    s3_bucket VARCHAR(100),
    s3_key VARCHAR(500),
    s3_thumbnail_key VARCHAR(500),

    file_name VARCHAR(255) NOT NULL,
    file_size INT,
    mime_type VARCHAR(100),
    width INT,
    height INT,

    alt_text VARCHAR(255),
    display_order INT DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_primary_image_per_variant
    ON variant_images (variant_id)
    WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_variant_images_variant_id ON variant_images (variant_id);

-- 2. Sub-variants (second dimension, e.g. Size under a Color variant)
CREATE TABLE IF NOT EXISTS product_sub_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,

    sku VARCHAR(100) UNIQUE NOT NULL,
    sub_variant_name VARCHAR(255) NOT NULL,

    price DECIMAL(12, 2),
    mrp DECIMAL(12, 2),
    price_ex_gst DECIMAL(12, 2),
    mrp_ex_gst DECIMAL(12, 2),
    wholeprice_ex_gst DECIMAL(12, 2),

    stock_quantity INT DEFAULT 0,
    attributes JSONB,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_variants_variant_id ON product_sub_variants (variant_id);
CREATE INDEX IF NOT EXISTS idx_sub_variants_product_id ON product_sub_variants (product_id);

-- 3. Label for the sub-variant dimension on the product (e.g. "Size", "Grade")
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS sub_variant_type VARCHAR(100);
-- migrated
