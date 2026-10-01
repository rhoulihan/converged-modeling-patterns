# Instructor runbook: hands-on console in event mode

Solo mode (the default) needs none of this. It's one user, no sign-in, nothing to
prepare. This runbook is for running the console with a room full of attendees.

## Before the session (15 minutes)

1. Set the event's secrets and open the console (only the console) to the room:

   ```bash
   export LAB_MODE=event \
          ADMIN_PASSWORD='<choose one>' \
          LAB_ADMIN_PASSWORD='<choose another>' \
          EVENT_CODE='<short code for the room>' \
          CMP_UI_BIND=0.0.0.0
   ```

   The console refuses to start in event mode while `LAB_ADMIN_PASSWORD` is still the repo
   default. `CMP_UI_BIND=0.0.0.0` publishes port 3100 on every interface so attendees
   can reach it; by default it binds to `127.0.0.1` only. Passwords must not contain `"`.

   **Leave the database ports (1522, 8182, 27018) on localhost**: do not set
   `CMP_DB_BIND`. The console reaches the database over the compose network and never
   needs them published. Opening them to the room would hand attendees the database
   itself: LAB_ADMIN (which creates and drops users) and SYS, with credentials that are
   in this repo.
2. Start: `docker compose up -d`, or `./lab.sh up` where there is no compose provider
   (Podman, see the README's *Podman* section). Both read `.env`. First start builds images.
3. Wait until `curl -fsS http://localhost:3100/api/config` shows `"mode":"event"`.
4. Open `http://<your-host>:3100/admin.html`, sign in with `ADMIN_PASSWORD`, and
   **pre-warm** about as many workspaces as you expect attendees (each takes a few
   seconds; attendees who arrive early simply get a fresh one; you can pre-warm more
   than once if the room grows).
5. Put the console URL and the event code on a slide. Attendees sign in with their name,
   email and that code; each gets their own database schema.

## Capacity

The SQL lane has been load-tested at 150 simultaneous attendees, prewarmed, all clicking
**Run** in the same burst (20% doing their own write, 80% running the identical read
query): **0** requests came back `429`/`5xx`, **120 of 150** reads were served from the
cache instead of hitting the database, the database never had more than **1** attendee
session active at once (the gate held), and latency was **p50 ≈ 1.1 s / p95 ≈ 1.8 s**.
That measurement is SQL only: the MongoDB lane goes through the same gate, but it has not
been load-tested at room scale, so treat a room full of MongoDB runs as unmeasured.
That is `app/test/load/load.mjs`, run with prewarm against a console already started in
event mode. To repeat it for your own room size, from `app/`:

```bash
LAB_URL=http://localhost:3100 EVENT_CODE='<your event code>' ADMIN_PASSWORD='<your admin password>' \
  USERS=150 npm run test:load
```

`USERS` defaults to 150; `WRITERS` (fraction that write instead of read) defaults to
`0.2`. It needs a direct line to the database too (`DB_HOST`/`DB_PORT`, default
`localhost:1522`) to sample how many attendee sessions are active at once.

## During the session

- **Do not run `./run.sh` during an event.** Its last stage runs the console's
  integration tests against the same database (it skips them while the console is in
  event mode, but its first stage still runs `docker compose up -d` or `./lab.sh up`).
- **Pause execution** (admin page) while you talk through a slide. While paused, every
  new run *and every run already waiting in the queue* is refused with "paused by
  instructor"; a run already executing finishes. Nothing resumes on its own: after you
  un-pause, attendees press **Run** again.
- The queue card shows what is waiting and what is running right now, with a
  **Cancel** next to each running request. Cancel interrupts the statement executing
  now (it returns `ORA-01013`) and the rest of that request's statements do not run
  (`LAB-CANCELLED`).
- An attendee who broke their own workspace can press **Reset this pattern** on their
  page. From the attendee table you can **Reset all patterns** for one of them (it
  reports an error if any pattern fails to build), or use **Reset every attendee** to
  rebuild every pattern in every workspace. That runs in the background: the admin page
  shows "N of M done" and lists any workspace that failed. It queues behind attendee
  work, so it can take a while with a full room.
- The time limit (10 s by default, SQL and MongoDB) applies to each **Run** as a whole,
  not to each statement: a run of several statements shares one 10 s budget, and once
  it is spent the statement executing is stopped and the rest return `LAB-TIMEOUT`.
  It is adjustable live from the admin page, 1–60 s, if a demo genuinely needs longer.
  Resets have their own 120 s budget.
- Point attendees at the ⓘ next to any card, tab or knob; the Measure-it curve shows
  where their result sits against a reference run.

## After the session

- **End event** cuts off every attendee workspace at once: each schema is locked (no
  new connections, whatever it was doing) and queued for dropping, and returns
  `{ dropped: 0, pending: N }`. A background sweep does the dropping: its first pass runs
  within 30 s and it retries every 30 s; after a workspace has sat pending for 2 minutes
  it kills that schema's remaining database sessions (the Oracle API for MongoDB holds
  idle sessions open past client disconnect) and drops it on the retry. The admin page
  (or `GET /api/admin/status`, field `pending`) shows the count still being dropped; it
  falls to `0` within a few minutes.
- Then `docker compose down` (or `./lab.sh down`). Adding `-v` **deletes the database volume** (all lab data). Only do that when you mean to start from scratch.

## Limits to know

- One statement executes at a time (a 1-permit gate); each run (all its statements
  together) times out after 10 s by default; each result is capped at 500 rows / 1 MB (`truncated: true` beyond
  that); a request waits at most 30 s in the queue before "busy: the database is
  serving others, try again" (`429`).
- Oracle AI Database 26ai Free: 2 CPU threads, 2 GB RAM, 12 GB of user data. Each
  attendee schema is capped at a 50 MB quota (ample for the patterns' scaled-down
  data); ~150 of them fit comfortably.
- **Measure it** runs each side twice, both rolled back: one unmeasured warm-up, then the
  measured pass (V$MYSTAT deltas, in-memory undo off for that session). It is a
  single-session measurement on 26ai Free, not a fixed constant:
  an `INSERT` can vary by roughly ±76 redo bytes / ±1 block run to run, and a large JSON
  append can step by a whole LOB chunk. Say "same order of magnitude," not exact bytes,
  when presenting it live. If the card shows a `LAB-MEASURE` error instead of numbers,
  the session-level setting the measurement depends on failed to apply. Rerun it; if it
  keeps failing, note it and move on rather than debugging live.
- Patterns 02 and 06 are deliberately scaled up so their write cost is visible:
  subscriber `S-001` (Computed) carries 1,000 CDR line items, and whale `A-900`
  (Outlier) embeds 800 clients, with the measured statement an append. Measured ratios
  on 26ai Free:

  | Pattern | Document side | Converged side | Ratio |
  |---|---|---|---|
  | 02 – Computed | ~52 KB redo / 19 blocks | ~1.6 KB / 11 blocks | ~33× |
  | 06 – Outlier | ~20 KB / 15 blocks | ~1.0–1.1 KB / 7–8 blocks | ~20× |

  These are read-modify-write costs of a growing document versus a small appended row,
  not a claim about how either engine stores JSON internally.
