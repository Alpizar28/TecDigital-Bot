import axios from 'axios';
import { getActiveUsers, decrypt } from '@tec-brain/database';
import { TelegramService } from '@tec-brain/telegram';
import { DriveService } from '@tec-brain/drive';
import { dispatch } from './dispatcher.js';
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

        for (const user of users) {
            try {
                await processUser(user);
            } catch (err) {
                // Per-user error: log and continue with next user
                console.error(`[Orchestrator] Error processing user ${user.name}:`, err);
            }
        }
    } finally {
        running = false;
        console.log('[Orchestrator] Cycle complete.');
    }
}

async function processUser(user: ReturnType<typeof getActiveUsers> extends Promise<infer T> ? T[0] : never): Promise<void> {
    console.log(`[Orchestrator] Scraping for: ${user.name} (${user.tec_username})`);

    const password = decrypt(user.tec_password_enc);

    const response = await axios.post<ScrapeResponse>(
        `${SCRAPER_URL}/scrape/${user.id}`,
        { username: user.tec_username, password },
        { timeout: 120_000 },
    );

    if (response.data.status === 'error') {
        throw new Error(`Scraper returned error: ${response.data.error}`);
    }

    const { notifications, cookies } = response.data;
    console.log(`[Orchestrator] Got ${notifications.length} notifications for ${user.name}`);

    for (const notification of notifications) {
        try {
            await dispatch(user, notification, cookies, telegram, drive);
        } catch (err) {
            console.error(
                `[Orchestrator] Dispatch error for notification ${notification.external_id}:`,
                err,
            );
        }
    }
}
