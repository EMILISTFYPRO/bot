const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const GlobalOffensive = require('globaloffensive');

class SteamBot {
    constructor(username, password, sharedSecret, options = {}) {
        this.username = username;
        this.password = password;
        this.sharedSecret = sharedSecret || null;

        const clientOptions = {};
        if (options.proxy) {
            try {
                let socksUrl = options.proxy;
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

    login() {
        return new Promise((resolve, reject) => {
            let gcTimeout = null;

            const onLoggedOn = () => {
                this.isLoggedIn = true;
                this.steamId = this.client.steamID ? this.client.steamID.getSteamID64() : null;
                console.log(`✅ Logged in as ${this.username} (${this.steamId})`);

                // Launch CS2
                this.client.gamesPlayed([730], true);

                // Wait up to 15 s for GC; fall through if it never connects
                gcTimeout = setTimeout(() => {
                    if (!this.haveGCSession) {
                        console.warn(`⏱️ GC timeout for ${this.username}, proceeding with login only`);
                        cleanup();
                        resolve();
                    }
                }, 15000);
            };

            const onGCReady = () => {
                this.haveGCSession = true;
                console.log(`✅ Game Coordinator connected for ${this.username}`);
                cleanup();
                resolve();
            };

            const onError = (err) => {
                console.error(`❌ Steam error for ${this.username}: ${err.message}`);
                cleanup();
                reject(err);
            };

            const onSteamGuard = (domain, callback) => {
                if (!this.sharedSecret) {
                    cleanup();
                    return reject(new Error(`Steam Guard required but no shared_secret provided for ${this.username}`));
                }
                try {
                    const code = SteamTotp.generateAuthCode(this.sharedSecret);
                    callback(code);
                } catch (err) {
                    cleanup();
                    reject(new Error(`Failed to generate TOTP code: ${err.message}`));
                }
            };

            const cleanup = () => {
                if (gcTimeout) clearTimeout(gcTimeout);
                this.client.removeListener('loggedOn', onLoggedOn);
                this.client.removeListener('error', onError);
                this.client.removeListener('steamGuard', onSteamGuard);
                this.csgo.removeListener('ready', onGCReady);
            };

            this.client.on('loggedOn', onLoggedOn);
            this.client.on('error', onError);
            this.client.on('steamGuard', onSteamGuard);
            this.csgo.on('ready', onGCReady);

            this.client.logOn({
                accountName: this.username,
                password: this.password
            });
        });
    }

    /**
     * Check connectivity: login, verify CS2 app is present, check GC readiness, then logout.
     * Returns a status object.
     */
    async checkConnectivity() {
        const result = {
            username: this.username,
            steamId: null,
            loginOk: false,
            cs2Present: false,
            gcReady: false,
            logoutOk: false,
            error: null
        };

        try {
            await this.login();
            result.loginOk = true;
            result.steamId = this.steamId;
            result.cs2Present = this.haveGCSession; // GC connectivity implies CS2 is present
            result.gcReady = this.haveGCSession;
        } catch (err) {
            result.error = err.message;
        } finally {
            try {
                this.logout();
                result.logoutOk = true;
            } catch (_) {
                result.logoutOk = false;
            }
        }

        return result;
    }

    logout() {
        if (this.client) {
            this.haveGCSession = false;
            this.isLoggedIn = false;
            this.client.logOff();
            console.log(`👋 Logged out ${this.username}`);
        }
    }
}

module.exports = SteamBot;
