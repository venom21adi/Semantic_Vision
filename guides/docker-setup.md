# Running Semantic Vision in Docker

A practical walkthrough of the Docker setup: the one thing that trips
people up (why a real host path "isn't found"), and the actual best way
to point it at your own repos without editing `.env` and restarting
every time you switch. See the [main README](../README.md#-run-with-docker)
for the one-command quick start; this is the long version.

## The one rule: the container only sees what you mount

`docker compose up` runs the backend inside a container, which has its
own filesystem — it cannot see `C:\Users\you\projects\my-repo` or
`/home/you/my-repo` no matter what you type into the app. The only part
of your machine it can see is whatever host folder `docker-compose.yml`
mounts, and that folder always lands at the fixed in-container path
`/workspace/repo`. That's why the app's **Repository path** field always
wants `/workspace/repo`, never a real path from your machine — typing a
real host path fails with `Not a directory: ...`, which reads like "not
found" but really just means "the container never saw this path to
begin with."

`REPO_PATH` in `.env` controls *which* host folder gets mounted at
`/workspace/repo`. Leave it blank and `docker compose up` mounts this
project's own repo, ready to explore with zero setup.

## The naive way (works, but you'll fight it constantly)

Point `REPO_PATH` at one specific repo:

```bash
# .env
REPO_PATH=C:/Users/you/projects/my-api
```

```bash
docker compose up --build
```

Type `/workspace/repo` in the app — `my-api` loads. Now you want to look
at `my-frontend` instead. You have to:

1. Edit `.env` to `REPO_PATH=C:/Users/you/projects/my-frontend`
2. Recreate the containers, because a volume mount is fixed when a
   container is created — editing `.env` does nothing to one already
   running:
   ```bash
   docker compose up --build
   ```
3. Type `/workspace/repo` again.

Repeat for every repo, every session. This is the friction — and it's
avoidable.

## The practical way: mount the parent folder, not one repo

If your repos already live under one common folder — which is normal;
most people keep everything under something like `~/projects` or
`C:\Users\you\code` — point `REPO_PATH` at *that folder* instead of any
one repo inside it:

```bash
# .env
REPO_PATH=C:/Users/you/projects
```

```bash
docker compose up --build
```

Now `/workspace/repo` is your whole projects folder, and every repo
under it is a subpath away — no `.env` edit, no restart, just type a
different path into the same field:

```
/workspace/repo/my-api
/workspace/repo/my-frontend
/workspace/repo/another-service
```

Switching between them is exactly as fast as switching tabs. This needs
no code or compose change — `REPO_PATH` was always "whatever host folder
you point it at," a parent folder is just a better choice than a single
repo.

**Worked example.** Say your machine has:

```
C:\Users\you\projects\
├── my-api\           (a FastAPI service)
├── my-frontend\       (a React app)
└── another-service\
```

```bash
# .env
REPO_PATH=C:/Users/you/projects
```

```bash
docker compose up --build
```

Open `http://localhost:5173`, type `/workspace/repo/my-api`, click
**Load** — `my-api` loads, its `.visualiser/` save data lands at the
real `C:\Users\you\projects\my-api\.visualiser` on your host (see
"Where saves land" below). Clear the field, type
`/workspace/repo/my-frontend`, click **Load** again — no restart, same
running containers.

### If your repos aren't all under one folder

Drop a symlink per repo into a dedicated folder instead of moving
anything, then mount that folder:

```bash
mkdir C:\docker-workspace
mklink /D C:\docker-workspace\my-api C:\Users\you\projects\my-api
mklink /D C:\docker-workspace\legacy-thing D:\old-stuff\legacy-thing
```

(macOS/Linux: `mkdir -p ~/docker-workspace && ln -s /path/to/repo ~/docker-workspace/repo`)

```bash
# .env
REPO_PATH=C:/docker-workspace
```

Same result — `/workspace/repo/my-api` and `/workspace/repo/legacy-thing`
both work, restart-free, regardless of where the real repos live.

## Where saves land

The mounted folder is read-only, with one exception: `.visualiser/`
(dragged layout, saved docs, analysis state) is separately mounted
read-write, landing exactly where it would if you'd run Semantic Vision
natively — inside the repo you loaded, on your host. Two things follow:

- The **Save location** field's "Change" control only works if pointed
  at a path under `/workspace/repo` — anywhere else fails with a
  permission error, since nothing else is writable in the container.
- The default auto-detected save location only resolves correctly if
  the specific repo you loaded (e.g. `/workspace/repo/my-api`) has its
  own `.git` — true for a normal repo root, not for an arbitrary
  subfolder with no `.git` anywhere in its tree.

## Other `.env` settings

`.env` is also where AI documentation providers are configured —
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OLLAMA_API_BASE` (an Ollama
server on your host is reachable from the backend container at
`http://host.docker.internal:11434` by default). See `.env.example` for
the full list. Unlike `REPO_PATH`, these are read at container start the
same way — changing them also needs `docker compose up --build` to take
effect.

## See also

- [Main README — Run with Docker](../README.md#-run-with-docker) for the
  one-command quick start.
- [`docker-compose.yml`](../docker-compose.yml) — the actual volume
  mounts this guide describes.
