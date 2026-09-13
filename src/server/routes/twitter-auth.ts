import { Router } from 'express';
import { TwitterApi } from 'twitter-api-v2';
import { eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db, schema } from '../../db/index.js';
import { logger } from '../../config/logger.js';
import { engine } from '../../core/engine.js';
import { isUuid } from '../middleware.js';

export const twitterAuthRouter = Router();

const PENDING_TTL_MS = 10 * 60 * 1000;

// Temporary store for OAuth request tokens (request token → { secret, accountId, expiresAt })
const pendingTokens = new Map<string, { secret: string; accountId: string; expiresAt: number }>();

function prunePending(): void {
  const now = Date.now();
  for (const [token, entry] of pendingTokens) {
    if (entry.expiresAt < now) pendingTokens.delete(token);
  }
}

twitterAuthRouter.get('/auth', async (req, res) => {
  try {
    const { accountId } = req.query as { accountId?: string };

    if (!isUuid(accountId)) {
      res.status(400).json({ error: 'A valid accountId is required' });
      return;
    }

    if (!env.TWITTER_API_KEY || !env.TWITTER_API_SECRET) {
      res.status(500).json({ error: 'Twitter API key/secret not configured in environment' });
      return;
    }

    const [account] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);

    if (!account) {
      res.status(404).json({ error: 'Account not found' });
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

    prunePending();
    pendingTokens.set(oauth_token, { secret: oauth_token_secret, accountId, expiresAt: Date.now() + PENDING_TTL_MS });

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
      res.status(400).send(closePopupHtml(false, 'OAuth verification failed: missing parameters'));
      return;
    }

    const pending = pendingTokens.get(oauth_token);
    pendingTokens.delete(oauth_token);
    if (!pending || pending.expiresAt < Date.now()) {
      res.status(400).send(closePopupHtml(false, 'OAuth session expired, please try again'));
      return;
    }

    if (!env.TWITTER_API_KEY || !env.TWITTER_API_SECRET) {
      res.status(500).send(closePopupHtml(false, 'Twitter API key/secret not configured'));
      return;
    }

    const client = new TwitterApi({
      appKey: env.TWITTER_API_KEY,
      appSecret: env.TWITTER_API_SECRET,
      accessToken: oauth_token,
      accessSecret: pending.secret,
    });

    const { accessToken, accessSecret, screenName } = await client.login(oauth_verifier);

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

    engine.invalidateAccount(pending.accountId);
    logger.info('Twitter OAuth completed', { accountId: pending.accountId, screenName });

    res.send(closePopupHtml(true, '', screenName));
  } catch (err) {
    logger.error('Twitter OAuth callback error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).send(closePopupHtml(false, 'OAuth connection failed'));
  }
});

/** JSON that is safe to embed inside a <script> tag */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function closePopupHtml(success: boolean, error?: string, screenName?: string): string {
  const message = scriptJson({
    type: 'twitter-oauth',
    success,
    screenName: screenName ?? '',
    error: error ?? '',
  });

  const fallbackText = scriptJson(success ? 'Success! You can close this window.' : (error || 'Something went wrong'));

  return `<!DOCTYPE html><html><head><title>Twitter OAuth</title></head><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${message}, window.location.origin);
    window.close();
  } else {
    document.body.textContent = ${fallbackText};
  }
</script>
</body></html>`;
}
