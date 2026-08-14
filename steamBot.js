const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const GlobalOffensive = require('globaloffensive');

class SteamBot {
    constructor(username, password, sharedSecret, proxyUrl = null) {
        this.username = username;
        this.password = password;
        this.sharedSecret = sharedSecret;
        this.proxyUrl = proxyUrl;

        // Parse SOCKS5 proxy URL if provided
        const clientOptions = {};
        if (proxyUrl) {
            try {
                let socksUrl = proxyUrl;
                if (socksUrl.startsWith('http://')) {
                    socksUrl = socksUrl.replace('http://', 'socks5://');
                }
                const url = new URL(socksUrl);
                clientOptions.connection = {
                    type: 'socks5',
                    host: url.hostname,
                    port: parseInt(url.port) || 1080,
                    userId: url.username || '',
                    password: url.password || ''
                };
                console.log(`🔧 SOCKS5 Proxy configured: ${url.hostname}:${url.port || 1080}`);
            } catch (err) {
                console.warn(`⚠️ Invalid proxy URL: ${err.message}`);
            }
        }

        this.client = new SteamUser(clientOptions);
        this.csgo = new GlobalOffensive(this.client);
        this.isLoggedIn = false;
        this.haveGCSession = false;
        this.steamId = null;
    }

    async login() {
        return new Promise((resolve, reject) => {
            console.log(`🔐 Logging in as ${this.username}...`);

            let resolved = false;
            const done = (err) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                if (err) reject(err);
                else resolve();
            };

            // Remove all listeners on cleanup to avoid duplicate handler leaks
            const cleanup = () => {
                clearTimeout(gcTimeout);
                clearTimeout(loginTimeout);
                this.client.removeAllListeners('loggedOn');
                this.client.removeAllListeners('error');
                this.client.removeAllListeners('disconnected');
                this.client.removeAllListeners('steamGuard');
                this.csgo.removeAllListeners('ready');
            };

            // Event: Steam Guard
            this.client.once('steamGuard', (domain, callback) => {
                if (!this.sharedSecret) {
                    console.error(`❌ Steam Guard required for "${this.username}" but no shared secret provided`);
                    this.client.logOff();
                    done(new Error('Steam Guard required but no shared secret'));
                    return;
                }
                try {
                    const code = SteamTotp.generateAuthCode(this.sharedSecret);
                    callback(code);
                } catch (err) {
                    console.error(`❌ Failed to generate Steam Guard code: ${err.message}`);
                    done(err);
                }
            });

            // Event: Logged on → launch CS2
            this.client.once('loggedOn', () => {
                this.steamId = this.client.steamID.getSteamID64();
                this.isLoggedIn = true;
                console.log(`✅ Logged in as ${this.username} (${this.steamId})`);
                console.log(`🚀 Launching CS2 (app 730)...`);
                this.client.gamesPlayed([730], true);
            });

            // Event: GC ready
            const gcReadyHandler = () => {
                this.haveGCSession = true;
                console.log(`✅ Game Coordinator connected for ${this.username}`);
                clearTimeout(gcTimeout);
                done();
            };
            this.csgo.once('ready', gcReadyHandler);

            // Event: Error
            this.client.once('error', (err) => {
                console.error(`❌ Steam error for ${this.username}: ${err.message}`);
                done(err);
            });

            // Event: Disconnected before login
            this.client.once('disconnected', (eresult, msg) => {
                console.warn(`⚠️ Disconnected for ${this.username}: ${msg} (${eresult})`);
                done(new Error(`Disconnected: ${msg}`));
            });

            // GC connection timeout — proceed if logged in but GC slow
            const gcTimeout = setTimeout(() => {
                if (this.isLoggedIn) {
                    console.warn(`⏱️ GC timeout for ${this.username}, proceeding without GC session`);
                    done();
                }
            }, 15000);

            // Overall login timeout
            const loginTimeout = setTimeout(() => {
                done(new Error(`Login timeout for ${this.username}`));
            }, 30000);

            console.log(`📡 Connecting to Steam ${this.proxyUrl ? 'via SOCKS5 proxy' : 'directly'}...`);
            try {
                this.client.logOn({ accountName: this.username, password: this.password });
            } catch (err) {
                console.error(`❌ Connection failed: ${err.message}`);
                done(err);
            }
        });
    }

    logout() {
        if (this.client) {
            console.log(`👋 Logging out ${this.username}...`);
            this.haveGCSession = false;
            this.isLoggedIn = false;
            this.client.logOff();
        }
    }

    /**
     * Run a full connectivity check:
     * login → CS2 presence → GC readiness → logout
     * Returns a result object with status details.
     */
    async checkConnectivity() {
        const result = {
            username: this.username,
            loginOk: false,
            cs2Ok: false,
            gcOk: false,
            error: null
        };

        try {
            await this.login();
            result.loginOk = this.isLoggedIn;
            result.cs2Ok = this.isLoggedIn; // gamesPlayed(730) called on loggedOn
            result.gcOk = this.haveGCSession;
        } catch (err) {
            result.error = err.message;
        } finally {
            this.logout();
        }

        return result;
    }
}

module.exports = SteamBot;
