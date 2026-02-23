import axios from 'axios';
import { notificationExists, insertNotification, decrypt } from '@tec-brain/database';
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
    switch (notification.type) {
        case 'noticia':
            await telegram.sendNotice(user, notification);
            break;

        case 'evaluacion':
            await telegram.sendEvaluation(user, notification);
            break;

        case 'documento': {
            if (
                drive &&
                user.drive_root_folder_id &&
                notification.files &&
                notification.files.length > 0
            ) {
                for (const file of notification.files) {
                    try {
                        // Ensure /RootFolder/UserName/CourseName/ folder tree
                        const userFolderId = await drive.ensureFolder(user.name, user.drive_root_folder_id);
                        const courseFolderId = await drive.ensureFolder(notification.course, userFolderId);

                        await drive.downloadAndUpload(file.download_url, file.file_name, courseFolderId, cookies);
                        await telegram.sendDocumentSaved(user, notification, file.file_name);
                    } catch (err) {
                        console.error(`[Dispatcher] Drive upload failed for ${file.file_name}:`, err);
                        // Fallback: send just a link notification instead
                        await telegram.sendDocumentLink(user, notification);
                    }
                }
            } else {
                // No Drive configured or no files resolved → just send link
                await telegram.sendDocumentLink(user, notification);
            }
            break;
        }
    }

    // 3. Persist as sent (regardless of type)
    await insertNotification(user.id, notification);
}
