#!/bin/zsh
# Uploads the four films from out/ to a NEW version folder on the CDN (public). Usage: ./upload.sh v2
# A version is never overwritten: browsers and CloudFront keep each one for 7 days. Afterwards point BASE in
# controller-service/src/app/(ecom)/ecom/_demo/demo-videos.ts at the new folder.
cd "$(dirname "$0")/out" || exit 1
v=$1
if [[ ! $v =~ ^v[0-9]+$ ]]; then echo "usage: ./upload.sh v<N>"; exit 1; fi
for id in overview storefront admin campaigns; do
  for ext in mp4 webm jpg; do [[ -f $id.$ext ]] || { echo "missing out/$id.$ext"; exit 1 }; done
done
DEST=s3://jeffi-stores-bucket/marketing/demo/$v
if [[ -n "$(aws s3 ls "$DEST/" 2>/dev/null)" ]]; then echo "$DEST already has files; pick a new version"; exit 1; fi
CC="public, max-age=604800"
for id in overview storefront admin campaigns; do
  aws s3 cp "$id.mp4"  "$DEST/$id.mp4"  --content-type video/mp4  --cache-control "$CC" --only-show-errors || exit 1
  aws s3 cp "$id.webm" "$DEST/$id.webm" --content-type video/webm --cache-control "$CC" --only-show-errors || exit 1
  aws s3 cp "$id.jpg"  "$DEST/$id.jpg"  --content-type image/jpeg --cache-control "$CC" --only-show-errors || exit 1
done
echo "uploaded: https://dm9rri2wgl1e.cloudfront.net/marketing/demo/$v/"
