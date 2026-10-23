# Nkabom: the WomenTrust alumnae community

*Shape in, shape out.*

Functional requirements, Release 1. 17 October 2026.

**Decisions:** the developer makes every decision on this project, including the open ones at the end of this document. Nothing waits on sign-off from the executives.

**Roles:** Member, Admin (Executive), Primary Admin (an admin with extra rights over admin accounts). There can be more than one Primary Admin.

## 1. Authentication and accounts

- **FR-1.1** Members can register and log in with email and password, Google, or Facebook.
- **FR-1.2** Email sign-ups must verify the email address before the account is active.
- **FR-1.3** Logging in with a social provider whose email matches an existing account links to that account instead of creating a duplicate.
- **FR-1.4** Email/password accounts can reset their password via an emailed link.
- **FR-1.5** The system has two roles, Member and Admin. A Primary Admin is an admin with the extra right to manage admin accounts.
- **FR-1.6** The first Primary Admin account is created during initial system setup. A Primary Admin can create admin accounts by entering a name, a login email, and the Google account email to use for the birthday calendar (which can be the same address), and can deactivate or delete admin accounts.
- **FR-1.7** A Primary Admin can promote an existing admin to Primary Admin, and can demote another Primary Admin to a normal admin. The system never allows the last Primary Admin to be demoted or deleted.
- **FR-1.8** When an admin account is created, the system emails a one-time, expiring link for the new admin to set their password before first login.
- **FR-1.9** Admins log in with email and password only, not social login.
- **FR-1.10** Sessions expire after inactivity, and admin sessions are shorter than member sessions.
- **FR-1.11** Admin routes and APIs are enforced server-side, not only hidden in the UI.
- **FR-1.12** Nothing on the site is visible before login except three pages: login, sign-up, and the privacy notice. Every other page and API requires an authenticated session.
- **FR-1.13** The privacy notice is linked from the login page, the sign-up page, and the site footer.
- **FR-1.14** The privacy notice explains in plain language:
  - what data is collected (name, date of birth, occupation or course, graduation year, photo)
  - why it is collected
  - who can see what (admins see full records; members see the limited directory profile)
  - that members' names and birthdays (day and month only) are stored in a shared Google Calendar accessible only to admins
  - how long data is kept
  - members' rights to access, correct, and delete their data
  - who to contact about their data
- **FR-1.15** The sign-up page shows a one-line summary of the notice with a link. The consent checkbox in FR-2.7 is recorded after login.

## 2. Member registration and profile

- **FR-2.1** After first login, a member must complete a registration form with:
  - First name(s) (required)
  - Surname (required)
  - Date of birth (required)
  - Status: Student or Graduate/Working (required)
  - Course of study (if student) or occupation (if graduate) (required)
  - Year of graduation from tertiary education, or expected year if still studying (required)
  - Profile photo (required)
  - Acceptance of the constitution (see FR-6.8)
- **FR-2.2** Validation: the date of birth must be a valid past date, the graduation year must be within a sensible range (for example 1990 to current year + 8), and errors show inline.
- **FR-2.3** The photo upload accepts JPG, PNG, and WebP up to a size limit (for example 5 MB). The system resizes and compresses the image and stores it in private object storage.
- **FR-2.4** Members can view and edit their own details at any time.
- **FR-2.5** Each profile has a "last updated" timestamp. The system sends a yearly email reminder asking members to confirm or update their details. Sends are spread over several days if the volume would exceed the email provider's daily limit.
- **FR-2.6** A member can have only one profile. Duplicate detection warns on identical name plus date of birth.
- **FR-2.7** The registration form includes a consent checkbox and a link to the privacy notice, in line with Ghana's Data Protection Act. The notice states that name, photo, occupation or course, and graduation year are visible to other members through the mentor directory (FR-3.1, FR-5.2), and that birthdays are shared with the executives (FR-1.14).
- **FR-2.8** Members can request deletion of their account and data. Deletion also removes the member's birthday event from the calendar (FR-4.4).
- **FR-2.9** New registrations require admin approval:
  - After submitting the profile form, a member's status is **Pending**. A pending member sees only an "awaiting approval" page, with no directory, mentorship, or other tabs.
  - Admins see a **Pending registrations** list on the dashboard, with a count badge, and can approve or reject each one. Rejection takes an optional reason.
  - The member gets an email when approved or rejected.
  - Every decision is recorded in the audit log with the admin's name and the time.
  - Pending members do not appear in the mentor directory.
  - The Pending list is the source of truth, so a missed notification never means a missed registration.
