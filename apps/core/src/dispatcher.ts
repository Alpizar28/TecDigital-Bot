import axios from 'axios';
import crypto from 'crypto';
import { notificationExists, insertNotification, decrypt, uploadedFileExists, insertUploadedFile } from '@tec-brain/database';
import { TelegramService } from '@tec-brain/telegram';
import { DriveService } from '@tec-brain/drive';
import type { User, RawNotification, ScrapeResponse } from '@tec-brain/types';

/**
 * Dispatches a single notification: deduplicates, then routes to the
 * correct action (Telegram message or Drive upload + Telegram confirm).
 */
export async function dispatch(
    user: User,
    notification: RawNotification,
    cookies: ScrapeResponse['cookies'],
    telegram: TelegramService,
    drive: DriveService | null,
): Promise<void> {
    // 1. Deduplication check
    const alreadySent = await notificationExists(user.id, notification.external_id);
    if (alreadySent) return;

    // 2. Route by type
    try {
        switch (notification.type) {
            case 'noticia':
                await safeTelegram(user, notification, () => telegram.sendNotice(user, notification), 'telegram_notice');
                break;

            case 'evaluacion':
                await safeTelegram(user, notification, () => telegram.sendEvaluation(user, notification), 'telegram_eval');
                break;

            case 'documento': {
                if (
                    drive &&
                    user.drive_root_folder_id &&
                    notification.files &&
                    notification.files.length > 0
                ) {
                    await Promise.allSettled(
                        notification.files.map(async (file) => {
                            try {
                                const fileHash = crypto.createHash('sha256').update(file.download_url + file.file_name).digest('hex');

                                const isDuplicate = await uploadedFileExists(user.id, fileHash);
                                if (isDuplicate) {
                                    console.log(`[Dispatcher] Skipping duplicate document upload: ${file.file_name} for ${user.name}`);
                                    return; // early-exit, db says we already uploaded this mapped file context.
                                }

                                const userFolderId = await drive.ensureFolder(user.name, user.drive_root_folder_id!);
                                const courseFolderId = await drive.ensureFolder(notification.course, userFolderId);
                                const { fileId } = await drive.downloadAndUpload(file.download_url, file.file_name, courseFolderId, cookies);

                                await insertUploadedFile(user.id, notification.course, fileHash, file.file_name, fileId);

                                await safeTelegram(user, notification, () => telegram.sendDocumentSaved(user, notification, file.file_name), 'telegram_doc_saved');
                            } catch (err) {
                                logStructuredError(user, notification, 'drive_upload', err);
                                await safeTelegram(user, notification, () => telegram.sendDocumentLink(user, notification), 'telegram_doc_fallback');
                            }
                        })
                    );
                } else {
                    await safeTelegram(user, notification, () => telegram.sendDocumentLink(user, notification), 'telegram_doc_link');
                }
                break;
            }
        }
    } catch (err) {
        logStructuredError(user, notification, 'dispatch_internal', err);
    }

    // 3. Persist as sent (regardless of type to secure progression)
    await insertNotification(user.id, notification);
}

function logStructuredError(user: User, notif: RawNotification, action: string, err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
        level: 'ERROR',
        user_id: user.id,
        external_id: notif.external_id,
        type: notif.type,
        action,
        error_message: errorMsg,
    }));
}

async function safeTelegram(user: User, notif: RawNotification, fn: () => Promise<void>, action: string) {
    try {
        await fn();
    } catch (err) {
        logStructuredError(user, notif, action, err);
    }
}
