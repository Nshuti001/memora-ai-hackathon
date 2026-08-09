#!/usr/bin/env bash
#
# Deploys the Memora memory API to AWS Lambda behind a Function URL.
#
# Prerequisites: AWS CLI v2 configured (`aws configure`), and server/.env filled in.
# Run from the server/ directory:  ./deploy.sh
#
set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-memora-api}"
ROLE_NAME="${ROLE_NAME:-memora-lambda-role}"
REGION="${AWS_REGION:-us-east-1}"
RUNTIME="nodejs22.x"

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "server/.env is missing. Copy .env.example and fill it in — see ../SETUP.md" >&2
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

echo "==> Compiling TypeScript"
npm run build

echo "==> Building deployment bundle"
rm -rf .deploy && mkdir -p .deploy
cp -r dist/* .deploy/
cp package.json .deploy/
(cd .deploy && npm install --omit=dev --silent)

rm -f function.zip
(cd .deploy && zip -qr ../function.zip .)
echo "    $(du -h function.zip | cut -f1) bundle"

echo "==> Ensuring execution role ${ROLE_NAME}"
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "lambda.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null

  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

  # Bedrock access for Claude (reasoning) and Titan (embeddings).
  aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name memora-bedrock \
    --policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        "Resource": "*"
      }]
    }'

  echo "    created; waiting 10s for IAM propagation"
  sleep 10
fi

# Lambda reads config from its own environment, not from a bundled .env file — a .env inside the
# deployment package would put the database password in the artifact.
#
# Lambda reserves AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY and rejects
# CreateFunction outright if any of them appear, so they are stripped. The region it supplies
# itself. The credential pair is re-added under BEDROCK_* names, which config.ts reads as a
# fallback: the execution role alone was not enough, because the Anthropic Bedrock SDK failed to
# sign with the container credentials and every turn came back "credentials were rejected".
ENV_JSON="$(
  {
    grep -v '^\s*#' .env | grep -v '^\s*$' | grep -v '^\s*AWS_'
    # Same key pair, under names Lambda does not reserve. config.ts reads these as a fallback.
    grep -E '^\s*AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)=' .env | sed 's/^AWS_/BEDROCK_/'
  } | awk -F= '{key=$1; sub(/^[^=]*=/, "", $0); printf "\"%s\":\"%s\",", key, $0}' \
    | sed 's/,$//'
)"

echo "==> Deploying ${FUNCTION_NAME}"
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" --zip-file fileb://function.zip \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "{\"Variables\":{${ENV_JSON}}}" \
    --timeout 60 --memory-size 1024 \
    --region "$REGION" >/dev/null
else
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --role "$ROLE_ARN" \
    --handler lambda.handler \
    --zip-file fileb://function.zip \
    --environment "{\"Variables\":{${ENV_JSON}}}" \
    --timeout 60 --memory-size 1024 \
    --region "$REGION" >/dev/null

  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"

  aws lambda create-function-url-config \
    --function-name "$FUNCTION_NAME" --auth-type NONE \
    --region "$REGION" >/dev/null

  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id public-function-url \
    --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE \
    --region "$REGION" >/dev/null
fi

URL="$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" \
        --region "$REGION" --query FunctionUrl --output text)"

rm -rf .deploy function.zip

echo
echo "Deployed. API is at:"
echo "  ${URL}"
echo
echo "Next:"
echo "  1. curl ${URL}api/health"
echo "  2. Set VITE_API_URL=${URL%/} in the frontend .env and rebuild"
echo "  3. Add the CloudFront domain to CORS_ALLOWED_ORIGINS and redeploy this function"
