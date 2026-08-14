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
const serverIp = process.env.SERVER_IP || '127.0.0.1';
const serverPort = parseInt(process.env.SERVER_PORT) || 27015;

// Parse CLI flags
const args = process.argv.slice(2);
const joinServerMode = args.includes('--join-server');

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
 * Parse Steam accounts from STEAM_ACCOUNTS environment variable
 * Format: username:password:shared_secret (one per line or comma-separated)
 * @returns {Array} Array of {username, password, shared_secret} objects
 */
function parseAccountsFromEnv() {
    const accountsEnv = process.env.STEAM_ACCOUNTS;
    if (!accountsEnv) return [];

    const accounts = [];
    const lines = accountsEnv.split('\n').filter(line => line.trim());

    for (const line of lines) {
        const parts = line.trim().split(':');
        if (parts.length === 3) {
            accounts.push({
                username: parts[0].trim(),
                password: parts[1].trim(),
                shared_secret: parts[2].trim()
            });
        }
    }

    return accounts;
}

/**
 * Add accounts from .env STEAM_ACCOUNTS to database
 */
function syncAccountsFromEnv() {
    return new Promise((resolve, reject) => {
        const envAccounts = parseAccountsFromEnv();

        if (envAccounts.length === 0) {
            return resolve(0); // No accounts from env
        }

        let added = 0;
        for (const account of envAccounts) {
            db.run(
                'INSERT OR IGNORE INTO accounts (username, password, shared_secret) VALUES (?, ?, ?)',
                [account.username, account.password, account.shared_secret],
                function(err) {
                    if (err) {
                        console.warn(`⚠️  Failed to add ${account.username}: ${err.message}`);
                    } else if (this.changes > 0) {
                        added++;
                    }
                }
            );
        }

        setTimeout(() => resolve(added), 500);
    });
}

/**
 * Test connectivity for all accounts in the database.
 * Each account is tested sequentially: login → CS2 presence → GC readiness → logout.
 */
async function testConnectivity() {
    console.log('\n🔍 Starting Steam connectivity check...\n');

    // Sync accounts from .env first
    const envCount = await syncAccountsFromEnv();
    if (envCount > 0) {
        console.log(`✅ Added ${envCount} account(s) from .env\n`);
    }

    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM accounts', async (err, accounts) => {
            if (err) {
                console.error('❌ Error fetching accounts:', err);
                return reject(err);
            }

            if (!accounts || accounts.length === 0) {
                console.error('❌ No accounts found. Add accounts in .env:');
                console.error('   STEAM_ACCOUNTS=username:password:shared_secret');
                console.error('   STEAM_ACCOUNTS=user2:pass2:secret2');
                console.error('\n   Or use: npm run manage-db');
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
                    [account.id, result.loginOk ? 1 : 0, result.cs2Ok ? 1 : 0, result.gcOk ? 1 : 0, result.error || null],
                    (dbErr) => { if (dbErr) console.warn(`⚠️  Failed to save result for ${account.username}: ${dbErr.message}`); }
                );

                console.log(`   🔐 Login:            ${result.loginOk ? '✅ OK' : '❌ FAIL'}`);
                console.log(`   🎮 CS2 presence:     ${result.cs2Ok  ? '✅ OK' : '❌ FAIL'}`);
                console.log(`   📡 GC connected:     ${result.gcOk   ? '✅ OK' : '⚠️  Not connected'}`);
                if (result.error) {
                    console.log(`   ⚠️  Error: ${result.error}`);
                }

                if (account !== accounts[accounts.length - 1]) {
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

/**
 * Join a CS2 server for all accounts in the database.
 * Each account logs in, launches CS2, then connects to the server.
 *
 * @param {string} ip   - Server IP address
 * @param {number} port - Server port
 */
async function joinServer(ip, port) {
    console.log(`\n🎮 Starting server join mode — target: ${ip}:${port}\n`);

    const envCount = await syncAccountsFromEnv();
    if (envCount > 0) {
        console.log(`✅ Added ${envCount} account(s) from .env\n`);
    }

    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM accounts', async (err, accounts) => {
            if (err) {
                console.error('❌ Error fetching accounts:', err);
                return reject(err);
            }

            if (!accounts || accounts.length === 0) {
                console.error('❌ No accounts found. Add accounts to .env:');
                console.error('   STEAM_ACCOUNTS=username:password:shared_secret');
                return reject(new Error('No accounts'));
            }

            const bots = [];

            // Register graceful shutdown
            const shutdown = async (reason = 'manual exit') => {
                console.log(`\n🛑 Shutting down — reason: ${reason}`);
                for (const bot of bots) {
                    try {
                        bot.disconnect();
                    } catch (_) {}
                }
                await new Promise(r => setTimeout(r, 1000));
                db.close();
                process.exit(0);
            };

            process.once('SIGINT',  () => shutdown('Ctrl+C'));
            process.once('SIGTERM', () => shutdown('SIGTERM'));

            for (const account of accounts) {
                console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`👤 Account: ${account.username}`);

                const bot = new SteamBot(
                    account.username,
                    account.password,
                    account.shared_secret,
                    proxy
                );
                bots.push(bot);

                try {
                    await bot.joinServer(ip, port);
                    console.log(`✅ ${account.username} joined ${ip}:${port}`);
                } catch (err) {
                    console.error(`❌ ${account.username} failed to join: ${err.message}`);
                }

                if (account !== accounts[accounts.length - 1]) {
                    await new Promise(r => setTimeout(r, delayBetweenAccounts));
                }
            }

            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`✅ All bots connected to ${ip}:${port}`);
            console.log('Press Ctrl+C to disconnect all bots.');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            // Keep process alive — bots stay connected until shutdown
            resolve(bots);
        });
    });
}

module.exports = { testConnectivity, joinServer, db, config };

// Run if executed directly
if (require.main === module) {
    if (joinServerMode) {
        joinServer(serverIp, serverPort)
            .catch(err => {
                console.error('❌ Server join failed:', err.message);
                db.close();
                process.exit(1);
            });
    } else {
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
}

