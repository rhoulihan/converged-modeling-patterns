# Remote access: a public HTTPS URL for the lab

The lab host has no public address of its own. A tunnel it dials **out** gives remote
attendees a static `https://` URL without opening any router ports.

## What the public URL exposes

The console runs a second listener for tunnels: **port 3101 on the host, bound to
`127.0.0.1` only**. It serves the attendee side and nothing else:

| Path | LAN (`:3100`) | Public listener (`:3101`) |
|---|---|---|
| Sign-in, patterns, SQL and MongoDB console | yes | yes |
| `/admin.html`, `/api/admin/*` (instructor console) | yes | **404** |
| `/deck/` (instructor deck with speaker notes) | yes | **404** |

The attendee sign-in page hides its "Instructor sign-in" link on the public listener.
**Run the event from the LAN** (`http://<lab-host>:3100/admin.html`).

Attendees still need the event code to get a workspace. Before sharing a public URL:

- set a fresh `EVENT_CODE` for the event in `.env`, and a long `ADMIN_PASSWORD`;
- `docker compose up -d` to apply them.

## Option C: Tailscale Funnel (current)

On the lab host (Linux):

```bash
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --hostname=umt-lab          # open the printed link once to approve the machine
sudo tailscale funnel --bg 3101               # public HTTPS -> the attendee-only listener
tailscale funnel status                        # shows https://umt-lab.<tailnet>.ts.net
```

The first `funnel` run may print a link to enable HTTPS certificates and Funnel for the
tailnet; open it once. `--bg` makes the configuration persistent across reboots.
Turn it off with `sudo tailscale funnel --https=443 off`.

Point Funnel at **3101**, never 3100: 3100 carries the instructor console.

## Option A: a cloud VM + WireGuard + Caddy (later)

A small VM with a static public IP (OCI Always Free) runs Caddy for HTTPS and a WireGuard
server; the lab host keeps a WireGuard tunnel up to it, and Caddy proxies
`https://<your domain>` to the lab host's tunnel address on **3101** (bind the listener to
the WireGuard interface instead of `127.0.0.1` for that setup).
