#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { stdin as input, stdout as output } from 'process';
import * as readline from 'readline';

const rl = readline.createInterface({ input, output });

const question = (prompt) =>
  new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });

async function run() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Error: Missing SUPABASE env vars');
    process.exit(1);
  }

  const client = createClient(url, key);

  // Get tenant ID
  const { data: tenant, error: tenantError } = await client
    .from('tenants')
    .select('id')
    .eq('slug', 'vardr-upload-test')
    .single();

  if (tenantError || !tenant) {
    console.error('Error: Tenant not found');
    process.exit(1);
  }

  console.log('Ready to store uber_customer_id for vardr-upload-test.');
  console.log('Paste the Customer ID (input hidden):');

  // Read without echoing
  const customerId = await new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const handler = (ch) => {
      if (ch === '' || ch === '') {
        // Ctrl+C or Ctrl+D
        console.log('\n\nCanceled.');
        process.exit(0);
      } else if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        console.log('');
        resolve(value);
      } else if (ch === '' || ch === '') {
        // Backspace
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };

    stdin.on('data', handler);
  });

  if (!customerId.trim()) {
    console.error('Error: No value provided');
    process.exit(1);
  }

  // Insert into tenant_secrets
  const { error: insertError } = await client
    .from('tenant_secrets')
    .upsert(
      {
        tenant_id: tenant.id,
        key: 'uber_customer_id',
        value: customerId.trim(),
      },
      { onConflict: 'tenant_id,key' },
    );

  if (insertError) {
    console.error('Error storing secret:', insertError.message);
    process.exit(1);
  }

  // Verify it exists
  const { data: verify, error: verifyError } = await client
    .from('tenant_secrets')
    .select('created_at, updated_at')
    .eq('tenant_id', tenant.id)
    .eq('key', 'uber_customer_id')
    .single();

  if (verifyError || !verify) {
    console.error('Error verifying secret:', verifyError?.message);
    process.exit(1);
  }

  console.log('✓ Secret stored successfully');
  console.log(`  Tenant: vardr-upload-test`);
  console.log(`  Key: uber_customer_id`);
  console.log(`  Stored at: ${verify.updated_at}`);
  console.log('\nNow run Check Config on the admin page to verify.');
}

run().catch(console.error);
