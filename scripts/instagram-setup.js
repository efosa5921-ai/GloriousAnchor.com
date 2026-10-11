#!/usr/bin/env node
/**
 * One-time helper: turns a short-lived Facebook user token into the two values the build needs
 * (IG_USER_ID and a non-expiring Page access token). Run it on your own machine:
 *
 *   node scripts/instagram-setup.js --app-id 123 --app-secret abc --token EAAB...
 *
 * How to get the inputs (about 10 minutes, all free):
 *   1. https://developers.facebook.com → My Apps → Create App (type "Business"). Note the App ID and App Secret
 *      (Settings → Basic).
 *   2. Make sure you have a Facebook Page and an Instagram *professional* (Business or Creator) account linked to it
 *      (Instagram app → Settings → Account type and tools → Switch to professional account; then link the Page).
 *   3. https://developers.facebook.com/tools/explorer → pick your app → "Get User Access Token" with permissions
 *      pages_show_list, pages_read_engagement, instagram_basic, business_management → Generate. Copy the token.
 *   4. Run this script. Add the printed values as GitHub Actions secrets IG_USER_ID and IG_ACCESS_TOKEN.
 */
import { GRAPH } from './lib/instagram.js';

const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const appId = get('--app-id'), appSecret = get('--app-secret'), token = get('--token');
if (!appId || !appSecret || !token) {
  console.error('Usage: node scripts/instagram-setup.js --app-id <id> --app-secret <secret> --token <short-lived user token>');
  process.exit(1);
}

async function graph(path, params) {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u);
  const data = await res.json();
  if (data.error) throw new Error(`${path}: ${data.error.message}`);
  return data;
}

const longLived = await graph('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token });
console.log('✓ Exchanged for a long-lived user token.');
const pages = await graph('/me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: longLived.access_token });
const linked = (pages.data || []).filter((p) => p.instagram_business_account);
if (!linked.length) {
  console.error('No Facebook Page with a linked Instagram professional account was found for this user.');
  process.exit(1);
}
for (const p of linked) {
  console.log(`\nPage "${p.name}" → Instagram @${p.instagram_business_account.username}`);
  console.log(`  IG_USER_ID=${p.instagram_business_account.id}`);
  console.log(`  IG_ACCESS_TOKEN=${p.access_token}`);
}
console.log('\nPage access tokens obtained from a long-lived user token do not expire. Add the values above as GitHub Actions secrets.');
