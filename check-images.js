const { createClient } = require('@supabase/supabase-js');

// Read env manually
const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabase = createClient(
  envVars.NEXT_PUBLIC_SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: products } = await supabase
    .from('products')
    .select('id, name')
    .order('created_at', { ascending: false })
    .limit(1);

  if (products && products.length > 0) {
    console.log('\n=== Latest Product ===');
    console.log('Product:', products[0].name);
    console.log('ID:', products[0].id);

    const { data: images } = await supabase
      .from('product_images')
      .select('*')
      .eq('product_id', products[0].id);

    console.log('\n=== Product Images ===');
    if (images && images.length > 0) {
      images.forEach((img, i) => {
        console.log(`\nImage ${i + 1}:`);
        console.log('  File:', img.file_name);
        console.log('  URL:', img.image_url);
        console.log('  Thumbnail:', img.thumbnail_url);
        console.log('  Primary:', img.is_primary);
      });
    } else {
      console.log('No images found for this product');
    }
  } else {
    console.log('No products found in database');
  }
})();