- **FR-2.10** When a registration is submitted, the system notifies the admins through the notification service (FR-4.10 to FR-4.17) with the member's name only and a link to the Pending list.
- **FR-2.11** If a registration is still pending after a set number of days (for example 3), the system reminds the admins.

## 3. Admin dashboard

- **FR-3.1** Only admins can access the dashboard and the full member records. Members can see only the limited directory profile defined in FR-5.2, never date of birth or other full-record fields.
- **FR-3.2** The dashboard lists all members with photo, full name, date of birth, occupation or course, graduation year, status (pending, active, rejected, deactivated), and registration date.
- **FR-3.3** Admins can search by name and filter by status and graduation year.
- **FR-3.4** Admins can sort and paginate the list.
- **FR-3.5** Admins can view a member's full profile.
- **FR-3.6** Admins can export the member list to CSV or Excel. Exports are recorded in an audit log.
- **FR-3.7** Admins can import the existing Excel sheet to seed the database, with a preview and error report before committing. Imported members who are approved get their birthday events created (FR-4.6).
- **FR-3.8** Admins can edit or deactivate a member's record, and every such change is logged with the admin's identity and a timestamp.
- **FR-3.9** The dashboard shows summary counts: total members, students versus graduates, members per graduation year, and pending registrations.

## 4. Birthdays and notifications

### Birthdays (Google Calendar)

- **FR-4.1** When a registration is approved, the system creates a yearly recurring all-day event named "\<first name> \<surname>'s birthday" on the executives' shared Google Calendar, starting on the member's next upcoming birthday.
- **FR-4.2** Events contain the name only. They never include year of birth, age, photo, or other profile details, and they are never created for pending or rejected members.
- **FR-4.3** Members born on 29 February have their event repeat on the last day of February.
- **FR-4.4** The system updates the event when a member's name or date of birth changes, and deletes it when a member is deactivated, deleted, or has their data removed.
- **FR-4.5** The system stores each member's calendar event ID and sync status, retries failed calls, and alerts a Primary Admin if syncing keeps failing.
- **FR-4.6** The calendar is owned by a project Google service account. A Primary Admin can trigger a full re-sync. Bulk creation, such as after the Excel import, runs in small paced batches with retries to stay within the API's rate limits.
- **FR-4.7** When an admin is created, their Google account email is added to the calendar's sharing list with read-only access, and removed when they are deactivated or deleted.
- **FR-4.8** A new admin sees a short guide for setting their own Google Calendar reminder time. Admins mute or change birthday reminders in Google Calendar, so the site has no birthday on/off toggle.
- **FR-4.9** Birthday reminders are for the admins only. The system never sends a birthday message to the member.

### Notifications (registrations, mentorship, constitution)

- **FR-4.10** The site is an installable PWA with a manifest and service worker, served over HTTPS.
- **FR-4.11** After login, admins are prompted to enable notifications. On iPhones the prompt first explains how to add the site to the Home Screen, since push only works for installed web apps there, and the permission request is triggered by an explicit button tap.
- **FR-4.12** The notification service sends **push** notifications first and **email** as backup. It sends the email when:
  - the person has no active push subscription
  - the push service rejects the message or reports the subscription as expired (the dead subscription is also deleted)
  - a registration alert has not been opened or actioned within a set time (for example 2 hours)
- **FR-4.13** Push and email notifications to admins contain the member's name only and a link to the dashboard. They never include date of birth, age, or other profile details, because push messages appear on lock screens.
- **FR-4.14** Each admin has a settings page showing their notification status (push enabled or email only) with a "send a test notification" button.
- **FR-4.15** A person can have push subscriptions on several devices, and a push goes to all of them.
- **FR-4.16** The system logs every send attempt, retries on failure, and alerts a Primary Admin if delivery to an admin keeps failing.
- **FR-4.17 (optional)** A WhatsApp group adapter can be enabled by a Primary Admin. It is off by default and uses an unofficial integration, so it only repeats the same name-only registration alerts that push and email already carry. Failures never block the other channels. The privacy notice and admin handbook mention it if it is enabled.
- **FR-4.18** Members receive push, with email as backup, for mentorship requests and responses (section 5) and for constitution updates (section 6), subject to their own notification settings.

