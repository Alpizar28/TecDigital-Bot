import type { BrowserContext } from 'playwright';
import type { RawNotification } from '@tec-brain/types';

const TEC_NOTIFICATIONS_URL = 'https://tecdigital.tec.ac.cr/dotlrn/notifications';

/**
 * Extracts all notification items from the TEC Digital notification panel.
 * Navigates to the notifications URL and parses the AngularJS-rendered list.
 */
export async function extractNotifications(
    context: BrowserContext,
): Promise<RawNotification[]> {
    const page = await context.newPage();
    const notifications: RawNotification[] = [];

    try {
        await page.goto(TEC_NOTIFICATIONS_URL, { waitUntil: 'networkidle', timeout: 30_000 });

        // Wait for Angular to render the notification list
        await page.waitForSelector('.notification-item, [ng-repeat]', { timeout: 15_000 }).catch(() => {
            console.log('[Extractor] No notification elements found.');
        });

        // Extract raw data from the DOM
        const rawItems = await page.evaluate(() => {
            const items = document.querySelectorAll('.notification-item, [ng-repeat] .item');

            return Array.from(items).map((el, idx) => ({
                index: idx,
                text: el.textContent?.trim() ?? '',
                link: (el.querySelector('a') as HTMLAnchorElement | null)?.href ?? '',
                type_hint: el.className ?? '',
                date_text:
                    (el.querySelector('.date, .fecha, time') as HTMLElement | null)?.textContent?.trim() ??
                    '',
            }));
        });

        for (const item of rawItems) {
            if (!item.link) continue;

            const type = classifyType(item.type_hint, item.text);
            const parsed: RawNotification = {
                external_id: `notif_${hashString(`${item.link}${item.text.slice(0, 40)}`)}`,
                type,
                course: extractCourse(item.text),
                title: item.text.slice(0, 100),
                description: item.text,
                link: item.link,
                date: item.date_text || new Date().toISOString().slice(0, 10),
                files: type === 'documento' ? [] : undefined,
            };
            notifications.push(parsed);
        }
    } finally {
        await page.close();
    }

    return notifications;
}

function classifyType(className: string, text: string): RawNotification['type'] {
    const lower = `${className} ${text}`.toLowerCase();
    if (lower.includes('evaluaci') || lower.includes('tarea') || lower.includes('examen')) {
        return 'evaluacion';
    }
    if (lower.includes('documento') || lower.includes('archivo') || lower.includes('material')) {
        return 'documento';
    }
    return 'noticia';
}

function extractCourse(text: string): string {
    // Heuristic: TEC notifications usually start with the course name
    const match = text.match(/^([^:–\-\n]{5,60}?)[\s:–\-]/);
    return match?.[1]?.trim() ?? 'Curso Desconocido';
}

function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}
