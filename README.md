# Secure Notes frontend

Plain HTML, CSS, and browser JavaScript. No framework, library, CDN, package dependencies, build process, or templates. The optional local web server uses Node.js built-ins only.

## Run locally

Requires Node.js 22.12+ only; do not run `npm install`.

```powershell
cd E:\PROJECTS\MongoDb\SecureNoteFrontEnd
node server.mjs
```

Open **http://localhost:5173**. Use this exact hostname so it matches the backend's default `CORS_ORIGIN`. Do not double-click `index.html`: modules and API integration need an HTTP origin.

In another terminal, start your backend:

```powershell
cd E:\PROJECTS\MongoDb\SecureNotes
npm run dev
```

The backend `.env` should use `PORT=4000` and `CORS_ORIGIN=http://localhost:5173`. If the database is on your VPS, keep the SSH database tunnel running as described in the backend documentation. The frontend never connects to MongoDB directly.

## Choose an API

Open **API connection** at the top of the page. Default: `http://localhost:4000/api/v1`.

To use the deployed backend directly, enter `http://samiulenterprise.com:8787/api/v1`, or its HTTPS equivalent once its certificate is valid. Click **Save connection**, then **Test connection**. The remote backend must also allow `CORS_ORIGIN=http://localhost:5173` for local browser use. Postman does not enforce CORS; browsers do. Changing backend `.env` on the VPS requires restarting `secure-notes-api`.

Only the API URL is remembered in localStorage. JWTs and user details stay in memory and are cleared on sign-out, reload, API change, or session expiration. JWTs expire after 15 minutes; sign in again. No database, SSH, or certificate password belongs in frontend source files. An HTTPS-hosted frontend cannot call an HTTP backend.

## Features

- Register ordinary users, sign in, display the current profile, and sign out.
- Own notes: paginated list, full read, create, update, and delete with confirmation.
- Admin: paginated listing of everyone's notes, with read-only access to others' notes.
- Admin user management: paginated list, detail view, add, edit profile/role/password/interests, and delete with confirmation.
- Admin interests report: paginated interest groups and their member users.
- Public posts by a user ID, without login; jump to your own posts or to an author's posts from admin user/interest views.
- Create public posts when signed in.
- Loading, empty, validation, network, API error, pagination, and expired-session states.

Admin controls reflect the authenticated profile. The API remains the authority for access checks. Database indexing, password hashing, JWT signing, and the aggregation pipelines remain in the backend.

## Existing API boundaries

Public posts are fetched through `GET /users/:id/posts`; there is no global author directory or global posts feed in the backend. Guests can enter an author's ID, signed-in users can use **My posts**, and admins can select authors from their management views.

The current backend only implements **creating and listing posts**, so this frontend does not invent post edit/delete endpoints. All required private-note CRUD and admin-user CRUD operations are implemented.

User deletion can return 409 if the user owns notes or posts. Removing or demoting the final admin can also return 409. The API has no post-deletion endpoint to clear an account's posts. Errors are shown exactly as returned by the backend.

Every list uses backend page/limit pagination, with a page-size selector. Interest pagination applies to groups, matching the backend. All API-provided text is rendered as text, not HTML, including note/post content and names.

## Manual integration checklist

1. Test the API connection; register two ordinary users.
2. Sign in as the first user. Create, read, edit, delete, and paginate notes. Check My profile and My posts.
3. Publish a post; sign out and retrieve it by that author's ID from Public posts.
4. Sign in as the second user. Confirm their own notes list is separate and admin navigation is absent.
5. Sign in as an API admin. List/add/edit/delete users, inspect user details, read all notes, and open the interest report. Other users' notes have no edit/delete controls.
6. Try deleting an account that owns content or demoting the final admin; verify the API error is visible and the page remains usable.
7. Sign out and reload; verify no private data or JWT is retained. Test a wrong password, disconnected API, and pagination's last page.

## Optional checks

```powershell
node --check app.js
node --check utils.js
node --check server.mjs
node --test tests/*.test.mjs
```

The static server exposes only the required static files, not arbitrary files from the folder. To host elsewhere, serve `index.html`, `styles.css`, `app.js`, and `utils.js` from any static server, and configure backend CORS for that frontend origin. No npm packages are required.
