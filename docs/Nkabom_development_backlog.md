# Nkabom: development backlog (Release 1)

Nkabom: the WomenTrust alumnae community. Backlog for developers, 17 October 2026.

75 stories in seven epics, ordered so each epic builds on the one before it. Points are a rough size (1 = a few hours, 3 = about a day, 5 = two to three days, 8 = a week). Each story names the requirements it covers (FR numbers from the requirements doc) and ends with its "done when" check. Stack: Angular, Firebase (Hosting, Authentication, Firestore, Cloud Functions, Cloud Messaging), and Cloudflare R2 for photos. The developer makes every decision, including the open ones listed at the end of the requirements doc.

## 1. Foundation and infrastructure

- **NKB-101 · Initialise repositories and local environment** (2 pts) · FR-8.7 Angular app and a Firebase project (Hosting, Authentication, Firestore, Functions), with the Firebase Emulator Suite for local work. *Done when:* one command starts everything locally, lint and formatting run, and no secrets are committed.
- **NKB-102 · Continuous integration** (3 pts) Run backend tests, frontend tests, lint, and build on every pull request. *Done when:* a failing check blocks the merge.
- **NKB-103 · Firestore data model** (5 pts) · FR-1.5, FR-2.6 User with role (member, admin, primary admin) and member profile with status (pending, active, rejected, deactivated). *Done when:* the collections can be created from scratch in the emulator and one profile per user is enforced by using the user ID as the document ID.
- **NKB-104 · Audit log service** (3 pts) · FR-8.3 A reusable function that records actor, action, target, and time. *Done when:* entries cannot be edited or deleted from the app and later stories can call it with one line.
- **NKB-105 · Photo storage on Cloudflare R2** (3 pts) · FR-2.3, FR-8.2 Private Cloudflare R2 bucket, with a Cloud Function issuing short-lived signed URLs for upload and download. Checking against a real bucket needs the Cloudflare account from NKB-113. *Done when:* an uploaded file cannot be opened without a valid signed link.
- **NKB-106 · Email service and templates** (3 pts) · FR-8.5 One send function over a free-tier transactional email provider, called from Cloud Functions, with templates kept in one place. *Done when:* the provider can be swapped by configuration and failed sends are logged.
- **NKB-107 · PWA shell** (3 pts) · FR-4.10 Angular PWA setup with manifest, icons, service worker, and an offline fallback page, served over HTTPS from Firebase Hosting. *Done when:* the app can be installed on Android and iPhone and passes the Lighthouse installability check.
- **NKB-108 · Light and dark theme** (3 pts) · FR-8.8, FR-8.9, FR-8.10 Toggle on every page, default from the device setting, choice remembered. *Done when:* every screen is readable in both modes and the choice survives a reload.
- **NKB-109 · Firebase environments and backups** (3 pts) · FR-8.2, FR-8.6 Separate staging and production Firebase projects, scheduled Firestore exports for backups, HTTPS, and secrets kept in Functions configuration. Both projects sit under the shared project Google account. Depends on NKB-113. Automated deploys come in NKB-114. *Done when:* a manual deploy to staging works and a backup restore has been tested once and written up.
- **NKB-110 · Scheduled Cloud Functions** (3 pts) Scheduled functions with retries for the reminder and sync jobs. *Done when:* a sample scheduled job runs on staging, retries on failure, and logs errors.

* **NKB-111 · Admin-only and member-visible data split** (5 pts) · FR-3.1, FR-5.2 Full member records, including date of birth, in an admin-only collection, and a limited directory record (name, photo, occupation or course, graduation year) in a collection members can read, kept in sync by a function. *Done when:* emulator tests show a member can read the directory but never the full record.
* **NKB-112 · Cost guardrails** (2 pts) Blaze plan with a budget alert well under the $5-a-month limit, usage checks for Firestore, Functions, and R2, and a handbook note on what to do if the alert fires. *Done when:* a test alert fires at a low threshold and the alert goes to the shared project account's email.
* **NKB-113 · Shared project accounts** (1 pt) · FR-8.7 A shared Google account for the project, created by the developer, that owns the Firebase projects (NKB-109), the Google Cloud project and calendar service account (NKB-501), and the Cloudflare account for R2 (NKB-105). Turn on 2-step verification, keep backup codes and a recovery email and phone outside the account, and add the payment card chosen for the Firebase Blaze plan and Cloudflare. Needed before NKB-105 can be checked on a real bucket and before NKB-109. *Done when:* the Google and Cloudflare accounts exist, signing in does not depend on a single phone, and the access and recovery details are recorded for the handbook (NKB-708).
* **NKB-114 · Continuous deployment** (3 pts) · FR-8.2 GitHub Actions deploys Hosting, Cloud Functions, and Firestore rules and indexes together: to staging on every merge to main, and to production on a tagged release that needs manual approval in a GitHub environment. It signs in with Workload Identity Federation, so no service account key is stored. Deploys run only after the CI check passes. Each pull request gets a Hosting preview channel against staging. Depends on NKB-109. *Done when:* a merge to main reaches staging without manual steps, production changes only after approval, and a failed CI check blocks the deploy.

