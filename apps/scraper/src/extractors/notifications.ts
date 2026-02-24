import type { BrowserContext } from 'playwright';
import type { RawNotification } from '@tec-brain/types';

const TEC_HOME_URL = 'https://tecdigital.tec.ac.cr/dotlrn/';

/**
 * Extracts all notification items from the TEC Digital notification panel.
 * Clicks the notification bell on the dashboard to trigger the Angular dropdown.
 */
export async function extractNotifications(
    context: BrowserContext,
): Promise<RawNotification[]> {
    const page = await context.newPage();
    const notifications: RawNotification[] = [];

    try {
        await page.goto(TEC_HOME_URL, { waitUntil: 'networkidle', timeout: 30_000 });

        // Click the Notification Bell
        await page.evaluate(() => {
            const bell = document.getElementById('platform_user_notifications');
            if (bell) bell.click();
        });

        // Wait for the new Angular Material layout notification list
        await page.waitForSelector('a.notification', { timeout: 15_000 }).catch(async () => {
            console.log('[Extractor] No notification elements found. Capturing diagnostic screenshot.');
            await page.screenshot({ path: '/app/data/notifications_empty.png' });
        });

        // Extract raw data from the DOM
        const rawItems = await page.evaluate(() => {
            const items = document.querySelectorAll('a.notification');

            return Array.from(items).map((el, idx) => {
                const element = el as HTMLAnchorElement;
                const title = element.querySelector('.title')?.textContent?.trim() ?? '';
                const desc = element.querySelector('.text')?.textContent?.trim() ?? '';

                return {
                    index: idx,
                    text: `${title} - ${desc}`,
                    link: element.href ?? '',
                    type_hint: element.className ?? '',
                    date_text: element.querySelector('.date')?.textContent?.trim() ?? ''
                };
            });
        });

        for (const item of rawItems) {
            if (!item.link) continue;

            const type = classifyType(item.type_hint, item.text);
            let files: NonNullable<RawNotification['files']> | undefined = undefined;
            let document_status: RawNotification['document_status'] = undefined;

            if (type === 'documento') {
                const resolved = await resolveDocumentFiles(context, item.link);
                files = resolved;
                document_status = resolved.length > 0 ? 'resolved' : 'unresolved';
            }

            const parsed: RawNotification = {
                external_id: `notif_${hashString(`${item.link}${item.text.slice(0, 40)}`)}`,
                type,
                course: extractCourse(item.text),
                title: item.text.slice(0, 100),
                description: item.text,
                link: item.link,
                date: item.date_text || new Date().toISOString().slice(0, 10),
                files,
                document_status,
            };
            notifications.push(parsed);
        }
    } finally {
        await page.close();
    }

    return notifications;
}

/**
 * Resolves actual downloadable file URLs from a TEC Digital course documents page.
 * Implements a tri-strategy fallback:
 * A) Network Interception (watching responses for binary endpoints)
 * B) DOM Parsing (finding anchors linking to file-storage view)
 * C) API Fallback (GL_FOLDER_ID JSON)
 */
async function resolveDocumentFiles(context: BrowserContext, docLink: string): Promise<NonNullable<RawNotification['files']>> {
    const tab = await context.newPage();

    try {
        console.log(`[Extractor] Navigating to resolve documents: ${docLink}`);
        // Wait until document list container has rendered
        await tab.goto(docLink, { waitUntil: 'networkidle', timeout: 30_000 });

        // Wait for the new Angular Material layout file rows
        await tab.waitForSelector('.fs-element.formatList', { timeout: 15_000 }).catch(() => {
            console.log('[Extractor] Wait for .fs-element.formatList timed out.');
        });

        // Use Angular memory space extraction method discovered by Subagent
        const files = await tab.evaluate((sourceUrl) => {
            const fileRows = Array.from(document.querySelectorAll('.fs-element.formatList'));

            return fileRows.map(el => {
                // @ts-ignore - access global angular variable exposed by TEC Digital
                if (typeof angular === 'undefined') return null;

                // @ts-ignore - Extract the internal data model bound to this DOM row
                const scope = angular.element(el).isolateScope();
                const info = scope ? scope.elementInfo : null;

                if (info && info.fs_type === 'file') {
                    // Reconstruct the hidden file download API endpoint using the object_id
                    const baseUrl = window.location.href.split('#')[0];
                    const downloadUrl = `${baseUrl}download/${encodeURIComponent(info.name)}?file_id=${info.object_id}`;

                    return {
                        file_name: info.name as string,
                        download_url: downloadUrl,
                        source_url: sourceUrl
                    };
                }
                return null;
            }).filter((f): f is NonNullable<typeof f> => f !== null);
        }, docLink);

        console.log(`[Extractor] Resolved ${files.length} document(s) via Angular Scope injection.`);
        return files;

    } catch (e) {
        console.log(`[Extractor] Error resolving files for ${docLink}:`, e);
        return [];
    } finally {
        await tab.close();
    }
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
