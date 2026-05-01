UPDATE products SET sku = UPPER(sku) WHERE sku != UPPER(sku);
UPDATE product_variants SET sku = UPPER(sku) WHERE sku != UPPER(sku);
