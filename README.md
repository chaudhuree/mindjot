# Realtime Notes (Fastify + MongoDB + EJS + Tailwind CDN)

A modern, elegant, mobile‑first note taking web app with realtime updates and a recycle bin, built with Fastify, MongoDB, EJS (server-rendered), Tailwind via CDN, and Socket.IO.

## Features

- Realtime updates (create/update/delete/restore) via Socket.IO
- Soft delete with Recycle Bin and permanent delete
- Single and batch actions (mark done/undone, soft delete, restore, permanent delete)
- Group notes and filter by group
- Rich text formatting (bold/italic/underline) using contenteditable
- Dark/Light/System theme with persistence
- Global search
- Beautiful loading screen + skeleton UI while fetching
- Highly responsive layout (mobile/desktop)

## Tech Stack

- Fastify 4
- MongoDB (via `@fastify/mongodb`)
- EJS templates
- Tailwind CSS (CDN)
- Socket.IO (via `@fastify/socket.io`)

## Prerequisites

- Node.js 18+
- MongoDB running locally at `mongodb://127.0.0.1:27017` or a MongoDB Atlas connection string

## Getting Started

1. Configure env in `.env` (already created):

```
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/notes_app
```

2. Install dependencies:

```bash
npm install
```

3. Start the dev server with live reload:

```bash
npm run dev
```

Then open http://localhost:3000

## API Overview

- GET `/api/notes?deleted=true|false&groupId=<id>`
- POST `/api/notes` { title, content?, groupId? }
- PATCH `/api/notes/:id` { title?, content?, isDone?, groupId? }
- DELETE `/api/notes/:id` (soft delete)
- POST `/api/notes/:id/restore`
- DELETE `/api/notes/:id/permanent`
- POST `/api/notes/batch` { action: 'soft-delete'|'restore'|'permanent-delete'|'mark-done'|'mark-undone', ids: string[] }

- GET `/api/groups`
- POST `/api/groups` { name, color? }
- PATCH `/api/groups/:id` { name?, color? }
- DELETE `/api/groups/:id` (only if no active notes in the group)

## Notes

- IDs are serialized to plain strings for consistent client handling.
- Tailwind styles come from CDN; small UI helpers are inlined in `views/index.ejs`.
- Rich text uses `document.execCommand` to toggle bold/italic/underline within contenteditable. Keep content concise to maintain readability.

## Project Structure

- `index.js` — Fastify server, routes, Socket.IO
- `views/index.ejs` — Main UI template
- `public/js/main.js` — Client-side logic
- `.env` — Environment variables

## Production

- Use `npm start` to run without nodemon.
- Reverse proxy (e.g., Nginx) recommended. Set `PORT` via env.
- For Tailwind customization beyond CDN, add a build step (not required for this demo).
