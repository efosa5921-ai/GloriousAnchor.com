import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socialLinks, contactDetails, detailsText, renderAboutPage } from '../scripts/lib/about.js';
import { missionBody } from '../scripts/mission-pdf.js';

const site = {
  name: 'Glorious Anchor', url: 'https://gloriousanchor.com', network: 'Glorious Anchor International Network (GAIN)',
  motto: 'Connecting Nations • Empowering People • Transforming Lives', verse: 'We have this hope as an anchor for the soul.',
  contactEmail: 'info@gloriousanchor.com', whatsappChannel: 'https://whatsapp.com/channel/abc', telegramChannel: 'https://t.me/gloriousanchor',
  youtubeChannel: 'https://www.youtube.com/@gloriousanchor', xHandle: 'GloriousAnchor',
};

test('socialLinks lists every configured handle, and optional ones only when set', () => {
  assert.deepEqual(socialLinks(site).map((s) => s.key), ['whatsapp', 'telegram', 'youtube', 'x']);
  assert.equal(socialLinks(site).find((s) => s.key === 'youtube').label, '@gloriousanchor');
  assert.equal(socialLinks(site).find((s) => s.key === 'x').url, 'https://x.com/GloriousAnchor');
  const more = socialLinks({ ...site, facebookPage: 'https://www.facebook.com/gloriousanchor', instagram: '@gloriousanchor', tiktok: 'gloriousanchor' });
  assert.deepEqual(more.map((s) => s.key), ['whatsapp', 'telegram', 'youtube', 'x', 'facebook', 'instagram', 'tiktok']);
  assert.equal(more.find((s) => s.key === 'instagram').url, 'https://www.instagram.com/gloriousanchor');
  assert.equal(more.find((s) => s.key === 'tiktok').url, 'https://www.tiktok.com/@gloriousanchor');
});

test('contactDetails gives the email and website, and a phone or address when set', () => {
  assert.deepEqual(contactDetails(site).map((c) => c.name), ['Email', 'Website']);
  const more = contactDetails({ ...site, phone: '+1 (555) 010-0100', address: '1 Anchor Way' });
  assert.equal(more.find((c) => c.name === 'Phone').url, 'tel:+15550100100');
  assert.equal(more.find((c) => c.name === 'Address').url, '');
});

test('the About page shows the handles, the contact details and the mission download', () => {
  const html = renderAboutPage(site, { mission: { path: 'assets/gain-mission.pdf', bytes: 190000, pages: 8 } });
  for (const want of ['Glorious Anchor International Network', 'Connecting Nations', 'https://t.me/gloriousanchor', '@GloriousAnchor', 'mailto:info@gloriousanchor.com', 'href="../assets/gain-mission.pdf" download', 'PDF, 8 pages', 'https://gaintv.app', '"@type":"Organization"']) assert.ok(html.includes(want), want);
  assert.ok(!renderAboutPage(site).includes('gain-mission.pdf'), 'no download link without a document');
});

test('detailsText carries the same details as plain text', () => {
  const text = detailsText(site, { mission: { path: 'assets/gain-mission.pdf' } });
  for (const want of ['Website: https://gloriousanchor.com', 'Telegram: https://t.me/gloriousanchor', 'Email: info@gloriousanchor.com', 'https://gloriousanchor.com/assets/gain-mission.pdf']) assert.ok(text.includes(want), want);
});

test('missionBody keeps the document and drops the front matter, site links and Q&A', () => {
  const body = missionBody('---\ntitle: T\ndraft: true\n---\n\n## The encounters\n\nText.\n\nFor what the network does online today, read [Welcome](/articles/welcome/).\n\n## Questions this article answers\n\n### Q?\n\nA.\n');
  assert.equal(body, '## The encounters\n\nText.');
});
