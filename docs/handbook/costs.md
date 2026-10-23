# Costs and the budget alert

> **Being replaced.** The projects stay on the free Spark plan, which cannot be billed, and server code moves to a Cloudflare Worker on its free plan (NKB-114 to NKB-120). The budgets, the cap and the instance limit below are never set up, and NKB-120 rewrites this page. Photos and backups also move from R2 to Workers KV (NKB-115, NKB-119), so no card is needed on Cloudflare either. The monthly usage checks still apply, with KV in place of R2.

Nkabom should cost less than $5 a month (requirements, Technology). Firebase's Blaze plan needs a card on file, so a budget watches the spending and turns billing off before it gets far. This page says what is set up, what to check each month, and what to do when an alert email arrives.

Everything here is done signed in as the shared project Google account.

## What is set up

| Project          | Monthly budget | Emails at                                | Billing turned off at |
| ---------------- | -------------- | ---------------------------------------- | --------------------- |
| `nkabom-prod`    | $1.50          | $0.75, $1.35, $1.50, and $1.50 forecast  | $1.50 actual spend    |
| `nkabom-staging` | $0.50          | $0.25, $0.45, $0.50, and $0.50 forecast  | $0.50 actual spend    |

- **Alert emails** go to the billing account's admins, which is the shared project account. The forecast email means Google expects the month to end over budget; it is a warning only.
- **The cap:** each budget also notifies the project's `enforceBudget` function. Once actual spend for the month reaches the budget, it unlinks the project from the billing account, so no more charges can build up. It never acts on a forecast. Each project can only turn off its own billing, so staging cannot take production down.
- **Instance limit:** no Cloud Function runs more than 10 copies at once, so a bug or a flood of requests cannot multiply the bill.
- **Card limit:** Google and Cloudflare are paid with a virtual card with a monthly spending limit (see [accounts.md](accounts.md#payment-card)). It also covers Cloudflare and any other Google project on the account, which the budgets do not.

Budgets are made with `scripts/create-budget.sh` (see the README, Setting up a project). Change an amount in the Google Cloud console under **Billing > Budgets & alerts**.

## When billing is turned off

The project drops back to the free Spark plan:

- The app's pages still load from Firebase Hosting, and Firestore keeps its data.
- Cloud Functions stop. New sign-ups get no user record, photos cannot be uploaded or viewed, no email is sent, the directory stops updating, and scheduled jobs, including the nightly backup, do not run.
- Google warns that it can delete resources in a project that stays without billing. Turn billing back on within days, not weeks.

## When an alert email arrives

**At 50% or 90%, or a forecast:** nothing has stopped yet. Find out why within a few days.

1. In the Google Cloud console, open **Billing > Reports**, choose the project, and group by **Service**. The biggest bar is where the money goes.
2. Compare with the monthly checks below to see which limit was passed.
3. Common causes: a function stuck in a loop (the same function in the logs again and again), many more Firestore reads than usual (a page reading a whole collection), or old function images piling up in Artifact Registry.
4. Fix the cause, or if the usage is real and expected, raise the budget, still under $5 in total.

**At 100%, with billing turned off:** the app is partly down (see above).

1. Find the cause as above and fix it first. Turning billing back on without a fix only spends more.
2. Raise that project's budget above this month's spend in **Billing > Budgets & alerts**. Otherwise the next budget notification, within hours, turns billing off again. Put it back on the 1st of next month, when spend starts again from zero.
3. Turn billing back on: in the Firebase console, open the project's **Usage and billing**, and choose the Blaze plan with the shared billing account.
4. Check the app works: sign in, open the directory, and in Cloud Scheduler **Force run** `backupFirestore`.
5. Tell the other executives what happened and what was changed.

The function's own record is in Logs Explorer: search for `"Budget reached"`.

## Monthly checks

Once a month, look at each service's usage against its free allowance. The allowances below are from Google's and Cloudflare's pricing pages as of October 2026; check them there if a number looks wrong.

| Service                             | Where to look                                       | Free each month (or day)                                                      |
| ----------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Firestore                           | Firebase console > Firestore > **Usage**            | 50,000 reads, 20,000 writes and 20,000 deletes a day; 1 GiB stored            |
| Cloud Functions                     | Firebase console > Functions > **Usage**            | 2 million calls; 400,000 GB-seconds and 200,000 CPU-seconds                   |
| Cloud Scheduler                     | Google Cloud console > Cloud Scheduler              | 3 jobs per billing account, then $0.10 a job                                  |
| Secret Manager                      | Google Cloud console > Security > Secret Manager    | 6 secret versions per billing account, then $0.06 a version                   |
| Cloud Storage (backups)             | Google Cloud console > Cloud Storage > Buckets      | 5 GB only in US regions; elsewhere about $0.02 per GB                         |
| Artifact Registry (function images) | Google Cloud console > Artifact Registry            | 0.5 GB                                                                        |
| Hosting                             | Firebase console > Hosting > **Usage**              | 10 GB stored, 360 MB a day transferred                                        |
| Cloudflare R2 (photos)              | Cloudflare dashboard > R2 > **Metrics**             | 10 GB stored, 1 million uploads (class A), 10 million downloads (class B)     |

Cloudflare R2 is billed by Cloudflare, not Google, so the budget above does not cover it. If R2 nears its free allowance, look at photo sizes (they should be resized before upload) before paying.

Cloud Scheduler stays free while there are at most 3 jobs. Each project should end up with one daily job, which also runs the backup, so 2 in total; until then each has its backup job and, until its staging check, the heartbeat, which makes 4, about $0.10 a month. Secret Manager stays free while each project has at most 3 secrets (`R2_CREDENTIALS`, `BREVO_API_KEY`, and the calendar key) and old versions are pruned with `firebase functions:secrets:prune`. Keep old function images down by accepting the cleanup policy the Firebase CLI offers on the first deploy, or run `firebase functions:artifacts:setpolicy`.

## Testing the alert and the cap

Do this on staging once, and after any change to the budgets:

1. **Email:** in **Billing > Budgets & alerts**, set the `nkabom-staging` budget to the lowest amount allowed. Budget emails come only from real spend, so this fires on the first charge of any size; it can take a day. Check the email reaches the shared project account, then set the budget back to $0.50.
2. **Cap:** send a fake over-budget notification:

   ```sh
   gcloud pubsub topics publish budget-alerts --project=nkabom-staging \
     --message='{"budgetDisplayName":"test","costAmount":1,"budgetAmount":0.5,"currencyCode":"USD"}'
   ```

   Within a minute, Logs Explorer shows `Budget reached: billing turned off` and the staging project is on the Spark plan. Turn billing back on as in step 3 above.
