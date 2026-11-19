// Verifies a Google Play Billing subscription with the Google Play Developer API
// before activating GalliRent Premium. Deploy WITH JWT verification enabled.
// The raw purchase token is never stored; only its SHA-256 hash is persisted.

import { createClient } from 'npm:@supabase/supabase-js@2.74.0';
import { SignJWT, importPKCS8 } from 'npm:jose@5.10.0';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

type GooglePurchase = {
  startTime?: string;
  subscriptionState?: string;
  latestOrderId?: string;
  lineItems?: Array<{ productId?: string; expiryTime?: string }>;
};

async function googleAccessToken(serviceAccountJson: string): Promise<string> {
  const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key');
  }
  const privateKey = await importPKCS8(
    serviceAccount.private_key.replace(/\\n/g, '\n'),
    'RS256',
  );
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/androidpublisher',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email)
    .setAudience(serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const token = (await response.json()) as { access_token?: string; error?: string };
  if (!response.ok || !token.access_token) {
    throw new Error(`Google OAuth failed: ${token.error ?? response.status}`);
  }
  return token.access_token;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = request.headers.get('Authorization');
    const projectUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    const packageName = Deno.env.get('GOOGLE_PLAY_PACKAGE_NAME') ?? 'in.gallirent.app';

    if (!authHeader || !projectUrl || !anonKey || !serviceKey || !serviceAccountJson) {
      return json({ error: 'Server or authentication is not configured' }, 500);
    }
    if (packageName !== 'in.gallirent.app') {
      return json({ error: 'Unexpected Android package name' }, 400);
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(projectUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !userData.user) return json({ error: 'Invalid user session' }, 401);

    const body = (await request.json()) as {
      productId?: string;
      purchaseToken?: string;
      orderId?: string;
    };
    const productId = String(body.productId ?? '');
    const purchaseToken = String(body.purchaseToken ?? '');
    if (!/^[a-z0-9_.-]{3,80}$/.test(productId) || purchaseToken.length < 20) {
      return json({ error: 'Invalid purchase payload' }, 400);
    }

    const admin = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Only administrator-configured plan IDs can activate Premium.
    const { data: plan, error: planError } = await admin
      .from('subscription_plans')
      .select('id,duration_days,is_active')
      .eq('play_product_id', productId)
      .eq('is_active', true)
      .maybeSingle();
    if (planError || !plan) return json({ error: 'Plan is not active' }, 400);

    const accessToken = await googleAccessToken(serviceAccountJson);
    const verificationUrl =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/` +
      `${encodeURIComponent(purchaseToken)}`;
    const purchaseResponse = await fetch(verificationUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const purchase = (await purchaseResponse.json()) as GooglePurchase & {
      error?: { message?: string };
    };
    if (!purchaseResponse.ok) {
      return json({ error: purchase.error?.message ?? 'Google Play verification failed' }, 400);
    }

    const activeStates = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'];
    const lineItem = (purchase.lineItems ?? []).find((item) => item.productId === productId);
    const expiryTime = lineItem?.expiryTime;
    const isActive =
      activeStates.includes(String(purchase.subscriptionState ?? '')) &&
      !!expiryTime &&
      new Date(expiryTime).getTime() > Date.now();

    if (!lineItem || !isActive) {
      return json({ error: 'Purchase is not an active subscription', active: false }, 400);
    }

    const purchaseTokenHash = await sha256Hex(purchaseToken);
    const { error: entitlementError } = await admin.from('premium_entitlements').upsert(
      {
        user_id: userData.user.id,
        purchase_token_hash: purchaseTokenHash,
        product_id: productId,
        order_id: purchase.latestOrderId ?? body.orderId ?? null,
        started_at: purchase.startTime ?? new Date().toISOString(),
        expires_at: expiryTime,
        status: 'ACTIVE',
        raw_response: purchase,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'purchase_token_hash' },
    );
    if (entitlementError) throw entitlementError;

    return json({
      active: true,
      product_id: productId,
      expires_at: expiryTime,
      server_now: new Date().toISOString(),
    });
  } catch (error) {
    console.error('verify-play-purchase error', error);
    return json({ error: error instanceof Error ? error.message : 'Verification failed' }, 500);
  }
});
