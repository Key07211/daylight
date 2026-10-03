# Local service

`node server/index.mjs` binds only `127.0.0.1:4317` and serves the built `dist/` UI. Node 24 is sufficient; the server has no third-party runtime dependencies. API writes require JSON and the `X-Daylight-Token` returned by `/api/bootstrap`. Host and Origin validation prevent websites from calling a local service through DNS rebinding or cross-site requests. Tokens change on restart.

Environment variables:

- `DAYLIGHT_PORT`: default `4317`.
- `DAYLIGHT_DATA_DIR`: absolute path to durable data; default `data/` beside this directory.
- `CODEX_BIN`: optional executable path; default `codex` from PATH.
- `DAYLIGHT_ALLOWED_ORIGINS`: comma-separated extra UI origins. Default development origins are `http://localhost:5173,http://127.0.0.1:5173`. Vite should proxy `/api` with `changeOrigin: true`.

All tasks, runs, settings, reminder receipts, and notifications are atomically written to `data/store.json`; malformed data stops startup without replacing the file. `/api/export` downloads a complete backup. To restore, stop the app and replace `store.json` with a valid backup. Run one service against each data directory.

Reminders and schedules are checked every five seconds while the service runs. The computer must be awake and the service running. On restart, due reminders are delivered once, and missed recurring schedules run once before advancing to the next future date. Daily, weekday, and weekly schedules preserve local wall-clock time using the computer's timezone. Completing a task pauses its reminders and scheduling. Reopening resumes overdue reminders/schedules that were not previously consumed.

Windows notifications are opt-in through settings. Persistent in-app notifications are always created. Windows may suppress desktop toasts due to notification settings or Focus Assist. Other platforms keep in-app notifications but do not send an OS toast in this release.

Codex runs require an existing absolute workspace directory and a prompt. The CLI must be installed and authenticated before starting Daylight. Manual runs require an explicit API action; scheduled runs require enabled automation and a due `runAt`. Runs use `codex exec --skip-git-repo-check --color never -s <read-only|workspace-write> -C <workspace> -`, passing prompts via stdin, without a shell. Default sandbox is `read-only`; no approval-bypass flags are used. At most one process runs at a time. Runs stop after 30 minutes, logs are bounded, and cancellation terminates the launched process tree on Windows. A startup interruption is recorded as failed and is never automatically replayed.

Completed runs and reminders do not automatically complete tasks. A one-time schedule disables after launch; a recurring schedule advances when launched, regardless of the eventual result. CLI/setup failures are recorded once for that occurrence. History retains the latest 100 runs and 500 notifications. Task deletion keeps historical run titles.

Useful test entry points: `createApp`/`start` from `server/app.mjs`, and `nextRunAt` from `server/scheduler.mjs`. Tests inject Codex metadata, a process stub, clock, and notification sender; no tests invoke paid Codex runs or deliver OS notifications.
