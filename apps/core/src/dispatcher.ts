import axios from 'axios';
import crypto from 'crypto';
import {
    getNotificationState,
    insertNotification,
    updateNotificationDocumentStatus,
    uploadedFileExists,
    insertUploadedFile
} from '@tec-brain/database';
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
    // 1. Deduplication / recovery check
    const { exists, document_status: previousStatus } = await getNotificationState(user.id, notification.external_id);
    const isDocument = notification.type === 'documento';
    const resolvedNow = notification.document_status === 'resolved' && !!notification.files?.length;
    let hasPendingUploads = false;

    if (exists && isDocument && notification.files && notification.files.length > 0) {
        for (const file of notification.files) {
            const fileHash = crypto.createHash('sha256').update(file.download_url + file.file_name).digest('hex');
            const isDuplicate = await uploadedFileExists(user.id, fileHash);
            if (!isDuplicate) {
                hasPendingUploads = true;
                break;
            }
        }
    }

    const shouldRetryDocument =
        exists &&
        isDocument &&
        resolvedNow &&
        (previousStatus !== 'resolved' || hasPendingUploads);

    if (exists && !shouldRetryDocument) {
        console.log(`[Dispatcher] Skip duplicate notification: ${notification.external_id} (${notification.type}) for ${user.name}`);
        return;
    }

    if (shouldRetryDocument) {
        console.log(`[Dispatcher] Reprocessing document notification: ${notification.external_id} (previous status: ${previousStatus ?? 'null'}) for ${user.name}`);
    }

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
                    const userFolderId = await drive.ensureFolder(user.name, user.drive_root_folder_id!);
                    const courseFolderId = await drive.ensureFolder(notification.course, userFolderId);

                    await Promise.allSettled(
                        notification.files.map(async (file) => {
                            try {
                                const fileHash = crypto.createHash('sha256').update(file.download_url + file.file_name).digest('hex');

                                const isDuplicate = await uploadedFileExists(user.id, fileHash);
                                if (isDuplicate) {
                                    console.log(`[Dispatcher] Skipping duplicate document upload: ${file.file_name} for ${user.name}`);
                                    return; // early-exit, db says we already uploaded this mapped file context.
                                }

                                const { fileId } = await drive.downloadAndUpload(file.download_url, file.file_name, courseFolderId, cookies);

                                await insertUploadedFile(user.id, notification.course, fileHash, file.file_name, fileId);

                                await safeTelegram(
                                    user,
                                    notification,
                                    () => telegram.sendDocumentSaved(user, notification, file.file_name, fileId),
                                    'telegram_doc_saved'
                                );
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

    // 3. Persist as sent / update status
    if (!exists) {
        await insertNotification(user.id, notification);
    } else if (shouldRetryDocument && notification.document_status === 'resolved') {
        await updateNotificationDocumentStatus(user.id, notification.external_id, 'resolved');
    }
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
