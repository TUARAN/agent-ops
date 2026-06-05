# Agent Ops on Cloudflare Tunnel

Target:

```text
https://ops.2aran.com
```

This exposes the local Agent Ops GUI through Cloudflare Tunnel. The local Mac still executes all tasks; Cloudflare only forwards authenticated browser traffic to `http://127.0.0.1:4179`.

## Architecture

```text
Browser -> Cloudflare Access -> ops.2aran.com -> Cloudflare Tunnel -> 127.0.0.1:4179
```

## Safety Model

- Do not expose `127.0.0.1:4179` directly to the internet.
- Put `ops.2aran.com` behind Cloudflare Access.
- Allow only your own email or GitHub identity.
- Keep task execution whitelisted through `config/tasks.json`.
- Keep human review for publish/approval flows.

## 1. Install cloudflared

```bash
brew install cloudflared
cloudflared --version
```

## 2. Login to Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser. Choose the Cloudflare account and the `2aran.com` zone.

## 3. Create the tunnel

```bash
cloudflared tunnel create agent-ops
```

Copy the generated tunnel UUID. It will also create a credentials file under:

```text
~/.cloudflared/<TUNNEL_UUID>.json
```

## 4. Create the config

Copy the template:

```bash
mkdir -p ~/.cloudflared
cp cloudflare/config.template.yml ~/.cloudflared/agent-ops.yml
```

Edit `~/.cloudflared/agent-ops.yml`:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /Users/tuaran/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: ops.2aran.com
    service: http://127.0.0.1:4179
  - service: http_status:404
```

## 5. Route DNS

```bash
cloudflared tunnel route dns agent-ops ops.2aran.com
```

## 6. Run locally

Start Agent Ops:

```bash
cd /Users/tuaran/Documents/codex/agent-ops
npm run serve
```

Start the tunnel in another terminal:

```bash
cloudflared tunnel --config ~/.cloudflared/agent-ops.yml run agent-ops
```

Then open:

```text
https://ops.2aran.com
```

## 7. Keep Agent Ops running

Generate the launchd plist:

```bash
npm run launchd:serve
npm run launchd:tunnel
```

Install it:

```bash
cp data/launchd/local.agent-ops.serve.plist ~/Library/LaunchAgents/
cp data/launchd/local.agent-ops.tunnel.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/local.agent-ops.serve.plist
launchctl load ~/Library/LaunchAgents/local.agent-ops.tunnel.plist
```

## 8. Add Cloudflare Access

In Cloudflare Zero Trust:

1. Access -> Applications -> Add application -> Self-hosted.
2. Application domain: `ops.2aran.com`.
3. Policy: allow only your email.
4. Session duration: short enough for your workflow.

Do this before relying on the public hostname.

## Check

```bash
npm run tunnel:check
```