## 2. Authentication and accounts

- **NKB-201 · Email sign-up with verification** (5 pts) · FR-1.1, FR-1.2 Registration with email and password and an emailed verification link. *Done when:* an unverified account cannot log in and the link expires.
- **NKB-202 · Login, logout, and session expiry** (3 pts) · FR-1.10 Firebase ID tokens refreshed securely, with a shorter maximum session for admins enforced by the backend. *Done when:* an idle admin session ends sooner than an idle member session.
- **NKB-203 · Password reset** (2 pts) · FR-1.4 Emailed one-time link. *Done when:* the link works once and expires.
- **NKB-204 · Google login** (3 pts) · FR-1.1 OAuth login for members. *Done when:* a new Google user lands on the registration form.
- **NKB-205 · Facebook login** (3 pts) · FR-1.1 OAuth login for members, with the privacy notice URL set in the Meta app. *Done when:* a new Facebook user lands on the registration form.
- **NKB-207 · Account linking by verified email** (3 pts) · FR-1.3 A social login whose verified email matches an existing account links to it. *Done when:* no duplicate account is created and unverified emails are never linked.
- **NKB-208 · Role-based access enforcement** (3 pts) · FR-1.11 Roles stored as custom claims and enforced by Firestore security rules and in every callable function. *Done when:* automated emulator tests show a member is denied on every admin read, write, and function.
- **NKB-209 · First Primary Admin setup command** (1 pt) · FR-1.6 One-off script that creates the first Primary Admin and sets their role claim. *Done when:* it can run once on a fresh database and refuses to create a second one silently.
- **NKB-210 · Create admin accounts** (5 pts) · FR-1.6, FR-1.8, FR-1.9 A callable function lets a Primary Admin enter name, login email, and Google calendar email; the new admin gets an expiring set-password link. *Done when:* admins can log in only with email and password, and the link works once.
- **NKB-211 · Manage admin roles and status** (3 pts) · FR-1.7, FR-1.6 Promote, demote, deactivate, and delete admins. *Done when:* the last Primary Admin cannot be demoted or deleted, and a deactivated admin's sessions end immediately.
- **NKB-212 · Default-deny access** (3 pts) · FR-1.12 Everything requires login except login, sign-up, and the privacy notice. *Done when:* a test of the security rules and routes while logged out finds only those three pages.
- **NKB-213 · Public privacy notice** (2 pts) · FR-1.13, FR-1.14, FR-1.15 Notice page linked from login, sign-up, and the footer, plus a one-line summary on sign-up. *Done when:* the page is reachable logged out and covers every point in FR-1.14.

## 3. Member registration, profile, and approval

- **NKB-301 · Registration form** (5 pts) · FR-2.1, FR-2.2 Name, date of birth, status, course or occupation, graduation year, and photo, with inline validation. *Done when:* invalid dates and graduation years are rejected on both the form and the server.
- **NKB-302 · Photo upload with resizing** (3 pts) · FR-2.3 JPG, PNG, and WebP up to the size limit, resized and compressed in the browser, then uploaded to R2 through a signed URL. *Done when:* oversized or wrong-type files are refused and the stored image is smaller than the original.
- **NKB-303 · Consent and constitution acknowledgment** (3 pts) · FR-2.7, FR-6.8 Consent checkbox, privacy notice link, and constitution acceptance recorded with the version. Depends on NKB-702. *Done when:* the profile cannot be saved without both ticks and the accepted version is stored.
- **NKB-304 · Edit own profile** (2 pts) · FR-2.4, FR-2.5 Members update their details; a last-updated time is kept. *Done when:* edits show on the dashboard and the timestamp changes.
- **NKB-305 · Duplicate detection** (2 pts) · FR-2.6 Warn on identical name and date of birth. *Done when:* the warning appears and an admin can still approve a genuine second person.
- **NKB-306 · Pending state and waiting page** (3 pts) · FR-2.9 A submitted registration is Pending and the member sees only an "awaiting approval" page. *Done when:* a pending member cannot reach the directory, mentorship, or other tabs by URL.
- **NKB-307 · Approve or reject registrations** (5 pts) · FR-2.9 Pending list with approve and reject (optional reason), email to the member, and an audit entry. *Done when:* an approved member gains access at once and every decision is logged with the admin's name.
- **NKB-308 · Yearly profile-update reminder** (3 pts) · FR-2.5 Scheduled email asking members to confirm their details, spread over several days. *Done when:* a batch never exceeds the email provider's daily limit.
- **NKB-309 · Account deletion request** (3 pts) · FR-2.8 Member requests deletion; data and photo are removed and the birthday event deleted. *Done when:* no personal data remains except the audit entry, and the calendar event is gone.

