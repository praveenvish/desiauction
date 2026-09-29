# The shared layer

One of each per host, whatever projects run on it:

| Service      | Job                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `caddy`      | The ONLY thing publishing ports (80, 443, 443/udp). TLS is automatic.                                              |
| `loki`       | Thirty days of every container's logs, one timeline                                                                |
| `alloy`      | Ships the logs, labelled `project` (Compose project) and `service`                                                 |
| `grafana`    | Queries and alert rules; loopback only, reached over an SSH tunnel                                                 |
| `autoheal`   | Restarts any container labelled `autoheal=true` whose healthcheck fails                                            |
| `disk-watch` | Writes how full each filesystem is as a log line, so Loki can alert on it. Host root mounted read-only, no network |

## The host, as a picture

```
/srv/platform/                 this directory (ops/platform), owner deploy
  .env                         ALERT_WEBHOOK_URL — not in git, chmod 600
  sites/<stack>.caddy          one per project environment, written by its deploy
/srv/apps/<project>/<env>/     one Compose stack per environment (e.g. ops/deploy)
```

Each stack has its own private network and a `<stack>-public` network that
holds only its public-facing services under stack-qualified aliases
(`da-prod-web`). The edge Caddy is connected to every `*-public` network and
nothing else is. There is deliberately NO network shared by all stacks: Docker
registers plain service names (`engine`, `web`) on every network a container
joins, so on a shared network production could resolve staging's `engine`.

## Applying it

```bash
ops/platform/apply.sh da-vps
```

First time only, create `/srv/platform/.env` (owner `deploy`, `chmod 600`)
with `ALERT_WEBHOOK_URL=` — any endpoint that accepts Grafana's webhook JSON
(an ntfy.sh topic, a Slack/Discord bridge, PagerDuty). Grafana refuses to start
without it: an alert with nowhere to go is a dashboard nobody watches.

`apply.sh` recreates only what changed, reconnects Caddy to every
`*-public` network (a recreated container loses the connections deploys made),
validates and reloads. Project deploys never touch this directory except to
write their own `sites/<stack>.caddy` and reload Caddy.

## Reading the logs

```bash
ssh -L 3001:localhost:3001 da-vps   # then http://localhost:3001
```

```logql
{project="da-prod", level="error"}                 # every production error
{project="da-prod", service=~"web|engine"}         # an auction, both sides
{project="da-staging"}                             # everything staging said
```

`level` is pino's number named (50 error, 40 warn, 30 info); plain-text logs
(Caddy, Postgres, Silo) are `unknown`. These logs live on the box, like the box.
Shipping them off-box is a Loki endpoint change, not a redesign.

## Alerts

`observability/grafana-alerting.yml` holds one contact point and one rule group
per project, each rule scoped by `project`. DesiAuction's group watches
`da-prod` only — staging is stopped and started freely and never pages. What
Grafana on this box cannot say is that the box is gone; the external uptime
check (docs/operations/ALERTS.md "Outside the box") covers that.

Heartbeat rules ("no backup in 26h", "no scheduler run") fire for a stack that
does not exist yet, so a new stack's project is SILENCED until its first
deploy. `da-prod` has one (created 2026-09-28, expires 2026-10-28): delete it
in Grafana → Alerting → Silences at the first production deploy.

## Adding a project (or an environment)

1. Its stack gets its own directory `/srv/apps/<project>/<env>`, a unique
   `COMPOSE_PROJECT_NAME`, and a `<stack>-public` network for the services
   Caddy must reach — nothing else joins it.
2. Every service has `deploy.resources.limits` (memory + cpus) from `.env`.
3. Its deploy writes `/srv/platform/sites/<stack>.caddy`, runs
   `docker network connect <stack>-public edge-caddy`, validates, reloads.
4. Its data has an off-box backup of its own, and a rule group here under its
   own project label.
5. DNS: an A record per hostname to this host.

## Growing and shrinking

| Situation                      | Lever                                                      |
| ------------------------------ | ---------------------------------------------------------- |
| One stack needs more (or less) | Its `.env` sizing knobs, then `docker compose up -d`       |
| Auction night                  | `docker compose stop` in the staging directory             |
| A project is idle or retired   | `docker compose stop` — or `down -v` to also free its disk |
| Who is using the disk          | `sudo docker system df -v`, `sudo ncdu /var/lib/docker`    |
| The whole host is too small    | Upgrade the plan in hPanel (data kept, ~10 min)            |
| A project outgrows the host    | Restore it from its off-box backup on a new host, move DNS |
