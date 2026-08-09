#!/usr/bin/env bash
#
# Publishes the dashboard to S3 + CloudFront and puts the memory API behind the same distribution
# at /api/*, so the browser talks to one origin and CORS never enters the picture.
#
# Why CloudFront rather than hitting the Lambda Function URL directly: a public Function URL
# (auth-type NONE) is blocked at the account level on new AWS accounts and answers 403 no matter
# what the resource policy says. Fronting it with an Origin Access Control lets CloudFront sign
# each request with SigV4, so the Function URL can stay on AWS_IAM auth and CloudFront becomes its
# only permitted caller. That is stricter than a public URL, not looser.
#
# Run from the server/ directory, after deploy.sh:  ./deploy-web.sh
set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-memora-api}"
REGION="${AWS_REGION:-us-east-1}"
cd "$(dirname "$0")"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${BUCKET:-memora-ai-web-${ACCOUNT_ID}}"

FN_URL="$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" \
           --region "$REGION" --query FunctionUrl --output text)"
FN_HOST="${FN_URL#https://}"; FN_HOST="${FN_HOST%/}"

echo "==> Building the dashboard for same-origin API calls"
# Empty VITE_API_URL leaves BASE_URL as '', so the client requests /api/... relative to whatever
# host serves it — which is the CloudFront distribution.
(cd .. && VITE_API_URL= npm run build >/dev/null)

echo "==> Ensuring bucket ${BUCKET}"
if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  # The bucket stays private; CloudFront reaches it through the Origin Access Control below.
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' >/dev/null
fi

echo "==> Uploading dist/"
# Hashed assets are immutable; index.html must never be cached or a deploy looks like a no-op.
aws s3 sync ../dist "s3://${BUCKET}" --delete --exclude index.html \
  --cache-control 'public,max-age=31536000,immutable' >/dev/null
aws s3 cp ../dist/index.html "s3://${BUCKET}/index.html" \
  --cache-control 'no-cache,no-store,must-revalidate' >/dev/null

oac_id() { aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$1'].Id | [0]" --output text 2>/dev/null; }

echo "==> Ensuring origin access controls"
S3_OAC="$(oac_id "memora-s3")"
if [[ "$S3_OAC" == "None" || -z "$S3_OAC" ]]; then
  S3_OAC="$(aws cloudfront create-origin-access-control --origin-access-control-config \
    '{"Name":"memora-s3","Description":"Memora dashboard bucket","SigningProtocol":"sigv4","SigningBehavior":"always","OriginAccessControlOriginType":"s3"}' \
    --query 'OriginAccessControl.Id' --output text)"
fi
LAMBDA_OAC="$(oac_id "memora-lambda")"
if [[ "$LAMBDA_OAC" == "None" || -z "$LAMBDA_OAC" ]]; then
  LAMBDA_OAC="$(aws cloudfront create-origin-access-control --origin-access-control-config \
    '{"Name":"memora-lambda","Description":"Memora memory API","SigningProtocol":"sigv4","SigningBehavior":"always","OriginAccessControlOriginType":"lambda"}' \
    --query 'OriginAccessControl.Id' --output text)"
fi

DIST_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='memora-ai'].Id | [0]" --output text 2>/dev/null || echo None)"

if [[ "$DIST_ID" == "None" || -z "$DIST_ID" ]]; then
  echo "==> Creating CloudFront distribution"
  cat > /tmp/memora-dist.json <<JSON
{
  "CallerReference": "memora-$(date +%s)",
  "Comment": "memora-ai",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 2,
    "Items": [
      {
        "Id": "s3-site",
        "DomainName": "${BUCKET}.s3.${REGION}.amazonaws.com",
        "OriginAccessControlId": "${S3_OAC}",
        "S3OriginConfig": { "OriginAccessIdentity": "" }
      },
      {
        "Id": "lambda-api",
        "DomainName": "${FN_HOST}",
        "OriginAccessControlId": "${LAMBDA_OAC}",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "https-only",
          "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] },
          "OriginReadTimeout": 60,
          "OriginKeepaliveTimeout": 5
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-site",
    "ViewerProtocolPolicy": "redirect-to-https",
    "Compress": true,
    "AllowedMethods": { "Quantity": 2, "Items": ["GET","HEAD"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6"
  },
  "CacheBehaviors": {
    "Quantity": 1,
    "Items": [
      {
        "PathPattern": "/api/*",
        "TargetOriginId": "lambda-api",
        "ViewerProtocolPolicy": "https-only",
        "Compress": true,
        "AllowedMethods": { "Quantity": 7, "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
          "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
        "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
        "OriginRequestPolicyId": "b689b0a8-53d0-40ab-baf2-68738e2966ac"
      }
    ]
  },
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      { "ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 10 },
      { "ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 10 }
    ]
  }
}
JSON
  DIST_ID="$(aws cloudfront create-distribution --distribution-config file:///tmp/memora-dist.json \
              --query 'Distribution.Id' --output text)"
fi

DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text)"
DIST_ARN="arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DIST_ID}"

echo "==> Locking the bucket to this distribution"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{
  "Effect":"Allow","Principal":{"Service":"cloudfront.amazonaws.com"},
  "Action":"s3:GetObject","Resource":"arn:aws:s3:::${BUCKET}/*",
  "Condition":{"StringEquals":{"AWS:SourceArn":"${DIST_ARN}"}}}]}
JSON
)" >/dev/null

echo "==> Locking the Function URL to this distribution"
# AWS_IAM means an unsigned public request is rejected; only CloudFront, which signs with the OAC,
# gets through.
aws lambda update-function-url-config --function-name "$FUNCTION_NAME" \
  --auth-type AWS_IAM --region "$REGION" >/dev/null
for sid in public-function-url public-url-v2; do
  aws lambda remove-permission --function-name "$FUNCTION_NAME" --statement-id "$sid" \
    --region "$REGION" >/dev/null 2>&1 || true
done
aws lambda add-permission --function-name "$FUNCTION_NAME" --statement-id cloudfront-oac \
  --action lambda:InvokeFunctionUrl --principal cloudfront.amazonaws.com \
  --source-arn "$DIST_ARN" --function-url-auth-type AWS_IAM \
  --region "$REGION" >/dev/null 2>&1 || true

echo "==> Invalidating cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null

echo
echo "Distribution ${DIST_ID} -> https://${DOMAIN}"
echo "CloudFront takes a few minutes to finish deploying the first time."