## 4. Admin dashboard and data management

- **NKB-401 · Members list with search, filters, sort, and paging** (5 pts) · FR-3.2, FR-3.3, FR-3.4 Photo, name, date of birth, course or occupation, graduation year, status, and registration date. *Done when:* search by name (prefix or in-browser) and filters by status and graduation year work with 1,000 members.
- **NKB-402 · Member detail, edit, and deactivate** (3 pts) · FR-3.5, FR-3.8 Full profile view with admin edit and deactivate. *Done when:* every change is logged with the admin's identity and time.
- **NKB-403 · Summary counts and pending badge** (2 pts) · FR-3.9 Total members, students versus graduates, members per graduation year, and pending count. *Done when:* counts match the list and the badge updates after each approval.
- **NKB-404 · CSV and Excel export** (3 pts) · FR-3.6 Export the filtered list. *Done when:* each export creates an audit entry.
- **NKB-405 · Excel import with preview** (5 pts) · FR-3.7 Upload the old alumni sheet, preview rows, and see an error report before committing. *Done when:* a file with bad rows imports the good rows only after confirmation.
- **NKB-406 · Audit log viewer** (3 pts) · FR-8.3 Searchable list of admin actions. *Done when:* admins can filter by actor, action, and date, and cannot edit entries.

## 5. Birthdays and notifications

- **NKB-501 · Google Cloud project and service account** (2 pts) · FR-4.6 In the production Firebase project, under the shared project Google account (NKB-113), enable the Calendar API and have the project's service account create the shared executives' calendar through the API, so the service account owns it (FR-4.6). Staging gets its own test calendar. Store the key in the secrets store. *Done when:* the backend can create and delete a test event, and the owner accounts are recorded for the handbook.
- **NKB-502 · Create birthday event on approval** (5 pts) · FR-4.1, FR-4.2 Yearly recurring all-day event named "\<first name> \<surname>'s birthday", starting on the next upcoming birthday, with the event ID stored. Depends on NKB-307. *Done when:* the event shows the day and month only, never the year or age, and no event exists for pending or rejected members.
- **NKB-503 · Handle 29 February birthdays** (1 pt) · FR-4.3 Repeat on the last day of February. *Done when:* a 29 February member's event falls on 28 February in non-leap years.
- **NKB-504 · Keep events in sync with profile changes** (3 pts) · FR-4.4 Update on name or date-of-birth change, delete on deactivation or deletion. *Done when:* each change is reflected in the calendar within a minute.
- **NKB-505 · Share calendar with admins** (3 pts) · FR-4.7 Add each admin's Google email read-only on creation and remove it on deactivation. *Done when:* a deactivated admin loses calendar access in the same step.
- **NKB-506 · Sync status, retries, and failure alert** (3 pts) · FR-4.5 Store sync status per member and retry failures. *Done when:* repeated failures raise an alert to a Primary Admin.
- **NKB-507 · Full re-sync and paced bulk create** (3 pts) · FR-4.6, FR-3.7 Primary Admin button that rebuilds all events in small batches, also used after the Excel import. *Done when:* 1,000 members sync without hitting the API rate limit.
- **NKB-508 · Admin guide to set calendar reminders** (1 pt) · FR-4.8 Short in-app guide shown to new admins. *Done when:* it appears on first admin login and can be reopened from settings.
- **NKB-509 · Push notification tokens** (5 pts) · FR-4.10, FR-4.15 Firebase Cloud Messaging tokens, token storage, and the service worker push handler. *Done when:* one user can receive a push on two devices and expired subscriptions are deleted on failure.
- **NKB-510 · Notification permission prompt** (3 pts) · FR-4.11 Prompt after login, with an add-to-Home-Screen guide on iPhone and permission requested only on a button tap. *Done when:* push can be enabled from an installed iPhone web app.
- **NKB-511 · Notification service with email backup** (5 pts) · FR-4.12, FR-4.13, FR-4.16 Push first, then email if there is no subscription, the push fails, or an alert is not opened within the set time. *Done when:* each rule is covered by a test, messages carry the name only, and every attempt is logged.
- **NKB-512 · Registration alerts and reminders** (2 pts) · FR-2.10, FR-2.11 Notify admins of each new registration and remind them if one stays pending past the set days. *Done when:* an alert reaches all admins with a link to the Pending list.
- **NKB-513 · Admin notification settings** (2 pts) · FR-4.14 Page showing push status with a "send a test notification" button. *Done when:* the test arrives on every enabled device.
- **NKB-514 · Optional WhatsApp group adapter** (3 pts, optional) · FR-4.17 Spike on an unofficial integration, off by default. *Done when:* it can be enabled and disabled in settings and its failure never blocks push or email.

