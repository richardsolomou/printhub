# Migrating from the Convex-backed PrintHub

The standalone build keeps your STL files exactly where they are and imports the Convex metadata (requests, per-status copy counts, users, thumbnails) into SQLite under `/data`. Nothing is deleted from Convex, so you can roll back until you decommission it.

## 1. Back up

- Export Convex data: `npx convex export --path printhub-export.zip` in the old app's checkout, then unzip it.
- Snapshot or copy the prints directory on your NAS (the folder mounted at `/prints`, containing `todo/`, `in-progress/`, `done/`, `.previews/`).

## 2. Stop the old app

Stop the old container (and its Cloudflare Tunnel if you plan to reuse the hostname). Convex stays untouched.

## 3. Deploy the new image

Mount a **fresh, empty** directory at `/data` and the **same prints directory** at `/prints` (see the README's Install section). Don't start it yet — or if it started, stop it before importing.

## 4. Import

Run the importer from a checkout of this repository (Node 22+, `pnpm install` first), pointing at the unzipped export and both mounts:

```sh
pnpm migrate:convex -- \
  --export ./printhub-export \
  --data /mnt/HDDs/STL/.printhub-data \
  --prints /mnt/HDDs/STL \
  --operators you@example.com \
  --operator you@example.com --operator-password <a password of 8+ characters>
```

- Add `--dry-run` first (no `--data` needed): it exercises the full import against an in-memory database and verifies every file on disk without touching anything — safe to run while the old app is still live.
- `--operators` marks the listed emails (your old `ADMIN_EMAILS`) as operators; everyone else imports as a requester.
- `--operator`/`--operator-password` give one account a password. PrintHub signs in with built-in email/password accounts only, so pass it — without it nobody can sign in after the import.
- The importer moves `.previews/*` into the new `.printhub/previews/` layout, verifies every request's file exists on disk (warning if not), records the prints location in settings, and refuses to run against a database that already has requests.

## 5. Verify the import

Before starting the app, run the independent verifier — it compares every exported field against the imported database and the files on disk:

```sh
pnpm exec tsx scripts/verify-convex-import.ts ./printhub-export /mnt/HDDs/STL/.printhub-data /mnt/HDDs/STL
```

It must end with `NO METADATA MISMATCHES` and full file counts; anything else lists the exact request and field that differs.

## 6. First start

Start the container and open the app. Sign in with the `--operator` credentials. Verify the board: columns and copy counts should match the old app, thumbnails render, and downloads work.

## 7. Let teammates back in

The old deployment authenticated with Cloudflare Access headers; the new app uses built-in email/password accounts. Your teammates' accounts were imported with the same emails, names, and colors, but without passwords. Set one for each under **Settings → Users → Set password** and share it with them directly; they can change it themselves afterwards under Account.

If you keep the Cloudflare Tunnel, it now only provides ingress. An Access policy in front still works as an extra gate, but PrintHub no longer reads its identity headers.

## Rollback

Stop the new container, start the old one. Convex data was never modified. The only disk change the importer makes is moving `.previews/*` to `.printhub/previews/*`; move those files back if you return to the old app permanently.
