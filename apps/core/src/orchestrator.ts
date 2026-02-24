import axios from 'axios';
import { getActiveUsers, decrypt } from '@tec-brain/database';
import { TelegramService } from '@tec-brain/telegram';
import { DriveService } from '@tec-brain/drive';
import { dispatch } from './dispatcher.js';
import pLimit from 'p-limit';
import type { ScrapeResponse } from '@tec-brain/types';

const SCRAPER_URL = process.env.SCRAPER_URL ?? 'http://scraper:3001';

// Singletons shared across cron invocations
const telegram = new TelegramService(process.env.TELEGRAM_BOT_TOKEN ?? '');
const drive = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH
    ? new DriveService(process.env.GOOGLE_DRIVE_CREDENTIALS_PATH)
    : null;

let running = false;

/**
 * Main orchestration cycle.
 * Fetches active users, calls the scraper, and dispatches each notification.
 */
export async function runOrchestrationCycle(): Promise<void> {
    if (running) {
        console.log('[Orchestrator] Cycle already in progress. Skipping.');
        return;
    }
    running = true;
    console.log('[Orchestrator] Starting orchestration cycle...');

    try {
        const users = await getActiveUsers();
        console.log(`[Orchestrator] Processing ${users.length} active users.`);

        const concurrencyLimit = parseInt(process.env.CORE_CONCURRENCY ?? '3', 10);
        console.log(`[Orchestrator] Concurrency level: ${concurrencyLimit}`);
        const limit = pLimit(concurrencyLimit);

        const tasks = users.map((user) =>
            limit(async () => {
                try {
                    await processUser(user);
                } catch (err) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    console.error(JSON.stringify({
                        level: 'ERROR',
                        user_id: user.id,
                        action: 'scrape_failed',
                        error_message: errorMsg,
                    }));
                }
            })
        );

        await Promise.all(tasks);

    } finally {
        running = false;
        console.log('[Orchestrator] Cycle complete.');
    }
}

async function processUser(user: Awaited<ReturnType<typeof getActiveUsers>>[0]): Promise<void> {
    console.log(`[Orchestrator] Scraping for: ${user.name} (${user.tec_username})`);

    const password = decrypt(user.tec_password_enc);

    const response = await axios.post<ScrapeResponse>(
        `${SCRAPER_URL}/scrape/${user.id}`,
        { username: user.tec_username, password },
        { timeout: 120_000 },
    );

    if (response.data.status === 'error') {
        throw new Error(response.data.error || 'Unknown scraper error');
    }

    const { notifications, cookies } = response.data;
    console.log(`[Orchestrator] Got ${notifications.length} notifications for ${user.name}`);

    for (const notification of notifications) {
        try {
            await dispatch(user, notification, cookies, telegram, drive);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(JSON.stringify({
                level: 'ERROR',
                user_id: user.id,
                external_id: notification.external_id,
                type: notification.type,
                action: 'dispatch_wrapper',
                error_message: errorMsg,
            }));
        }
    }
}
