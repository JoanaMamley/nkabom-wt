# Costs and free limits

Nkabom costs nothing to run, and that is how it must stay: it is a charity project. Both Firebase projects are on the free Spark plan and Cloudflare is on the Workers free plan, and neither the Google nor the Cloudflare account has a card on it (see [accounts.md](accounts.md)). So nothing can be charged. Instead, a service that reaches a free limit stops until the limit resets. This page lists the limits that matter, what to check each month, and what to do when one is reached.

Everything here is done signed in as the shared project accounts.

## The limits

From Google's and Cloudflare's pricing pages as of October 2026; check them there if a number looks wrong. Cloudflare's limits are for the whole account, so staging and production share them.

| Service                      | Free                                                                              | Resets              | When it runs out                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| Firestore                    | 50,000 reads, 20,000 writes and 20,000 deletes a day; 1 GiB stored                | Midnight US Pacific | The app cannot load or save data                                           |
| Firebase Hosting             | 10 GB stored; 360 MB a day transferred                                            | Daily               | The site stops loading for new visitors; installed copies still open       |
| Cloudflare Workers           | 100,000 requests a day; 10 ms of CPU per request                                  | Midnight UTC        | The API refuses calls: no sign-ups, profile edits, photos or email         |
| Workers KV (photos, backups) | 1 GB stored; 100,000 reads, 1,000 writes, 1,000 deletes and 1,000 lists a day     | Midnight UTC        | Photos cannot be uploaded or seen, and backups fail                        |
| Cloudflare Queues            | 10,000 operations a day                                                           | Midnight UTC        | Scheduled tasks, such as the backup, do not run                            |
| Cron Triggers                | 5 per account                                                                     | (a count, not a rate) | A deploy with more is refused                                           |
| Gmail (the app's email)      | About 500 recipients a day, counted over a rolling 24 hours                       | Rolling             | Emails fail and are logged as `Email send failed`                          |

At about 1,000 members, normal use is well inside all of them. The README says how each part keeps to its limits: photos are resized before upload (Photo storage), large email sends are spread over days (Email), backups use about 35 KV writes a day per environment (Backups), and each task on the 5-minute schedule costs about 860 queue operations a day per environment (Scheduled jobs).

## Monthly checks

Once a month, look at each service's usage against the limits above. Anything above about half of a daily limit on a normal day needs looking into before it becomes a problem.

| Service             | Where to look                                                                       |
| ------------------- | ----------------------------------------------------------------------------------- |
| Firestore           | Firebase console > Firestore Database > **Usage**, for each project                 |
| Hosting             | Firebase console > Hosting > **Usage**, for each project                            |
| Workers             | Cloudflare dashboard > Workers & Pages > `nkabom-api-prod` (and staging) > **Metrics** |
| Workers KV          | Cloudflare dashboard > Storage & Databases > KV > each namespace > **Metrics**      |
| Queues              | Cloudflare dashboard > Queues > `nkabom-jobs-prod` (and staging) > **Metrics**      |
| Scheduled tasks     | Firebase console > Firestore Database > `jobStatus`: every task `succeeded`         |

## When a limit is reached

Members see errors, or a failed scheduled task emails the Primary Admins. Nothing is charged, and the service comes back by itself when the limit resets, usually within a day.

1. Find which limit: the table above says what stops for each. The usage pages in the monthly checks show which one is at its limit.
2. Find the cause. Common ones: a page that reads a whole collection instead of one document, something calling the API in a loop, photos stored without resizing, or a new task on the 5-minute schedule.
3. Fix the cause and deploy. If it was a one-off, such as an import, wait for the reset.
4. Tell the other executives what happened and when it will be back.

Do not add a card to get past a limit: the project is meant to cost nothing. If normal use outgrows a limit, change how the app uses that service.