## 6. Mentorship

- **NKB-601 · Mentor directory** (5 pts) · FR-5.1, FR-5.2, FR-5.3 Searchable, filterable list of active members showing name, photo, occupation or course, and graduation year. *Done when:* date of birth and contact details never appear in the response and pending members are excluded.
- **NKB-602 · Send a mentorship request** (3 pts) · FR-5.4, FR-5.10 Short message and optional topic, with a limit on pending requests and a delay before re-sending a declined one. *Done when:* the limits are enforced on the server.
- **NKB-603 · Accept or decline a request** (3 pts) · FR-5.5 Recipient responds with an optional note. *Done when:* the requester sees the outcome and the status cannot be changed twice.
- **NKB-604 · Share contacts after acceptance** (2 pts) · FR-5.6 Email, and phone if collected, become visible to both people only after acceptance. *Done when:* contact details are absent from the API before acceptance.
- **NKB-605 · Cancel a request or end a mentorship** (2 pts) · FR-5.7 Either party can end it at any time. *Done when:* contacts are hidden again after ending.
- **NKB-606 · Opt out of requests** (2 pts) · FR-5.8, FR-5.9 Profile setting that hides the Request button and can be reversed at any time. *Done when:* the change applies immediately and existing requests are untouched.
- **NKB-607 · Block and report a member** (3 pts) · FR-5.11 A blocked member can no longer send requests to the blocker, and reports reach the admins. *Done when:* the block holds across new requests and reports appear in the admin view.
- **NKB-608 · Mentorship notifications** (2 pts) · FR-4.18 Push with email backup for requests and responses. *Done when:* the recipient is notified within a minute of each event.
- **NKB-609 · Admin mentorship overview** (3 pts) · FR-5.12 View all requests and matches, remove a match, and see counts of sent, accepted, and declined. *Done when:* removing a match is logged and hides the contacts.

## 7. Constitution, coming-soon tabs, and launch

- **NKB-701 · Constitution page** (5 pts) · FR-6.1, FR-6.2, FR-6.3 Readable by article and section with a table of contents, in-page search, and PDF download. *Done when:* it works on a phone and is visible only after login.
- **NKB-702 · Publish and version the constitution** (5 pts) · FR-6.4, FR-6.5, FR-6.6 Admin screen to paste or upload text with a version number, effective date, and change summary, plus a read-only archive. *Done when:* earlier versions cannot be edited or deleted and publishing is logged.
- **NKB-703 · Acceptance tracking and re-acceptance gate** (5 pts) · FR-6.8, FR-6.9, FR-6.10 Record which version each member accepted, block the site until a new version is accepted, and show admins who is still pending. Depends on NKB-702. *Done when:* a member sees only the new version and the accept button after an update.
- **NKB-704 · Constitution update notifications** (2 pts) · FR-6.7 Notify members of each new version with the change summary, without the text itself. *Done when:* every active member is notified once per version.
- **NKB-705 · Coming-soon tabs with feature flags** (2 pts) · FR-7.1 to FR-7.4 Opportunities, Events and Announcements, Success Stories, and Giving Back, each its own route behind a flag. *Done when:* the tabs show a "Coming soon" message only to logged-in approved users.
- **NKB-706 · Security review and authorization tests** (5 pts) · FR-1.11, FR-8.2 Review security rules, custom claims, signed URLs, and every callable function. *Done when:* the emulator tests cover each role against each collection and function and the findings are fixed.
- **NKB-707 · Retention and deletion rules** (2 pts) · FR-8.4 Written retention rule and the job or process that applies it. *Done when:* the rule is in the privacy notice and the handbook.
- **NKB-708 · Admin handbook** (3 pts) · FR-8.7 Handover steps, the owners of the email, push, Google, hosting, and Cloudflare accounts, how to hand over the shared project Google account, and how to promote a Primary Admin. *Done when:* a new executive could follow it without help from the developer.
- **NKB-709 · End-to-end test on staging** (3 pts) Register, approve, birthday event, mentorship request, and constitution update, on staging with real phones. *Done when:* the full path passes on Android and iPhone.
- **NKB-710 · Accessibility and low-bandwidth pass** (3 pts) · FR-8.1 Check keyboard use, contrast in both themes, and page weight on a slow connection. *Done when:* main pages load acceptably on throttled 3G and pass an accessibility checker.
- **NKB-711 · Launch checklist** (2 pts) Final privacy notice text, Google API pricing check, and go-live. *Done when:* the developer has decided or consciously deferred every open decision in the requirements doc.
