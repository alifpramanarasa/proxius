# Running Proxius in CI/CD

Proxius collections are plain, version-controllable JSON (`.pxs`). The `proxius`
CLI runs them headlessly — the same engine and assertions as the desktop app —
so any request you build and test in the UI runs identically in CI.

## 1. Export a collection

In the app, open a collection's **Export** (⇩) menu → **Proxius (.pxs)** →
**Download**, and commit the file to your repo (e.g. `examples/httpbin.pxs`).
The `.pxs` includes every request, its assertions (status, header, JSON path,
response time, **JSON Schema**), and variables.

## 2. Run it locally

```bash
# Human-readable output
proxius run examples/httpbin.pxs

# One run → pretty logs on stdout + JUnit / HTML / JSON files
proxius run examples/httpbin.pxs \
  --report junit --report html --report json \
  --report-dir proxius-report
```

The process exits **non-zero** if any request errors or any assertion fails —
so CI fails the build automatically.

### Options

| Flag | Purpose |
|------|---------|
| `--env <file.json>` | Environment variables, `{"key":"value"}`. |
| `--var K=V` | Override a single variable (repeatable). |
| `--data <array.json>` | Data-driven: one run per object in the JSON array. |
| `--reporter <fmt>` | Single reporter to stdout/`--output`: `pretty`, `json`, `junit`, `html`. |
| `--report <fmt>` | Emit several reports in **one** run (repeatable); files go to `--report-dir`. |
| `--report-dir <dir>` | Destination for `--report` files (`junit.xml`, `report.html`, `report.json`). |
| `--output <file>` | Write a single `--reporter` result to a file. |
| `--notify <url>` | Post a result summary to a webhook (repeatable). Slack / Discord / Teams are auto-detected from the URL; anything else gets a generic `{"text": …}`. |
| `--notify-on <when>` | `failure` (default) or `always`. |

## 3. Wire it into GitHub Actions

This repo ships a reusable composite action at
[`.github/actions/proxius-run`](../.github/actions/proxius-run/action.yml) and a
ready-to-copy workflow at
[`.github/workflows/api-tests.yml`](../.github/workflows/api-tests.yml).

Minimal usage in your own repo (after installing the CLI onto `PATH`):

```yaml
- name: Install proxius
  run: cargo install --git https://github.com/<owner>/proxius proxius-cli

- name: Run API collection
  uses: <owner>/proxius/.github/actions/proxius-run@main
  with:
    collection: examples/httpbin.pxs
    report-dir: proxius-report
    # env: environments/ci.json
    # vars: "token=${{ secrets.API_TOKEN }}"

- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: proxius-report
    path: proxius-report/

- uses: mikepenz/action-junit-report@v4     # nice PR test summary
  if: always()
  with:
    report_paths: proxius-report/junit.xml
    fail_on_failure: true
```

### Action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `collection` | yes | — | Path to the `.pxs` file. |
| `env` | no | — | Environment JSON file. |
| `data` | no | — | Data-driven JSON array file. |
| `vars` | no | — | Space-separated `K=V` overrides. |
| `report-dir` | no | `proxius-report` | Where reports are written. |
| `notify` | no | — | Webhook URL for a result summary (Slack/Discord/Teams/generic). |
| `notify-on` | no | `failure` | `failure` or `always`. |
| `proxius-bin` | no | `proxius` | Path to the binary (use `./target/release/proxius` when building from source). |

The action writes `junit.xml`, `report.html`, and `report.json`, adds a
pass/fail line to the job summary, and propagates the CLI exit code so a failed
assertion fails the job.

## Load / performance testing

The same `.pxs` doubles as a load test — no separate script. `proxius load`
fires the collection's requests from N concurrent virtual users for a fixed
duration and reports latency percentiles, throughput, and error rate:

```bash
proxius load examples/httpbin.pxs --vus 20 --duration 30 \
  --only "GET /get returns JSON" \
  --output load.json
```

```
httpbin smoke tests · 20 VUs · 30.02s
  6120 requests · 203.9 rps · 0/6120 failed (0.00%)
  latency ms: min 71 · p50 92 · p90 148 · p95 171 · p99 240 · max 512
  status: 200:6120
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--vus <N>` | 10 | Concurrent virtual users. |
| `--duration <secs>` | 10 | How long to run. |
| `--only <name>` | — | Load just one request from the document. |
| `--env` / `--var` | — | Same variable handling as `run`. |
| `--output <file.json>` | — | Write the full `LoadReport` (percentiles, status distribution) as JSON. |

Exits non-zero if any request failed, so a nightly performance gate can fail the
job. For scripted browser-side load, the app can also **export a k6 script**
(collection ⇩ → Export → k6) and run it under `k6` if you need k6's full
scenario model.

## Other CI systems

The CLI is a single binary with a standard exit code, so it drops into any
runner:

```yaml
# GitLab CI
api-tests:
  script:
    - cargo install --git https://github.com/<owner>/proxius proxius-cli
    - proxius run examples/httpbin.pxs --report junit --report html --report-dir proxius-report
  artifacts:
    when: always
    paths: [proxius-report/]
    reports:
      junit: proxius-report/junit.xml
```

## Notifications

Post a run summary to a chat webhook — handy for scheduled/monitoring runs:

```bash
proxius run examples/httpbin.pxs \
  --notify "$SLACK_WEBHOOK" \
  --notify-on failure          # or: always
```

The payload shape is chosen from the URL: Slack (`hooks.slack.com` → `{"text"}`),
Discord (`…/api/webhooks` → `{"content"}`), Teams (`webhook.office`/`office.com`
→ MessageCard), and a generic `{"text"}` for anything else. The summary lists
the suite verdict, request/assertion counts, and the first failing requests. A
failing webhook is logged to stderr but never fails the build.

In the action:

```yaml
- uses: <owner>/proxius/.github/actions/proxius-run@main
  with:
    collection: examples/httpbin.pxs
    notify: ${{ secrets.SLACK_WEBHOOK }}
    notify-on: failure
```

## Reports

- **JUnit XML** — consumed by GitHub/GitLab test UIs and most CI dashboards.
- **HTML** — a self-contained page (no external assets) you can open from the
  build artifacts; shows each request, timing, and every assertion with its
  failure message.
- **JSON** — the full `RunReport` for custom processing.
