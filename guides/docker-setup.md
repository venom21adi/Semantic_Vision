# Running Semantic Vision in Docker

A practical walkthrough of the Docker setup: how a real host path you
paste into the app actually reaches the container, and the best way to
point it at your own repos without editing `.env` and restarting every
time you switch. See the [main README](../README.md#-run-with-docker)
for the one-command quick start; this is the long version.

## The one rule: the container only sees what you mount

`docker compose up` runs the backend inside a container, which has its
own filesystem — it cannot see `C:\Users\you\projects\my-repo` or
`/home/you/my-repo` unless `docker-compose.yml` mounted it there. The
only part of your machine it can see is whatever host folder `REPO_PATH`
(in `.env`) points at, and that folder always lands at the fixed
in-container path `/workspace/repo`.

Paste the same path you set as `REPO_PATH` — or a subfolder of it —
into the app's **Repository path** field, and the backend recognizes it
and maps it onto `/workspace/repo` itself (it's told `REPO_PATH` too, so
it knows the mapping); typing `/workspace/repo` directly still works the
same as always. A path that *isn't* under `REPO_PATH` at all still fails
with `Not a directory: ...`, since the container genuinely never saw it
— that's the one case where you do need to either update `REPO_PATH` and
restart, or mount a shared parent folder, covered below.

`REPO_PATH` in `.env` controls *which* host folder gets mounted at
`/workspace/repo`. Leave it blank and `docker compose up` mounts this
project's own repo, ready to explore with zero setup — but with nothing
in `REPO_PATH` to translate from, only `/workspace/repo` itself works in
that default case.

## The naive way (works, but you'll fight it constantly)

Point `REPO_PATH` at one specific repo:

```bash
# .env
REPO_PATH=C:/Users/you/projects/my-api
```

```bash
docker compose up --build
```

Paste `C:/Users/you/projects/my-api` (or type `/workspace/repo`) in the
app — `my-api` loads. Now you want to look at `my-frontend` instead. You
have to:

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
under it is a subpath away — no `.env` edit, no restart, just paste a
different path into the same field. Any of these work, and land on the
exact same place:

```
C:/Users/you/projects/my-api          (the real path -- just paste it)
C:/Users/you/projects/my-frontend
/workspace/repo/my-api                 (the in-container path, if you prefer)
/workspace/repo/my-frontend
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

Open `http://localhost:5173`, paste `C:\Users\you\projects\my-api`
(or type `/workspace/repo/my-api`), click **Load** — `my-api` loads,
its `.visualiser/` save data lands at the real
`C:\Users\you\projects\my-api\.visualiser` on your host (see "Where
saves land" below). Clear the field, paste
`C:\Users\you\projects\my-frontend`, click **Load** again — no restart,
same running containers.

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
  at a path under `/workspace/repo` (or the equivalent real host path,
  translated the same way the repository path is) — anywhere else fails
  with a permission error, since nothing else is writable in the
  container.
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

## Why REPO_PATH isn't configurable from the app itself

It would be more convenient if the app's own **Repository path** field
could change what folder Docker has access to, with no `.env` edit and
no restart, ever. We looked at this and deliberately didn't build it —
not a "maybe later," a real no, for a reason worth spelling out rather
than leaving unexplained.

A Docker volume mount is fixed the moment its container is created;
nothing running inside that container can change it. The *only* way for
the app to change its own mount at runtime is for the backend container
to be able to recreate itself — which means giving it access to the
Docker socket (`/var/run/docker.sock`, or Docker Desktop's equivalent on
Windows). There's no lighter-weight way to do it; that access is what
"reconfigure my own container" requires.

Docker socket access is equivalent to root on the *host machine*, not
just the container — this is one of the most well-documented container
escape techniques there is, and it's the first thing real malware
scans for when it finds an exposed Docker socket. Anything that can
reach that socket can launch a brand new container mounting your entire
disk read-write and read or write anything on it: SSH keys, saved
credentials, unrelated projects, anything.

This app is a worse-than-average place to add that capability, not a
neutral one, for two reasons specific to it:

- **It already sends real code to a third-party API.** Clicking
  **Document** with OpenAI or Anthropic selected sends a function's
  source, callers, and callees off this machine — an accepted, narrow,
  opt-in exposure on its own. Stack host-level Docker control on top of
  that, and any bug anywhere in that pipeline (or in the parser, given
  this tool's whole purpose is pointing it at code you may not fully
  trust yet) stops meaning "a code snippet went somewhere it shouldn't"
  and starts meaning "the attacker now has read/write on your entire
  machine, including whatever credentials made that AI call possible in
  the first place."
- **It's self-hosted and unmanaged.** This runs on each user's own
  machine, not on infrastructure we operate — a mistake in this code
  path is a standing host-compromise vector on every install, forever,
  until each person updates on their own. That's a much worse failure
  mode here than it would be for something centrally run and patched.

Compare the blast radius against what's already documented above
instead: the "mount a parent folder" pattern gives up almost nothing —
worst case, a bug lets someone read files under one folder *you
explicitly chose*, read-only. Bounded, and entirely within a scope you
picked. That's why it's the recommended way to cut this friction, not a
consolation prize for the "real" dynamic version.

## Why the first load is slow, and why every load after that isn't

Loading a large repo for the first time in Docker takes noticeably
longer than a native run of the same repo would. That's not a bug or a
misconfiguration — it's a real cost of how Docker Desktop shares files
between Windows/macOS and the Linux VM the container actually runs in:
every single file read on a bind mount (`REPO_PATH`'s mount, above)
crosses that VM boundary, and each crossing has a fixed latency cost on
top of the read itself. For a few hundred small source files that tax
adds up to far more time than the actual parsing does, in a way that
doesn't show up at all in a native run.

Measured directly, parsing a ~1,100-file repo:

| | Docker, first load | Docker, every load after | Native |
|---|---|---|---|
| Time | ~54s | ~10s | ~6s |

The backend doesn't just eat that cost every time, though. It keeps its
own fast, container-local copy of whatever repo it last parsed (in a
Docker-managed volume, not visible on your host — it grants no new
filesystem access beyond what `REPO_PATH` already exposes read-only, and
survives `docker compose restart`, so it stays warm across ordinary
container restarts too). The **first** time you load a given repo, it
still has to read every file across the VM boundary at least once —
nothing can avoid that. Every load after that, it only needs to check
what's changed since last time (fast) and re-read the handful of files
that actually did (usually none), instead of paying the full cost again.

This needs no setup and no change to how you use Docker — it's just how
`POST /api/parse-repo` behaves now. See
[`src/semantic_vision/api/repo_cache_sync.py`](../src/semantic_vision/api/repo_cache_sync.py)
for the implementation.

## See also

- [Main README — Run with Docker](../README.md#-run-with-docker) for the
  one-command quick start.
- [`docker-compose.yml`](../docker-compose.yml) — the actual volume
  mounts this guide describes.
