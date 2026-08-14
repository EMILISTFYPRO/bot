require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'connectivity.db'));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(q) {
    return new Promise(resolve => rl.question(q, resolve));
}

// Initialize tables
function initializeTables() {
    return new Promise((resolve) => {
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
            `, () => {
                console.log('✅ Database tables initialized');
                resolve();
            });
        });
    });
}

async function menu() {
    console.log('\n=== CS2 Connectivity Checker - Database Manager ===');
    console.log('1. Add bot account');
    console.log('2. List accounts');
    console.log('3. View connectivity results');
    console.log('4. Delete account');
    console.log('5. Exit');

    const choice = await question('\nSelect option (1-5): ');

    switch (choice.trim()) {
        case '1':
            await addAccount();
            break;
        case '2':
            await listAccounts();
            break;
        case '3':
            await viewResults();
            break;
        case '4':
            await deleteAccount();
            break;
        case '5':
            console.log('Goodbye!');
            rl.close();
            db.close();
            process.exit(0);
        default:
            console.log('Invalid option');
    }

    await menu();
}

async function addAccount() {
    const username = await question('Steam username: ');
    const password = await question('Steam password: ');
    const sharedSecret = await question('Shared secret (TOTP, or press enter to skip): ');

    await new Promise((resolve) => {
        db.run(
            'INSERT INTO accounts (username, password, shared_secret) VALUES (?, ?, ?)',
            [username.trim(), password.trim(), sharedSecret.trim() || null],
            (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        console.log(`⚠️  Account already exists: ${username.trim()}`);
                    } else {
                        console.error('❌ Error:', err.message);
                    }
                } else {
                    console.log('✅ Account added!');
                }
                resolve();
            }
        );
    });
}

async function listAccounts() {
    db.all('SELECT id, username, created_at FROM accounts ORDER BY created_at', (err, rows) => {
        if (err) { console.error('❌ Error:', err.message); return; }
        if (!rows || rows.length === 0) { console.log('No accounts found'); return; }
        console.log('\n=== Bot Accounts ===');
        rows.forEach(row => {
            console.log(`ID: ${row.id} | Username: ${row.username} | Added: ${row.created_at}`);
        });
    });
}

async function viewResults() {
    db.all(
        `SELECT a.username, r.login_ok, r.cs2_ok, r.gc_ok, r.error, r.checked_at
         FROM connectivity_results r
         JOIN accounts a ON r.account_id = a.id
         ORDER BY r.checked_at DESC
         LIMIT 50`,
        (err, rows) => {
            if (err) { console.error('❌ Error:', err.message); return; }
            if (!rows || rows.length === 0) { console.log('No results yet. Run: npm run test-connectivity'); return; }
            console.log('\n=== Recent Connectivity Results ===');
            rows.forEach(row => {
                const login = row.login_ok ? '✅' : '❌';
                const cs2   = row.cs2_ok   ? '✅' : '❌';
                const gc    = row.gc_ok    ? '✅' : '⚠️ ';
                const err   = row.error ? ` | Error: ${row.error}` : '';
                console.log(`${row.username} | Login:${login} CS2:${cs2} GC:${gc} | ${row.checked_at}${err}`);
            });
        }
    );
}

async function deleteAccount() {
    await listAccounts();
    const id = await question('\nAccount ID to delete: ');
    await new Promise((resolve) => {
        db.run('DELETE FROM accounts WHERE id = ?', [id.trim()], (err) => {
            if (err) console.error('❌ Error:', err.message);
            else console.log('✅ Account deleted!');
            resolve();
        });
    });
}

// Initialize tables before starting menu
initializeTables().then(() => menu());
