import fs from 'fs';
import path from 'path';
import type { Browser, BrowserContext, Cookie } from 'playwright';
import type { Cookie as AppCookie } from '@tec-brain/types';

const TEC_LOGIN_URL = 'https://tecdigital.tec.ac.cr/dotlrn/';
const TEC_HOME_URL = 'https://tecdigital.tec.ac.cr/dotlrn/';

/**
 * Manages browser sessions per user.
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

    private loadSavedCookies(username: string): AppCookie[] | null {
        const p = this.sessionPath(username);
        if (!fs.existsSync(p)) return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8')) as AppCookie[];
        } catch {
            return null;
        }
    }

    private saveCookies(username: string, cookies: AppCookie[]): void {
        fs.writeFileSync(this.sessionPath(username), JSON.stringify(cookies, null, 2));
    }

    /**
     * Returns an authenticated browser context.
     * Tries to restore from disk first. Falls back to fresh login.
     */
    async getContext(browser: Browser, username: string, password: string): Promise<BrowserContext> {
        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        });

        const saved = this.loadSavedCookies(username);
        if (saved && saved.length > 0) {
            await context.addCookies(saved as Parameters<BrowserContext['addCookies']>[0]);
            const isValid = await this.validateSession(context);
            if (isValid) {
                console.log(`[Session] Restored session for: ${username}`);
                return context;
            }
            console.log(`[Session] Saved session expired. Re-logging in: ${username}`);
        }

        await this.login(context, username, password);
        return context;
    }

    private async validateSession(context: BrowserContext): Promise<boolean> {
        const page = await context.newPage();
        try {
            await page.goto(TEC_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            const isLoggedIn = await page.evaluate(() => {
                return !document.querySelector('form[action*="login"]');
            });
            return isLoggedIn;
        } catch {
            return false;
        } finally {
            await page.close();
        }
    }

    async login(context: BrowserContext, username: string, password: string): Promise<void> {
        const page = await context.newPage();
        try {
            console.log(`[Session] Performing login for: ${username}`);
            await page.goto(TEC_LOGIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });

            const userSelector = '#mail-input';
            const passSelector = '#password-input';
            const userField = await page.$(userSelector);
            if (!userField) throw new Error('DOM Error: Formulario de login no encontrado');

            await page.fill(userSelector, username);
            await page.fill(passSelector, password);
            await page.press(passSelector, 'Enter');

            try {
                await page.waitForSelector('#btnSync', { state: 'visible', timeout: 20000 });
            } catch (error) {
                const loginStillPresent = await page.$(userSelector);
                if (loginStillPresent) {
                    throw new Error('Login fallido: Credenciales inválidas o acceso denegado');
                }
                throw new Error('Login transition failed: Dashboard element #btnSync not found after submit');
            }
            await page.waitForLoadState('networkidle', { timeout: 15_000 });

            const cookies = await context.cookies();
            this.saveCookies(
                username,
                cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })),
            );
            console.log(`[Session] Login successful and session saved for: ${username}`);
        } finally {
            await page.close();
        }
    }

    async getCookies(context: BrowserContext): Promise<AppCookie[]> {
        const raw = await context.cookies();
        return raw.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
    }
}
