import { Router } from 'express';
import { TwitterApi } from 'twitter-api-v2';
import { eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db, schema } from '../../db/index.js';
import { logger } from '../../config/logger.js';

export const twitterAuthRouter = Router();

// Temporary store for OAuth tokens (request token → { secret, accountId })
const pendingTokens = new Map<string, { secret: string; accountId: string }>();

twitterAuthRouter.get('/auth', async (req, res) => {
  try {
    const { accountId } = req.query as { accountId?: string };

    if (!accountId) {
      res.status(400).json({ error: 'accountId is required' });
      return;
    }

    if (!env.TWITTER_API_KEY || !env.TWITTER_API_SECRET) {
      res.status(500).json({ error: 'Twitter API key/secret not configured in environment' });
      return;
    }

    const client = new TwitterApi({
      appKey: env.TWITTER_API_KEY,
      appSecret: env.TWITTER_API_SECRET,
    });

    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(
      env.TWITTER_CALLBACK_URL,
      { linkMode: 'authorize' },
    );

    pendingTokens.set(oauth_token, { secret: oauth_token_secret, accountId });

    // Clean up stale tokens after 10 minutes
    setTimeout(() => pendingTokens.delete(oauth_token), 10 * 60 * 1000);

    res.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Twitter OAuth auth error', { error: msg });
    res.status(500).json({ error: 'Failed to start OAuth flow: ' + msg });
  }
});

twitterAuthRouter.get('/callback', async (req, res) => {
  try {
    const { oauth_token, oauth_verifier } = req.query as {
      oauth_token?: string;
      oauth_verifier?: string;
    };

    if (!oauth_token || !oauth_verifier) {
      res.status(400).send(closePopupHtml(false, 'OAuth dogrulama basarisiz: eksik parametreler'));
      return;
    }

    const pending = pendingTokens.get(oauth_token);
    if (!pending) {
      res.status(400).send(closePopupHtml(false, 'OAuth token suresi doldu, tekrar deneyin'));
      return;
    }

    pendingTokens.delete(oauth_token);

    if (!env.TWITTER_API_KEY || !env.TWITTER_API_SECRET) {
      res.status(500).send(closePopupHtml(false, 'Twitter API key/secret yapilandirilmamis'));
      return;
    }

    const client = new TwitterApi({
      appKey: env.TWITTER_API_KEY,
      appSecret: env.TWITTER_API_SECRET,
      accessToken: oauth_token,
      accessSecret: pending.secret,
    });

    const { accessToken, accessSecret, screenName } = await client.login(oauth_verifier);

    // Save credentials to account
    await db
      .update(schema.accounts)
      .set({
        credentials: {
          apiKey: env.TWITTER_API_KEY,
          apiSecret: env.TWITTER_API_SECRET,
          accessToken,
          accessSecret,
        },
        ...(screenName ? { username: screenName } : {}),
      })
      .where(eq(schema.accounts.id, pending.accountId));

    logger.info('Twitter OAuth completed', { accountId: pending.accountId, screenName });

    res.send(closePopupHtml(true, '', screenName));
  } catch (err) {
    logger.error('Twitter OAuth callback error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).send(closePopupHtml(false, 'OAuth baglanma hatasi: ' + (err instanceof Error ? err.message : String(err))));
  }
});

function closePopupHtml(success: boolean, error?: string, screenName?: string): string {
  const message = JSON.stringify({
    type: 'twitter-oauth',
    success,
    screenName: screenName ?? '',
    error: error ?? '',
  });

  const fallbackText = success
    ? 'Basarili! Bu pencereyi kapatabilirsiniz.'
    : (error || 'Bir hata olustu');

  return `<!DOCTYPE html><html><head><title>Twitter OAuth</title></head><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${message}, '*');
    window.close();
  } else {
    document.body.innerHTML = ${JSON.stringify(fallbackText)};
  }
</script>
</body></html>`;
}
