# CrediTrack

Store credit management for sari-sari stores and their customers.
Built with **ASP.NET Core (.NET 10) Razor Pages** for the pages, an **ASP.NET Core Web API** (controllers) with
PostgreSQL for the data, and CSS and vanilla JavaScript for the look and behavior.

## Run
```
cd CrediTrack.Api
dotnet build
dotnet run
```
Open **http://localhost:5224** (the splash screen). The pages and the API are ONE app on one address:
the Store Owner and Customer screens are ASP.NET Core MVC (`Controllers/OwnerController.cs` + `Views/Owner/*.cshtml`, `Controllers/CustomerController.cs` + `Views/Customer/*.cshtml`, `ViewModels/`) and the public pages (welcome, login, register, email links, privacy, terms) are Razor Pages (`CrediTrack.Api/Pages/*.cshtml`), all with the same layout and login (the addresses are shown without `.html`, for example
`/owner/dashboard` and `/customer/home`), and the API is under `/api/...`.
Static files (css, js, images) are in `CrediTrack.Api/wwwroot`.

## First-time setup (database and email)
The app needs two things that are **secrets**, so they are not in `appsettings.json`. Without the database setting the app stops at start with a message that says what is missing. Without the email settings it still runs, but nobody can receive the verification email or reset a password (a warning in the log names the missing settings).

**1. PostgreSQL.** Create an empty database (for example `creditrack`). The tables are created by the app on the first start.

**2. Local (Development): user secrets.** Run these once inside `CrediTrack.Api` (the values are kept outside the project, so they are never committed):
```
dotnet user-secrets set "ConnectionStrings:Default" "Host=localhost;Port=5432;Database=creditrack;Username=postgres;Password=YOUR_DB_PASSWORD"
dotnet user-secrets set "Email:Smtp:Host" "smtp.gmail.com"
dotnet user-secrets set "Email:Smtp:Port" "587"
dotnet user-secrets set "Email:Smtp:Username" "your-address@gmail.com"
dotnet user-secrets set "Email:Smtp:Password" "YOUR_16_CHARACTER_APP_PASSWORD"
dotnet user-secrets set "Email:From" "CrediTrack <your-address@gmail.com>"
dotnet user-secrets list
```
`appsettings.Example.json` shows every key (it is a template; the app does not read it).

**3. Email with Gmail.** A normal Gmail password does not work. Turn on 2-Step Verification for the account, then make an **App password** (Google Account > Security > App passwords) and use those 16 characters as `Email:Smtp:Password`. Port `587` (STARTTLS) and `465` (SSL) are both supported. Other providers (Brevo, Mailgun, Zoho, Outlook) work the same way with their own host, port, username and password.

**4. On a host (Production).** User secrets are only read in Development. Use environment variables instead (double underscore for nesting):
```
ConnectionStrings__Default=Host=...;Port=5432;Database=...;Username=...;Password=...;SSL Mode=Require
Email__Smtp__Host=smtp.gmail.com
Email__Smtp__Port=587
Email__Smtp__Username=your-address@gmail.com
Email__Smtp__Password=...
Email__From=CrediTrack <your-address@gmail.com>
```
If the host only gives one `DATABASE_URL` (`postgres://user:password@host:5432/db`), leave `ConnectionStrings__Default` out and the app converts `DATABASE_URL` itself.

**5. Check it works.** Start the app and read the log: there must be no "database is not configured" error and no "Email is NOT set up" warning. Then register a new account: the verification email should arrive within a minute (check Spam). If it does not, the log line "Failed to create or send the verification email" shows the real reason (wrong app password, blocked port, wrong host).

## Going live checklist (production settings)
Do these once when you put the app on a real domain. On a host they are environment variables (double underscore for nesting). The app logs a warning at start for each one that is still wrong, so after deploying, read the first lines of the log.

| # | Setting (env var) | Set it to | Why |
|---|---|---|---|
| 1 | `ASPNETCORE_ENVIRONMENT` | `Production` | Turns on the always-`Secure` login cookie, HTTPS redirect, HSTS and the production checks. |
| 2 | `Frontend__EmailVerificationUrl` | `https://your-domain.com/verify-email` | The link inside the verification email. It still says `localhost` by default, so real users would get a dead link. |
| 3 | `Frontend__ResetPasswordUrl` | `https://your-domain.com/reset-password` | The link inside the password-reset email. Must be `https`: the token travels in it. |
| 4 | `AllowedHosts` | `your-domain.com` (several: `a.com;www.a.com`) | Stops requests that carry a made-up Host header. `*` accepts anything. |
| 5 | `Proxy__ForwardLimit` | `1` (use `2` if Cloudflare sits in front of the host) | How many proxies are in front of the app. |
| 6 | `Proxy__KnownNetworks__0` or `Proxy__KnownProxies__0` | the host's proxy address range (ask the host) | So only the host's proxy is believed about the visitor's address and `https`. |

