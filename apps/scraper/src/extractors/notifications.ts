import { TecHttpClient } from '../clients/tec-http.client.js';
import type { RawNotification } from '@tec-brain/types';
import * as cheerio from 'cheerio';
import axios from 'axios';

/**
 * Extracts all notification items from the TEC Digital notification panel via secure internal API.
 */
export async function extractNotifications(
    client: TecHttpClient
): Promise<RawNotification[]> {
    const notifications: RawNotification[] = [];

    try {
        console.log('[Extractor] Fetching unread JSON from API...');
        // Prime the session correctly as the browser does
        await client.client.get('https://tecdigital.tec.ac.cr/tda-notifications/ajax/has_unread_notifications?');

        // Fetch raw list
        const notifRes = await client.client.get('https://tecdigital.tec.ac.cr/tda-notifications/ajax/get_user_notifications?');

        if (notifRes.status === 200 && notifRes.data && Array.isArray(notifRes.data.notifications)) {
            let index = 0;
            for (const item of notifRes.data.notifications) {
                index++;
                const text = item.text || '';
                const type = classifyType(item.type_hint || '', text);
                const link = item.url || '';
                const date_text = item.date_text || '';

                let files: NonNullable<RawNotification['files']> | undefined = undefined;
                let document_status: RawNotification['document_status'] = undefined;

                if (link && type === 'documento') {
                    const resolved = await resolveDocumentFiles(client, link);
                    files = resolved;
                    document_status = resolved.length > 0 ? 'resolved' : 'unresolved';
                }

                const parsed: RawNotification = {
                    external_id: `notif_${hashString(`${link}${text.slice(0, 40)}`)}`,
                    type,
                    course: extractCourse(text),
                    title: text.split(' - ')[0] || text.slice(0, 100),
                    description: text,
                    link,
                    date: date_text || new Date().toISOString().slice(0, 10),
                    files,
                    document_status,
                };
                notifications.push(parsed);
            }
        }
    } catch (e) {
        console.error('[Extractor] Error fetching API notifications:', e instanceof Error ? e.message : String(e));
    }

    return notifications;
}

/**
 * Validates, formats, and pushes individual notifications to Core sequentially.
 * If Core returns 200 OK, calls the delete API endpoint so they are not pulled twice.
 */
export async function processNotificationsSequentially(
    client: TecHttpClient,
    userId: string,
    dispatchUrl: string,
    cookies: any[],
    keywords: string[] = []
): Promise<void> {

    try {
        console.log('[Extractor] Sequential Push: Fetching unread JSON from API...');
        await client.client.get('https://tecdigital.tec.ac.cr/tda-notifications/ajax/has_unread_notifications?');
        const notifRes = await client.client.get('https://tecdigital.tec.ac.cr/tda-notifications/ajax/get_user_notifications?');

        if (notifRes.status !== 200 || !notifRes.data || !Array.isArray(notifRes.data.notifications)) {
            console.log('[Extractor] Could not retrieve notifications via JSON.');
            return;
        }

        const items = notifRes.data.notifications;
        console.log(`[Extractor] Sequential Push: Found ${items.length} notifications.`);

        let index = 0;
        for (const item of items) {
            index++;
            try {
                const text = item.text || '';
                const type = classifyType(item.type_hint || '', text);
                const course = extractCourse(text);
                const link = item.url || '';

                if (!link) continue;

                if (keywords.length > 0 && !keywords.some(kw => course.toLowerCase().includes(kw.toLowerCase()))) {
                    console.log(`[Extractor] Skipping notification ${index} (filtered by keywords)`);
                    continue;
                }

                let files: NonNullable<RawNotification['files']> | undefined = undefined;
                let document_status: RawNotification['document_status'] = undefined;

                if (type === 'documento') {
                    const resolved = await resolveDocumentFiles(client, link);
                    files = resolved;
                    document_status = resolved.length > 0 ? 'resolved' : 'unresolved';
                }

                const parsed: RawNotification = {
                    external_id: `notif_${hashString(`${link}${text.slice(0, 40)}`)}`,
                    type,
                    course,
                    title: text.split(' - ')[0] || text.slice(0, 100),
                    description: text,
                    link,
                    date: item.date_text || new Date().toISOString().slice(0, 10),
                    files,
                    document_status,
                };

                // Dispatch to Core internally
                const response = await axios.post(dispatchUrl, {
                    userId,
                    notification: parsed,
                    cookies,
                }, { timeout: 120_000 });

                if (response.status === 200) {
                    console.log(`[Extractor] Dispatch success for ${parsed.external_id}. Attempting API Delete.`);

                    // Call the API delete endpoint using the JSON item internal ID
                    if (item.id) {
                        try {
                            const delUrl = `https://tecdigital.tec.ac.cr/tda-notifications/ajax/notification_delete?notification_id=${item.id}`;
                            const delRes = await client.client.get(delUrl);
                            if (delRes.status === 200) {
                                console.log(`[Extractor] Successfully deleted notification ${item.id} from TEC Digital`);
                            } else {
                                console.log(`[Extractor] Delete API returned status ${delRes.status}.`);
                            }
                        } catch (e) {
                            console.log(`[Extractor] Delete API Error:`, e instanceof Error ? e.message : String(e));
                        }
                    } else {
                        console.log(`[Extractor] Missing JSON ID for notification to delete.`);
                    }
                } else {
                    console.log(`[Extractor] Dispatch returned status ${response.status}. Skipping delete.`);
                }
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.log(`[Extractor] Error processing notification ${index}:`, errMsg);
            }
        }
    } catch (e) {
        console.log(`[Extractor] Error in sequential processor:`, e instanceof Error ? e.message : String(e));
    }
}

