# Quest Master

Build a production-ready, responsive QR-based competition points web app using Lovable + Supabase.

1. Core concept

There are two roles:

Admin/Organizer — mainly uses PC/Desktop

Team/User — mainly uses Mobile

Use one responsive web application with role-based access.

Prioritize performance and functionality over heavy animations or visual effects.

2. Authentication & roles

Use Supabase Auth.

Create two roles:

admin

team

Each team has its own login account.

After login, identify the team from the authenticated Supabase session.

Never trust a team ID supplied by the frontend, URL, QR code, or request body.

Team users must only access their own data.

Admin has access to all competition management features.

Team logout

Do NOT show a logout button anywhere in the Team interface.

Admin must have a Force Logout Team function for testing/resetting a team's active session.

3. QR Code creation

Admin can create QR codes using exactly these fields:

QR Title

Points

Clue

Example:

QR Title: Registration
Points: 10
Clue: Find the registration desk.


When creating a QR:

Generate a unique secure QR token/ID.

QR must NOT be assigned to a specific team.

Generate a QR code from that token.

Store the QR data in Supabase.

QR should have an Active/Inactive status.

Admin can view, deactivate, and delete QR codes.

Database:

qr_codes

Fields:

id

title

points

clue

token

active

created_at

4. QR scanning logic

Team flow:

Team Login
↓
Team Dashboard
↓
Scan QR
↓
Camera scans QR token
↓
Backend validates QR
↓
Backend identifies authenticated team
↓
Check whether this team already scanned this QR
↓
If already scanned → reject
↓
If not scanned → award points on backend
↓
Create scan record
↓
Display ONLY the clue


VERY IMPORTANT

After scanning:

DO NOT DISPLAY THE POINT VALUE TO THE TEAM.

Do not return or expose:

QR points

points awarded

backend scoring information

The team should only see the clue.

Example:

✓ QR Accepted

Your clue:

"Find the next location near the main entrance."

[SCAN NEXT QR]


The backend silently adds the QR's points to the team's score.

5. Duplicate scan prevention

A team can scan each QR only once.

Example:

Team Alpha scans QR 1:

QR 1 → accepted


If Team Alpha scans QR 1 again:

QR already scanned.


No additional points are awarded.

Implement duplicate protection at the database/backend level, not only in frontend JavaScript.

Create a unique constraint:

(team_id, qr_id)


This must prevent duplicate records even if someone sends multiple requests simultaneously.

6. Refresh behavior / current clue

After a successful scan, the currently unlocked clue must persist.

If the team refreshes the browser:

Refresh
↓
Authenticate team
↓
Load latest/current scan state from Supabase
↓
Display the current clue again


The clue must NOT disappear after refresh.

The frontend must fetch the team's latest valid scan/clue from the backend.

Do not rely only on React state, localStorage, or session state.

If the team has scanned a QR and that scan is still valid, refreshing must show the same current clue.

The team dashboard should therefore persist the current clue using database state.

7. Scan records

Create:

scans

Fields:

id

team_id

qr_id

points_awarded

scanned_at

Store the awarded points in the scan record for audit/history.

Teams can see their own scan history, but do not expose the points awarded for individual QR scans if the competition requires points to remain hidden.

The team should mainly see:

QR/Challenge title if appropriate

Scan time

Current clue/status

8. Team points

The team's total score must be maintained securely on the backend.

Do not allow the frontend to directly modify:

team.points


Use a secure server-side database function/RPC or Edge Function for scoring operations.

When a valid QR is scanned:

QR points
→ backend
→ add to team score
→ create scan record


The frontend only receives the safe result:

success
clue


Never send the QR's point value to the client.

9. Admin dashboard

Admin dashboard should be optimized for PC/Desktop.

Use a professional dashboard layout with sidebar navigation.

Sections:

Dashboard

Show:

Total Teams

Total QR Codes

Total Scans

Leaderboard

Recent Scan Activity

QR Codes

Admin can:

Create QR

View QR

Download/display QR

View title

View points

View clue

Activate/deactivate QR

Delete QR

QR creation form:

QR Title
Points
Clue
[Create QR]


Teams

Admin can:

Create team

Remove team

View team score

View team scan history

Force logout team

Scan Records

Show a table containing:

Team

QR

Scan time

Points awarded

Actions

Add filters:

Team

QR

Date

10. Admin delete scan / rollback

Admin can delete an individual scan record.

