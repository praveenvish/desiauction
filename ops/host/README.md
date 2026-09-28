# The machine

`bootstrap.sh` turns a fresh Ubuntu 24.04/26.04 VPS into a host for any number
of Docker Compose projects. It is idempotent — re-running it converges.

## Current host

|              |                                                               |
| ------------ | ------------------------------------------------------------- |
| Provider     | Hostinger KVM 4 — India, Mumbai (the DesiAuction ops account) |
| Size         | 4 vCPU (AMD EPYC 9354P), 16 GB RAM, 200 GB NVMe, 16 TB/month  |
| OS           | Ubuntu 26.04 LTS                                              |
| Address      | `145.223.20.134` (`srv2014292.hstgr.cloud`)                   |
| Bootstrapped | 2026-09-28                                                    |

Measured on the empty box: 1.1 GB/s write, 830 MB/s read, ~1,400 fsyncs/s,
~67 MB/s from GitHub, 5.7 ms to ghcr.io.

## What it sets

| Area     | Setting                                                                                | Why                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Users    | `ops` (sudo, a human), `deploy` (docker group, CI only)                                | root never logs in; CI never has sudo                                                                                      |
| SSH      | keys only, root off, `AllowUsers ops deploy`, 3 tries                                  | The drop-in is `00-…` because sshd keeps the FIRST value it reads, and the image's `50-cloud-init.conf` turns passwords ON |
| Firewall | UFW: 22 (rate-limited), 80, 443, 443/udp; plus the hPanel firewall with the same rules | Docker publishes ports around UFW, so only the edge Caddy publishes any                                                    |
| Updates  | unattended security updates, **no automatic reboot**                                   | An unattended reboot during an auction is an outage; reboots are scheduled by a person                                     |
| Memory   | 4 GB swap, swappiness 10                                                               | A safety net under the per-container limits, not capacity                                                                  |
| Logs     | journald ≤ 1 GB; Docker json-file 3 × 20 MB per container by default                   | An uncapped log is a full disk on a slow timer                                                                             |
| Docker   | official repo, `live-restore`                                                          | Containers keep running while the daemon updates                                                                           |
| Layout   | `/srv/platform`, `/srv/apps` (owner `deploy`)                                          | ops/platform/README.md                                                                                                     |

## Access

```bash
ssh da-vps            # ops@145.223.20.134 with ~/.ssh/desiauction_admin
```

Lost the key? hPanel → VPS → **Web console** still works, and a new public key
can be added in hPanel → VPS → Settings → SSH keys (it lands in root's
`authorized_keys`; copy it to `/home/ops/.ssh/authorized_keys` from the console).

## CI access

`deploy` has exactly one key: GitHub Actions', written `restrict ssh-ed25519 …`
(no port/agent forwarding, no pty) — its private half lives only in the
`production` environment's `DEPLOY_SSH_KEY` secret. Both workflows pin the
host with `DEPLOY_HOST_FINGERPRINT`. Rotating it: generate a new pair, replace
the line in `/home/deploy/.ssh/authorized_keys`, update the secret, delete the
local private key. A rebuilt host has a NEW host key: update the fingerprint
secret too, or every deploy refuses (correctly).

## Backups of the machine itself

Hostinger takes a weekly backup (daily is paid) and keeps one manual snapshot
that **expires after a day**. Restoring either overwrites the WHOLE VPS — every
project at once — so it is the answer to losing the machine, never to losing
one project's data. That is each project's own off-box backup (pgBackRest and
the object mirror for DesiAuction). Take a snapshot before any risky host
change.