## 5. Mentorship matching

- **FR-5.1** A logged-in, approved member can browse a mentor directory of all active members and send a mentorship request to any of them, including students requesting from other students.
- **FR-5.2** The directory shows only first name, surname, photo, occupation or course of study, and graduation year. Date of birth and contact details are never shown.
- **FR-5.3** The directory supports search by name and filtering by occupation/field and graduation year.
- **FR-5.4** A request includes a short message describing what help is wanted and an optional topic.
- **FR-5.5** The recipient is notified (FR-4.18) and can accept or decline, optionally with a short note.
- **FR-5.6** Contact details (email, and phone if collected) are shared between the two people only after acceptance.
- **FR-5.7** Members can cancel a pending request and end an accepted mentorship at any time.
- **FR-5.8** Members can opt out of receiving mentorship requests with a setting in their profile. While opted out, the Request button is hidden for others. Members can switch the setting back at any time, and the change takes effect immediately.
- **FR-5.9** Opting out does not affect requests already accepted or pending. Pending requests to a member who opts out stay visible to them until answered or cancelled.
- **FR-5.10** A member can have at most N pending requests at once (for example 3), and cannot re-send a declined request to the same person within a set period.
- **FR-5.11** Members can block or report another member who sends unwanted requests.
- **FR-5.12** Admins can see all requests and matches, remove a match, and see participation statistics (requests sent, accepted, declined).

## 6. Alumni constitution

The constitution text is not yet in hand. These requirements cover how the platform hosts it.

- **FR-6.1** The site has a **Constitution** page, linked from the main navigation and the footer, visible only to logged-in users.
- **FR-6.2** The constitution is displayed as readable text, organized by article and section with a clickable table of contents, and works well on mobile.
- **FR-6.3** Members can search within the constitution and download it as a PDF.
- **FR-6.4** Only admins can publish and update the constitution, by pasting text or uploading a document through an admin screen.
- **FR-6.5** Each published version records a version number, effective date, and short summary of changes. Earlier versions stay viewable in an archive and cannot be edited or deleted.
- **FR-6.6** Publishing a new version is recorded in the audit log with the admin's identity and timestamp.
- **FR-6.7** Members are notified (FR-4.18) when a new version is published, with a summary of changes. The notification tells them to log in to read it and does not include the constitution text.
- **FR-6.8** During registration, the member must read and tick an acknowledgment ("I have read and agree to the constitution") before the profile can be saved. The system records which version was accepted and when.
- **FR-6.9** After a new version is published, every member must accept it on their next login. Until they do, they see only the new version and the accept button, and cannot use other parts of the site.
- **FR-6.10** Admins can see which members have accepted which version, and who is still pending.
- **FR-6.11 (open)** Admins accept new versions too, but are not blocked from administrative duties until they have. Whether to block them as well is an open decision (see the end of this document).

## 7. Coming-soon tabs

- **FR-7.1** The site navigation includes tabs for **Opportunities**, **Events and Announcements**, **Success Stories**, and **Giving Back**.
- **FR-7.2** Each tab shows a "Coming soon" message and no functionality.
- **FR-7.3** The tabs are visible only to logged-in, approved members and admins.
- **FR-7.4** The tabs are built as separate routes so each feature can be enabled later without restructuring the navigation. A single configuration flag per feature is enough.

## 8. Cross-cutting requirements

- **FR-8.1** The site is responsive and works well on low-end phones and slow connections.
- **FR-8.2** All data travels over HTTPS, and photos are stored in private storage with access-controlled URLs.
- **FR-8.3** An audit log records admin actions: logins, exports, edits, deletions, account creation, role changes, registration decisions, calendar sharing changes, and constitution publishing.
- **FR-8.4** The system supports data deletion requests and a documented data retention rule.
- **FR-8.5** Email templates are maintained in one place in the codebase or editable by admins.
- **FR-8.6** The system includes automated backups and a documented restore procedure.
- **FR-8.7** An admin handbook documents handover steps for when the executive team changes, including how to promote a new Primary Admin (FR-1.7), who owns the email and push-notification accounts, where the Google Cloud project and service account for the birthday calendar are kept, and how access to the shared project Google account is handed over.

