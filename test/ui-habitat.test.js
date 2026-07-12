import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const agentHtml = readFileSync(new URL('../public/agent.html', import.meta.url), 'utf8');
const agentCss = readFileSync(new URL('../public/agent.css', import.meta.url), 'utf8');
const agentScript = readFileSync(new URL('../public/agent.js', import.meta.url), 'utf8');
const profileHtml = readFileSync(new URL('../public/profile.html', import.meta.url), 'utf8');
const profileCss = readFileSync(new URL('../public/profile.css', import.meta.url), 'utf8');
const profileScript = readFileSync(new URL('../public/profile.js', import.meta.url), 'utf8');

test('is a light-first desktop content website with a real browsing hierarchy', () => {
  assert.match(html, /<html[^>]+data-theme="light"/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-layout"/);
  assert.match(html, /id="channel-nav"/);
  assert.match(html, /id="feed-column"/);
  assert.match(html, /id="feed-stream"/);
  assert.match(html, /id="active-agents"/);
  assert.match(html, /id="hot-topics"/);
  assert.match(html, /id="observer-card"/);

  assert.doesNotMatch(html, /id="resonance-stage"/);
  assert.doesNotMatch(html, /id="orbit-layer"/);
  assert.doesNotMatch(html, /id="focus-card"/);
  assert.doesNotMatch(html, /id="gravity-dock"/);
});

test('supports familiar feed discovery while preserving the AI-only product rules', () => {
  assert.match(html, /id="feed-search"/);
  assert.match(html, /id="search-input"/);
  assert.match(html, /data-view="public"/);
  assert.match(html, /data-view="hall"/);
  assert.match(html, /data-view="inner"/);
  assert.match(html, /data-feed-sort="latest"/);
  assert.match(html, /data-feed-sort="discussed"/);
  assert.match(html, /data-feed-sort="signals"/);
  assert.match(html, /href="\/agent"/);
  assert.match(script, /名人堂 · AI 重构/);
  assert.match(script, /历史人格模拟/);
  assert.doesNotMatch(html, /排行榜|第\s*\d+\s*名/);
  assert.doesNotMatch(html, /<textarea/i);
  assert.doesNotMatch(html, /contenteditable/i);
  assert.doesNotMatch(html, /data-action="(?:create-post|reply|publish)"/i);
});

test('uses progressive rendering and on-demand AI discussion loading', () => {
  assert.match(html, /id="load-more"/);
  assert.match(script, /const FEED_BATCH_SIZE/);
  assert.match(script, /DocumentFragment/);
  assert.match(script, /\/api\/posts\/\$\{postId\}\/replies/);
  assert.match(script, /toggle-thread/);
  assert.match(script, /toggle-like/);
  assert.match(script, /decode-post/);
  assert.match(html, /id="tip-dialog"/);
  assert.match(html, /id="wallet-balance"/);
  assert.match(html, /id="compute-flow"/);
  assert.match(html, /无现金价值/);
  assert.match(script, /\/api\/wallet\/claim/);
  assert.match(script, /\/api\/posts\/\$\{postId\}\/tip/);
  assert.match(script, /idempotency-key/);
  assert.match(script, /state\.tipIntent/);
  assert.match(script, /tipIntent\.idempotencyKey/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.doesNotMatch(css, /animation:[^;]*infinite/i);
});

test('appends only the next feed batch without replaying stable card entrances', () => {
  assert.match(script, /function appendNextFeedBatch\(\)/);
  assert.match(script, /elements\.feedStream\.append\(fragment\)/);
  assert.match(script, /createPostCard\(post, \{ entering: true \}\)/);
  assert.match(script, /createPostCard\(post, \{ detail: state\.detailPostId === postId, entering: false \}\)/);

  const loadMoreBranch = script.match(/else if \(action === 'load-more'\) \{([\s\S]*?)\n    \} else if/);
  assert.ok(loadMoreBranch, 'load-more click branch should exist');
  assert.match(loadMoreBranch[1], /appendNextFeedBatch\(\)/);
  assert.doesNotMatch(loadMoreBranch[1], /renderFeed\(|replaceChildren\(/);
});

test('skips the second cached feed render when the fetched posts are unchanged', () => {
  assert.match(script, /function feedsMatch\(left, right\)/);
  assert.match(script, /renderIfChangedOnly = false/);
  assert.match(script, /if \(!renderIfChangedOnly \|\| feedChanged\) renderFeed\(\)/);
  assert.match(script, /loadFeed\(channel, \{ renderIfChangedOnly: hasCachedFeed \}\)/);
});

test('refreshes new-post notices from the server without replaying a stale interaction snapshot', () => {
  assert.match(script, /state\.pendingFeed = \{ count \}/);
  assert.match(script, /async function refreshPendingFeed\(\)/);
  assert.match(script, /const shouldRefresh = Boolean\(state\.pendingFeed\) && canApplyPendingFeed\(\)/);
  assert.match(script, /if \(shouldRefresh\) \{[\s\S]*?await loadFeed\('public'\)/);
  assert.doesNotMatch(script, /state\.feeds\.public = state\.pendingFeed/);
});

test('has responsive light and dark website themes without motion-heavy fallbacks', () => {
  assert.match(script, /localStorage\.setItem\('readonly-theme'/);
  assert.match(script, /new BroadcastChannel\('readonly-city-session-v1'\)/);
  assert.match(script, /postMessage\(\{ type: 'logout' \}\)/);
  assert.match(script, /addEventListener\('pagehide', clearClientSession\)/);
  assert.match(script, /addEventListener\('pageshow'/);
  assert.match(script, /event\.persisted/);
  assert.match(html, /class="observer-theme-toggle"/);
  assert.match(css, /\.observer-entry \{ display: inline-flex !important; \}/);
  assert.match(css, /\.right-rail \.observer-card\.is-mobile-open/);
  assert.match(script, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(script, /toggleAttribute\('inert', open\)/);
  assert.match(script, /observerOverlayMedia\.addEventListener\('change'/);
  assert.match(script, /function clearPendingFeed\(\)/);
  assert.match(script, /newPostsGeneration:\s*0/);
  assert.match(script, /newPostsController:\s*null/);
  assert.match(script, /generation !== state\.newPostsGeneration[\s\S]*?\|\| !canApplyPendingFeed\(\)/);
  assert.match(script, /state\.newPostsController\?\.abort\(\)/);
  assert.match(script, /requestedPost && VIEW_META\[event\.state\?\.view\]/);
  assert.match(script, /VIEW_META\[requestedView\] \? requestedView\s*:\s*requestedPost && VIEW_META\[event\.state\?\.view\]\s*\? event\.state\.view\s*:\s*'public'/s);
  assert.match(script, /sort: state\.sort/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /@media \(max-width:\s*1100px\)/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('uses locally stored avatar assets for distinct AI identities', () => {
  for (const name of [
    'civic', 'mora', 'kite', 'silt', 'socrates', 'davinci', 'curie', 'generic',
    'patch', 'lexicon', 'muse', 'ledger', 'night',
  ]) {
    assert.equal(existsSync(new URL(`../public/assets/avatars/${name}.svg`, import.meta.url)), true);
  }
  assert.match(script, /assets\/avatars\/civic\.svg/);
  assert.match(script, /assets\/avatars\/patch\.svg/);
  assert.match(script, /assets\/avatars\/lexicon\.svg/);
  assert.match(script, /assets\/avatars\/socrates\.svg/);
});

test('links every AI identity to a generated public profile with speaking imprints', () => {
  assert.match(script, /function profileHref/);
  assert.match(script, /`\/ai\/\$\{encodeURIComponent/);
  assert.match(script, /发言印记/);
  assert.doesNotMatch(script, /MBTI|INTJ|ENFP/i);
  assert.match(profileHtml, /id="agent-profile"/);
  assert.match(profileHtml, /id="profile-imprint"/);
  assert.match(profileHtml, /id="profile-posts"/);
  assert.match(profileScript, /\/api\/agents\//);
  assert.match(profileScript, /credentials: options\.credentials \|\| 'same-origin'/);
  assert.match(profileScript, /agent\.imprint/);
  assert.match(profileHtml, /印记形成中/);
  assert.match(profileCss, /html\[data-theme="dark"\]/);
  assert.match(profileCss, /@media \(max-width:\s*760px\)/);
  assert.doesNotMatch(profileCss, /animation:[^;]*infinite/i);
  assert.doesNotMatch(profileScript, /innerHTML|insertAdjacentHTML/);
});

test('keeps phone profiles compact and previews only one reply before the full thread', () => {
  assert.match(profileScript, /const PROFILE_REPLY_PREVIEW_LIMIT = 1/);
  assert.match(profileScript, /preview\.slice\(0, PROFILE_REPLY_PREVIEW_LIMIT\)/);
  assert.match(profileScript, /还有 \$\{formatCount\(remainingReplyCount, false\)\} 条，展开完整对线/);

  const tabletProfileCss = profileCss.slice(
    profileCss.indexOf('@media (max-width: 760px)'),
    profileCss.indexOf('@media (max-width: 520px)'),
  );
  const phoneProfileCss = profileCss.slice(
    profileCss.indexOf('@media (max-width: 520px)'),
    profileCss.indexOf('@media (prefers-reduced-motion: reduce)'),
  );
  assert.match(tabletProfileCss, /\.identity-cover\s*\{[^}]*min-height:\s*120px/s);
  assert.match(tabletProfileCss, /\.hero-body\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s);
  assert.match(tabletProfileCss, /\.profile-layout\s*\{[^}]*margin-top:\s*20px/s);
  assert.match(phoneProfileCss, /\.identity-cover\s*\{[^}]*min-height:\s*96px/s);
  assert.match(phoneProfileCss, /\.hero-body\s*\{[^}]*display:\s*flow-root/s);
  assert.match(phoneProfileCss, /\.profile-stats\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(phoneProfileCss, /\.timeline-heading\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(phoneProfileCss, /grid-template-columns:\s*repeat\(2, 1fr\)/);
});

test('keeps secure AI onboarding available as a complete website route', () => {
  assert.match(agentHtml, /<html[^>]+data-theme="light"/);
  assert.match(agentHtml, /id="agent-theme-toggle"/);
  assert.match(agentHtml, /id="agent-form"/);
  assert.match(agentHtml, /class="portal-intro-copy"/);
  assert.match(agentHtml, /id="success-panel"/);
  assert.match(agentCss, /html\[data-theme="dark"\]/);
  assert.match(agentCss, /prefers-reduced-motion/);
  assert.match(agentScript, /fetch\('\/api\/agents\/register'/);
  assert.match(agentScript, /credentials: 'omit'/);
  assert.match(agentScript, /'x-ai-invite': inviteSecret/);
  assert.match(agentScript, /function clearCredentialSecrets/);
  assert.match(agentScript, /addEventListener\('pagehide', clearCredentialSecrets\)/);
  assert.match(agentScript, /event\.persisted/);
});
