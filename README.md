# CS2 Connectivity Checker

A multi-account Steam connectivity checker that verifies each account can log in to Steam, launch CS2 (app ID 730), and connect to the CS2 Game Coordinator.

## Prerequisites

- Node.js 18+
- Valid Steam accounts (optionally with TOTP shared secrets for Steam Guard)

## Installation

```bash
npm install
```

## Configuration

### Environment Variables (recommended)

Copy `.env.example` to `.env` and edit as needed:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `PROXY_URL` | SOCKS5 proxy URL (`******host:port`) | none |
| `DELAY_BETWEEN_ACCOUNTS` | Milliseconds to wait between accounts | `2000` |

### Optional config.json

Alternatively, copy `config.json.example` to `config.json`:

```json
{
    "proxy": "******host:port",
    "delayBetweenAccounts": 2000
}
```

## Setup

### Add accounts to the database

```bash
npm run manage-db
```

Select **option 1** to add each Steam account. You will be prompted for:
- Steam username
- Steam password
- TOTP shared secret (optional, for Steam Guard 2FA)

## Usage

### Run connectivity check

```bash
npm run test-connectivity
```

This will, for each account in sequence:

1. **Login** to Steam
2. **Announce CS2** presence (app ID 730)
3. **Connect** to the CS2 Game Coordinator
4. **Log out** cleanly
5. **Record** the result in the database

### Expected output

```
🔍 Starting Steam connectivity check...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Account: myaccount
✅ Logged in as myaccount (76561198xxxxxxxxx)
🚀 Launching CS2 (app 730)...
✅ Game Coordinator connected for myaccount
👋 Logging out myaccount...
   🔐 Login:            ✅ OK
   🎮 CS2 presence:     ✅ OK
   📡 GC connected:     ✅ OK

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Summary:
   1/1 accounts logged in successfully
   1/1 accounts reached Game Coordinator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### View past results

```bash
npm run manage-db
# Select option 3: View connectivity results
```

## Database

The checker uses SQLite (`connectivity.db`) with two tables:

- `accounts` — Steam account credentials
- `connectivity_results` — per-account check results (login, CS2 presence, GC status)

## Proxy Support

Set `PROXY_URL` in your `.env` to route each bot's Steam connection through a SOCKS5 proxy:

```
PROXY_URL=******proxy-host:1080
```

HTTP proxy URLs (`http://...`) are automatically converted to SOCKS5.

## License

ISC
