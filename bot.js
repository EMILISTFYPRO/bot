require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const SteamBot = require('./steamBot');

// Initialize database
const db = new sqlite3.Database('connectivity.db', (err) => {
    if (err) console.error('Database error:', err);
    else console.log('✅ Database connected');
});

// Create tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            shared_secret TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS connectivity_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER,
            steam_id TEXT,
            login_ok INTEGER,
            cs2_present INTEGER,
            gc_ready INTEGER,
            error TEXT,
            checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id)
        )
    `);
});

/**
 * Test connectivity for all accounts in the database sequentially.
 */
async function testConnectivity() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM accounts', async (err, accounts) => {
            if (err) return reject(err);

            if (accounts.length === 0) {
                console.error('❌ No bot accounts found in database.');
                console.log('💡 Add accounts using: node dbManager.js');
                return reject(new Error('No accounts'));
            }

            console.log(`\n🔍 Testing connectivity for ${accounts.length} account(s)...\n`);

            const results = [];
            const proxy = process.env.PROXY_URL || null;

            for (const account of accounts) {
                console.log(`\n👤 Account: ${account.username}`);

                const bot = new SteamBot(
                    account.username,
                    account.password,
                    account.shared_secret,
                    { proxy }
                );

                const status = await bot.checkConnectivity();
                results.push(status);

                // Persist result
                db.run(
                    `INSERT INTO connectivity_checks (account_id, steam_id, login_ok, cs2_present, gc_ready, error)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        account.id,
                        status.steamId,
                        status.loginOk ? 1 : 0,
                        status.cs2Present ? 1 : 0,
                        status.gcReady ? 1 : 0,
                        status.error || null
                    ]
                );

                // Brief delay between accounts to avoid rate limiting
                await new Promise(r => setTimeout(r, parseInt(process.env.DELAY_BETWEEN_ACCOUNTS) || 2000));
            }

            // Summary
            console.log('\n' + '='.repeat(50));
            console.log('📊 Connectivity Check Summary');
            console.log('='.repeat(50));
            for (const r of results) {
                const login  = r.loginOk    ? '✅' : '❌';
                const cs2    = r.cs2Present ? '✅' : '❌';
                const gc     = r.gcReady    ? '✅' : '⚠️ ';
                const logout = r.logoutOk   ? '✅' : '❌';
                console.log(
                    `${r.username.padEnd(24)} | Login:${login} CS2:${cs2} GC:${gc} Logout:${logout}` +
                    (r.error ? ` | Error: ${r.error}` : '')
                );
            }
            console.log('='.repeat(50));

            resolve(results);
        });
    });
}

module.exports = { db };

// Run if executed directly
if (require.main === module) {
    testConnectivity()
        .then(() => {
            db.close();
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Error:', err.message);
            db.close();
            process.exit(1);
        });
}
