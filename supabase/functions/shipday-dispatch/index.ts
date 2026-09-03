/**
 * shipday-dispatch — the courier proxy.
 *
 * This is the only place in the platform that knows which courier network is
 * being used. It is invoked server-to-server with the service-role key, it
 * reads the tenant's key from `tenant_secrets` (a table with RLS enabled and
 * zero policies, so no client role can read it under any circumstances), and
 * it returns nothing provider-shaped to its caller.
 *
 * The provider's job id is written to `deliveries.external_ref`, which no
 * client role selects — deliberately not to `orders`, which customers can
 * read.
 *
 * Deploy:  supabase functions deploy shipday-dispatch --no-verify-jwt=false
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISPATCH_API_BASE_URL =
  Deno.env.get('DISPATCH_API_BASE_URL') ?? 'https://api.shipday.com';

const SECRET_KEY = 'shipday_api_key';

type DispatchRequestBody = { orderId?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  // Only the service role may invoke this. Anything else — an anon key, a
  // customer's JWT — is refused before a single secret is read.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  let body: DispatchRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Malformed request body' }, 400);
  }

  const orderId = body.orderId;
  if (!orderId) return json({ ok: false, error: 'orderId is required' }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- load the order ------------------------------------------------
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      `id, tenant_id, order_number, fulfillment_type, status,
       customer_name, customer_phone, customer_email,
       delivery_address_line1, delivery_address_line2, delivery_city,
       delivery_region, delivery_postal_code, delivery_country,
       delivery_latitude, delivery_longitude, delivery_instructions,
       subtotal_cents, tax_cents, tip_cents, total_cents, promised_at,
       order_items ( name_snapshot, quantity, unit_price_cents,
                     order_item_modifiers ( name_snapshot, price_delta_cents ) )`,
    )
    .eq('id', orderId)
    .single();

  if (orderError || !order) return json({ ok: false, error: 'Order not found' }, 404);
  if (order.fulfillment_type !== 'delivery') {
    return json({ ok: false, error: 'Order is not a delivery' }, 409);
  }

  // Already dispatched: succeed without creating a duplicate job.
  const { data: existing } = await supabase
    .from('deliveries')
    .select('external_ref')
    .eq('order_id', orderId)
    .maybeSingle();

  if (existing?.external_ref) return json({ ok: true });

  // ---- tenant key and pickup address ---------------------------------
  const { data: secret, error: secretError } = await supabase
    .from('tenant_secrets')
    .select('value')
    .eq('tenant_id', order.tenant_id)
    .eq('key', SECRET_KEY)
    .maybeSingle();

  if (secretError) return json({ ok: false, error: 'Could not load dispatch credentials' }, 500);
  if (!secret?.value) {
    return json({ ok: false, error: 'Courier dispatch is not configured for this restaurant' }, 409);
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, support_phone')
    .eq('id', order.tenant_id)
    .single();

  const { data: settings } = await supabase
    .from('tenant_settings')
    .select(
      'address_line1, address_line2, city, region, postal_code, country, latitude, longitude',
    )
    .eq('tenant_id', order.tenant_id)
    .single();

  if (!settings?.address_line1 || !settings.city || !settings.postal_code) {
    return json({ ok: false, error: 'Restaurant pickup address is incomplete' }, 409);
  }

  const money = (cents: number) => Number((cents / 100).toFixed(2));

  const payload = {
    orderNumber: order.order_number,
    customerName: order.customer_name,
    customerAddress: [
      order.delivery_address_line1,
      order.delivery_address_line2,
      order.delivery_city,
      order.delivery_region,
      order.delivery_postal_code,
    ]
      .filter(Boolean)
      .join(', '),
    customerEmail: order.customer_email ?? undefined,
    customerPhoneNumber: order.customer_phone,
    restaurantName: tenant?.name ?? 'Restaurant',
    restaurantAddress: [
      settings.address_line1,
      settings.address_line2,
      settings.city,
      settings.region,
      settings.postal_code,
    ]
      .filter(Boolean)
      .join(', '),
    restaurantPhoneNumber: tenant?.support_phone ?? undefined,
    expectedPickupTime: order.promised_at ?? undefined,
    pickupLatitude: settings.latitude ?? undefined,
    pickupLongitude: settings.longitude ?? undefined,
    deliveryLatitude: order.delivery_latitude ?? undefined,
    deliveryLongitude: order.delivery_longitude ?? undefined,
    deliveryInstruction: order.delivery_instructions ?? undefined,
    orderItem: (order.order_items ?? []).map((item) => ({
      name: item.name_snapshot,
      quantity: item.quantity,
      unitPrice: money(item.unit_price_cents),
      addOns: (item.order_item_modifiers ?? []).map((m) => m.name_snapshot),
    })),
    tax: money(order.tax_cents),
    tips: money(order.tip_cents),
    totalOrderCost: money(order.total_cents),
    paymentMethod: 'credit_card',
  };

  // ---- provider call --------------------------------------------------
  let providerRef: string | null = null;
  let trackingUrl: string | null = null;
  try {
    const response = await fetch(`${DISPATCH_API_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${secret.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      // The provider's own error text is logged, not returned — a caller
      // must not be able to fingerprint the courier network from an error.
      console.error('dispatch rejected', response.status, detail.slice(0, 500));
      return json({ ok: false, error: 'Courier dispatch was rejected' }, 502);
    }

    const result = (await response.json()) as {
      orderId?: number | string;
      trackingLink?: string;
      trackingUrl?: string;
    };
    providerRef = result?.orderId != null ? String(result.orderId) : null;
    trackingUrl = result?.trackingLink ?? result?.trackingUrl ?? null;
  } catch (error) {
    console.error('dispatch call failed', error);
    return json({ ok: false, error: 'Courier dispatch is unavailable' }, 503);
  }

  if (!providerRef) {
    return json({ ok: false, error: 'Courier did not return a job reference' }, 502);
  }

  const { error: recordError } = await supabase.rpc('record_dispatch_reference', {
    p_order_id: orderId,
    p_external_ref: providerRef,
    p_status: 'assigned',
    p_tracking_url: trackingUrl,
  });

  if (recordError) {
    console.error('failed to record dispatch reference', recordError);
    return json({ ok: false, error: 'Dispatch succeeded but could not be recorded' }, 500);
  }

  return json({ ok: true });
});
