#!/usr/bin/env bash
# Sets up the cost guardrail for one Firebase project (NKB-112): a monthly budget that emails the
# billing account's admins at 50%, 90% and 100% of actual spend and at 100% of forecast spend, and
# sends every notification to the budget-alerts topic, where enforceBudget turns billing off once
# actual spend reaches the budget. See docs/handbook/costs.md.
#
#   scripts/create-budget.sh nkabom-prod 1.50
#   scripts/create-budget.sh nkabom-staging 0.50
#
# Run it once per project, signed in to gcloud as the shared project account, after the project is
# on the Blaze plan. The amount is in the billing account's currency (CURRENCY, default USD).
set -euo pipefail

project=${1:?Usage: scripts/create-budget.sh <project ID> <monthly amount>}
amount=${2:?Usage: scripts/create-budget.sh <project ID> <monthly amount>}
currency=${CURRENCY:-USD}
topic=budget-alerts

account=$(gcloud billing projects describe "$project" --format='value(billingAccountName)')
account=${account#billingAccounts/}
if [[ -z $account ]]; then
  echo "$project has no billing account. Move it to the Blaze plan first." >&2
  exit 1
fi

if [[ -n $(gcloud billing budgets list --billing-account="$account" \
  --filter="displayName=$project" --format='value(name)') ]]; then
  echo "A budget named $project already exists. Change it in the console instead." >&2
  exit 1
fi

gcloud services enable cloudbilling.googleapis.com billingbudgets.googleapis.com \
  pubsub.googleapis.com --project="$project"

if ! gcloud pubsub topics describe "$topic" --project="$project" >/dev/null 2>&1; then
  gcloud pubsub topics create "$topic" --project="$project"
fi

gcloud billing budgets create \
  --billing-account="$account" \
  --display-name="$project" \
  --budget-amount="$amount$currency" \
  --filter-projects="projects/$project" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend \
  --notifications-rule-pubsub-topic="projects/$project/topics/$topic"

# enforceBudget runs as the default compute service account. Unlinking billing needs only the
# project-level Project Billing Manager role, not access to the billing account.
number=$(gcloud projects describe "$project" --format='value(projectNumber)')
gcloud projects add-iam-policy-binding "$project" \
  --member="serviceAccount:$number-compute@developer.gserviceaccount.com" \
  --role=roles/billing.projectManager --condition=None >/dev/null

echo "Budget of $amount $currency set for $project. Deploy enforceBudget if it is not deployed yet."
