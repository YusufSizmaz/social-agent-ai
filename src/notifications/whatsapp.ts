import { Client, LocalAuth } from 'whatsapp-web.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let client: Client | null = null;
let ready = false;

export async function initWhatsApp(): Promise<void> {
  if (!env.WHATSAPP_ADMIN_NUMBER) {
    logger.warn('WhatsApp admin number not configured, notifications disabled');
    return;
  }

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox'] },
  });

  client.on('ready', () => {
    ready = true;
    logger.info('WhatsApp client ready');
  });

  client.on('auth_failure', (msg) => {
    logger.error('WhatsApp auth failure', { message: msg });
  });

  client.on('disconnected', (reason) => {
    ready = false;
    logger.warn('WhatsApp disconnected', { reason });
  });

  await client.initialize();
}

export async function sendAdminMessage(message: string): Promise<void> {
  if (!client || !ready || !env.WHATSAPP_ADMIN_NUMBER) {
    logger.debug('WhatsApp not available, skipping notification');
    return;
  }

  try {
    const chatId = `${env.WHATSAPP_ADMIN_NUMBER}@c.us`;
    await client.sendMessage(chatId, message);
    logger.debug('WhatsApp message sent to admin');
  } catch (err) {
    logger.error('Failed to send WhatsApp message', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function notifyError(source: string, error: string): Promise<void> {
  await sendAdminMessage(`⚠️ *HATA*\nKaynak: ${source}\nHata: ${error}\nZaman: ${new Date().toLocaleString('tr-TR')}`);
}

export async function notifyDailySummary(stats: {
  postsPublished: number;
  postsFailed: number;
  totalEngagement: number;
}): Promise<void> {
  await sendAdminMessage(
    `📊 *Günlük Özet*\n` +
    `Yayınlanan: ${stats.postsPublished}\n` +
    `Başarısız: ${stats.postsFailed}\n` +
    `Toplam Etkileşim: ${stats.totalEngagement}\n` +
    `Tarih: ${new Date().toLocaleDateString('tr-TR')}`,
  );
}

export async function notifyAccountStatus(account: string, status: string): Promise<void> {
  await sendAdminMessage(`🔔 *Hesap Durumu*\nHesap: ${account}\nDurum: ${status}`);
}

export async function destroyWhatsApp(): Promise<void> {
  if (client) {
    await client.destroy();
    client = null;
    ready = false;
  }
}
