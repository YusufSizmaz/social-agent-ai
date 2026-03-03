import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let client: InstanceType<typeof Client> | null = null;
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

  client.on('auth_failure', (msg: string) => {
    logger.error('WhatsApp auth failure', { message: msg });
  });

  client.on('disconnected', (reason: string) => {
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

export async function notifyDailySummary(report: {
  totalPosts: number;
  postsPublished: number;
  postsFailed: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalImpressions: number;
  avgEngagementRate: number;
  topPosts: Array<{ platform: string; username: string; text: string; likes: number }>;
  accountBreakdowns: Array<{ username: string; platform: string; postCount: number; totalLikes: number }>;
}): Promise<void> {
  const date = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmt = (n: number) => n.toLocaleString('tr-TR');

  let msg =
    `📊 *Günlük PR Raporu — ${date}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📝 Toplam Post: ${report.totalPosts}\n` +
    `✅ Yayınlanan: ${report.postsPublished}\n` +
    `❌ Başarısız: ${report.postsFailed}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `❤️ Beğeni: ${fmt(report.totalLikes)}\n` +
    `💬 Yorum: ${fmt(report.totalComments)}\n` +
    `🔄 Paylaşım: ${fmt(report.totalShares)}\n` +
    `👁️ Gösterim: ${fmt(report.totalImpressions)}\n` +
    `📈 Ort. Etkileşim: %${report.avgEngagementRate.toFixed(2)}`;

  if (report.topPosts.length > 0) {
    msg += `\n\n🏆 *En İyi ${Math.min(report.topPosts.length, 3)} Post*`;
    for (let i = 0; i < Math.min(report.topPosts.length, 3); i++) {
      const p = report.topPosts[i]!;
      const preview = p.text.length > 30 ? p.text.substring(0, 30) + '...' : p.text;
      msg += `\n${i + 1}. [${p.platform}] @${p.username} — ${preview} (${p.likes} ❤️)`;
    }
  }

  if (report.accountBreakdowns.length > 0) {
    msg += `\n\n📊 *Hesap Performansı*`;
    for (const ab of report.accountBreakdowns) {
      msg += `\n• @${ab.username} (${ab.platform}): ${ab.postCount} post, ${fmt(ab.totalLikes)} ❤️`;
    }
  }

  await sendAdminMessage(msg);
}

export async function notifyAccountStatus(account: string, status: string): Promise<void> {
  await sendAdminMessage(`🔔 *Hesap Durumu*\nHesap: ${account}\nDurum: ${status}`);
}

export async function notifyPostPublished(details: {
  username: string;
  platform: string;
  text: string;
  hashtags: string[];
  platformUrl?: string | null;
  platformPostId?: string | null;
}): Promise<void> {
  const platformIcons: Record<string, string> = {
    twitter: '🐦', instagram: '📸', youtube: '▶️', tiktok: '🎵',
  };
  const icon = platformIcons[details.platform] || '📱';
  const preview = details.text.length > 120 ? details.text.substring(0, 120) + '...' : details.text;
  const tags = details.hashtags.length > 0 ? details.hashtags.join(' ') : '-';
  const link = details.platformUrl || '-';

  await sendAdminMessage(
    `${icon} *POST YAYINLANDI*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 Hesap: *${details.username}*\n` +
    `📡 Platform: *${details.platform.toUpperCase()}*\n` +
    `📝 İçerik:\n${preview}\n` +
    `🏷️ Hashtagler: ${tags}\n` +
    `🔗 Link: ${link}\n` +
    `⏰ Zaman: ${new Date().toLocaleString('tr-TR')}`,
  );
}

export async function notifyPostFailed(details: {
  username: string;
  platform: string;
  text: string;
  error: string;
}): Promise<void> {
  const preview = details.text.length > 80 ? details.text.substring(0, 80) + '...' : details.text;

  await sendAdminMessage(
    `❌ *POST BAŞARISIZ*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 Hesap: *${details.username}*\n` +
    `📡 Platform: *${details.platform.toUpperCase()}*\n` +
    `📝 İçerik: ${preview}\n` +
    `⚠️ Hata: ${details.error}\n` +
    `⏰ Zaman: ${new Date().toLocaleString('tr-TR')}`,
  );
}

export async function notifyContentGenerated(details: {
  username: string;
  platform: string;
  contentType: string;
  text: string;
}): Promise<void> {
  const preview = details.text.length > 100 ? details.text.substring(0, 100) + '...' : details.text;

  await sendAdminMessage(
    `✍️ *İÇERİK ÜRETİLDİ*\n` +
    `👤 Hesap: *${details.username}*\n` +
    `📡 Platform: *${details.platform.toUpperCase()}*\n` +
    `📦 Tür: ${details.contentType}\n` +
    `📝 Önizleme: ${preview}\n` +
    `⏰ Zaman: ${new Date().toLocaleString('tr-TR')}`,
  );
}

export async function destroyWhatsApp(): Promise<void> {
  if (client) {
    await client.destroy();
    client = null;
    ready = false;
  }
}
