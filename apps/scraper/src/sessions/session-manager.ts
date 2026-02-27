import fs from 'fs';
import path from 'path';
import { TecHttpClient } from '../clients/tec-http.client.js';

/**
 * Manages HTTP clients per user.
 * Sessions are persisted to disk in `sessionDir/{username}.json`.
 */
export class SessionManager {
    private readonly sessionDir: string;

    constructor(sessionDir: string) {
        this.sessionDir = sessionDir;
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    private sessionPath(username: string): string {
        const safe = username.replace(/[^a-zA-Z0-9@._-]/g, '_');
        return path.join(this.sessionDir, `${safe}.json`);
    }

    private loadSavedCookies(username: string): any[] | null {
        const p = this.sessionPath(username);
        if (!fs.existsSync(p)) return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch {
            return null;
        }
    }

    private saveCookies(username: string, cookies: any[]): void {
        fs.writeFileSync(this.sessionPath(username), JSON.stringify(cookies, null, 2));
    }

    /**
     * Returns an authenticated HTTP client.
     * Tries to restore from disk first. Falls back to fresh login.
     */
    async getClient(username: string, password: string): Promise<TecHttpClient> {
        const client = new TecHttpClient();

        const saved = this.loadSavedCookies(username);
        if (saved && saved.length > 0) {
            // Restore tough-cookie jar
            for (const c of saved) {
                // toughcookie format expects a string like "key=value"
                // The URL is usually the origin or the specific path.
                const cookieStr = `${c.key}=${c.value}; Domain=${c.domain}; Path=${c.path}`;
                await client.jar.setCookie(cookieStr, `https://${c.domain}${c.path}`);
            }

            const isValid = await this.validateSession(client);
            if (isValid) {
                console.log(`[Session] Restored API session for: ${username}`);
                return client;
            }
            console.log(`[Session] Saved API session expired. Re-logging in: ${username}`);
            // Clearing the jar for a fresh login
            client.jar.removeAllCookiesSync();
        }

        await this.login(client, username, password);
        return client;
    }

    private async validateSession(client: TecHttpClient): Promise<boolean> {
        try {
            // A quick check to the internal API
            const res = await client.client.get('https://tecdigital.tec.ac.cr/tda-notifications/ajax/has_unread_notifications?');
            return res.status === 200 && typeof res.data === 'object';
        } catch {
            return false;
        }
    }

    async login(client: TecHttpClient, username: string, password: string): Promise<void> {
        console.log(`[Session] Performing API login for: ${username}`);

        const success = await client.login(username, password);

        if (!success) {
            throw new Error('Login fallido: Credenciales inválidas o acceso denegado por API');
        }

        const rawCookies = await client.jar.getCookies('https://tecdigital.tec.ac.cr/');

        this.saveCookies(
            username,
            rawCookies.map((c) => ({ key: c.key, value: c.value, domain: c.domain, path: c.path }))
        );

        console.log(`[Session] API Login successful and session saved for: ${username}`);
    }

    async getCookies(client: TecHttpClient): Promise<any[]> {
        const raw = await client.jar.getCookies('https://tecdigital.tec.ac.cr/');
        return raw.map((c) => ({ name: c.key, value: c.value, domain: c.domain, path: c.path }));
    }
}