* **FR-8.8** The site has a light mode and a dark mode, and a toggle visible on every page, including login and sign-up, lets any user switch between them at any time.
* **FR-8.9** On a first visit the site follows the device's light or dark setting. After a user switches, their choice is remembered on that device and applies across the whole site, including the admin dashboard.
* **FR-8.10** Both modes keep text readable, with enough contrast for photos, status badges, and form errors.

## 9. Technology stack

- **Frontend:** Angular, built as an installable PWA (FR-4.10) and hosted on Firebase Hosting.
- **Backend:** Firebase on the free Spark plan: Authentication (email, Google, and Facebook), Firestore, and Cloud Messaging (push). Server code runs in a Cloudflare Worker on the free plan: the app's API (approvals, admin accounts, signed photo links, exports, birthday calendar sync, directory record sync, and email and push sends), scheduled jobs (Cron Triggers), and retried bulk work (Queues). It acts on Firebase with a service account key held as a Worker secret.
- **Database:** Firestore, with full member records in an admin-only collection and a limited directory record that members can read (FR-3.1, FR-5.2), enforced by Firestore security rules with automated tests.

* **Email:** Gmail's mail server, sending as the shared project Google account with an app password, called from the Worker, with templates kept in one place in the codebase (FR-8.5). A free Gmail account can send a few hundred emails a day, so large sends are spread over several days (FR-2.5). The provider can be swapped by configuration; a Brevo provider is also built.
* **Photo storage:** Workers KV, private and read only through the Worker, with short-lived signed links issued by the Worker (FR-2.3, FR-8.2). Cloudflare R2 was dropped because it needs a payment method on file.
* **Cost target:** $0 a month; this is a charity project. Firebase stays on the free Spark plan, which cannot be billed: Cloud Functions would need the Blaze plan, and Google asked for a prepayment to turn it on. Cloudflare Workers and Workers KV are used within their free plans, which need no card, and email goes through the shared Gmail account; Workers and KV reject requests past their limits instead of charging.

- **Development and backups:** the Firebase Emulator Suite and `wrangler dev` for local development and automated tests, and daily Firestore exports by the Worker to a private Workers KV namespace for backups (FR-8.6).
- **Accounts:** a shared project Google account, created by the developer, owns the Firebase projects, the Google Cloud project for the birthday calendar, the Cloudflare account for Workers and Workers KV, and sends the app's email from its Gmail account. Its access and recovery details are kept in a private record outside the repo, which the admin handbook points to (FR-8.7).

## Deferred to later releases

Voting, the opportunities board, events and announcements, success stories and spotlight, the giving-back tracker, and SMS notifications.

## Out of scope

Sign in with Apple. It needs a paid Apple Developer account, which the cost target does not allow. iPhone users sign in with email and password, Google, or Facebook.

## Open decisions

The developer decides each of these.

1. Whether admins are blocked until they accept a new constitution version (FR-6.11).
2. Whether to build the optional WhatsApp channel (FR-4.17) at all.
3. The values for N pending requests (FR-5.10) and the registration reminder period (FR-2.11).
4. Whether storing birthdays in Google Calendar counts as a transfer of data abroad that the privacy notice needs to cover.
5. Google's Calendar API pricing page mentions possible charges for exceeding quotas later in 2026. Usage is far below any limit, but check the page before launch.
6. How the constitution text affects this list. Once the text is in hand, read it against these requirements before building section 6, since it may define alumna eligibility, executive roles, or election rules that change FR-2.9, section 1, or the voting feature later.
7. ~~Which email provider sends messages from Cloud Functions (FR-8.5).~~ Decided: Brevo, whose free plan allows 300 emails a day. The provider can be swapped by configuration (NKB-106). Changed: email is sent through the shared Gmail account, with an app password, since Brevo needs a domain the project does not have (NKB-116).
8. ~~Which payment card goes on the Firebase Blaze plan and the Cloudflare account.~~ Decided: no card on Google. Firebase stays on the free Spark plan and server code runs on Cloudflare Workers (NKB-114 to NKB-120). No card on Cloudflare either: photos and backups use Workers KV instead of R2, which needs a payment method on file (NKB-115, NKB-119).
9. ~~Which domain Brevo sends email from (FR-8.5).~~ Decided: none is needed. Email goes through the shared Gmail account (NKB-116).
