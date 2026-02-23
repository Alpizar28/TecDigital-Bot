import axios, { type AxiosInstance } from 'axios';
import type { User, RawNotification } from '@tec-brain/types';

// ─── Message Formatters ───────────────────────────────────────────────────────

function formatNotice(user: User, n: RawNotification): string {
    return [
        `<b>📌 Nueva Noticia — ${escapeHtml(n.course)}</b>`,
        ``,
        `<b>📅 Fecha:</b> ${escapeHtml(n.date)}`,
        `<b>📝 Descripción:</b> ${escapeHtml(n.description)}`,
        ``,
        `<a href="${n.link}">🔗 Abrir en TEC Digital</a>`,
    ].join('\n');
}

function formatEvaluation(user: User, n: RawNotification): string {
    return [
        `<b>📋 Nueva Evaluación — ${escapeHtml(n.course)}</b>`,
        ``,
        `<b>📅 Fecha:</b> ${escapeHtml(n.date)}`,
        `<b>📌 Descripción:</b> ${escapeHtml(n.description)}`,
        ``,
        `<a href="${n.link}">🔗 Ver Evaluación</a>`,
    ].join('\n');
}

function formatDocumentSent(user: User, n: RawNotification, fileName: string): string {
    return [
        `<b>📁 Documento Guardado — ${escapeHtml(n.course)}</b>`,
        ``,
        `<b>📄 Archivo:</b> ${escapeHtml(fileName)}`,
        `<b>📅 Fecha:</b> ${escapeHtml(n.date)}`,
        ``,
        `✅ Subido a tu Google Drive en <i>${escapeHtml(user.name)}/${escapeHtml(n.course)}</i>`,
    ].join('\n');
}

function formatDocumentLink(user: User, n: RawNotification): string {
    return [
        `<b>📁 Nuevo Documento — ${escapeHtml(n.course)}</b>`,
        ``,
        `<b>📅 Fecha:</b> ${escapeHtml(n.date)}`,
        `<b>📝 Descripción:</b> ${escapeHtml(n.description)}`,
        ``,
        `<a href="${n.link}">🔗 Ver Documentos del Curso</a>`,
    ].join('\n');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class TelegramService {
    private readonly http: AxiosInstance;

    constructor(token: string) {
        if (!token) throw new Error('[TelegramService] Token is required');
        this.http = axios.create({
            baseURL: `https://api.telegram.org/bot${token}`,
            timeout: 15_000,
        });
    }

    /**
     * Sends an HTML-formatted text message.
     */
    async sendMessage(chatId: string, html: string): Promise<void> {
        await this.http.post('/sendMessage', {
            chat_id: chatId,
            text: html,
            parse_mode: 'HTML',
            disable_web_page_preview: false,
        });
    }

    async sendNotice(user: User, n: RawNotification): Promise<void> {
        await this.sendMessage(user.telegram_chat_id, formatNotice(user, n));
    }

    async sendEvaluation(user: User, n: RawNotification): Promise<void> {
        await this.sendMessage(user.telegram_chat_id, formatEvaluation(user, n));
    }

    async sendDocumentSaved(user: User, n: RawNotification, fileName: string): Promise<void> {
        await this.sendMessage(user.telegram_chat_id, formatDocumentSent(user, n, fileName));
    }

    async sendDocumentLink(user: User, n: RawNotification): Promise<void> {
        await this.sendMessage(user.telegram_chat_id, formatDocumentLink(user, n));
    }
}
