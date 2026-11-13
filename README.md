# PingME School Safety Suite

A responsive full stack school safety demo built with React, Vite, Express, Leaflet, and an optional Supabase backend. It uses synthetic Horizon Academy profiles. Airport Cab Pooling and Railway Porter Booking are shown as coming soon and have no booking functionality.

## How this relates to the hackathon brief

The participant brief does not assign a fixed problem statement. It asks teams to inspect PingME, choose and research an everyday problem, build one working user flow, and explain why it belongs in the super app. This project takes the brief's School Safety Suite seed idea and implements the two parts named there: parent-visible bus journeys and digital dismissal pickup. The three service cards are the requested super-app framing. The brief also calls for evidence-backed market research and a short pitch; this repository focuses on the software deliverable and does not claim to complete those separate submission items.

## Run locally

Requirements: Node.js 20+ and npm.

```sh
npm install
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173. The dev command requires port 5173 to be free; it will fail instead of silently switching ports. The API runs on http://localhost:4000. Without Supabase keys the app starts in clearly labelled demo mode. Sign in with any email address and a password of at least four characters, then choose Parent, Bus Driver, or School Admin. Demo changes live in the API process memory and reset when the server restarts.

For a production-style local build:

```sh
npm run build
npm start
```

Express serves the built frontend and API on port 4000.

## Demo workflows

- **Parent:** select Maya or Leo, view the moving DEMO bus on the OpenStreetMap route, check in for pickup, and watch the queue status progress.
- **School admin:** review the queue, call a student, mark them at the gate, confirm handover, and see the fleet summary.
- **Bus driver:** start/end the simulated trip. Switch to REAL GPS and explicitly allow browser location to share actual coordinates while the trip is active. The browser must be served from localhost or HTTPS for geolocation.
- **Multiple demo sessions:** open another browser profile/window, choose another role, and observe updates as dashboards refresh every four seconds.

## Supabase setup

1. Create a Supabase project and run `supabase/migrations/001_school_safety.sql` in the SQL editor.
2. Copy the project URL and **publishable/anon** key into `.env` as `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`.
3. Restart the app. New registrations receive a parent profile for the synthetic Horizon Academy. Email confirmation settings in Supabase may require verifying the address before signing in.
4. To attach a newly registered parent to the synthetic students, an administrator can run (replace the parent UUID):

   ```sql
   insert into public.parent_student_relationships(parent_id,student_id) values
     ('PARENT-AUTH-USER-UUID','22222222-2222-4222-8222-222222222221'),
     ('PARENT-AUTH-USER-UUID','22222222-2222-4222-8222-222222222222');
   ```

5. Provision driver/admin roles from the Supabase SQL editor, not from public signup. Set the profile role to `driver` or `admin`; for a driver, create the `drivers` row with the sample bus and route ids shown below. Never put a service-role key in the frontend or `.env` values prefixed with `VITE_`.

The SQL migration defines schools, profiles, students, guardian links, buses, drivers, routes, assignments, trips, bus locations, pickup requests, notifications, and handover records; it includes indexes, demo seed records, a serialized queue-number RPC, a handover audit RPC, RLS policies, and Realtime publication for journey/pickup changes. The server uses the signed-in user's Supabase access token for database calls. Public signup always creates a parent profile; elevated staff access must be provisioned by the school.

### Assign a demo driver

After creating a staff auth user and promoting that profile, provision its sample assignment from SQL Editor:

```sql
insert into public.drivers(id,school_id,license_label)
values ('DRIVER-AUTH-USER-UUID','11111111-1111-4111-8111-111111111111','DEMO');
```

The migration intentionally leaves staff provisioning under administrator control. For a production deployment, add school onboarding, audited role assignment, transactional trip setup, retention limits for GPS history, and notification delivery (push/email/SMS) before handling real students or location data. Do not enter real children's information into the demo.

## Configuration

See [.env.example](.env.example). API port defaults to `4000`. Supabase is optional in local demo mode. OpenStreetMap tiles require an internet connection; map interactions and synthetic location updates still work locally when tile loading is unavailable.

## Architecture

```text
src/                 React pages, role dashboards, Supabase client, styles
server/index.js      Express API, demo data, auth checks, trip/pickup endpoints
supabase/migrations/ PostgreSQL schema, RLS, RPCs, synthetic seed records
```

In DEMO GPS mode the server moves the bus along a predefined synthetic route and the app labels the source on every map. REAL GPS requires an active driver trip and browser permission. Parent and staff views are role-specific; the migration's RLS policies limit student/location access by school, guardian relationship, and trip.



## Smart Society Visitor Management

The fourth service is available at `/society`. It is integrated into the existing React router and Express server; the school safety routes and the airport/railway service cards are retained.

### Local synthetic demo

Start the existing development command with `npm run dev`, open `http://localhost:5173`, and select **Smart Society Visitor Management**. Choose one of the synthetic accounts:

- Residents: `resident@pingme.demo` (B-1204), `diya@pingme.demo` (A-803), or `kabir@pingme.demo` (C-502)
- Security guard: `guard@pingme.demo`
- Society admin: `admin@pingme.demo`

These buttons select demo roles; there are no demo passwords. Demo records are generated by the Express API and reset when the server process restarts. The demo includes synthetic active and completed visits. Residents can issue a pass, copy the QR scan code or share a visitor QR page, and revoke a pass. Guards can scan with a camera or paste the scan code, request resident approval, and check visitors out. Admins can inspect statistics, review scan attempts, flag records for private review, add apartments/gates/categories, and inspect the account roster. Try an approval for apartment A-803, then sign in as `diya@pingme.demo` to approve or reject it.

The pass QR contains only a cryptographically random token. The API stores its SHA-256 digest, checks expiry/revocation/use limits on the server, records every scan attempt and creates a check-in on valid scans. The camera needs a secure browser origin (localhost or HTTPS) and camera permission. Pasting the copied QR scan code is the fallback.

### Supabase-backed society mode

1. Run `supabase/migrations/001_school_safety.sql` and then `supabase/migrations/002_society_visitors.sql` in the Supabase SQL editor.
2. Configure the Vite URL and publishable/anon key in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the server as well.
3. Add `SUPABASE_SERVICE_ROLE_KEY` to the **server environment only**. It is used by Express to verify sessions, provision accounts, and call the atomic visitor-pass RPCs. Never use a `VITE_` prefix for this secret.
4. Set `SOCIETY_DEMO_MODE=false`, restart the server, and create an initial authenticated user. The migration creates a resident profile for new accounts. Promote the first trusted administrator from the SQL editor:

   ```sql
   update public.society_profiles
   set role = 'society_admin'
   where id = 'AUTH-USER-UUID';
   ```

5. Sign in as that administrator and use **Access settings** to provision residents and guards, link apartments, and add gates or visitor categories. New resident self-registration also creates a resident profile; an administrator must link an apartment before that resident can issue passes.

The society migration adds apartment-level RLS, visitor/approval/pass/entry tables, scan and audit logs, notification tables, Realtime publication, and server-only RPCs. The QR check-in RPC locks the pass row and applies the use limit and active-entry constraint in one transaction. The Express routes require an authenticated society profile and enforce resident, guard and administrator roles. Without a server service-role key, the society backend remains in labelled synthetic demo mode unless `SOCIETY_DEMO_MODE=false` is explicitly set; the service-role key must never be sent to the browser.

Local demo data is in process memory and is not a substitute for the Supabase-backed persistence path. Do not use synthetic/demo accounts or records to control real residential access.
