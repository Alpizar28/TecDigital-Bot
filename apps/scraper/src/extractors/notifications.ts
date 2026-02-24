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

            return Array.from(items).map((el, idx) => {
                const element = el as HTMLElement;
                return {
                    index: idx,
                    text: element.textContent?.trim() ?? '',
                    link: (element.querySelector('a') as HTMLAnchorElement | null)?.href ?? '',
                    type_hint: element.className ?? '',
                    date_text:
                        (element.querySelector('.date, .fecha, time') as HTMLElement | null)?.textContent?.trim() ??
                        '',
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
    const interceptedUrls: string[] = [];

    // Strategy A: Network Interception (attach before navigation)
    tab.on('response', (response) => {
        const url = response.url();
        const type = response.headers()['content-type'] ?? '';
        if (
            url.includes('/file-storage/download') ||
            type.includes('application/pdf') ||
            type.includes('application/vnd') ||
            type.includes('octet-stream')
        ) {
            interceptedUrls.push(url);
        }
    });

    try {
        console.log(`[Extractor] Navigating to resolve documents: ${docLink}`);
        // Allow time for SPA rendering, network idle
        await tab.goto(docLink, { waitUntil: 'networkidle', timeout: 25000 });

        const files: NonNullable<RawNotification['files']> = [];

        // Strategy B: DOM Parsing
        const domFiles = await tab.evaluate((sourceUrl) => {
            const fileLinks = document.querySelectorAll('a[href*="file-storage/view"], a[href*="file-storage/download"]');
            return Array.from(fileLinks)
                .map(link => {
                    const el = link as HTMLAnchorElement;
                    return {
                        file_name: el.textContent?.trim() || 'Documento sin nombre',
                        download_url: el.href,
                        source_url: sourceUrl
                    };
                })
                .filter(f => f.file_name.length > 0);
        }, docLink);

        if (domFiles.length > 0) {
            console.log(`[Extractor] Resolved ${domFiles.length} file(s) via DOM Strategy.`);
            return domFiles;
        }

        // Check if Strategy A caught anything if DOM had no explicit UI anchors
        if (interceptedUrls.length > 0) {
            console.log(`[Extractor] Resolved via Network Interception Strategy.`);
            return interceptedUrls.map((url, idx) => ({
                file_name: `Documento_${idx + 1}`,
                download_url: url,
                source_url: docLink
            }));
        }

        // Strategy C: API Fallback (GL_FOLDER_ID parsing)
        const folderId = await tab.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const s of scripts) {
                const el = s as HTMLElement;
                const m = el.textContent?.match(/GL_FOLDER_ID\s*=\s*(\d+)/);
                if (m) return m[1];
            }
            return null;
        });

        if (folderId) {
            const apiUrl = `/dotlrn/file-storage/files-api?folder_id=${folderId}`;
            const result = await tab.evaluate(async (url) => {
                try {
                    const res = await fetch(url, { credentials: 'include' });
                    const text = await res.text();
                    return { status: res.status, body: text.substring(0, 2000) };
                } catch (e) {
                    return { status: 0, body: String(e) };
                }
            }, apiUrl);

            try {
                const data = JSON.parse(result.body) as any;
                const items = Array.isArray(data) ? data : (data.files || data.items || []);

                const fallbackFiles = items
                    .filter((f: any) => f.name && (f.url || f.download_url || f.href))
                    .map((f: any) => ({
                        file_name: String(f.name),
                        download_url: String((f.url || f.download_url || f.href)).startsWith('http')
                            ? String((f.url || f.download_url || f.href))
                            : 'https://tecdigital.tec.ac.cr' + String((f.url || f.download_url || f.href)),
                        source_url: docLink
                    }));

                if (fallbackFiles.length > 0) {
                    console.log(`[Extractor] Resolved ${fallbackFiles.length} file(s) via API Fallback Strategy.`);
                    return fallbackFiles;
                }
            } catch {
                console.log('[Extractor] Response is not JSON in Fallback Strategy.');
            }
        }

        console.log(`[Extractor] All strategies failed for ${docLink}. Returning empty.`);
        return [];
    } catch (e) {
        console.log(`[Extractor] Error resolving files for ${docLink}: ${String(e)}`);
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
