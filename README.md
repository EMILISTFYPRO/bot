# CS2 Multi-Account Connectivity Checker

Tests Steam login and CS2 Game Coordinator availability across multiple accounts you own.

## What it does

For each account stored in the database the tool will:

1. Log in to Steam
2. Launch CS2 (app ID 730)
3. Wait for the Game Coordinator to confirm readiness
4. Log out cleanly
5. Print a one-line status summary per account

## Prerequisites

- Node.js 18+
- Steam accounts with CS2 in their library
- Optional: TOTP shared secrets for Steam Guard accounts

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and fill in any optional values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PROXY_URL` | Optional SOCKS5 proxy (`******host:port`) |

**Credentials are stored in the local SQLite database, not in plain-text files.**

## Managing accounts

```bash
npm run manage-db
```

Options include adding accounts manually or importing from a CSV/text file.

## Running the connectivity check

```bash
npm run test-connectivity
```

Example output:

```
🔍 Testing connectivity for 3 account(s)...

👤 Account: steambot1
✅ Logged in as steambot1 (76561198xxxxxxxxx)
✅ Game Coordinator connected for steambot1
👋 Logged out steambot1

...

==================================================
📊 Connectivity Check Summary
==================================================
steambot1                | Login:✅ CS2:✅ GC:✅ Logout:✅
steambot2                | Login:✅ CS2:✅ GC:⚠️  Logout:✅
steambot3                | Login:❌ CS2:❌ GC:❌ Logout:✅ | Error: Invalid password
==================================================
```

## Database

SQLite database (`commends.db`) with two tables:

| Table | Purpose |
|---|---|
| `accounts` | Steam account credentials |
| `connectivity_checks` | Historical check results |

## License

ISC
