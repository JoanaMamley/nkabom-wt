#!/usr/bin/env bash
# Lets GitHub Actions deploy one Firebase project without a stored key (NKB-121): a service
# account with only the roles a deploy needs, and a Workload Identity Federation pool that trusts
# GitHub's tokens from this repository alone. Run it once per project in Google Cloud Shell (it
# has gcloud), signed in as the shared project account:
#
#   scripts/setup-github-deploy.sh nkabom-staging
#   scripts/setup-github-deploy.sh nkabom-prod
#
# Running it again only puts the settings back as below. It ends by printing the two values for the
# GitHub environment (README, Continuous deployment). Workload Identity Federation is free and
# works on the Spark plan.
set -euo pipefail

REPOSITORY=JoanaMamley/nkabom-wt
POOL=github
PROVIDER=nkabom-wt
ACCOUNT_NAME=github-deployer

PROJECT=${1:-}
case "$PROJECT" in
  nkabom-staging)
    # Staging deploys from main and previews from pull requests, all in the staging environment.
    CONDITION="assertion.repository == '$REPOSITORY' && assertion.environment == 'staging'"
    ;;
  nkabom-prod)
    # Production only from a v* tag, in the production environment, which needs an approval.
    CONDITION="assertion.repository == '$REPOSITORY' && assertion.environment == 'production' && assertion.ref.startsWith('refs/tags/v')"
    ;;
  *)
    echo "Usage: $0 nkabom-staging|nkabom-prod" >&2
    exit 1
    ;;
esac

ACCOUNT="$ACCOUNT_NAME@$PROJECT.iam.gserviceaccount.com"
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

echo "Turning on the APIs Workload Identity Federation uses"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com --project "$PROJECT"

echo "Service account $ACCOUNT"
if ! gcloud iam service-accounts describe "$ACCOUNT" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$ACCOUNT_NAME" --project "$PROJECT" \
    --display-name "GitHub deploys (NKB-121)"
fi

# Hosting, Firestore rules and indexes, and what the Firebase CLI reads on the way. Nothing that
# can read or change data.
ROLES=(
  roles/firebasehosting.admin
  roles/firebaserules.admin
  roles/datastore.indexAdmin
  roles/firebase.viewer
  roles/serviceusage.serviceUsageConsumer
  roles/serviceusage.serviceUsageViewer
  roles/serviceusage.apiKeysViewer
)
for role in "${ROLES[@]}"; do
  echo "  $role"
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$ACCOUNT" \
    --role "$role" --condition None --quiet >/dev/null
done

echo "Workload identity pool $POOL"
if ! gcloud iam workload-identity-pools describe "$POOL" --location global --project "$PROJECT" \
  >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location global --project "$PROJECT" \
    --display-name "GitHub Actions"
fi

echo "Provider $PROVIDER, trusting only: $CONDITION"
PROVIDER_ARGS=(
  --location global --project "$PROJECT" --workload-identity-pool "$POOL"
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository"
  --attribute-condition "$CONDITION"
)
if gcloud iam workload-identity-pools providers describe "$PROVIDER" "${PROVIDER_ARGS[@]:0:6}" \
  >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" "${PROVIDER_ARGS[@]}"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" "${PROVIDER_ARGS[@]}" \
    --issuer-uri https://token.actions.githubusercontent.com --display-name "nkabom-wt"
fi

echo "Letting the repository act as the service account"
gcloud iam service-accounts add-iam-policy-binding "$ACCOUNT" --project "$PROJECT" \
  --role roles/iam.workloadIdentityUser --condition None --quiet \
  --member "principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPOSITORY" \
  >/dev/null

echo
echo "Done. In GitHub, set these variables on the ${PROJECT#nkabom-} environment:"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
echo "  GCP_SERVICE_ACCOUNT            = $ACCOUNT"
