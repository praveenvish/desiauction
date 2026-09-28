#!/usr/bin/env bash
# Create one environment's env files ON THE HOST, with every internal secret
# generated here — they never pass through a laptop, a chat or CI.
#
#   sudo bash init-env.sh production desiauction.in
#   sudo bash init-env.sh staging    staging.desiauction.in
#
# NEVER OVERWRITES: a file that exists is left exactly as it is, so re-running
# only fills in what is missing. Values only a person can supply (provider keys,
# DSNs, the off-box bucket) are written COMMENTED OUT under a FOUNDER marker —
# an empty `KEY=` reaches the apps as an empty string, which fails their URL
# checks, where an absent key is simply unset. Uncomment each one as it is
# filled; the listing at the end shows what is left, and the deploy's
# `migrator preflight` refuses production until the required ones are set.
set -Eeuo pipefail

ENV_NAME="${1:?usage: init-env.sh production|staging <public-domain>}"
DOMAIN="${2:?usage: init-env.sh production|staging <public-domain>}"
case "$ENV_NAME" in
  production) STACK=da-prod ;;
  staging) STACK=da-staging ;;
  *) echo "environment must be production or staging"; exit 1 ;;
esac
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

DIR="/srv/apps/desiauction/$ENV_NAME"
install -d -m 750 -o deploy -g deploy "$DIR"
cd "$DIR"

# Hex only: safe unquoted in env files, in URLs and in psql -v.
secret() { openssl rand -hex "${1:-24}"; }

write() { # name — content on stdin
  if [ -e "$1" ]; then
    echo "  keep   $1 (exists)"
    cat >/dev/null
    return
  fi
  cat >"$1"
  chown deploy:deploy "$1"
  chmod 600 "$1"
  echo "  create $1"
}

# Generated once, shared by the files that must agree.
PG_OWNER_PW="$(secret)"
APP_PW="$(secret)"
SYSTEM_PW="$(secret)"
ENGINE_PW="$(secret)"
RUNNER_PW="$(secret)"
ENGINE_SECRET="$(secret 32)"
S3_USER="da-$(secret 6)"
S3_PW="$(secret)"
DB=desiauction
PUBLIC="https://$DOMAIN"
ORIGINS="$PUBLIC"
[ "$STACK" = da-prod ] && ORIGINS="$PUBLIC,https://www.$DOMAIN"

echo "Writing $DIR ($STACK)"

write .env <<EOF
# Compose settings for this stack (ops/deploy/README.md "The env files").
COMPOSE_FILE=docker-compose.production.yml
COMPOSE_PROJECT_NAME=$STACK
REGISTRY=ghcr.io/praveenvish/desiauction
# TAG and DB_TAG are written by each deploy.
TAG=none-yet
PUBLIC_DOMAIN=$DOMAIN
ENGINE_DOMAIN=engine.$DOMAIN
S3_DOMAIN=s3.$DOMAIN
# Sizing overrides (README "Sizing"); unset = production defaults.
EOF

write db.env <<EOF
POSTGRES_DB=$DB
POSTGRES_PASSWORD=$PG_OWNER_PW
EOF

write migrator.env <<EOF
# The database OWNER — used only by deploy-time migrate / roles / grants.
DATABASE_URL=postgres://postgres:$PG_OWNER_PW@db:5432/$DB
EOF

write minio.env <<EOF
MINIO_ROOT_USER=$S3_USER
MINIO_ROOT_PASSWORD=$S3_PW
EOF

# What web.env and runner.env must agree on, written once.
STORAGE="MEDIA_STORAGE=bucket
MEDIA_S3_ENDPOINT=https://s3.$DOMAIN
MEDIA_S3_REGION=us-east-1
MEDIA_S3_BUCKET=desiauction-media
MEDIA_S3_ACCESS_KEY_ID=$S3_USER
MEDIA_S3_SECRET_ACCESS_KEY=$S3_PW
MEDIA_PUBLIC_BASE=https://s3.$DOMAIN/desiauction-media
FINOPS_ARTIFACT_STORE=bucket
FINOPS_STORAGE_DIR=/var/lib/desiauction/finops
FINOPS_S3_ENDPOINT=https://s3.$DOMAIN
FINOPS_S3_REGION=us-east-1
FINOPS_S3_BUCKET=desiauction-finops
FINOPS_S3_ACCESS_KEY_ID=$S3_USER
FINOPS_S3_SECRET_ACCESS_KEY=$S3_PW"

MAIL="EMAIL_PROVIDER=ses
EMAIL_FROM=DesiAuction <no-reply@mail.desiauction.in>
EMAIL_REPLY_TO=support@desiauction.in
SES_REGION=ap-south-1
SES_CONFIGURATION_SET=desiauction-transactional
SES_FEEDBACK_ADDRESS=bounces@desiauction.in"