Notes:
- **Log in once after deploying.** If every page keeps redirecting, the app thinks the request is plain http: check #5 and #6 (a wrong proxy range causes this), then #1.
- **#6 can wait** if the app is only reachable through the host's proxy (normal on Render, Railway, Azure App Service and similar). It is the last hardening step, not a blocker. If you do not know the range, leave it empty; the app logs a warning and keeps working.
- **`/health`** (used by the host's uptime check) is not redirected to https. If the host calls it with its own host name, add that name to `AllowedHosts` too.
- **Email logo:** with `Frontend__EmailVerificationUrl` on `https`, the email logo is loaded from your own site. You can also set `Email__LogoUrl` to another `https` picture.
- **Rate limits** are kept in the memory of one instance. Run one instance, or move them to Redis or the database before scaling out.
- **Settings from step 1 of First-time setup** (`ConnectionStrings__Default`, `Email__Smtp__*`, `Email__From`) are still needed.

## Hosting in the cloud
One app to deploy. Set these environment variables on the host (double underscore = nested setting):
```
ConnectionStrings__Default=<your PostgreSQL connection string>
Frontend__EmailVerificationUrl=https://<your-domain>/verify-email
Frontend__ResetPasswordUrl=https://<your-domain>/reset-password
```
The app trusts `X-Forwarded-Proto`, so behind the host's HTTPS the login cookie and links are correct.
HTTPS is also what lets the browser open the camera for Scan Store QR.

### Production security settings
Outside Development the app behaves differently on purpose:
- **Login cookie is always `Secure`.** It is never issued or sent over plain http, so running the Production setting on `http://localhost` will not stay signed in. Use `ASPNETCORE_ENVIRONMENT=Development` locally.
- **CORS allows no other origin** unless you list it (`Cors__Origins__0=https://other-site.example`). The site and API are one app, so normally you list nothing. In Development the Live Server addresses (`localhost:5500`) are still allowed.
- **Trusted proxy.** `X-Forwarded-For` / `X-Forwarded-Proto` should only be believed when they come from your host's proxy. Set the proxy's address range once you know it (ask the host, or check the logs for the proxy's address):
  ```
  Proxy__KnownNetworks__0=10.0.0.0/8      # CIDR range of the host's proxy / load balancer
  Proxy__KnownProxies__0=203.0.113.5      # or a single proxy address
  Proxy__ForwardLimit=1                   # proxies in front of the app (2 if Cloudflare is in front of the host)
  ```
  With nothing set, the headers are accepted from anyone (still only the last hop is believed) and a startup warning is logged. A wrong range makes the app think every request is plain http and loops the https redirect, so set it, deploy, and test the login once.
- **Allowed hosts.** Set `AllowedHosts=your-domain.com` (a `;`-separated list is fine). Leaving `*` logs a warning. If the host's health check calls `/health` with a different host name, add that name too.
- **Email links** (`Frontend__EmailVerificationUrl`, `Frontend__ResetPasswordUrl`) must not point to localhost; a warning is logged if they do.

### Rate limits
- Per IP: `register`, `login`, `forgot-password`, `reset-password`, `verify`, `resend-verification`, `PUT /api/account/profile` and `change-password` allow 15 requests per minute (the `auth` policy).
- Per email (`Services/AttemptLimiter.cs`): `forgot-password` and `resend-verification` send at most 3 mails per address per 15 minutes. Over the limit the reply is the normal 200 message and nothing is sent, so the limit does not reveal which emails are registered.
- Per account: 5 wrong "current password" answers per 15 minutes (shared by the email change and Change Password) answer 429; the right password clears the count.
- The counters live in the memory of one app instance and reset on restart. If you run several instances, move them to Redis or the database.

## Changing the email address (Edit Profile)
Changing the email needs the **current password** (`PUT /api/account/profile` with `currentPassword`; wrong or missing = 400 with `field: "currentPassword"`). The email is **not** switched at once: the new address gets a confirmation link (30 minutes, one use) and the account keeps the old email until it is opened. The pending address lives in `EmailVerificationTokens.PendingEmail` (migration `AddPendingEmail`); `POST /api/auth/verify` applies it. Changing only the name, phone or photo needs no password.

## Money safety: one writer at a time per store
`AddCredit`, `AddPayment`, `Approve` (payment request), `Edit` and `Void` each open a database transaction and take `pg_advisory_xact_lock(storeId)` first (`Services/StoreLock.cs`). Only then do they read the balance, take the next transaction number, insert and commit. So two requests for the same store run one after the other: two payments can no longer both pass the "balance is enough" check (no overpaying), and two saves can no longer pick the same `Number`. Different stores never wait for each other, and the lock is released by the commit or rollback (every early `return` rolls back), so it cannot get stuck.
If the unique index still refuses a row because the same `RequestId` was saved a moment before (a double click), the transaction is rolled back and the FIRST record is returned (`duplicate: true`) instead of a 500. Test: `StoreLockTests` (needs `CREDITRACK_TEST_DB`, see `OverdueAccountsEndpointTests`).
A customer's own payment request (`POST /api/customer/payment-requests`, `CustomerPortalController.Submit`) takes the same lock before it reads the balance and the requests still pending, so a double click or two open tabs can no longer leave pending requests that together are more than the customer owes (the second one is answered 409 with the pending total). Test: `StoreLockTests.Two_payment_requests_at_once_cannot_cover_more_than_the_balance`.

## Uploaded pictures (profile photos and proof of payment)
Pictures are **saved in the database** (table `StoredFiles`, migration `StorePicturesInDatabase`), so they are not lost when a cloud host restarts or redeploys the app. `Users.PhotoPath` and `PaymentRequests.ProofPath` keep the short path (the key of the row in `StoredFiles`).
- Pages still send a small data URL when uploading; `Services/FileStorage.cs` checks the type and the real file bytes, saves the picture under a random name, and deletes the old one when a photo is changed or removed.
- Pages receive an address like `/api/files/profiles/<id>.jpg`. `Controllers/FilesController.cs` serves it only to a signed-in person who may see it (own photo; the owner and the customers of the same store; proof of payment: only the customer who sent it and the store owner).
- The customer's Stores screen shows the store owner's picture (`ownerPhoto` from `GET /api/customer/stores`) while the customer is connected to that store.
- Old pictures: on the next start, pictures an earlier version saved as files in `App_Data/uploads` are copied into the database once. A picture whose file is gone is cleared (initials show instead) and can be uploaded again. The `Uploads:Path` setting is only used for that import, so no persistent disk is needed for pictures any more.

## Pages (Razor Pages)
The public pages live in `CrediTrack.Api/Pages`, the Owner and Customer screens in `CrediTrack.Api/Views`; all use the shared layout `Pages/Shared/_Layout.cshtml`
(title, `<body>` attributes, a `Head` section for styles and a `Scripts` section for scripts). The routes below replace the
old `.html` files; the old names are kept in the descriptions as page names.

## Structure (page names: the route is /<name>, /owner/<name> or /customer/<name>)
```
creditrack/
  index                  Splash screen (every launch), then routes by sign-in status
  pages/
    welcome              Welcome screen (signed-out visitors only)
    login                Log in (email, password, forgot password)
    account-type         Choose Store Owner or Customer, or log in
    register-owner       Store owner sign-up, 3 steps (personal, store, account security)
    register-customer    Customer sign-up, 2 steps (personal, account security)
  pages/owner/
    dashboard            Store Owner dashboard (more owner pages go in this folder)
    customers            Customers: searchable list with balances, filters, Add Customer, empty states
    customer-details     Customer Details (?id=): info, balance, credit/payment history, Customer Account (link / linked account), Edit (subpage)
    customer-form        Add Customer, or Edit Customer with ?id= (subpage)
    transactions         Transaction History: credits and payments by day, search by customer, type and date filters, totals
    transaction-details  Transaction Details (?id=): items or payment info, status, customer, who recorded it (subpage) **Void Transaction** (danger-outline button, hidden once voided): a confirmation dialog explains the transaction is voided, not permanently deleted, shows the customer's balance before and after, and asks for a required reason (Duplicate transaction, Incorrect entry, or Other, which needs remarks of 5-200 characters). Confirm and Cancel; success shows a message and the page switches to a Voided notice (when, by whom, reason, remarks, balance effect) with a Voided badge and a struck-through amount. The original record is kept; its effect on the balance is reversed (a voided credit is taken off the balance, a voided payment is added back); it no longer counts in Dashboard, Customers, Overdue Accounts or Reports; it stays visible in Transaction History, the customer's history and the Dashboard's recent list marked Voided. It cannot be voided twice, and a credit that the customer has already paid beyond their other credits is blocked with an explanation (void or edit those payments first). A **Change History** panel (below Transaction Information) lists every edit and the void, oldest first, or says "No changes yet" (see "Transaction Change History" below)
    transaction-edit     Edit Transaction (?id=, opened from the Edit Transaction button on Transaction Details; subpage): the fields start with the saved values. Credit: customer, date, and each item's name, quantity (2, 0.5 or 1/2), unit and unit price. Payment: customer, date, amount (never more than the customer owed before it), method, reference number, notes. Shows the balance after the change as you type, validates, asks for confirmation (what changed and the new balance), then saves through `updateTransaction` in owner-api.js and returns to Transaction Details with a success message. The transaction ID and type never change. Voided transactions cannot be edited (the page returns to Transaction Details). Every saved edit that changes a value adds an entry to Transaction Details > Change History automatically (see "Transaction Change History" below). **Payment due date (credit only):** a credit with no due date shows "No due date" / "Set due date" (the Record Utang buttons and date picker, today or later, within 5 years); the chosen date is sent as `dueDate` through the same `PUT /api/owner/transactions/{id}` and saved in `Transactions.DueDate`, then Transaction Details shows it. A credit that already has a due date shows the date picker with the current date selected: choosing a different date (same rules) and saving changes it through the same endpoint, and Transaction Details shows the new date. **Remove due date:** a credit that has a due date also shows "Remove due date" / "Keep due date"; choosing Remove hides the date picker, the confirmation shows the old date changing to "No due date", and saving sends `removeDueDate: true` through the same `PUT /api/owner/transactions/{id}`, which saves `Transactions.DueDate` as NULL (no schema change); Transaction Details then shows "No due date". Adding, changing or removing a due date is recorded in Change History like any other edit (a "Due date" change showing the previous and new value, e.g. "No due date" -> "Nov 20, 2026"), with the date, time and user
    overdue              Overdue Accounts (opened from the Dashboard card): totals and the list of overdue customers (subpage) **Part 5B:** for real accounts the list, summary cards, chip counts, search, days filter, sort and pagination all come from `GET /api/owner/overdue-accounts` (via `queryOverdueAccounts` in owner-api.js; the page calculates nothing). It shows a loading line, a dimmed list while a new search/filter/page loads, the empty and no-match states, and an error panel with Try again (session-expired and cannot-reach messages). Search waits 300 ms after the last key. The Dashboard's Overdue Accounts card links to this page
    notifications        Notifications (opened from the bell): list grouped by day, All / Unread, mark as read, empty states (subpage)
    settings             Profile & Settings (full-screen page like Notifications: Back button and title only, no header, sidebar or bottom navigation; Back returns to where the person came from, fallback Dashboard): centered photo, name, store, role, account status, Edit Profile, Personal Information, a Store Management menu and an Account Settings menu, and Log Out on phones. Every menu item opens its own subpage
    profile-edit         Edit Profile (subpage): photo, full name, email, contact number; validation, Save Changes, Cancel
    store-information    Store Information (subpage): store details with its own Edit form (store name, store contact number, business type, store hours, address); the store code is read-only
    store-qr             Store QR Code & Store Code (subpage): QR code (js/vendor/qrcode.js, MIT), Copy Code, Download QR
    security             Security (subpage): Change Password (interface only) and account protection tips
    settings-notifications  Notifications (subpage): notification switches, saved as they change
    help-support         Help & Support (subpage): FAQs and sample contact details
    about                About CrediTrack (subpage): app version and system information
  pages/customer/
    home                 Customer Home dashboard: "No Store Joined" state and "After Joining a Store" state (order: Outstanding Balance, My Stores dropdown, My Stores, Recent Activity; floating PAY button at the lower-right) (more customer pages go in this folder)
    join-store           Join a Store (7 steps on one page): choose method, enter store code / scan store QR, store verification, link existing customer record, confirm details, success. The joined store appears in My Stores on Home with its own balance
    history              Customer Transaction History: search, store filter (2+ stores), All / Credits / Payments tabs, transaction list. Each row opens Transaction Details. The view (tab, store, search) is kept in the address (?tab=&store=&q=)
    request-payment      Make a Payment (?store= preselects a store; else the store selected on Home): store, amount (Full balance), method (Cash, GCash, Maya, Bank Transfer, Other), reference number (required for GCash/Maya/Bank Transfer, optional for Other, hidden for Cash), optional proof picture (JPG/PNG up to 5 MB) and message, Review, Submit Payment Request, success. The request is saved as Pending and the balance is NOT changed: only the Store Owner's approval (later step) records the payment
    payments             Customer Payments (My Payments, main screen): payment summary (Pending count and amount, Recorded in the last 30 days), tabs All / Pending / Completed / Rejected with counts, payment request list (store, method, date, amount, status badge), empty states. The Make a Payment button is not on this page (the PAY button on Home starts a payment). A store filter (2+ stores) narrows the list and the tab counts. The tab and store are kept in the address (?tab=&store=). Each row opens Payment Request Details
    stores               Customer Connected Stores (Profile > Connected Stores, or Home "View details"): every joined store with name, type, code, its own outstanding balance and payment status, View Store Details (owner, location, joined, totals, transactions, last activity), Leave Store with a confirmation dialog, a Disconnected list with Reconnect, and Join Another Store. Leaving only switches a connection flag: credits, payments and transactions are never deleted, and each store's balance stays separate. The PDF has no leave screen, so the confirmation is an addition
    profile              Customer Profile (main screen, Profile tab): avatar or initials, name, email, contact number (when there is one), Customer / Account Active, Edit Profile (opens `profile-edit`); Customer Code with Copy Code and View My QR (QR drawn offline with js/vendor/qrcode.js, holds CREDITRACK:CUSTOMER:<code>); menu: Personal Information, Connected Stores (shows how many), Security, Notifications, Help & Support; Log Out. Edit Profile is built; the pages behind the menu are later steps: until then each menu item shows a short message. They will use data-nav="sub" data-back="profile" (customer-shell.js) so Back returns to Profile
    security             Customer Security (subpage opened from Profile > Security; Back returns to Profile): Change Password with Current, New and Confirm New password, show/hide on each, live rules list, Save Changes / Cancel, field messages, a "Password updated" confirmation and a "last changed" line, plus Account Protection tips (see "Customer Security" below)
    about                Customer About CrediTrack (subpage opened from Profile > About CrediTrack; Back and a Back to Profile button return to Profile): logo, system name, tagline "Every Credit, On Track.", short description, what the Customer Portal does, app version and basic system information (see "Customer About CrediTrack" below)
    help-support         Customer Help & Support (subpage opened from Profile > Help & Support; Back and a Back to Profile button return to Profile): jump links, step-by-step guides (joining a store, linking an existing customer record, viewing balances, transaction history, sending and tracking payment requests), nine FAQs, and Contact Support (see "Customer Help & Support" below)
    settings-notifications  Customer Notification Settings (subpage opened from Profile > Notifications; Back returns to Profile): four on/off switches (payment request updates, credit and payment activity, store updates, account and security alerts), Save Changes / Cancel, a "Preferences saved" confirmation, and the saved choices are kept (see "Customer Notification Settings" below). Not the same as notifications, the list opened from the bell
    customer-code        Customer Code & QR (subpage opened from "Customer Code & QR details" on Profile; Back returns to Profile): the customer's unique Customer Code (`CT-CUS-######`) with Copy Code, their personal QR code with View Larger / View Smaller (in place) and Download QR (PNG with name and code), and short instructions for identification and linking an existing store record (see "Customer Code & QR" below)
    profile-edit         Customer Edit Profile (subpage opened from the Edit Profile button on Profile): photo, full name, email, contact number; validation, Save Changes, Cancel. Saves into the same profile record Profile reads, then returns to Profile with a "Profile updated." message (see "Customer Edit Profile" below)
    notifications        Customer Notifications (a subpage opened from the bell, like the Store Owner's: Back button and title only, no header, menu or bottom navigation; the bell shows a pressed background when tapped): All / Unread tabs with counts, list grouped by day, Read / Unread label on every item, Mark as read (each item) and Mark all as read, empty states. Payment request updates (pending, approved, rejected), store activity (credits and payments the store recorded) and account alerts (store joined, balance reminder, overdue, welcome). Opening one marks it read and goes to its Payment Request Details, Transaction Details or History (that store)
    payment-request-details  Payment Request Details (?id=&back=): store, amount, method, reference number, proof of payment (View Larger), the customer's note, submission date and time and status. Pending explains the request awaits the store owner's review; Completed shows the approval date and confirmation details; Rejected shows the store owner's reason. "Back to Payments" returns to the same status tab and store filter ("Back to Notifications" when opened from a notification). Read-only: the request workflow is unchanged
    transaction-details  Customer Transaction Details (?id=&back=): Transaction ID, type, date and time, store, amount, status; credit = items, quantities, unit prices, total; payment = method, reference number, payment details. "Back to History" returns to the same History view **Due date (Part 6A, credits only, display only):** Transaction Information shows the store's agreed payment date (for example "November 20, 2026"), or a muted "No due date" when the credit has none (`Transactions.DueDate` is NULL). A payment has no due date, so it shows no row. The value comes from the existing `dueDate` in the `/api/customer/history` and `/api/customer/transactions/{id}` rows (`Ledger.BuildRow`), which only return records linked to the signed-in customer (`Customer.LinkedUserId`); customers cannot edit or remove it
  assets/images/              Official transparent logo (creditrack-logo-transparent.png) used on every screen, and the wordmark (creditrack-wordmark.png), unchanged
  css/tokens.css              Official palette: Navy #071A52, Teal #086B70, Turquoise #35A5A0, Lime #F0F59A, fonts, spacing (edit here first)
  css/base.css                Reset, element defaults, layout utilities
  css/components.css          Buttons, inputs, cards, badges, toast
  css/polish.css              Usability layer, loaded last on every page: pill / circle navigation hover (no boxes), labelled round floating buttons, shape-following focus ring, 44px touch targets, status shapes on badges, skip link, reduced motion / transparency
  css/components/customer-shell.css  Customer Portal shell: only what differs from the owner shell (4 bottom tabs, no "+")
  css/pages/customer-home.css  Customer Home: join card, balance hero, store dropdown, My Stores, recent activity, floating PAY button + store chooser
  css/pages/customer-join.css  Join a Store: step cards, method choices, code fields, camera frame, detail rows, success
  css/pages/customer-request-payment.css  Make a Payment: store/amount/method fields, proof upload, review and success (reuses the step card styles of customer-join.css)
  css/pages/customer-payments.css  Customer Payments: summary cards, status tabs, request rows and status badges (also uses the page heading of css/pages/owner-customers.css)
  css/pages/customer-history.css  Customer History: store filter, segmented tabs, transaction rows (also uses the heading, search and result-line styles of css/pages/owner-customers.css)
  css/pages/customer-profile.css  Customer Profile: Customer Code card, View My QR dialog, Log Out on every screen size (reuses owner-customers.css and owner-settings.css)
  css/pages/customer-notifications.css  Customer Notifications: spacing only
  css/pages/customer-about.css  Customer About CrediTrack: name, tagline, description, "What You Can Do" list, bottom buttons (logo panel and info list come from owner-settings.css)
  css/pages/customer-help.css  Customer Help & Support: jump links, numbered steps, FAQ accordion, Back to Profile (panels and contact list come from owner-settings.css)
  css/pages/customer-settings-notifications.css  Customer Notification Settings: saved message, status line, account-alerts warning (rows and switches come from owner-settings.css)
  css/pages/owner-notifications.css  also used by Customer Notifications (rows, chips, date groups); the Back button comes from customer-transaction-details.css
  css/pages/customer-payment-request-details.css  Payment Request Details: status panel, proof picture and View Larger dialog (reuses the page layout, info lists and status badges of the files above)
  css/pages/customer-transaction-details.css  Customer Transaction Details: only the Back to History buttons and a note (the rest reuses owner-customers.css and owner-transactions.css)
  css/components/split-layout.css  Shared layout for Account Type, Login and Registration: fixed left branding column (logo, description, store illustration) + right content. On phone/tablet the Back link (every screen that has one) is pinned to the top-left corner above the logo (position: absolute)
  css/components/owner-shell.css  Store Owner header, sidebar, bottom nav, quick-action sheet, and the Back bar used on subpages
  css/components/owner-ui.css     Shared owner UI: panels, list rows, empty states, notices, Sample tag
  css/pages/owner-customers.css   Customers list, Customer Details and the Add/Edit Customer page (its heading, search and filter-chip styles are also used by Transaction History)
  css/components/record-utang.css  Record Utang floating modal (all four steps, discard confirmation, phone layout)
  css/components/link-account.css  Link Customer Account modal: only what differs from Record Utang (Enter Code / Scan QR tabs, code field, camera frame, sample codes, account to confirm)
  css/pages/owner-transaction-history.css  Transaction Details > Change History: the timeline (markers, previous/updated value pairs, voided entry, audit note); reuses panel, badge, .empty and .info__list
  css/pages/owner-transaction-void.css  Void Transaction: the button, reason choices, remarks and the Voided notice (the dialog look comes from owner-transaction-edit.css; struck-through voided rows and the Voided tag are in owner-ui.css)
  css/pages/owner-transaction-edit.css  Edit Transaction: item cards, balance-effect box and the confirmation dialog (also uses owner-customers.css form styles)
  css/pages/owner-transactions.css  Transaction History list (totals, filters, day groups, rows) and Transaction Details
  css/pages/owner-overdue.css  Overdue Accounts: totals, customer cards (phone) and table rows (wide screens)
  css/pages/owner-notifications.css  Notifications list (items, unread state, type icons, toolbar, responsive)
  css/pages/owner-settings.css  Profile & Settings: two sections (side by side from 56rem), edit form groups, notification switches, password field and rules
  css/pages/owner-dashboard.css   Dashboard layout (balance, quick numbers, pending payments, recent transactions)
  css/pages/splash.css        Splash screen: large logo, short reveal, progress line, reduced-motion support
  css/pages/welcome.css       Welcome screen: heading (wordmark image), subtitle, illustration, 3 benefit lines, 2 buttons, tagline, dot grids (inline SVG). Phone/tablet: one centered column; desktop (64rem+): two columns (text left, illustration right)
  css/pages/auth.css          Right-hand panel styles for Login, Account Type and Registration
  css/pages/register.css      Registration stepper, steps, password rules
  js/api/owner-api.js         Store Owner data layer (calls the API through CrediTrackHttp)
  js/pages/customer-join.js   Join a Store steps and checks (findStore, lookupRecord, joinStore in customer-api.js)
  js/api/customer-api.js      Customer data layer: records vs sample data, status rules, totals, profile (getProfile, updateProfile, validateProfile) (fetch() later)
  js/components/customer-shell.js  Builds the customer header, sidebar and 4-tab bottom nav (one NAV list); reuses the owner shell's CSS classes
  js/pages/customer-home.js   Fills the Customer Home dashboard (both states, store selector, activity, My Stores)
  js/pages/customer-request-payment.js  Make a Payment: form, validation, review, submit via submitPaymentRequest() in customer-api.js (safe to repeat: one request per requestId)
  js/pages/customer-payments.js  Customer Payments: getPayments() from customer-api.js; status tabs, list, summary, empty states, Show more after 20 rows
  js/pages/customer-history.js  Customer History: getHistory() from customer-api.js; search, store filter and tabs work together; rows link to details; Show more after 20 rows; empty states
  js/pages/customer-profile-edit.js  Customer Edit Profile: form, photo picker, validation, Save Changes / Cancel via getProfile() / validateProfile() / updateProfile() in customer-api.js
  js/pages/customer-transaction-details.js  Customer Transaction Details: getTransaction() from customer-api.js (sample credits carry items, sample payments carry reference numbers); Back to History
  js/components/owner-shell.js  Builds header, sidebar, bottom nav and "+" actions for owner main pages (one NAV list), or just the Back bar on subpages
  js/pages/owner-dashboard.js Fills the dashboard
  js/pages/owner-customers.js  Customers list: search, filters, empty states
  js/pages/owner-customer-details.js  Customer Details, history and the Customer Account section
  js/pages/owner-customer-form.js  Add / Edit Customer page (Full Name, Contact Number)
  js/components/record-utang.js  Record Utang modal: the whole workflow (customer, items, review, confirm)
  js/components/link-account.js  Link Customer Account modal: enter or scan the customer's linking code, confirm the account, link it
  js/pages/owner-transactions.js  Transaction History: search, type and date filters, totals, Show more, empty states
  js/pages/owner-transaction-edit.js  Edit Transaction: pre-filled form for a credit or a payment, validation, live balance preview, confirmation, save via updateTransaction()
  js/pages/owner-transaction-details.js  Transaction Details, Void Transaction and the Change History timeline (renders getTransaction().history)
  js/pages/owner-overdue.js  Overdue Accounts: draws the totals and the customer list from getOverdueAccounts()
  js/pages/owner-notifications.js  Notifications: grouping, All/Unread filter, mark one / mark all as read, opening a notification, empty states
  js/pages/owner-settings.js  Profile & Settings: fills the profile, Edit Profile form and validation, notification switches, Change Password form, About
  js/pages/owner-reports.js  Reports page (cards, chart, table, Export button wiring)
  js/components/report-export.js  Reports export: builds the PDF and CSV files from the selected period
  js/components/pdf-lite.js  Tiny offline PDF writer used by the export (A4, Helvetica, vector shapes)
  js/main.js                  Shared route map, toast, placeholder messages, Back navigation (goBack), one-time flash messages
  js/session.js               Mock session (localStorage, memory fallback): get, start, end, dashboardUrl
  js/pages/splash.js          Splash timing and the sign-in check that picks the destination
  js/pages/welcome.js         Guest-only guard: signed-in people are redirected before the page shows
  js/address-select.js        Cascading PSGC address dropdowns (store owner registration)
  js/pages/login.js           Show/hide password, field checks
  js/pages/account-type.js    Account type selection
  js/pages/register-owner.js  Store owner step flow and validation
  js/pages/register-customer.js  Customer 2-step flow, validation, password rules
```

## Navigation
Routes (`splash`, `welcome`, ...) live in `AVAILABLE_PAGES` in `js/main.js`. Links use `data-route="name"`.
A route that is not built yet shows a short message. Placeholders for now:
`forgot-password`, `dashboard`, the Customer Portal pages Home links to (`customer-join-store` and `customer-history` are built, as is `customer-transaction`;
`customer-payment`, `customer-payments`, `customer-profile`, `customer-notifications`, `customer-store`), and the Store Owner pages
(`owner-payment-requests`). `owner-notifications`, `owner-overdue` and `owner-settings` are built (see Notifications, Overdue Accounts and Profile & Settings below). `store-dashboard` and `record-credit` (the Record Utang modal) are built.
A route can carry a query string, for example `data-route="record-credit?customer=4"` (`goTo` in `main.js` appends it).

## Store Owner pages: main pages and subpages
Each owner page loads `owner-api.js`, then `components/owner-shell.js`, then `main.js`, and sets
`data-root="../../"` and `data-page="<nav id>"` on `<body>`. There are two kinds of page:

**Main pages** (Dashboard, Customers, Transactions, Payment Requests, Reports, Settings) keep the complete
navigation: top header (logo, notification bell, profile), desktop sidebar, phone bottom bar and the "+" quick actions.
They have no breadcrumb. To add a nav item, edit the `NAV` list in `owner-shell.js`.

**Detail pages and subpages** (Customer Details, Add Customer, Edit Customer, and anything opened from a main page)
add `data-nav="sub"` and `data-title="Page title"` to `<body>`. The shell then builds **no** header, sidebar,
bottom bar or "+"; the page shows only a slim bar with a Back button; the page title is a heading just below the bar, in the page content. Set `data-back="<url>"` to the page's logical parent.

**Back button.** `CrediTrack.goBack(fallback)` (in `js/main.js`) returns to the exact page the person came from using
browser history, so that page keeps its place. It only uses the fallback parent when there is no earlier owner page
(a bookmarked link, a new tab). It never redirects to the Dashboard unless the Dashboard really was the previous page.
- Customer Details > Back: Customers (with the same search and filter). Fallback: `customers`.
- Edit Customer > Back, Cancel or Save: Customer Details. Fallback: `customer-details?id=`.
- Add Customer > Back, Cancel or Save: Customers. Fallback: `customers`.

**Keeping context.** The Customers list saves its search and filter in `sessionStorage` (`creditrack.customers.view`) and
restores them only when the person comes Back to it. Opening Customers from the sidebar or bottom bar starts clean, and the
dashboard's "Customers with Debt" opens the With Debt filter. After Add Customer, the list is reset to All so the new customer is visible.
`CrediTrack.flash("message")` shows a toast on the next page ("Customer added.", "Customer updated.").

To add a subpage: copy `customer-form` as a starting point, set the three `<body>` attributes above, and add its path to
`AVAILABLE_PAGES` in `main.js` when it is reached through a `data-route` link.
When a placeholder page is built, add its path to `AVAILABLE_PAGES`.

## Launch and sign-in flow
1. `index` is the splash screen and runs on every launch (about 1.6s, same on phone and desktop; it always plays in full).
   A fresh visit to `pages/welcome` (bookmark, restored tab) **or a reload of it** (for example after switching to a phone-sized window) is sent through the splash first; moving around inside the app is not (`CrediTrackSession.splashDue`).
   The splash leaves a one-time hand-off note just before opening Welcome; Welcome reads and removes it, so it skips the splash exactly once and never loops.
2. Signed out: it goes to `pages/welcome`. Signed in: it goes to that role's dashboard
   (`CrediTrackSession.dashboardUrl`). A signed-in person never sees the Welcome screen.
3. If a role has no dashboard yet, the splash stays and shows a message and a Log Out button. (Both roles have one now:
   a customer who finishes sign-up, or is already signed in, opens `pages/customer/home`.)
4. The mock session starts when a registration finishes and ends from the Log Out link (`data-logout`).
   Log In is still the earlier placeholder because there is no account store yet; when the backend exists,
   make `CrediTrackSession.start()` use the real response. To add a dashboard, set its path in `DASHBOARDS` in `js/session.js`.

Welcome > Log In > `login`; Welcome > Get Started > `account-type` > Store Owner > `register-owner`, or Customer > `register-customer`.
Password show/hide is shared: add `data-toggle-password="inputId"` to a button.

## No demo accounts
There is no demo login and no "Preview sample data" any more. Every screen shows the signed-in account's real data from the database; a new account simply starts empty. Sign in with a registered (and email-verified) account.
Old browsers: `js/session.js` removes any leftover `creditrack.demo*` / `creditrack.customer.demo*` storage keys from earlier builds when a page loads.
Other parts of this README that still say "demo" or "sample" describe the old prototype. In `owner-api.js` and `customer-api.js` the demo branches (`isDemo()`, `isDemoLogin()`) can never run, because `session.js` removes the demo keys on every page load and nothing sets them. A real account always goes through the API. Those branches are kept only so the code stays easy to compare with earlier versions, and they can be deleted in a separate cleanup.

## Customer Portal: Home dashboard (mock data only)
`pages/customer/home` (route `customer-dashboard`) is the first Customer Portal page. The sources are the prototype PDF (p.35 "No Store Joined", p.43 joined home, p.47-50 for the navigation) and the Store Owner design system. The Store Owner pages were not changed.
- **Shell:** `js/components/customer-shell.js` builds the header (wordmark + bell on phones; name + bell on desktop), the desktop sidebar (Home, History, Payments, Profile, Log Out) and the phone bottom bar (Home, History, Payments, Profile; no "+"). Its styles are the owner shell's (`.owner-header`, `.owner-sidebar`, `.owner-tab`... keep their `owner-` prefix because they are shared), plus `customer-shell.css`. To add a nav item, edit `NAV` in `customer-shell.js`. `owner-shell.js` is untouched.
- **State 1, No Store Joined:** "Hi, <first name>!", a **Join a Store** card and button, **Why join a store?** (three short benefits) and, below, a "Just exploring?" tip with **Preview sample data**.
- **State 2, After Joining a Store** (order on phones; two columns from 56rem, with Recent Activity on the right):
  1. **Outstanding Balance** hero: the balance, "Across n connected stores" or "Your balance at <store>", Total Credits / Total Payments, and a lime "pending verification" chip while a payment request is waiting.
  2. **Store selector** (`All stores (n)` plus each store; a single store has no "All" choice). The choice is remembered for the tab (`sessionStorage` `creditrack.customer.home.store`) and drives everything below except My Stores.
  3. **Account Status** (Active) and **Payment Status** (Fully Paid / Partially Paid / Unpaid / Overdue, with a progress bar).
  4. **View History** and **Make a Payment** (carry `?store=<id>` when one store is selected; Make a Payment is disabled, with a message, at PHP 0.00).
  5. **Recent Activity** (latest five credits, recorded payments and payment requests, with Recorded / Pending / Rejected badges; "No activity yet" when empty).
  6. **My Stores** (its own full-width section below the dashboard information, with an "n connected" count): one compact card per store with its own balance and status, **View details**, and a **Join Another Store** card. The selected store's card is highlighted.
- **Data** (`js/api/customer-api.js`): `getHome()` returns `{ isSample, stores, activity }`; `summarize(home, storeId)` returns the totals for all stores or one (the page never adds money up itself). A store's balance is always `totalCredit - totalPaid` and its status comes from `statusFor()`, the only place that decides it. A real customer has no stores (the join flow does not exist yet), so they see State 1. **Preview sample data** (fictional Aling Nena's Store PHP 300.00 and Mang Tony's Store PHP 450.00, PHP 750.00 in total, as in the PDF) switches `creditrack.customer.demo`; it is labelled **Sample**, never saved as records, and **Exit demo** returns to State 1. When the join flow is built it only needs to save `{ stores, activity }` to `creditrack.customer.records`.
- **Not built yet:** Join a Store, Store Details, History, Make a Payment / Payments, Profile (where Log Out will live on phones; the desktop sidebar has it now), Customer notifications. Their buttons show a short message. There is also no customer login yet (only sign-up starts a customer session), and the page does not redirect signed-out visitors, like the owner pages.

## Customer Edit Profile (mock data only)
`pages/customer/profile-edit` (route `customer-profile-edit`) is a **subpage** (`data-nav="sub"`, `data-back="profile"`): the **Edit Profile** button on the Customer Profile opens it, with only a Back button and the title (no header, menu or bottom navigation), like Notifications. It reuses the Store Owner's Edit Profile look (`css/pages/owner-customers.css` and `owner-settings.css`: photo picker, fields, form actions); there is no new CSS. The `ef-` ids match the owner's page because the photo picker styles use `#ef-photo`.
- **Edits:** profile photo, Full Name, Email Address, Contact Number. **Change Photo** takes JPG, PNG or WebP up to 5 MB, crops it to a centered square and shrinks it to 256 px (JPEG), so it fits browser storage; **Remove Photo** goes back to initials (the initials follow the name while there is no photo). Phone numbers show as `09XX XXX XXXX`.
- **Rules** (`validateProfile(data, onlyFields)` in `js/api/customer-api.js`, the only place that decides; same rules as the Store Owner's): name 2-60 characters, letters/spaces/`. ' -` only (spaces are tidied); email in a valid format, 100 at most; contact number is a Philippine mobile number (`09XX XXX XXXX` or `+639...`, stored as `09XXXXXXXXX`). All three fields are required, as they are at sign-up. To make the contact number optional later, change only its two lines in `validateProfile` (the form already shows the required mark from the HTML).
- **Feedback:** each field is checked when it loses focus and again as the person types after an error; **Save Changes** checks everything, shows every error, focuses the first invalid field and a "Please fix the highlighted fields." message. A photo that is the wrong type or too large shows its own message. While saving, the button reads "Saving..." and is disabled (no double save). Success returns to Profile with a "Profile updated." message (one-time `creditrack.flash`); saving without changes says "No changes to save."; if the browser storage is full or blocked, the form stays open with an error and nothing is changed. Save and Cancel keep the focus on the field while pressed, so an error appearing under a field cannot move the buttons away before the tap finishes.
- **Cancel / Back** leave without saving. Back returns to the page the customer came from (it keeps its place), otherwise Profile.
- **Data:** `getProfile()` -> `{ fullName, email, contactNumber, customerCode, photo, isDemo }` and `updateProfile({ fullName, email, contactNumber, photo })` in `js/api/customer-api.js`. A real customer is saved in the same record sign-up made (`creditrack.customer.profile`, localStorage), so the **customer code and everything else in it are kept**; `photo` is a small data URL (absent = none). The mock session name is kept in step (`CrediTrackSession.start`), so the Home greeting and the header follow. The saved write is read back to confirm it; a failure rejects with `error.code = "storage"`, a field problem with `error.errors = { field: message }`.
- **Where the new details show:** Customer Profile (photo, name, email, contact number), the desktop header avatar and name on every customer page, the Home greeting (first name), and the account details on Join a Store > Confirm (all read `getProfile()`).
- **Demo account:** the demo customer's changes are temporary (`creditrack.customer.demo.profile`), never written to a real profile record, and thrown away on log out (`session.js`) and at the next demo login.
- **Not built yet:** changing the password (Security), and the Personal Information page (a separate menu item) that will list these details. Customer log in only exists for the demo account for now, so a changed email is stored but is not used to sign in yet.

## Dashboard data (no backend yet)
Records (customers, transactions, payment requests) come from the API. A newly registered owner has none, so the
dashboard shows PHP 0.00, "No customers yet" and "No transactions yet".

## Store address (PSGC)
`js/address-select.js` loads Region > Province > City/Municipality > Barangay from the PSGC API
(`PSGC_API` at the top of the file) and caches it per session. Changing a parent clears its children.
Regions without provinces (NCR) show Province as "Not applicable"; province-less cities in a region
that has provinces appear under "Cities without a province". Needs an internet connection.

## Customers (mock data only)
`pages/owner/customers`, `pages/owner/customer-details?id=<id>` and `pages/owner/customer-form` (add) or
`customer-form?id=<id>` (edit). Real (non-demo) customers are saved in `localStorage` under
`creditrack.records`; there is no backend yet. All reads and writes go through `js/api/owner-api.js`
(`getCustomers`, `getCustomer`, `addCustomer`, `updateCustomer`), so only that file changes when the API exists.
Record Bayad is still a placeholder (Record Utang is built step by step, see below).

## Customer Account linking (mock data only)
Customer Details has a **Customer Account** section (right under the Record Utang / Record Bayad buttons and above Transaction History on a phone; in the left column under those buttons, above Customer Information, on wide screens). It connects the customer *record* in this store to the CrediTrack *account* the customer made in the customer app.
Everything is in one place: the data rules in `js/api/owner-api.js` ("Customer account linking"), the modal in `js/components/link-account.js` + `css/components/link-account.css`, and the section in `owner-customer-details.js`. There is no second linking system.
- **Not linked:** the section shows "This customer has not linked their CrediTrack account yet." and a **Link Customer Account** button.
- **Linked:** the message and button are replaced by the account's name, account ID, masked email and mobile number, the date it was linked and a **Connection Status** badge (`Connected`, or `Disconnected` if the customer's account was closed).
  Contact details are masked in `resolveLinkedAccount()` (the only place that does it), so the page never holds the full email or number.
- **The process** (floating modal, same look and behavior as Record Utang / Record Bayad: X, Escape or backdrop to close, focus stays inside):
  1. **Enter code** - two tabs. *Enter Code*: the customer's temporary linking code, 8 letters and numbers shown as `XXXX-XXXX` (capitalised and spaced as typed; letters that are easy to confuse, like O and 0, are never used). *Scan QR*: the camera reads the customer's linking QR code, text `CREDITRACK:LINK:<code>` (same style as the store QR, `CREDITRACK:JOIN:<store code>`). Scanning needs camera access and a browser with QR reading (`BarcodeDetector`, for example Chrome on Android); anywhere else the tab says so and points to Enter Code. A QR that is not a linking code (for example a store QR) is refused.
  2. **Confirm account** - the code is checked first (`verifyLinkCode`; nothing is saved), then the owner sees the account it belongs to (name, account ID, masked email and mobile, member since) next to "Will be linked to <customer>". If the account name and the customer record name are clearly different, a warning says so. Back returns to step 1; closing here asks "Cancel linking?".
  3. **Link Account** saves (`linkCustomerAccount`), then a success screen; **Done** closes and Customer Details redraws with the linked account ("Customer account linked." toast).
- **Rules** (`checkLinkCode`, the only place that decides): the code must be 8 valid characters, exist, not be **expired**, not be **already used**, and its account must not already be linked to another customer in the store; a customer can have only one linked account. Each failure has its own message (`error.code`: `empty`, `format`, `not_found`, `expired`, `used`, `account_linked`, `customer_linked`). Linking verifies again before saving, uses the code once, and pressing Link Account twice cannot link twice. A **"Customer Account Linked"** notification (type `customer_linked`, already in the Notifications list) is added.
- **Data shape:** `records.customerAccounts = [{ id, code (CA-1001), fullName, email, phone, memberSince, status }]`, `records.linkCodes = [{ code, accountId, createdAt, expiresAt, usedAt, customerId }]`, and `customer.linkedAccount = { accountId, linkedAt, status: "connected" }` (absent = not linked). `getCustomer(id)` also returns `linkedAccount` (the resolved, masked view). When the ASP.NET Core API exists, replace the bodies of `verifyLinkCode`, `linkCustomerAccount`, `getLinkingInfo` and `resolveLinkedAccount`; the page and modal do not change.
- **Sample data vs real accounts:** there is no customer app yet, so nobody can make a real linking code. A real account therefore has no customer accounts or codes: its modal says so and every code is "not found" (like Payment Requests, which are empty for real accounts). In demo mode, **sample linking codes** are listed in the modal (tap to fill in, or to act as a scanned QR on the Scan QR tab): `H7K2-M9QX` (Pedro Reyes, not linked yet: the main try-out), `W3CN-5TJD` (Lito M. Mendoza, for the Lito Mendoza record), `P6VB-2YFE` (Tess Aquino, expired), `R4TM-8XKQ` (Ana Cruz, already linked, so it is refused). Customers with evidence of an account in the sample data (Ana Cruz, who has the existing "Customer Account Linked" notification, and Juan Dela Cruz, Maria Santos, Carla Bautista and Rosa Dizon, who have sent payment requests) start out linked; everyone else shows the not-linked state. Changes live in the temporary demo working copy like every other demo edit.
- **Not built yet:** unlinking or re-linking a different account, a customer-side code/QR generator, and showing linked status in the Customers list.

## Overdue Accounts (Steps 1-2: customer list, search, filters and sorting; mock data only)
`pages/owner/overdue` is a **subpage** (`data-nav="sub"`). The Dashboard's **Overdue Accounts** card (`data-route="owner-overdue"`) opens it; Back returns to the page the person came from (fallback: Dashboard).
- **Shows:** the number of overdue accounts, the total overdue balance, and one entry per overdue customer: Customer Name, Outstanding Balance, Overdue Amount, Due Date, Days Overdue and **View Details**
  (opens `customer-details?id=`; Back from there returns here). Phone: one card per customer. Wide screens (56rem+): a table-like row per customer under column headings.
  Sorted by days overdue, most first. Empty state: "No overdue accounts" (with Back to Dashboard, and "Preview sample data" for a brand-new real account).
- **Step 2, search / filter / sort** (all in `js/pages/owner-overdue.js`, on the list `getOverdueAccounts()` returns; the calculations are unchanged): search by customer name; filter All, 1-7, 8-30 or more than 30 days overdue; sort by Highest / Lowest Overdue Amount, Oldest / Most Recent Due Date (default Oldest). They work together. The two summary cards and the "Showing X of Y" line always match the list shown; chip counts follow the search. On phones the search stays visible and the chips and sort box sit in a collapsible **Filter & Sort** panel (the button shows how many settings are changed and a line under it names them); from 40rem up the panel is always shown. No match shows its own empty state with a reset button. The view is restored when coming Back from Customer Details (sessionStorage `creditrack.overdue.view`).
- **What counts as overdue** (`getOverdueAccounts()` in `js/api/owner-api.js`, the only place that decides it): the customer still owes money AND has a **credit with an agreed due date before today** that is **still unpaid**.
  A credit with no fixed date is never overdue, so a customer with only those is not listed. Due today is not overdue yet. Payments are applied to the oldest credits first (same rule as Transaction History), so a paid-off credit never counts.
- **Per customer:** Outstanding Balance = the whole balance; Overdue Amount = what is still unpaid on the past-due credits (never more than the balance); Due Date = the oldest past-due date ("2 credits past due" is shown when there is more than one);
  Days Overdue = days since that date. **Total Overdue Balance** = the sum of the Overdue Amounts.
- **Due dates are new data:** a credit may carry `dueDate: "YYYY-MM-DD"`. Record Utang can now set one: on the Add items step, **Payment due date (optional)** has two buttons, **No due date** (the default) and **Set due date**, which shows a date picker (today or later, within 5 years). The date is shown on Review and Done and saved through `addCredit` / `POST /api/owner/transactions/credits` as `dueDate` (left out for No due date; the API answers `field: dueDate` with a message when it is invalid). Editing the due date later (Transaction Details / Edit) and the overdue rule on the backend are the next parts.
  Sample data gives due dates that match each sample customer's existing `overdueDays` (Jun Reyes 12, Rosa Dizon 8, Ben Torres 5), plus some future dates and a paid-off past date to show they are not listed.
- **Not changed (still uses the older `overdueDays` field):** the Dashboard's overdue count, the "Overdue" badges on Customers and Customer Details, and the Reports "Overdue Balance" (which counts the customer's whole balance, so it differs from Total Overdue Balance here).
  They agree with this page for the sample data. When Record Utang can save due dates, switch them to `getOverdueAccounts()`.

## Notifications (Step 1, mock data only)
`pages/owner/notifications` is a **subpage** (`data-nav="sub"`): the bell in the header opens it, and Back returns to the page the person came from
(fallback: Dashboard). It lists the store's notifications newest first, grouped by day (Today, Yesterday, Earlier).
- **Each notification shows** an icon for its type, a title, a short description, its date and time ("5 minutes ago", "Today, 9:42 AM", "Yesterday, 4:30 PM",
  then "Oct 28, 2026, 8:00 AM") and an explicit **Unread / Read** status. Unread items are also highlighted (tinted card, accent edge, bold title).
- **Types:** `payment_request` (new customer payment request), `payment_approved`, `payment_rejected`, `overdue` (account overdue),
  `customer_joined`, `customer_linked`, `credit_recorded`, `payment_recorded`. An unknown type still shows (generic bell icon).
- **Mark as read:** opening a notification marks it read; each unread item also has its own "Mark as read" button; **Mark all as read** (disabled when nothing is unread) clears them all.
  The red dot on the bell shows while anything is unread (it used to mean "pending payments"). Focus stays in the list after an item is marked.
- **Filter:** All / Unread chips with counts. **Empty states:** "No notifications yet" (a new real account, with "Preview sample data") and "You're all caught up" (Unread tab with nothing unread).
- **Where a tap goes:** customers and transactions open their detail pages. Payment-request items open Review Payment (see Payment Requests below), and they only show its message for now.
- **Data:** `js/api/owner-api.js` > `getNotifications()` -> `{ isSample, notifications, total, unread }`, `getUnreadNotificationCount()`,
  `markNotificationRead(id)`, `markAllNotificationsRead()`. A notification is `{ id, type, title, message, createdAt, read, target }` with
  `target = { kind: "customer" | "transaction", id }` or `{ kind: "route", route }`. Demo mode builds sample notifications from the sample records (so names and amounts match the Dashboard, Customers and
  Transactions) and keeps read/unread in the temporary working copy; a real account has none. **Not built yet:** creating notifications from live activity
  (Record Utang, Record Bayad, new customers, due dates), and applying the Settings notification preferences to this list (the switches are saved, see Profile & Settings).

## Profile & Settings (mock data only)
`pages/owner/settings` is a **main page** (Settings highlighted in the sidebar), opened from the sidebar's **Settings** link and from the profile icon / store name in the header (`owner-settings`). One column on every screen size.
It shows the centered photo (or initials), name, store name, a **Store Owner** badge and an **Account Active** badge, the **Edit Profile** button, **Personal Information**, then two menu lists and **Log Out** (phones and tablets; the desktop sidebar has its own).
Each menu item is a plain link to its own subpage (Back button + title, no accordions or floating panels). Subpages return to the Profile page with Back or Cancel.

| Menu item | Page | What it does |
|---|---|---|
| Edit Profile (button) | `profile-edit` | Photo (JPG/PNG/WebP up to 5 MB, shrunk to 256 px), full name, email, contact number. Save Changes / Cancel. After saving, the Profile page shows the new details and a "Profile updated." toast (a one-time `sessionStorage` message, key `creditrack.flash`). |
| Store Information | `store-information` | Store name, store contact number, business type, store hours, address, store code (read-only). Its own **Edit** button swaps the view for a form on the same page. Save Changes / Cancel. |
| Store QR Code & Store Code | `store-qr` | The store code (`CT-XXXXXX`, kept even if the store name changes) and a QR code of `CREDITRACK:JOIN:<store code>`, so both always match (drawn offline with `js/vendor/qrcode.js`, MIT). **Copy Code** (button turns to "Copied!" + toast), **View Larger / View Smaller** (in place, no pop-up), **Download QR** (PNG with store name and code). Short instructions for customers. Joining by scan is not connected yet (no customer app). |
| Security | `security` | Change Password (interface and validation only: nothing is changed) and account protection tips. |
| Notifications | `settings-notifications` | Four switches (payments, overdue, customers, activity), saved as they change. Only stored for now: the Notifications page does not filter by them yet. |
| Help & Support | `help-support` | FAQs and **sample** contact details (placeholders). |
| About CrediTrack | `about` | App name, version, tagline (`APP_INFO` in `owner-api.js`) and basic system information. |

**Rules** (`validateOwnerProfile(data, onlyFields)` in `js/api/owner-api.js`, the only place that decides): name 2-60 characters, letters/spaces/`. ' -` only; email in a valid format, 100 at most, not `demo@creditrack.test` for a real account;
contact and store numbers are Philippine mobile numbers (`09XX XXX XXXX` or `+639...`, stored as `09XXXXXXXXX`); store name 2-60; address 5-160; business type from `BUSINESS_TYPES` (optional); store hours up to 60 characters (optional).
**Data:** `getOwnerProfile()`, `updateOwnerProfile(values)` (personal fields + photo), `updateStoreInformation(values)` (store fields); both reject with `error.errors = { field: message }`. A real owner is saved in `localStorage` (`creditrack.owner`) and the mock session name follows.
The store code (`CT-XXXXXX`) is made once, the first time it is needed, and then kept. The photo is stored as a small data URL in the same record.
**Demo account:** a fictional profile marked **Sample** (store code `CT-DEMO01`); edits are temporary (`sessionStorage` key `creditrack.demo.settings`) and never appear in a real account.
Notification preferences: `getNotificationPreferences()`, `saveNotificationPreferences(prefs)` (`creditrack.owner.settings`). `changePassword()` does nothing yet (the password is never stored or checked).

## Reports (Steps 1 to 4, mock data only)
`pages/owner/reports` is a main page (full navigation) with the reporting period and its filters, four summary cards,
a Utang-vs-Bayad chart by month and the Detailed Transactions table. There is no Recent Transactions preview on Reports (the Transactions page covers that). Every figure comes from
`CrediTrackApi.getReportsOverview(period)` in `js/api/owner-api.js`, which reads the same records as the Dashboard, Customers and
Transactions pages (sample data in demo mode, the owner's own records otherwise). Nothing is hard-coded per filter.

**Period filters** (one compact bar; chips stay on one line and scroll sideways on a phone): This Week (Monday to Sunday), This Month (default), Last Month, This Year, Custom Date Range.
Custom Date Range is the only chip that opens the Start Date and End Date fields (with an Apply button); they stay hidden for every other period; it starts as this month so far, and the end date
cannot be earlier than the start date or in the future (an invalid range keeps the report that was showing and shows a message).
After opening a transaction from Reports, Back returns with the same period selected; opening Reports from the menu starts at This Month.

**Calculation rules**
- **Total Utang**: credit transactions dated inside the selected period.
- **Total Bayad**: confirmed payments inside the selected period. Only recorded/confirmed payment transactions count; pending or
  rejected payment requests (`paymentRequests`) are never included.
- **Outstanding Balance**: every customer's current unpaid balance as of today. It does not change with the period (same number as the Dashboard).
- **Overdue Balance**: what is still unpaid on the **overdue credits only**, as of today (not limited to the period). Not-yet-due, due-today, no-due-date, fully paid and voided credits add nothing. Real accounts: `OverdueRule.Totals` on the server (`GET /api/owner/reports` returns `overdue: { total, accounts, credits }`); demo mode: `computeOverdue`. The Reports card, the PDF and the CSV all show this same value.
- **Chart**: one group of bars for each calendar month the period touches (never later than this month, at most the latest 12),
  counting only transactions inside the period. (`getReportsOverview` still returns `recent`, but the page no longer shows it.)

The chart is plain SVG drawn in `js/pages/owner-reports.js` (no chart library needed) and has a hidden data table for screen readers.

**Detailed Transactions table (Step 3).** A full-width panel below the chart (the former 5-row Recent preview was removed). It lists every transaction inside the selected period, so it follows the period chips and
the custom date range exactly like the cards and the chart do.
- **Columns:** Transaction ID (`TRX-0001`, the same code Transaction History and Details show), Date (with the time underneath), Customer Name,
  Transaction Type and Amount. **Utang** (credit) has an amber label and a `+` amount; **Bayad** (confirmed payment) has a teal label and a `-` amount.
- **Which transactions:** only recorded credits and confirmed payments. Pending and rejected payment requests are never included
  (they live in `paymentRequests`, and `isReportable` in `owner-api.js` also skips any transaction whose status is pending, rejected, declined or cancelled).
  Because the cards, chart and table all read the same filtered list, their numbers always agree.
- **Order:** newest first (date and time, then the newest record). **Rows:** 20 at a time with a "Show more" button and a "Showing 20 of 35" line;
  changing the period starts again at 20, and coming Back from a transaction keeps the period and the rows that were open.
- **Opening:** the whole row opens Transaction Details (a Back button returns to Reports).
- **Responsive:** a real table on tablet and desktop; on phones each row becomes a compact two-line card (customer and amount, then ID, date and type).
  The table roles stay in the markup so screen readers still read it as a table.
- **Empty states:** "No transactions in this period" (with the dates, and a hint to try another period) or "No transactions yet" for an account with no records.
- **Data:** `getReportsOverview(period).table` = `[{ id, code, date, customer, type: "credit" | "payment", amount }]`, already sorted.

**Export Report (Step 4).** A compact **Export Report** button sits at the top right of the Reports heading and opens a small menu: **PDF** or **CSV**.
It exports the period currently selected (the chips or the applied custom dates). `js/components/report-export.js` calls
`CrediTrackApi.getReportsOverview(period)` again at the moment of export, so it uses exactly the same rules as the page and calculates nothing itself:
Total Utang and Total Bayad cover the period only; Outstanding and Overdue are current balances as of today; the table is every transaction in the period,
newest first; pending and rejected payment requests are never included. Nothing is uploaded: the file is built in the browser and downloaded.
- **PDF** (A4, `js/components/pdf-lite.js`, a small dependency-free PDF writer that works offline): CrediTrack header with the store name, reporting period and
  generated date, the four summary cards, the Utang vs. Bayad chart (vector bars, PDF only) and the Detailed Transactions table (Transaction ID, Date,
  Customer Name, Transaction Type, Amount). Long tables continue on more pages with the column headings repeated and "Page X of Y" in the footer.
  The standard PDF fonts have no peso sign, so pdf-lite draws it as a "P" with two bars; characters outside Latin-1/WinAnsi print as "?".
- **CSV** (UTF-8 with a byte-order mark so Excel shows the peso sign): store name, period, generated date, the four summary lines, then the table. No chart.
  Amounts are written as `₱1,250.00` text without a sign (the Transaction Type column says Utang or Bayad); text that starts with `= + - @` is prefixed with an apostrophe so spreadsheets never run it as a formula.
- **File names:** `CrediTrack_Report_<Store-Name>_<start>_to_<end>.pdf` / `.csv`, for example `CrediTrack_Report_Aling-Nenas-Store_2026-10-01_to_2026-10-31.pdf`.
- While demo data is on, both files say so (they are sample figures). An empty period still exports, with zero totals and "No transactions in this period."

## Transaction History (mock data only)
`pages/owner/transactions` is a main page (Transactions in the sidebar, History on the phone bottom bar; the dashboard's
"View all" opens it too). `pages/owner/transaction-details?id=<id>` is a detail page: no main navigation, only a Back button.
- **List:** newest first, grouped by day (Today, Yesterday, then the date). Each row shows the customer, Credit or Payment, what it was
  for (items or payment method), time, amount (+ credit, - payment) and a status badge. 20 rows at a time, then "Show more".
- **Search** by customer name. **Filters:** type (All, Credits, Payments) and date (All time, Today, Last 7 days, Last 30 days, This month,
  Custom range). The two totals at the top (Credits Recorded, Payments Received) follow the search and filters.
- **Status:** a payment is "Recorded". A credit is "Unpaid", "Partially paid" or "Paid": each customer's payments are applied to their
  oldest credits first (`decorateTransactions` in `owner-api.js`), so the badges always agree with the customer's balance.
- **Empty states:** no transactions yet (with a Record Credit link and, for a real account, "Preview sample data"), no match for the
  search, no credits or payments in the chosen period, and an invalid custom date range.
- **Keeping context:** like Customers, the list keeps its search and filters in `sessionStorage`
  (`creditrack.transactions.view`) and restores them when the person comes Back from Transaction Details. Opening Transactions
  from the navigation starts clean.
- **Data:** `getTransactions()` and `getTransaction(id)` in `js/api/owner-api.js`. Demo (sample) credits carry item lines (quantity x price
  adds up to the total) and e-wallet payments a fictional reference number. When Record Utang / Record Bayad are built they only need to
  store `{ customerId, type, amount, date, items | note, method, reference }`; a credit without `items` falls back to its `note`.
  Edit, Void and Change History came in later steps (see "Transaction Change History").

## Overdue rule (backend)

`Services/OverdueRule.cs` is the one place that decides whether a transaction is overdue. Every overdue feature must call it instead of comparing due dates itself. A transaction is overdue only when it has a due date, the due date is earlier than today (due today is not overdue yet), and it still has an outstanding balance greater than zero. No due date = never overdue; fully paid = never overdue; payments and voided credits are never overdue. "Today" is the Philippine calendar day (`Paging.PhToday`). The outstanding balance is not recalculated: it is `Ledger.ComputeStates` (payments applied to the oldest credits first), the same calculation behind Unpaid / Partially paid / Paid and the customer balance.

- `OverdueRule.IsOverdue(dueDate, outstanding, today)` and `DaysOverdue(...)`: the rule on plain values.
- `OverdueRule.Check(transaction, state, today)`: one credit -> `OverdueInfo`.
- `OverdueRule.Evaluate(allTransactions, today)`: credits -> `OverdueInfo`, from an in-memory list.
- `OverdueRule.ForStore(db, storeId)` and `OverdueRule.OverdueCredits(db, storeId)`: from the database (the second returns only the overdue credits, most overdue first).
- `OverdueRule.Totals(credits)` and `TotalsForStore(db, storeId)` (Part 4C): the Overdue Balance (sum of the unpaid part of the overdue credits), overdue account count and overdue credit count. The Reports endpoint uses it; it only adds up what `Check` decided.

The Dashboard count, the Customers badge (Part 4B) and the Reports Overdue Balance (Part 4C) call it. Tests: `dotnet test CrediTrack.Tests`.

## Overdue Accounts API (Part 5A, backend only)
`GET /api/owner/overdue-accounts` (`Controllers/OwnerOverdueAccountsController.cs`, filtering/sorting/paging in `Services/OverdueAccounts.cs`). Store owners only; the store comes from the signed-in owner, never from the request, so only that store's customers and transactions are read. The Overdue Accounts page does not call it yet (it still uses its local data).
- **Who is overdue** is decided only by `OverdueRule` (`OverdueRule.Accounts` groups the per-credit results into one entry per customer), so the list always agrees with the Dashboard count and the Reports Overdue Balance. Archived customers are included, like the Dashboard count.
- **Query (all optional):** `search` (customer name contains, not case sensitive), `overdueRange` = `all` | `1-7` | `8-30` | `30+` (days overdue of the customer's oldest overdue credit), `sortBy` = `due-asc` (default, oldest due date first) | `due-desc` | `amount-desc` | `amount-asc` | `days-desc` | `days-asc` | `name-asc` | `name-desc`, `page` (from 1), `pageSize` (1-100, default 20). Unknown values fall back to the defaults; ties are ordered by overdue amount (largest first), name, then id.
- **Response:** `{ isSample, items, totalCount, page, pageSize, totalPages, hasMore, summary: { count, total }, chipCounts: { all, 1-7, 8-30, 30+ }, totalAll }`. `totalCount` and `summary` cover every match, not only the page; `chipCounts` follow the search but ignore the days filter; `totalAll` = every overdue account of the store.
- **Item:** `{ customerId, code, name, phone, archived, balance, overdueAmount, dueDate, daysOverdue, overdueCredits }`. `balance` = the customer's whole outstanding balance, `overdueAmount` = the unpaid part of their overdue credits, `dueDate` = oldest overdue due date (`yyyy-MM-dd`). The names match `queryOverdueAccounts()` in `js/api/owner-api.js`, so the page can switch to it later by changing only that function body.
- **Tests:** `CrediTrack.Tests/OverdueAccountsTests.cs` (no database) and `OverdueAccountsEndpointTests.cs` (real PostgreSQL: set `CREDITRACK_TEST_DB` to an empty database whose name contains "test"; it is dropped and re-created). Run `dotnet test CrediTrack.Tests`.

## Transaction Change History (mock data only)
The **Change History** panel on `pages/owner/transaction-details` (below Transaction Information) is the record of what happened to one
transaction after it was recorded. It has its own stylesheet, `css/pages/owner-transaction-history.css`, and reuses the panel, badge, empty-state and
info-list styles. Edit Transaction and Void Transaction need no extra step: they write their own history entry when they save.
- **What it shows**, oldest first (the order the PDF's Change History timeline uses), with a count ("3 changes"):
  - **Transaction Edited**: when (date and time), who, and each value that changed as **Previous value -> Updated value** (previous struck through).
    Credit: customer, date, each item's name / quantity (with unit) / unit price (named like "Item 1 (Rice) quantity"), and the total amount; when items
    were added or removed the whole item list is shown before and after. Payment: customer, date, payment amount, method, reference number, notes.
  - **Transaction Voided**: when, who, the reason (Duplicate transaction, Incorrect entry or Other), the remarks (when there are any) and the customer's balance before -> after.
  - **Who:** "Edited by / Voided by <owner name> (Store Owner)" (the signed-in owner; the demo owner in demo mode). When no user is available it says "User not recorded".
  - A short note repeats the audit rule: earlier entries are never overwritten or deleted.
- **Empty state:** "No changes yet. This transaction has not been edited or voided." (no list, count or note). Saving an edit where nothing changed adds no entry.
- **Data** (`js/api/owner-api.js`): each transaction record has an append-only `history` list of `{ id (h1, h2...), action: "edited" | "voided", at, by: { name, role } | null, ... }`.
  `updateTransaction` adds an "edited" entry (with `changes: [{ field, label, before, after }]`, worked out from the old and new values just before the record is overwritten) and
  `voidTransaction` adds a "voided" entry (`reason`, `reasonLabel`, `remarks`, `balanceBefore`, `balanceAfter`). Both add the entry in the same save as the change itself, and only after every
  check passed, so a refused edit or void records nothing. `addHistory` only ever adds to the end; no function edits or removes an earlier entry, so editing or voiding again can never rewrite the past.
  `getTransaction(id)` returns the list as `history` (copies, oldest first). The existing `voidInfo` is unchanged (the red Voided notice still uses it).
- **Older records:** a transaction voided before Change History existed has `voidInfo` but no entry. It is shown as a Voided entry (user "not recorded") when read; nothing is written for it. Edits made before
  this step were not recorded, so such a transaction starts with no edit entries. Sample (demo) transactions start with no history; it builds up as the demo owner edits or voids them and goes away with the demo copy.
- **Not included:** an entry for the original recording (the PDF's "Transaction Created" line), and a reason for editing (the PDF's edit form asks for one; this project's Edit Transaction does not).
  When the API exists, `GET /transactions/{id}/history` replaces `getTransaction().history` and the server writes the entries.

## Record Utang (complete workflow, all inside one floating modal)
Record Utang (formerly Record Credit) is a **floating modal**, never a page. It opens centered above the current page with a slightly dimmed
backdrop; the page and its navigation stay visible behind it. Built by `js/components/record-utang.js` + `css/components/record-utang.css`,
loaded on Dashboard, Customers, Transactions and Customer Details. Every "Record Utang" button uses the route `record-credit`;
`goTo` in `js/main.js` opens the modal instead of navigating. Record Payment is labelled **Record Bayad** everywhere (route `record-payment`, still a placeholder).
There is no separate page for any step (the old `record-credit` and `record-credit-items` were removed).

1. **Select Customer.** Search field only at first. Suggestions (name + outstanding balance) appear after typing. **Add New Customer** shows only when
   nobody matches: it creates a basic customer from the typed name only (phone etc. are optional, edited later on Customers), chooses them and goes straight
   to Add Items. A name that already exists (any capitalization) is reused, so no duplicate is created. Customer Details > Record Utang opens with that customer already chosen.
2. **Add Items.** Customer name on top (Change goes back). Item name, quantity and unit price; subtotal = quantity x price shown live; add several items;
   edit (pencil) and remove (bin) each; running total in the footer. Validation: name required (max 60); quantity and price are numbers above 0
   with at most 2 decimals (quantity max 9,999, price max 100,000); errors show under the field. An item typed but not yet added is added when pressing Review Utang.
3. **Review Utang.** Customer, every item with quantity x price and subtotal, total utang, balance now and balance after. **Back** keeps everything; **Confirm Utang** saves.
4. **Confirm.** `CrediTrackApi.addCredit({ customerId, items, requestId })` (in `js/api/owner-api.js`, mock data only) stores ONE credit
   `{ id, customerId, type: "credit", amount, date, note, items, requestId }`, adds its total to the customer's `balance`, and returns the reference
   (`TRX-0001` style, the same code Transaction History and Details show). The Confirm button locks while saving, and the request id makes a repeated call return the
   transaction already saved, so it can never be saved twice. A "Utang recorded" screen shows reference, total and the new balance, with **Done** and **Record Another**.
   Closing the modal after something was saved (or a customer was added) reloads the page behind it, so Dashboard, Customers, Transaction History and Customer Details are up to date.

**Closing.** X button, Escape or a click on the backdrop. If items were entered (or the item form has text) the modal asks "Discard this utang?" first (Keep editing / Discard);
nothing is asked before anything was entered or after saving. Focus stays inside the modal and returns to the button that opened it.
**Phone.** The customer step is a compact centered card; the item, review and done steps grow into a nearly full-screen panel that is still an overlay.
Record Bayad (payment recording) is not built yet; when it is, store payments as `{ customerId, type: "payment", amount, date, method, reference }` and reduce `balance`.


## Payment Requests and Review Payment (mock data only)
- **Payment Requests** (`pages/owner/payment-requests`, main page, route `owner-payment-requests`): the requests customers have sent, with Pending / Approved / Rejected / All filters and counts. Opens on Pending (or All when nothing is pending). Empty states for "no requests yet" (real accounts have none until the customer app exists) and for an empty status.
- **Review Payment** (`pages/owner/payment-request-details?id=`, subpage, route `owner-payment-request?id=`): opened from the Dashboard's **Review Payment** button, the list, and payment notifications. Shows the amount, customer, method, reference number, submitted time, the customer's message, the **proof of payment** (a picture, with View Larger; "No proof uploaded" when none) and what the balance would be.
- **Approve** asks for one confirmation, then `approvePaymentRequest(id)` creates ONE payment transaction through the same `addPayment` rules as Record Bayad (balance goes down, never below 0; a payment bigger than the balance cannot be approved), tags it `requestId: "payreq-<id>"`, marks the request approved and adds a "Payment Request Approved" notification. **Reject** needs a reason (5-200 characters) and calls `rejectPaymentRequest(id, reason)`: status and reason are saved, a "Payment Request Rejected" notification is added, and **no transaction or balance is touched**.
- **No duplicates:** a request that is no longer pending is refused ("already approved/rejected"), the confirm button is disabled while saving, and a payment already tagged with the request is reused instead of created again.
- Either way the request's "New Payment Request" notification is marked read, and the Dashboard's Pending Payments, outstanding balance, Customers, Transactions and Reports all read the same records, so they update on their next load.
- **Data shape** of a request: `{ id, customerId, method, amount, submittedAt, status, reference, proof, note, reviewedAt, rejectionReason, transactionId }` in `records.paymentRequests`. The sample copy has two pending, one approved and one rejected request (a fictional receipt picture is the "uploaded proof"). Customers cannot send requests yet (no customer app), so a real account only ever sees the empty state.

## Floating action button animation
Defined in `css/components/owner-shell.css` (CSS only). It applies to the desktop button and the phone "+" alike. Nothing moves on its own:
the effects happen only when the button is hovered (lifts, real pointers only) or pressed (squeezes). Opening turns the plus into a minus
(the upright bar folds away while the icon spins half a turn), the page dims smoothly and Record Bayad then Record Utang spring up from the button.
With "reduce motion" turned on in the device settings, the menu animation is switched off too.


## Customer Connected Stores (js/pages/customer-stores.js, css/pages/customer-stores.css)
- Route `customer-stores` (`customer-stores?store=<id>` opens that store's details). Home store cards link here.
- API (js/api/customer-api.js): `getConnectedStores()` -> `{isSample, connected[], disconnected[]}`; `disconnectStore(id)`, `reconnectStore(id)` (flag only; resolve `{store, recordsKept}`).
- `getHome()` returns connected stores only (Home totals, My Stores, dropdown, Pay, Profile count). `getRecords()` returns everything; History and Payments use it, so a left store's transactions stay visible, labelled "(Disconnected)".
- Home dashboard order: Outstanding Balance, Account/Payment Status (side by side), My Stores dropdown, My Stores cards, Recent Activity; floating PAY button.
- Not built yet: the full single-store details page (PDF p.47); owner-side data is not synced with customer mock data.


## Customer Code & QR (js/pages/customer-code.js, css/pages/customer-code.css; mock data only)
- Route `customer-code`. Opened from the Customer Code card on Profile ("Customer Code & QR details"). Profile's Copy Code and View My QR still work as before.
- **One source:** `getCustomerIdentity()` in `js/api/customer-api.js` -> `{ fullName, customerCode, qrText, isDemo, available }`. The code shown and the QR come from the same call, and the QR text is `CREDITRACK:CUSTOMER:<customer code>` (`customerQrText()`; Profile's View My QR uses it too). `parseCustomerCode(text)` reads a typed code or that QR text back to the code, and returns "" for anything else.
- **Three different codes, never mixed:** Customer Code `CT-CUS-######` (the customer's account ID, QR `CREDITRACK:CUSTOMER:`), Store Code `STR-001` / `CT-XXXXXX` (identifies a store, QR `CREDITRACK:JOIN:`), and the Store Owner's temporary linking code `XXXX-XXXX` (QR `CREDITRACK:LINK:`). A store's own record number (`CUS-014`) is a fourth thing. Join a Store and the owner's Link Customer Account both reject a Customer Code with their normal "format" message.
- **Store Owner linking is unchanged.** Link Customer Account still needs the temporary linking code. The Customer Code / QR identifies the account so the owner knows which one to link; it never links anything on its own. The page says so in plain words.
- **No code yet** (an older account without one): the code line says "Not available yet" and Copy, View Larger and Download are disabled. Demo customer: `CT-CUS-000123`, with the Demo notice.
- **Not built yet:** the customer-side temporary linking code/QR generator (PDF "Connect Existing Record"), and the owner's Scan QR reading a Customer QR (today it answers "not a CrediTrack linking code").


## Customer Security (js/pages/customer-security.js, css/pages/customer-security.css; mock data only)
- Route `customer-security` (Profile > Security). Same layout, CSS (`owner-settings.css`) and password rules as the Store Owner's Security page, which is unchanged. Log Out is not on this page: the prototype keeps it on Profile (and the desktop sidebar).
- **Rules** (`passwordRulesMet`, `validatePasswordChange`, `changePassword` in `js/api/customer-api.js`, the only place that decides; same as sign-up): current password required; new password at least 8 characters with an uppercase letter, a lowercase letter, a number and a special character, and different from the current one; confirmation must match. Each field is checked when it loses focus and again as the person types after an error; Save Changes checks all, focuses the first error and shows "Please fix the highlighted fields.".
- **Show/hide** is the shared `data-toggle-password` handler (`js/main.js`); fields go back to hidden after a save or Cancel.
- **Success:** the form is cleared, a "Password updated" panel and toast appear, and "Password last changed: <date>" is shown. Only that time is saved (`passwordChangedAt`, in the customer profile record; for the demo account in its temporary profile edits, thrown away at log out). The password itself is never stored, logged or kept in the page.
- **Mock limits:** there is no account store, so the current password cannot be verified and sign-in still accepts any password; the page says so. When the API exists, replace `changePassword()` with POST /customer/password (the server checks the current password); the page does not change.
- Save and Cancel keep focus on the field while pressed, so an error appearing under a field cannot move the buttons before the tap finishes.


## Customer Notification Settings (js/pages/customer-settings-notifications.js, css/pages/customer-settings-notifications.css; mock data only)
- Route `customer-settings-notifications` (Profile > Notifications), a subpage (`data-nav="sub"`, Back returns to Profile). It chooses WHICH notifications the customer gets; the list opened from the bell (`customer-notifications`) is a different page. Rows, switches and form actions reuse the Store Owner's styles (`owner-settings.css`, `owner-customers.css`), which are unchanged.
- **Four categories** (keys in `NOTIFICATION_PREF_KEYS`): `payments` payment request updates (pending, approved, rejected), `activity` credit and payment activity, `stores` store updates, `account` account and security alerts. All are ON until the customer turns one off. Turning **Account and security alerts** off is allowed, but shows a short warning under the row.
- **Draft, then save:** moving a switch only changes a draft. **Save Changes** (enabled only when something changed) saves, shows a "Preferences saved" panel with the date and time and a toast, and stays on the page. **Cancel** throws the draft away and returns to Profile ("Changes discarded." when there was a draft). Leaving with unsaved changes (Back, a link, closing the tab) asks the browser to confirm first. If saving fails the switches stay as set, nothing is saved, and a message says so.
- **Kept:** `getNotificationPreferences()` -> `{ preferences, updatedAt, isDemo }` and `saveNotificationPreferences(prefs)` in `js/api/customer-api.js`, the only place that stores them (`creditrack.customer.settings`). The page reads them every time it opens, so they survive leaving and coming back, reloading, closing the app, and logging out and in. Missing or invalid values count as ON. The demo account's choices are temporary (`creditrack.customer.demo.settings`, removed by `session.end()` at log out), like its other edits.
- **Not built yet:** the saved choices do not filter the Customer Notifications list yet (same as the Store Owner's settings). When they do, map notification types to categories there: `payment_pending`/`payment_approved`/`payment_rejected` -> payments; `payment_recorded`/`credit_recorded`/`balance_reminder`/`overdue` -> activity; `store_joined` -> stores; `welcome` -> account. When the API exists, replace the two functions with GET/PUT /customer/settings/notifications; the page does not change.
- `js/main.js` and `js/session.js` are now loaded as `?v=5` on every page so browsers pick up the new route and the demo clean-up.


## Customer Help & Support (css/pages/customer-help.css; static content, no page script)
- Route `customer-help` (Profile > Help & Support), a subpage (`data-nav="sub"`, Back returns to Profile). Same panels, contact list and note as the Store Owner's Help & Support (`owner-settings.css`, unchanged).
- **Content:** jump links; five guides as numbered steps (Joining a Store, Linking an Existing Customer Record, Viewing Your Balances, Viewing Transaction History, Sending and Tracking Payment Requests), with buttons to Join a Store, History and Payments; nine FAQs that open and close in place (native `<details>`, keyboard and screen reader friendly); Contact Support; **Back to Profile** at the bottom (the top Back button also returns to Profile).
- **Wording follows the app:** step names, buttons, payment methods, status labels and the "amount cannot be more than your balance" rule match Join a Store, Home, History and Payments. If those screens change, update the guides here.
- **Contact details are placeholders** (`support@creditrack.test`, 0917 000 0000, Mon-Sat 8:00 AM - 6:00 PM), the same samples as the Store Owner's page, and the page says so. Replace them when support is set up.
- `js/main.js` is now `?v=6` on every customer page (new `customer-help` route).


## Customer About CrediTrack (js/pages/customer-about.js, css/pages/customer-about.css; mock data only)
- Route `customer-about` (Profile > Account Settings > About CrediTrack, a new menu row), a subpage (`data-nav="sub"`, Back returns to Profile). Reuses the Store Owner's About look (`owner-settings.css`, unchanged).
- **Shows:** the CrediTrack logo, the name, the tagline "Every Credit, On Track.", a short description, a "What You Can Do" list for the Customer Portal, and App Information (app name, version, account type Customer, data stored on this device, mode, browser, screen size) with the Preview build note. Back to Profile and Help & Support buttons are at the bottom.
- **Version:** `getAppInfo()` in `js/api/customer-api.js` -> `{ name, version, tagline }`, currently 1.0.0. It has the same values as `APP_INFO` in `js/api/owner-api.js` (one product): change the version in BOTH until a shared config exists. If the details cannot be read, the page shows the version as "Not available".
- **Prototype PDF:** it was not included in the project files, so the description and the list come from the app's own wording (Welcome screen copy, README notes taken from the PDF, and the screens as built). Compare them with the PDF's About screen if it has more.
- `js/main.js` is now `?v=7` on every customer page (new `customer-about` route).

## Store Owner Profile & Settings navigation
- `pages/owner/settings` opens like Notifications: `data-nav="sub"`, so only a Back button and the title show (no header, sidebar, bottom bar or "+"). Back goes to the page the person came from (fallback `dashboard`). It is opened from the header's profile icon or store name.
- Because there is no sidebar on this page, **Log Out** is now shown at the bottom on every screen size (`.st-logout` is no longer hidden on desktop). The Record Utang / Record Bayad modals are not loaded on this page.

## Customer archiving
- Customer Details has an **Archive Customer** / **Restore Customer** button (with a confirmation).
- Customers has **Active** and **Archived** views; the search and filters work inside the chosen view.
- Archived customers cannot be chosen for new utang (Record Utang search, preselect, Add New Customer, moving a credit in Edit Transaction, and `addCredit` in `owner-api.js` all refuse them). Payments can still be recorded.
- Nothing is deleted: transactions, payments and outstanding balances are untouched, and archived balances still count in dashboard and report totals.
- Data: a customer gets `archived: true` and `archivedAt`; `archiveCustomer(id)` and `restoreCustomer(id)` are in `js/api/owner-api.js`.

## Transaction voiding
- Void Transaction (on Transaction Details) needs a reason (Duplicate, Incorrect entry, or Other with remarks) and a confirmation. It cannot be repeated, and a voided transaction cannot be edited.
- A voided transaction shows its status, the void date and time, and who voided it (`voidInfo.by`, saved with the void). Lists show "Voided <date> by <name>".
- The record is kept for history. Its effect on the customer balance is reversed, and it is left out of the dashboard, Customers, Overdue, Transactions totals and Reports.

## Payment statuses and data consistency
- Four payment statuses everywhere on the owner side: **Pending**, **Confirmed**, **Rejected**, **Voided** (`paymentStatuses` in `owner-api.js`). Payment Requests has a tab for each.
- Only **Confirmed** payments change a balance. Pending and rejected requests never create a transaction. Voiding a confirmed payment puts its amount back on the balance, and the request then shows as Voided.
- A request can be confirmed or rejected once. Confirming again (or confirming a voided one) is refused, and a request can never produce two payments.
- One shared overdue rule (`computeOverdue`) feeds Overdue Accounts, the Dashboard, Customers and Reports, so the counts and the overdue total now match (Reports used to show each overdue customer's whole balance).

## CRUD consistency pass (customers, payment requests)
- **Customers** (`addCustomer` / `updateCustomer` in `js/api/owner-api.js`): the data layer now enforces the same rules as the form, so a future API gets them too. Name is required (2-60 characters, at least one letter) and cannot match another customer (archived customers count; case and extra spaces are ignored). The mobile number is optional but must be valid and cannot belong to another customer. Errors carry `.field` (`name` or `phone`) and the Add/Edit Customer page shows them under the right field. Edits stamp `updatedAt`.
- **Payment Requests, Archive / Restore**: reviewed requests (Confirmed, Rejected, Voided) can be archived from Review Payment (button + inline confirmation, same look as Confirm / Reject) and restored. Pending requests cannot be archived. Payment Requests has an **Archived** chip; the status chips and All leave archived requests out. Archiving changes only the request's visibility: the payment transaction, its history and every balance stay as they are. API: `archivePaymentRequest(id)`, `restorePaymentRequest(id)`.
- **Duplicate payments**: confirming a request is refused when a payment with the same reference number, method and customer is already recorded (not voided). Reject the request or void the earlier payment first.
- **Customer side**: sending a payment request is refused when an identical one (same store, amount, method, reference) is still pending; resending after a double tap with the same `requestId` stays safe.
- Already in place and checked, not changed: Archive/Restore Customer, Add/Edit/Void Transaction, Edit Items, Record Utang / Bayad validation, Confirm/Reject requests, Leave/Reconnect Store, Edit Store Information.

## Filtering and pagination (backend-ready query contract)
Every filtered list asks the API for **one page** instead of receiving the whole table. Shared helpers are in `js/api/list-query.js` (`window.CrediTrackQuery`, loaded before the api script on these pages). Request: `{ search, ...filters, page, pageSize }`. Response: `{ items, totalCount, page, pageSize, totalPages, hasMore, ...counts/totals }`. `totalCount` is the number of rows matching the filters; counts and totals cover all matching rows, never only the page. Pages draw the response, add the next page under the rows ("Show more", 20 at a time, `PAGE_SIZE` in each page) and ignore stale answers.

| Screen | API function | Filters |
|---|---|---|
| Customers | `queryCustomers` | search (name, code, number), `status` active/archived, `balance` all/debt/paid |
| Transactions | `queryTransactions` | search (customer), `type`, `status` (unpaid, partial, paid, confirmed, voided), `dateRange` + `from`/`to` |
| Payment Requests | `queryPaymentRequests` | `status` pending, confirmed, rejected, voided, all, archived |
| Overdue Accounts | `queryOverdueAccounts` | search (customer), `overdueRange` (1-7, 8-30, 30+ days), `sortBy` |
| Customer Payments | `queryPayments` | `status`, `method`, `storeId`, `dateRange` + `from`/`to` |
| Reports | `getReportsOverview` (unchanged) | period (week, month, last month, year, custom range) |

- The old `getCustomers`, `getTransactions`, `getPaymentRequests`, `getOverdueAccounts` and `getPayments` are unchanged (other pages use them); the query functions read through them, so demo mode works as before.
- **Moving to ASP.NET Core + PostgreSQL later:** each query becomes a `[FromQuery]` DTO (`CrediTrackQuery.toQueryString` builds the URL) and each response a paged result. search -> `ILIKE`, filters -> `WHERE`, date range -> `>= from AND < to + 1 day`, paging -> `ORDER BY ... LIMIT/OFFSET`, `totalCount` -> `COUNT(*)` with the same `WHERE`. Only the function bodies in `owner-api.js` / `customer-api.js` change; the pages do not. Each function has a "BACKEND CONTRACT" comment with the exact fields.
- Customer Payments keeps its view in the address (`?tab=&store=&method=&range=&from=&to=`) and Payment Request Details passes it back.
- Not yet paged on the server contract: the Reports Detailed Transactions table (still sliced on the page; the PDF/CSV export uses the same full list).

## Overdue notifications (Part 6B)
A customer with a linked account is notified when one of their credits becomes overdue. The notification is a normal row in the
existing notification system (type `overdue`, target = the credit), so it appears in Customer > Notifications and on the bell, follows
the customer's notification switch (it counts as their "Activity" switch), and opens the credit's Transaction Details.
- **Who is overdue:** only `OverdueRule` decides (a credit with a due date before today that still has something unpaid). `Services/OverdueNotifier.cs` never recalculates it.
- **When:** `Services/OverdueNotificationService.cs` (a background service) scans shortly after the app starts and then every hour. Settings: `Overdue:NotifyEnabled` (default true) and `Overdue:NotifyIntervalMinutes` (default 60, 1 to 1440).
- **Who is told:** only customers with a linked account who are still connected to the store and not archived. Credits with no due date, paid, or voided are never notified.
- **No duplicates:** one notification per overdue event, that is per credit and due date. The scan checks the customer's existing `overdue` notifications for that credit; the due date is part of the text, so a credit whose due date is moved and goes overdue again notifies again. Nothing was added to the database (no migration).
- Several app instances running at the same time could, in rare cases, send the same notification twice; run one instance, or set `Overdue:NotifyEnabled` to false on the others.

## Soft delete (payment requests)
- A payment request is never deleted: **Archive** sets `IsArchived`, `ArchivedAt` and `ArchivedByUserId`; **Restore** clears them.
- `AppDb` has a global query filter, `HasQueryFilter(r => !r.IsArchived)`, so archived requests are left out of every query by default.
- The few places that must still see them opt out with `IgnoreQueryFilters()`: the owner's Archived tab and counts, archive/restore, the owner's request details, the Dashboard's reviewed list, and the customer's own request list and details (nothing a customer sent disappears from their view).
- Customers are archived with `IsArchived` too, but with no global filter: an archived customer's transactions, balance and payments must stay visible in history, Overdue Accounts and Reports.

## Forgot your current password? (Security pages)
- The Change Password form (Owner and Customer Security) has a **Forgot your current password?** button under the Current password field.
- The person is already signed in, so one tap emails a reset link to the account's own email. It uses the same endpoints, token table, 30-minute expiry and single use as the Log In page (`POST /api/auth/forgot-password`, `POST /api/auth/reset-password`).
- **Where the request started is bound to the token on the server.** The Security page sends `returnTo: "settings"`. Only when the caller is signed in as that same account does the server make a *Settings token* (the random value starts with `st.`; the prefix is inside the hashed value, so it cannot be added, removed or faked) and email a link to **this account's Security page** (`/owner/security` or `/customer/security`, built from the origin of `Frontend:ResetPasswordUrl`). Every other request, including the Log In page's, gets the normal token and the `/reset-password` link. `reset-password` decides everything from the token, never from the page it came from or anything extra in the request.
- Opening that link is the identity check. `js/components/security-reset.js` reads `?token=`, removes it from the address bar and shows **New password + Confirm new password only** (no Current password, no forgot link). It checks the five password rules and that both match, then calls the same `POST /api/auth/reset-password`. Signed in as the token's account: the server gives this browser a fresh login cookie (keeping "Remember me") and the person stays on Security with a success message. A Settings token used while signed in as a different account is refused and nothing changes. A used, expired or unknown token shows a clear error and returns to the normal form.
- **Session ended?** (a) The link is opened signed out: `Program.cs` sends it to the normal `/reset-password?token=...`; after the reset the response carries `returnTo` (only for Settings tokens), so "Go to Log In" opens `/login?returnTo=/owner/security` (or customer) and Log In returns the person to Security. (b) The session ends while the form is open: the token is still valid, so the password is changed, then the page sends the person to the same Log In with `returnTo`. They sign in with the NEW password (they may not remember the old one). Log In only follows `returnTo` when it is exactly the logged-in role's own Security page; anything else goes to the dashboard.
- The Log In page's Forgot Password flow is unchanged: normal token, link to Reset Password, and a successful reset signs out every browser so the person logs in again.
- Files: `js/components/security-forgot.js`, `js/components/security-reset.js`, `css/components/security-forgot.css`, and the two Security pages.

## Void audit ("Voided by")

`Transactions.VoidedByUserId` (migration `AddVoidedBy`; the separate `VoidedByName` column was removed in `NormalizeTo3NF`, the name is now read from `Users`) is saved by `POST /api/owner/transactions/{id}/void`. `Ledger.BuildRow` sends them as `voidInfo { at, reasonLabel, remarks, by }`. The owner pages show "Voided by <name> (Store Owner)". The customer API sends the same `voidInfo` **without `by`**, so a customer sees when and why a record was voided ("Voided by the store") but never a staff name. In the customer History a voided credit or payment keeps its row with a Voided badge and a struck-through amount; Transaction Details shows the Voided on / by / reason rows. Voids made before this migration have no stored user; the owner page falls back to the store owner's name. The database is in Third Normal Form: see `NORMALIZATION.md`.

## Link Customer Account: Upload a QR photo
The Scan QR tab of Link Customer Account (Owner > Customer Details) has an **Upload a QR photo** button next to the camera, as Join a Store has for customers. It reads a screenshot or gallery picture of the customer's Customer Code QR (`CREDITRACK:CUSTOMER:`) with BarcodeDetector where the browser has it, otherwise with the bundled jsQR. The button stays visible when the camera is blocked or missing, and the same checks run as for a camera scan or a typed code. A picture with no QR code, or a QR that is not a Customer Code, shows a message and nothing is linked.

## Customer Home: payment reminders

`GET /api/customer/home` also returns `dueReminders` (at most 5) and `dueReminderCount`. They come from `Services/DueReminders.cs`, which asks `OverdueRule` (the one place that decides "overdue") for the customer's credits in the stores they are connected to. A credit is listed when it has a due date, still has a balance, is not voided and is overdue, due today or due within 7 days. Credits with no due date, fully paid credits and voided credits never appear. The Home page shows them in a **Payment reminders** card at the top as soon as the app opens: red "Overdue by N days", "Due today" or "Due in N days", with the store, TRX code, due date and what is left to pay; each row opens the transaction. "Today" is the Philippine day, so a credit due Nov 12 becomes overdue at 12:00 AM of Nov 13 (`DueRemindersTests.Midnight_turns_due_today_into_overdue`).

## Customer Payments: compact filters

The store, payment method and date filters of My Payments sit side by side (two per row on a phone) instead of one under the other, so the payment request list starts higher on the screen. CSS only (`css/pages/customer-payments.css`).

## Contact details, Terms and Conditions and Privacy Policy

- **One place for the contact details:** the `Site` section of `appsettings.json` (or environment variables `Site__SupportEmail`, `Site__SupportPhone`, `Site__SupportHours`, `Site__OperatorName`, `Site__SystemName`, `Site__Address`, `Site__LastUpdated`). They are read by `Services/SiteInfo.cs` and used by the landing page footer, both Help & Support pages, the Terms and the Privacy Policy. Put the real email, number, hours and name there and restart the app; no page needs editing. While the email still ends in `.test`, Help & Support shows the "Sample contact details" note; it disappears once a real address is set.
- **Pages:** `/terms` and `/privacy` (public, no login). They also link to each other and are listed in About (Customer and Owner).
- **Landing page footer** (`Pages/Shared/_SiteFooter.cshtml`, `css/components/site-footer.css`): system name and tagline, Terms and Conditions, Privacy Policy, Contact Us, email, phone, support hours and the copyright line. On a phone only the links and copyright show.
- **"I agree" on Register** (customer and owner, last step): the account cannot be created until the box is ticked. The pages send `acceptedTerms`, and `POST /api/auth/register` refuses a request without it (so it cannot be skipped by calling the API). The agreement is not stored in the database yet; storing the date and the version would need a migration.
- The Terms and Privacy text is a plain-language starting point written for this system (Data Privacy Act of 2012 mentioned). Have it reviewed by your adviser or a lawyer before real use.

## Help assistant (Help & Support, customer and owner)

A chat box at the top of both Help & Support pages (`Pages/Shared/_HelpBot.cshtml`, `js/components/help-bot.js`, `css/components/help-bot.css`). It uses **no AI service, no API key and costs nothing**, and it works offline.
- It answers from the FAQs written on the same page plus a built-in list of guides (due dates, overdue, void, payment requests, linking, reports, forgot password, verification email, camera not opening, and for customers balance, joining a store, reminders, history). It understands English and common Tagalog words (bayad, utang, paano, nakalimutan ...).
- When it is not sure, it says so and shows the support email, phone and hours of the page's Contact Support section (the `Site` settings), plus suggestion buttons.
- Nothing is sent to a server or stored; the chat clears when the page closes.
- To teach it a new answer, add `{ q: "question", k: "extra keywords", a: "answer" }` to `COMMON`, `OWNER` or `CUSTOMER` at the top of `help-bot.js`. In the browser console, `CrediTrackHelpBot.search("your question")` shows which answers match and how well.

## Dark mode and logos (v21)

- `js/theme.js` (loaded in the `<head>` by `Pages/Shared/_Layout.cshtml`) sets `<html data-theme="light|dark">` before the page paints. The choice (`light`, `dark`, `system`) is saved in `localStorage` under `creditrack.theme`.
- `css/theme.css` holds the dark colors (tokens first, then specific fixes) and the Appearance picker styles. It loads after `glass.css` and `polish.css`. Light mode is unchanged.
- `js/components/theme-picker.js` fills any `<div class="theme-picker" data-theme-picker>`. It is used in Owner Settings and Customer Profile.
- Logos: each logo is a `.logo-light` + `.logo-dark` image pair. Files are in `assets/images/` (`creditrack-logo-transparent.png`, `creditrack-logo-dark.png`, `creditrack-wordmark-transparent.png`, `creditrack-wordmark-dark.png`). The email logo stays light.

## Consent for joining and linking
- A customer who enters a store code only sends a **join request**; the store owner approves or declines it (Customers > Join requests). Reconnecting to a store the customer already had stays instant.
- An owner who enters a customer's CT-CUS code only sends a **link request**; the customer accepts or declines it (Stores > Requests). Nothing on the customer record changes until then.
- Requests live in the `ConsentRequests` table (migration `AddConsentRequests`, runs on startup), expire after 14 days, and are rate limited (code lookups, verify, link, join).

## Join and link updates (v23)
- **Add Customer by code or QR** (Customers > Add Customer, real accounts only): an optional *CrediTrack account* block. The owner types the customer's Customer Code (`CT-CUS-123456`) or scans / uploads their Customer Code QR (`CREDITRACK:CUSTOMER:<code>`, the one on the customer's Profile > Customer Code & QR). `POST /api/owner/customers/account/verify` shows who the code belongs to (email and mobile partly hidden) and refuses accounts already in the store or with a request waiting; the name is filled in from the account (a nickname can replace it). Saving sends `customerCode` to `POST /api/owner/customers`, which makes the record **and** a link request in one transaction. The customer still has to accept (Stores > Requests): knowing a code never attaches anyone by itself. If the owner already has a record with the same name the server says to use Link Customer Account on that record instead of making a duplicate. Component: `js/components/customer-code-field.js` (+ `css/components/customer-code-field.css`, which reuses the tabs and camera frame of `link-account.css`).
- **Approve a join and attach it to an existing record** (Customers > Join requests): each request has an *Already in your records?* menu with the store's active, not-yet-linked records (a record with the same name is listed first and labelled, never pre-selected). `POST /api/owner/customers/join-requests/{id}/approve` takes an optional `{ "customerId": 12 }`: the account is attached to that record, so its utang and payments stay in one place; without it a new record is made as before. The server checks the record belongs to the store, is not archived, not linked and has no link request waiting, and cancels a different link request the same account had in this store. Nothing is matched automatically by name or mobile number, because both are typed by the customer and unverified.
- **Auto-approve** (Settings > Store QR Code & Store Code > *Joining your store*): `Stores.AutoApproveJoins` (migration `AddAutoApproveJoins`, off for every store). `PUT /api/owner/store/auto-approve { enabled }`, and `GET /api/owner/store` returns `autoApproveJoins`. When it is on, `POST /api/customer/stores/join` adds the customer as a new record at once (response `joined: "joined"`), leaves an *accepted* join request as an audit trail, and notifies the owner ("New Customer Joined"). After 50 auto-approved joins in 24 hours, further joins wait for the owner's Approve like normal. Requests already waiting stay waiting when it is switched on.
- **More secure codes**: `Services/Codes.cs` now makes the Customer Code (`CT-CUS-######`) and the Store Code (`CT-XXXXXX`) with `RandomNumberGenerator` (cryptographic, no modulo bias) instead of `Random.Shared`, whose next value can be predicted from earlier ones. Formats are unchanged, so existing codes and pages keep working. Tests: `CrediTrack.Tests/CodesTests.cs`.

## Dashboard previews (v23)
- **Store Owner Dashboard > Payment Requests**: a red count badge (requests waiting), a preview of the 3 newest waiting requests (the whole row opens that request's Review Payment page, no Approve / Reject on the Dashboard) and a **Review all requests (n)** button to the Payment Requests page. Nothing waiting: "You are all caught up" and a quiet *See past requests* link. The reviewed and archived lists were removed from the Dashboard; they are on the Payment Requests page (Confirmed / Rejected / Archived filters).
- **Customer Home > Payment reminders**: a count badge (red when something is overdue), only the most urgent credit (the list is in due-date order) with a **Pay now** button that opens Make a Payment for that store, and a **View all N reminders** link to History.

## About CrediTrack (Customer and Owner)
- Both About pages follow the same outline: logo, name, tagline and a short description of what CrediTrack is; **What You Can Do** (written for that account type); **How It Works** (the store records, the customer connects with consent, both see the same numbers); **Good to Know** (record-keeping only, privacy, clear history); **App Information** (name, version, account type, operated by, data, legal links); **Contact Us** (email, phone and hours from the `Site` settings); and buttons to Help & Support.
- "Operated By" and the contact details come from `Services/SiteInfo.cs` (appsettings `Site` section), so the real details are filled in one place. The Owner page (`Views/Owner/About.cshtml`) also uses `css/pages/customer-about.css` for the list styles.
