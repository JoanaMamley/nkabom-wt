# Setting up the accounts

Step-by-step set-up of the shared project accounts (NKB-113): the Google account, Firebase, Cloudflare and Brevo. Everything stays on free plans: the Firebase projects on Spark, with no card on Google, and Cloudflare Workers, R2 and Brevo on their free plans. As you go, add each account's details to the private accounts record in your password manager, never to the repo (see [accounts.md](accounts.md#keep-the-details-out-of-the-repo)). Once the accounts exist, the Worker, deploy and backup steps follow with NKB-115 to NKB-120 (see [Next](#next)).

The click paths below were checked in October 2026. These consoles change their menus often: if a label has moved, look for the same words nearby or use the console's search box.

## Before you start

You need:

- **A second sign-in device:** a security key, or a second phone or laptop for a passkey, so signing in does not depend on one phone.
- **A domain you can add DNS records to,** for sending email through Brevo. Brevo cannot send reliably from a Gmail address: mail from `@gmail.com` sent through another service fails Gmail's authentication checks and is marked as spam or rejected.
- **A computer with Node.js 24** and this repo, with `npm install` run.

Keep a private note open while you work for the values you will need later: project numbers and the Brevo API keys. Delete it once each value is set as a Worker secret or stored in your password manager.

## 1. Google account

### Create it