When a scan is deleted:

Delete scan
↓
Reverse the points awarded
↓
Update team total
↓
Remove scan record
↓
Team can scan that QR again


This must happen atomically on the backend.

Example:

Team Alpha:

Registration = +10
Challenge 1 = +20

Total = 30


Admin deletes the Challenge 1 scan:

Total = 10


Team Alpha can then scan Challenge 1 again.

11. Security / Supabase RLS

Use Supabase Row Level Security.

Team users:

Can read their own team data.

Can read their own scan history.

Can access active QR validation through the secure backend flow.

Cannot modify points.

Cannot modify scans.

Cannot access other teams.

Cannot access admin data.

Cannot create/edit/delete QR codes.

Admin:

Full competition management access.

Never expose the Supabase service-role key in frontend code.

Sensitive scoring and admin operations must happen server-side.

12. Responsive UI

Build one responsive application.

Team interface — MOBILE FIRST

Participants will primarily use smartphones.

Optimize for:

Touch controls

Large Scan QR button

Mobile camera scanner

Simple cards

Minimal navigation

Fast loading

Easy-to-read clue

No unnecessary animations

Team dashboard example:

┌───────────────────────┐
│ Competition            │
│ Team Alpha             │
├───────────────────────┤
│                       │
│      120 POINTS       │
│                       │
│   [ 📷 SCAN QR ]      │
│                       │
│ Current Clue           │
│ ┌───────────────────┐ │
│ │ Find the next     │ │
│ │ location...       │ │
│ └───────────────────┘ │
│                       │
│ Scan History           │
└───────────────────────┘


The team score may be displayed on the dashboard, but individual QR point values must remain hidden.

Admin interface — DESKTOP FIRST

Use:

Sidebar

Dashboard cards

Tables

Filters

Modal forms

QR management

Team management

Scan management

Make the admin interface responsive for tablets/mobile as well.

13. QR scanner

Implement browser-based camera QR scanning.

Requirements:

Request camera permission properly.

Scan QR token.

Validate token through backend.

Handle invalid/inactive QR.

Handle duplicate scan.

Handle successful scan.

Provide clear loading/error states.

The deployed application must work over HTTPS for camera access.

14. Important data flow

Use this architecture:

TEAM MOBILE
     ↓
Supabase Auth
     ↓
Authenticated Team ID
     ↓
QR Scanner
     ↓
Secure Backend Function
     ↓
Validate QR
     ↓
Check (team_id + qr_id)
     ↓
Already scanned?
   ↙       ↘
 YES       NO
 ↓          ↓
Reject    Award points
            ↓
       Save scan
            ↓
       Return clue only
            ↓
       Team sees clue


Admin:

ADMIN PC
   ↓
Admin Dashboard
   ├── Teams
   ├── QR Codes
   ├── Scan Records
   ├── Leaderboard
   └── Force Logout


15. Database design

Use these main tables:

teams

id
team_name
points
created_at


qr_codes

id
title
points
clue
token
active
created_at


scans

id
team_id
qr_id
points_awarded
scanned_at


profiles

id
user_id
team_id
role
created_at


Use Supabase Auth for credentials.

Add appropriate foreign keys, indexes, RLS policies, and a unique constraint on:

scans(team_id, qr_id)


16. Performance

Keep the application lightweight.

Avoid:

Heavy animation libraries

Unnecessary dependencies

Large background videos

Excessive API requests

Repeated database queries

Client-side scoring logic

Prefer:

Simple responsive CSS

Efficient Supabase queries

Server-side validation

Reusable components

Lazy loading where useful

17. Error handling

Handle:

Invalid QR

Inactive QR

Already scanned QR

Camera permission denied

Camera unavailable

Network failure

Authentication failure

Expired session

Backend failure

Show simple user-friendly messages.

Never expose database errors, secrets, point values, or internal implementation details to the team.

18. Final requirement

Build the actual functional application, not a static UI prototype.

Prioritize:

Authentication

Secure QR scanning

Backend scoring

Duplicate prevention

Persistent clue after refresh

Admin controls

Supabase RLS/security

Responsive mobile Team UI

Responsive desktop Admin UI

Clean professional design

Do not add unnecessary features that are not specified above.
Avoid excessive design iterations and unnecessary dependencies to reduce Lovable credit usage.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://quest-scan-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bf243bad-998f-48ff-8e8d-2a2df585101b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