write web.env <<EOF
NODE_ENV=production
LOG_LEVEL=info
PUBLIC_BASE_URL=$PUBLIC
RP_ID=$DOMAIN
RP_ORIGINS=$ORIGINS
TRUSTED_PROXY_COUNT=1
DB_POOL_MAX=10
DATABASE_URL=postgres://desiauction_app:$APP_PW@db:5432/$DB
SYSTEM_DATABASE_URL=postgres://desiauction_system:$SYSTEM_PW@db:5432/$DB
# Server-side calls stay inside this stack's private network.
ENGINE_URL=http://engine:4000
ENGINE_PUBLIC_WS_URL=wss://engine.$DOMAIN/ws
ENGINE_SECRET=$ENGINE_SECRET
LOGIN_DEFAULT_METHOD=email
$STORAGE
$MAIL
FEEDBACK_JOB_SECRET=$(secret)
SETTLEMENT_JOB_SECRET=$(secret)
DEMO_JOB_SECRET=$(secret)
DEMO_TOKEN_SECRET=$(secret 32)
REVIEW_TOKEN_SECRET=$(secret 32)

# ---- FOUNDER: values only you hold (.env.example explains each) ----
# SENTRY_DSN=
# SES_ACCESS_KEY_ID=
# SES_SECRET_ACCESS_KEY=
# SES_SNS_TOPIC_ARN=
# Login codes by text: whatsapp (launch channel) or msg91. Production refuses
# to start without one — email-only login is not a supported production mode.
# OTP_PROVIDER=
# WHATSAPP_PHONE_NUMBER_ID=
# WHATSAPP_ACCESS_TOKEN=
# WHATSAPP_TEMPLATE_NAME=
# WHATSAPP_BUSINESS_ACCOUNT_ID=
# WHATSAPP_APP_SECRET=
# WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(secret 16)
# Optional — gateway payments (manual capture works without them).
# RAZORPAY_KEY_ID=
# RAZORPAY_KEY_SECRET=
# RAZORPAY_WEBHOOK_SECRET=
EOF

write engine.env <<EOF
NODE_ENV=production
LOG_LEVEL=info
PORT=4000
DATABASE_URL=postgres://desiauction_engine:$ENGINE_PW@db:5432/$DB
ENGINE_SECRET=$ENGINE_SECRET
ENGINE_ALLOWED_ORIGINS=$ORIGINS
TRUSTED_PROXY_COUNT=1

# ---- FOUNDER ----
# SENTRY_DSN=
EOF

write runner.env <<EOF
NODE_ENV=production
LOG_LEVEL=info
PUBLIC_BASE_URL=$PUBLIC
DATABASE_URL=postgres://desiauction_runner:$RUNNER_PW@db:5432/$DB
$STORAGE
$MAIL

# ---- FOUNDER (same values as web.env) ----
# SENTRY_DSN=
# SES_ACCESS_KEY_ID=
# SES_SECRET_ACCESS_KEY=
EOF

write pgbackrest.env <<EOF
PGBACKREST_STANZA=desiauction
PGBACKREST_PG1_PATH=/var/lib/postgresql/data
PGBACKREST_PG1_SOCKET_PATH=/var/run/postgresql
PGBACKREST_REPO1_TYPE=s3
PGBACKREST_REPO1_PATH=/pgbackrest/$STACK
PGBACKREST_REPO1_S3_URI_STYLE=host
PGBACKREST_REPO1_RETENTION_FULL=2
# Encrypted before it leaves the box. KEEP A COPY OF THIS PASSPHRASE OFF THIS
# MACHINE (password manager): without it the off-box backups cannot be read.
PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc
PGBACKREST_REPO1_CIPHER_PASS=$(secret 32)

# ---- FOUNDER: the off-box bucket (production: S3 Mumbai, desiauction-prod-pitr) ----
# PGBACKREST_REPO1_S3_ENDPOINT=
# PGBACKREST_REPO1_S3_BUCKET=
# PGBACKREST_REPO1_S3_REGION=
# PGBACKREST_REPO1_S3_KEY=
# PGBACKREST_REPO1_S3_KEY_SECRET=
EOF

write mirror.env <<EOF
MIRROR_INTERVAL_SECONDS=3600

# ---- FOUNDER: the off-box bucket (production: S3 Mumbai, desiauction-prod-copies/{media,finops}) ----
# MIRROR_S3_ENDPOINT=
# MIRROR_S3_ACCESS_KEY=
# MIRROR_S3_SECRET_KEY=
# MIRROR_MEDIA_BUCKET=
# MIRROR_FINOPS_BUCKET=
EOF

echo
echo "Commented out, waiting for a value (fill, uncomment, then deploy):"
grep -n '^# [A-Z0-9_]*=' "$DIR"/*.env | sed -e "s|$DIR/|  |" -e 's/=.*/=/' || echo "  nothing"