1. Open a private browser window, so your own Google account does not get in the way, and go to [accounts.google.com/signup](https://accounts.google.com/signup).
2. Enter a name for the project, for example first name `Nkabom`, surname `Project`.
3. Enter a birthday over 18 and a gender, then choose **Create your own Gmail address** and pick a neutral one about the project, not one tied to a person. Do not write the address in the repo.
4. Choose a long password and save it in your password manager.
5. If asked what the account is for, choose **For my personal use**.
6. Add a phone number when asked (yours for now; it changes in the next part) and accept the terms.

### Protect it

All of this is at [myaccount.google.com/security](https://myaccount.google.com/security), under **How you sign in to Google**.

1. **2-Step Verification > Turn on 2-Step Verification.** Follow the prompts to confirm with your phone number.
2. On the 2-Step Verification page, add **Authenticator**: scan the QR code with an authenticator app and enter the code it shows.
3. Add a second method that is not on the same phone: **Passkeys and security keys > Create a passkey** on your second device, or **Use a security key** for a USB or NFC key.
4. **Backup codes > Get backup codes.** Print the 10 codes and keep the sheet somewhere safe outside the account.
5. **Recovery email:** an address that does not depend on this account.
6. **Recovery phone:** a number that someone will still have in a few years.
7. Go back to **Security** and check **Recent security activity** shows nothing you do not recognise.

Add the address, password, 2-step methods, where the backup codes are kept, and the recovery email and phone to the private accounts record.

## 2. Firebase projects

Do this twice: first `nkabom-staging`, then `nkabom-prod`. Sign in to [console.firebase.google.com](https://console.firebase.google.com) as the shared account (in the private window, or as a separate browser profile).

### Create the project

1. **Create a new Firebase project** (or **Get started by setting up a Firebase project** the first time).
2. Enter the project name `nkabom-staging`. Under the name, check the project ID is exactly `nkabom-staging`; if it shows something else, click the pencil and change it. If the ID is taken, see the README, *Setting up a project*, step 1.
3. Accept the terms and continue.
4. Turn off **AI assistance** (Gemini in Firebase), which the project does not use.
5. Turn off **Google Analytics**. The app does not use it, and leaving it off keeps the privacy notice simpler.
6. **Create project**, then **Continue** once it is ready.

### Create the Firestore database

1. Left menu: **Databases & Storage > Firestore** (in some layouts **Build > Firestore Database**), then **Create database**.
2. **Edition:** Standard, the edition the app and its free allowance are planned around.
3. **Database ID:** leave it as `(default)`.
4. **Location:** pick one region and use the same for both projects. It cannot be changed later.
   - `europe-west1` (Belgium) is the closest of Google's regions to Ghana, so pages load faster. Backups go to Workers KV, so the region does not affect them.
   - Any region has the same free allowance.
5. **Start in production mode.** The deploy replaces these rules with `firestore.rules`.
6. **Create.**

### Turn on email sign-in

1. Left menu: **Security > Authentication** (or **Build > Authentication**), then **Get started**.
2. **Sign-in method > Email/Password > Enable** (leave **Email link** off) **> Save**.

The app's sign-up arrives in NKB-201.

### Register the web app

1. Click the gear next to **Project Overview > Project settings**.
2. **General**, at the bottom under **Your apps**, click the web icon (`</>`).
3. **App nickname:** `Nkabom web`. Leave **Also set up Firebase Hosting** unticked; the repo already has the Hosting set-up.
4. **Register app.** Copy the six values in `firebaseConfig` (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) into `src/environments/environment.staging.ts`, or `environment.ts` for `nkabom-prod`. They are not secret. **Continue to console.**

Note the **Project number** shown on the same page.

## 3. Cloudflare

### Create the account

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Sign up with the shared account's Gmail address and a new password of its own, saved in your password manager. Do not use **Sign up with Google**, so Cloudflare still opens if Google sign-in has trouble.
2. Open the verification email in the shared account's Gmail and click the link.
3. Skip any prompt to add a website or domain.

### Protect it

1. Top right: the profile icon **> Profile > Authentication**.
2. **Two-factor authentication > Mobile App Authentication**: scan the QR code with the authenticator app and enter the code.
3. Save the recovery codes Cloudflare shows with the Google backup codes.

### Nothing else for now

Do not add a payment method or turn on R2: Nkabom uses only the Workers free plan, with Workers KV for photos and backups, and neither needs a card. The Worker and its KV namespaces are created from the repo in NKB-115.

Add the Cloudflare password, 2-step method and recovery codes to the private accounts record.

## 4. Brevo

### Create the account

1. Go to [brevo.com](https://www.brevo.com) **> Sign up free**. Use the shared account's Gmail address and a new password, not **Sign up with Google**, for the same reason as Cloudflare.
2. Confirm the email from the shared account's Gmail.
3. Fill in the profile: name, **Company:** Nkabom (or WomenTrust alumnae), the website if there is one, and the address. Brevo uses these to check new senders, and in the footer of marketing emails (which Nkabom does not send).
4. Choose the **Free** plan.
5. Open **Transactional** in the top menu. If it says the transactional platform is not activated, ask Brevo support to activate it, explaining it sends account emails for a members' app. Brevo can take a day or two to check new accounts.

### Protect it

1. Top right: your name **> Security** (or **My profile > Security**).
2. **Two-factor authentication:** turn it on with the authenticator app, and save the backup codes with the others.

### Turn off IP blocking

Brevo can learn which addresses call its API and later block any new one. The Worker sends from addresses that change, so blocking would one day stop all email without warning.

1. Your name **> Security > Authorized IPs.**
2. Click **Deactivate blocking**, so API calls are allowed from any address. The API keys, kept only in the Worker's secrets, are what protects the account.

### Authenticate the domain

1. Your name **> Senders, domains & dedicated IPs > Domains > Add a domain.**
2. Enter the sending domain, for example `nkabom.org`.
3. Choose to authenticate it:
   - **Automatically,** if Brevo recognises the domain's DNS provider: sign in to the provider when asked, and Brevo adds the records.
   - **Manually** otherwise: Brevo lists records (a Brevo code TXT record, DKIM records, and a DMARC TXT record). In the DNS provider, add each with the exact name and value shown. In Cloudflare DNS, set each record to **DNS only** (grey cloud), not **Proxied**. If the domain already has a DMARC record, keep it rather than adding a second.
4. Back in Brevo, **Authenticate this email domain** (or **Check configuration**). Records can take up to a day or two to show; check again later if they are not green yet.
5. **Senders > Add a sender:** name `Nkabom`, email `no-reply@<domain>`. This is the Worker's `EMAIL_FROM` setting.

### Create the API keys

Once per environment, when you set up the Worker's secrets in NKB-115:

1. Your name **> SMTP & API > API keys > Generate a new API key.**
2. **Name:** `nkabom-staging` (or `nkabom-prod`), so one can be revoked without the other.
3. Copy the key now; Brevo shows it only once.
4. Set it straight away as the Worker's `BREVO_API_KEY` secret for that environment.

Add the Brevo password, 2-step method and backup codes to the private accounts record. The API keys go only into the Worker's secrets.

## 5. Tools

1. Sign the Firebase CLI in: `npx firebase login`, choosing the shared account. If it is already signed in as your own account, run `npx firebase login:add` and choose the shared account, then `npx firebase login:use <address>`.
2. Check it: `npx firebase projects:list` shows `nkabom-staging` and `nkabom-prod`.
3. From NKB-115, the Worker is deployed with Cloudflare's `wrangler` CLI: `npx wrangler login`, signing in to the shared Cloudflare account.

## Next

The rest of NKB-113 needs the Worker stories first:

- **NKB-115:** create the service account key (**Project settings > Service accounts > Generate new private key**), set the Worker secrets for each environment (the service account key, `BREVO_API_KEY` and the photo-link signing key), create the Workers KV namespaces for photos and backups, and deploy staging: Hosting, Firestore rules and the Worker.
- **NKB-119:** check the scheduled triggers run on staging.
- **NKB-120:** test a backup restore, then record it in the README.

For the restore test, staging needs some data first: add a few documents in the Firebase console under **Firestore**, or a test user under **Authentication > Users > Add user** once NKB-118 creates user records.
