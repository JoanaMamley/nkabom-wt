#!/usr/bin/env bash
# Sets up the Firestore backup bucket for one Firebase project (NKB-109): gs://<project>-backups,
# private, in the same location as the project's Firestore database, deleting exports after 30
# days, with the rights backupFirestore needs to start exports and write them. See the README,
# Backups.
#
#   scripts/create-backup-bucket.sh nkabom-staging
#   scripts/create-backup-bucket.sh nkabom-prod
#
# Run it once per project, signed in to gcloud as the shared project account, after the Firestore
# database is created. It is safe to run again: an existing bucket is updated, not replaced.
set -euo pipefail

project=${1:?Usage: scripts/create-backup-bucket.sh <project ID>}
bucket=gs://$project-backups
here=$(dirname "$0")

location=$(gcloud firestore databases describe --database='(default)' --project="$project" \
  --format='value(locationId)' 2>/dev/null || true)
if [[ -z $location ]]; then
  echo "$project has no Firestore database yet. Create it in the Firebase console first." >&2
  exit 1
fi

# A multi-region database (nam5, eur3) exports to the matching multi-region bucket location.
case $location in
  nam5) location=us ;;
  eur3) location=eu ;;
esac

if gcloud storage buckets describe "$bucket" >/dev/null 2>&1; then
  echo "$bucket already exists; updating its settings."
else
  gcloud storage buckets create "$bucket" --project="$project" --location="$location" \
    --uniform-bucket-level-access --public-access-prevention
fi
gcloud storage buckets update "$bucket" --lifecycle-file="$here/backup-lifecycle.json"

# backupFirestore runs as the default compute service account. Let it start exports and write them.
number=$(gcloud projects describe "$project" --format='value(projectNumber)')
account="serviceAccount:$number-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$project" --member="$account" \
  --role=roles/datastore.importExportAdmin --condition=None >/dev/null
gcloud storage buckets add-iam-policy-binding "$bucket" --member="$account" \
  --role=roles/storage.admin >/dev/null

echo "Backup bucket $bucket ready in $location. Deploy backupFirestore if it is not deployed yet."