/**
 * Resolves actual downloadable file URLs purely using HTTP GET.
 * Implements Cheerio parsing and Regex matching to extract object_id from Angular HTML structure.
 */
async function resolveDocumentFiles(client: TecHttpClient, docLink: string): Promise<NonNullable<RawNotification['files']>> {
    try {
        let completeUrl = docLink.trim();
        if (!completeUrl.startsWith('http')) {
            completeUrl = `https://tecdigital.tec.ac.cr${completeUrl.startsWith('/') ? '' : '/'}${completeUrl}`;
        }

        const files: NonNullable<RawNotification['files']> = [];

        // If the URL has an Angular hash fragment like #/12345#/, it's a folder ID
        const folderMatch = completeUrl.match(/#\/(\d+)#\//);

        if (folderMatch) {
            const folderId = folderMatch[1];
            console.log(`[Extractor] Detected folder ID ${folderId}. Querying internal folder-chunk API...`);

            const folderApiUrl = `https://tecdigital.tec.ac.cr/dotlrn/file-storage/view/folder-chunk?folder_id=${folderId}`;
            const folderRes = await client.client.get(folderApiUrl, {
                headers: { 'Accept': 'application/json, text/plain, */*' }
            });

            if (folderRes.status === 200 && Array.isArray(folderRes.data)) {
                for (const fileItem of folderRes.data) {
                    if (fileItem.file_id && fileItem.type === 'file') {
                        files.push({
                            download_url: fileItem.download_url || `https://tecdigital.tec.ac.cr/dotlrn/file-storage/download/${encodeURIComponent(fileItem.name || 'file')}?file_id=${fileItem.file_id}`,
                            file_name: fileItem.title || fileItem.name || 'document',
                            source_url: docLink
                        });
                    }
                }
            }
        } else {
            // General HTML regex fallback block
            console.log(`[Extractor] Fetching document page HTML: ${completeUrl}`);
            const res = await client.client.get(completeUrl);
            const html = res.data;

            const fileIdRegex = /file_id=([0-9]+)/g;
            let match;
            while ((match = fileIdRegex.exec(html)) !== null) {
                const id = match[1];
                files.push({
                    download_url: `https://tecdigital.tec.ac.cr/dotlrn/file-storage/download/document.pdf?file_id=${id}`,
                    file_name: `Documento-${id}.pdf`,
                    source_url: docLink
                });
            }

            const objectIdRegex = /object_id=([0-9]+)/g;
            while ((match = objectIdRegex.exec(html)) !== null) {
                const id = match[1];
                files.push({
                    download_url: `https://tecdigital.tec.ac.cr/dotlrn/file-storage/download/document.pdf?object_id=${id}`,
                    file_name: `Documento-${id}.pdf`,
                    source_url: docLink
                });
            }
        }

        console.log(`[Extractor] Resolved ${files.length} document(s) via HTTP Parsing.`);
        return files;
    } catch (e) {
        console.error(`[Extractor] HTTP Error resolving files for ${docLink}: ${(e as Error).message}`);
        return [];
    }
}

function classifyType(typeHint: string, text: string): RawNotification['type'] {
    const lower = `${typeHint} ${text}`.toLowerCase();
    if (lower.includes('evaluaci') || lower.includes('tarea') || lower.includes('examen')) {
        return 'evaluacion';
    }
    if (lower.includes('documento') || lower.includes('archivo') || lower.includes('material')) {
        return 'documento';
    }
    return 'noticia';
}

function extractCourse(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const separators = [' - ', ' – ', ': '];

    for (const separator of separators) {
        const idx = normalized.indexOf(separator);
        if (idx > 0) {
            const candidate = normalized.slice(0, idx).trim();
            if (candidate.length >= 5) return candidate;
        }
    }

    return normalized.slice(0, 80) || 'Curso Desconocido';
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
