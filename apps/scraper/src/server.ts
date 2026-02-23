import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { chromium, type Browser } from 'playwright';
import { SessionManager } from './sessions/session-manager.js';
import { extractNotifications } from './extractors/notifications.js';
import type { ScrapeResponse } from '@tec-brain/types';

const SESSION_DIR = process.env.SESSION_DIR ?? './data/sessions';

let globalBrowser: Browser | null = null;
let sessionManager: SessionManager;

async function ensureBrowser(): Promise<Browser> {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        globalBrowser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        globalBrowser.on('disconnected', () => {
            console.log('[Browser] Browser disconnected');
            globalBrowser = null;
        });
    }
    return globalBrowser;
}

export function buildServer(): FastifyInstance {
    const fastify = Fastify({
        logger: {
            level: process.env.LOG_LEVEL ?? 'info',
        },
    });

    void fastify.register(sensible);

    sessionManager = new SessionManager(SESSION_DIR);

    // ── Health Check ──────────────────────────────────────────────────────────
    fastify.get('/health', async (_, reply) => {
        return reply.send({ status: 'ok', uptime_s: Math.floor(process.uptime()) });
    });

    // ── Scrape Endpoint ───────────────────────────────────────────────────────
    fastify.post<{
        Params: { userId: string };
        Body: { username: string; password: string; keywords?: string[] };
    }>(
        '/scrape/:userId',
        {
            schema: {
                params: {
                    type: 'object',
                    properties: { userId: { type: 'string' } },
                    required: ['userId'],
                },
                body: {
                    type: 'object',
                    properties: {
                        username: { type: 'string' },
                        password: { type: 'string' },
                        keywords: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['username', 'password'],
                },
            },
        },
        async (request, reply): Promise<ScrapeResponse> => {
            const { userId } = request.params;
            const { username, password, keywords = [] } = request.body;

            try {
                const browser = await ensureBrowser();
                const context = await sessionManager.getContext(browser, username, password);
                let notifications = await extractNotifications(context);

                // Apply keyword filter if provided
                if (keywords.length > 0) {
                    notifications = notifications.filter((n) =>
                        keywords.some((kw) =>
                            n.course.toLowerCase().includes(kw.toLowerCase()),
                        ),
                    );
                }

                const cookies = await sessionManager.getCookies(context);

                return reply.send({
                    status: 'success',
                    user_id: userId,
                    notifications,
                    cookies,
                } satisfies ScrapeResponse);
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                request.log.error({ err, userId }, 'Scrape failed');

                // If login fails, clear the cached context so next request tries fresh
                sessionManager.closeContext(username);

                return reply.status(500).send({
                    status: 'error',
                    user_id: userId,
                    notifications: [],
                    cookies: [],
                    error,
                } satisfies ScrapeResponse);
            }
        },
    );

    fastify.addHook('onClose', async () => {
        if (globalBrowser) {
            await globalBrowser.close();
        }
    });

    return fastify;
}
