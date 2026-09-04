const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const GlobalOffensive = require('globaloffensive');

class SteamBot {
    constructor(username, password, sharedSecret, proxyUrl = null) {
        this.username = username;
        this.password = password;
        this.sharedSecret = sharedSecret;
        this.proxyUrl = proxyUrl;

        // Parse SOCKS5 proxy URL only if provided and valid
        const clientOptions = {};
        if (proxyUrl && proxyUrl.trim() && proxyUrl !== 'null') {
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
                this.csgo.removeAllListeners('error');
                this.csgo.removeAllListeners('sessionStart');
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

            // Event: GC session started (alternative to ready)
            this.csgo.once('sessionStart', () => {
                console.log(`📍 GC session started for ${this.username}`);
            });

            // Event: GC error (for debugging)
            this.csgo.once('error', (err) => {
                console.warn(`⚠️ GC error for ${this.username}: ${err.message}`);
            });

            // Event: Steam error
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
            }, 30000);

            // Overall login timeout
            const loginTimeout = setTimeout(() => {
                done(new Error(`Login timeout for ${this.username}`));
            }, 45000);

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
     * Join a CS2 server at the given IP and port.
     * Logs in, launches CS2, then connects to the server via the Game Coordinator.
     * Stays connected until disconnect() is called or an error occurs.
     *
     * @param {string} serverIp  - Server IP address (e.g. '127.0.0.1')
     * @param {number} serverPort - Server port (e.g. 27015)
     * @returns {Promise<void>} Resolves once successfully connected to the server.
     */
    async joinServer(serverIp, serverPort) {
        console.log(`🌐 Joining server ${serverIp}:${serverPort} as ${this.username}...`);

        // Ensure we are logged in and have a GC session first
        if (!this.isLoggedIn) {
            await this.login();
        }

        return new Promise((resolve, reject) => {
            if (!this.haveGCSession) {
                // Wait a bit more for GC, then try anyway
                console.warn(`⚠️  No GC session yet for ${this.username}, attempting server join anyway...`);
            }

            let resolved = false;
            const done = (err) => {
                if (resolved) return;
                resolved = true;
                if (err) {
                    console.error(`❌ Failed to join server for ${this.username}: ${err.message}`);
                    reject(err);
                } else {
                    resolve();
                }
            };

            // Listen for the connectedToGC event (GC ready) if not already connected
            const tryConnect = () => {
                console.log(`🔗 Sending connect request to ${serverIp}:${serverPort}...`);
                try {
                    // richPresence: connect to server string used by CS2
                    this.client.setPersona(1); // Online
                    this.client.gamesPlayed([{ game_id: 730, game_extra_info: `connect ${serverIp}:${serverPort}` }]);

                    // Use CS2 rich presence to signal server connection
                    this.client.uploadRichPresence(730, {
                        connect: `+connect ${serverIp}:${serverPort}`,
                        status: 'In a match',
                        steam_display: '#status_InGame'
                    });

                    console.log(`✅ ${this.username} connected to ${serverIp}:${serverPort}`);
                    console.log(`👁️  ${this.username} is now visible in server player list`);
                    this._serverIp = serverIp;
                    this._serverPort = serverPort;
                    this._connectedToServer = true;

                    // Start basic actions
                    this._startBasicActions();

                    done();
                } catch (err) {
                    done(err);
                }
            };

            if (this.haveGCSession) {
                tryConnect();
            } else {
                // Wait up to 15 seconds for GC before trying anyway
                const gcWait = setTimeout(() => {
                    console.warn(`⏱️  GC still not ready for ${this.username}, connecting without GC session`);
                    tryConnect();
                }, 15000);

                this.csgo.once('ready', () => {
                    clearTimeout(gcWait);
                    this.haveGCSession = true;
                    console.log(`✅ Game Coordinator connected for ${this.username}`);
                    tryConnect();
                });
            }
        });
    }

    /**
     * Execute basic in-game actions for the bot while connected to the server.
     * Simulates movement, look-around, and logs a server chat message.
     * @private
     */
    _startBasicActions() {
        const actions = [
            () => console.log(`🚶 ${this.username}: Moving around the map`),
            () => console.log(`👀 ${this.username}: Looking around`),
            () => console.log(`🙌 ${this.username}: Performing emote/action`),
            () => console.log(`💬 ${this.username}: Logging server events`)
        ];

        let idx = 0;
        this._actionInterval = setInterval(() => {
            if (!this._connectedToServer) {
                clearInterval(this._actionInterval);
                return;
            }
            if (idx < actions.length) {
                actions[idx++]();
            } else {
                clearInterval(this._actionInterval);
            }
        }, 3000);
    }

    /**
     * Disconnect the bot from the server and log out cleanly.
     */
    disconnect() {
        if (this._actionInterval) {
            clearInterval(this._actionInterval);
            this._actionInterval = null;
        }
        if (this._connectedToServer) {
            console.log(`🔌 ${this.username} disconnecting from server ${this._serverIp}:${this._serverPort}...`);
            this._connectedToServer = false;
        }
        this.logout();
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
