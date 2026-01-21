# S3 Bucket Setup Instructions

Your S3 bucket `jeffi-stores-bucket` needs to be configured to allow public read access for product images to display correctly.

## Steps to Configure S3 Bucket

### 1. Go to AWS S3 Console
- Navigate to https://s3.console.aws.amazon.com/
- Select your bucket: `jeffi-stores-bucket`

### 2. Unblock Public Access
- Click on the "Permissions" tab
- Click "Edit" under "Block public access (bucket settings)"
- **Uncheck** "Block all public access"
- Click "Save changes"
- Type "confirm" when prompted

### 3. Add Bucket Policy
- Still in the "Permissions" tab
- Scroll down to "Bucket policy"
- Click "Edit"
- Copy and paste the contents of `s3-bucket-policy.json` file
- Click "Save changes"

### 4. Verify Configuration
- Go to any uploaded image URL in your browser
- Example: `https://jeffi-stores-bucket.s3.us-east-1.amazonaws.com/products/[product-id]/[image-name]`
- The image should load without 403 error

## Alternative: Use CloudFront CDN (Recommended for Production)

For better performance and security in production:

1. Create a CloudFront distribution
2. Set S3 bucket as origin
3. Use Origin Access Control (OAC)
4. Update image URLs to use CloudFront domain
5. Keep S3 bucket private

## Current Configuration

- **Bucket Name**: jeffi-stores-bucket
- **Region**: us-east-1
- **Bucket URL Format**: `https://jeffi-stores-bucket.s3.us-east-1.amazonaws.com/[path]`

## Troubleshooting

If images still don't load:

1. Check browser console for errors
2. Verify bucket policy is applied
3. Check that "Block public access" is OFF
4. Try accessing image URL directly in browser
5. Clear browser cache and reload
