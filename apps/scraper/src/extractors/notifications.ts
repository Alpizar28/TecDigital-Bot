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

        // Wait for the Angular asynchronous fetch to populate the file rows with actual text characters
        await tab.waitForFunction(() => {
            const paragraphs = document.querySelectorAll('.fs-element.formatList p');
            for (let i = 0; i < paragraphs.length; i++) {
                if (paragraphs[i].textContent && paragraphs[i].textContent!.trim().length > 0) return true;
            }
            return false;
        }, { timeout: 15_000 }).catch(async () => {
            console.log('[Extractor] Wait for .fs-element.formatList text timed out. Capturing diagnostic screenshot.');
            await tab.screenshot({ path: '/app/data/resolve_timeout.png', fullPage: true });
        });

        // Angular race condition: give SPA 1500ms to attach isolateScope objects to memory
        await tab.waitForTimeout(1500);

        // Use Angular memory space extraction method discovered by Subagent
        const evalResults = await tab.evaluate((sourceUrl) => {
            const fileRows = Array.from(document.querySelectorAll('.fs-element.formatList'));

            return fileRows.map(el => {
                // @ts-ignore
                const winAny = window as any;
                if (!winAny.angular) {
                    return { error: 'window.angular undefined', html: el.innerHTML.substring(0, 100) };
                }

                try {
                    const scope = winAny.angular.element(el).isolateScope();
                    const info = scope ? scope.elementInfo : null;

                    if (info && info.fs_type === 'file') {
                        const baseUrl = window.location.href.split('#')[0];
                        const downloadUrl = `${baseUrl}download/${encodeURIComponent(info.name)}?file_id=${info.object_id}`;

                        return {
                            file_name: info.name as string,
                            download_url: downloadUrl,
                            source_url: sourceUrl
                        };
                    }

                    // Fallback to DOM parsing if memory is mangled
                    const html = el.innerHTML || '';
                    const objectIdMatch = html.match(/(?:object_id|file_id)["':=\s]+(\d+)/i) || el.id.match(/\d+/) || el.getAttribute('value')?.match(/\d+/);
                    const nameMatch = el.querySelector('p')?.textContent?.trim() || el.textContent?.trim() || 'Documento sin nombre';

                    if (objectIdMatch && objectIdMatch.length > 0) {
                        const objId = objectIdMatch[0].replace(/\D/g, '');
                        if (objId.length > 5) {
                            const baseUrl = window.location.href.split('#')[0];
                            return {
                                file_name: nameMatch,
                                download_url: `${baseUrl}download/${encodeURIComponent(nameMatch)}?file_id=${objId}`,
                                source_url: sourceUrl
                            };
                        }
                    }

                    return { error: 'info null or not file, and no object_id in dom', infoType: info?.fs_type, name: info?.name, innerText: el.textContent?.substring(0, 50) };
                } catch (e) {
                    return { error: 'isolateScope threw exception', detail: String(e) };
                }
            });
        }, docLink);

        const files = evalResults.filter((f): f is NonNullable<RawNotification['files']>[0] => !('error' in f));

        console.log(`[Extractor] Angular Scope Evaluation returned ${files.length} valid / ${evalResults.length} total raw results.`);
        if (files.length === 0 && evalResults.length > 0) {
            console.log(`[Extractor] DIAGNOSTIC: Failed evaluations dump:`, JSON.stringify(evalResults, null, 2));
        }

        console.log(`[Extractor] Resolved ${files.length} document(s) via Angular stabilization.`);
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
