require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const SteamBot = require('./steamBot');

// Load config from environment variables (with optional config.json fallback)
let config = {};
try {
    config = require('./config.json');
} catch (_) {}

const proxy = process.env.PROXY_URL || config.proxy || null;
const delayBetweenAccounts = parseInt(process.env.DELAY_BETWEEN_ACCOUNTS) || config.delayBetweenAccounts || 2000;

// Initialize database
const db = new sqlite3.Database(path.join(__dirname, 'connectivity.db'), (err) => {
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
        CREATE TABLE IF NOT EXISTS connectivity_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER,
            login_ok INTEGER DEFAULT 0,
            cs2_ok INTEGER DEFAULT 0,
            gc_ok INTEGER DEFAULT 0,
            error TEXT,
            checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id)
        )
    `);
});

/**
 * Test connectivity for all accounts in the database.
 * Each account is tested sequentially: login → CS2 presence → GC readiness → logout.
 */
async function testConnectivity() {
    console.log('\n🔍 Starting Steam connectivity check...\n');

    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM accounts', async (err, accounts) => {
            if (err) {
                console.error('❌ Error fetching accounts:', err);
                return reject(err);
            }

            if (!accounts || accounts.length === 0) {
                console.error('❌ No accounts found in database. Add accounts with: npm run manage-db');
                return reject(new Error('No accounts'));
            }

            const results = [];

            for (const account of accounts) {
                console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`👤 Account: ${account.username}`);

                const bot = new SteamBot(
                    account.username,
                    account.password,
                    account.shared_secret,
                    proxy
                );

                const result = await bot.checkConnectivity();
                results.push(result);

                // Persist result to database
                db.run(
                    'INSERT INTO connectivity_results (account_id, login_ok, cs2_ok, gc_ok, error) VALUES (?, ?, ?, ?, ?)',
                    [account.id, result.loginOk ? 1 : 0, result.cs2Ok ? 1 : 0, result.gcOk ? 1 : 0, result.error || null]
                );

                console.log(`   🔐 Login:            ${result.loginOk ? '✅ OK' : '❌ FAIL'}`);
                console.log(`   🎮 CS2 presence:     ${result.cs2Ok  ? '✅ OK' : '❌ FAIL'}`);
                console.log(`   📡 GC connected:     ${result.gcOk   ? '✅ OK' : '⚠️  Not connected'}`);
                if (result.error) {
                    console.log(`   ⚠️  Error: ${result.error}`);
                }

                if (accounts.indexOf(account) < accounts.length - 1) {
                    await new Promise(r => setTimeout(r, delayBetweenAccounts));
                }
            }

            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📊 Summary:');
            const ok = results.filter(r => r.loginOk).length;
            const gcOk = results.filter(r => r.gcOk).length;
            console.log(`   ${ok}/${results.length} accounts logged in successfully`);
            console.log(`   ${gcOk}/${results.length} accounts reached Game Coordinator`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            resolve(results);
        });
    });
}

module.exports = { testConnectivity, db, config };

// Run if executed directly
if (require.main === module) {
    testConnectivity()
        .then(() => {
            db.close();
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Connectivity check failed:', err.message);
            db.close();
            process.exit(1);
        });
}
