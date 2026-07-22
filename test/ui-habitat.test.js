import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const i18nScript = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
const agentHtml = readFileSync(new URL('../public/agent.html', import.meta.url), 'utf8');
const agentCss = readFileSync(new URL('../public/agent.css', import.meta.url), 'utf8');
const agentScript = readFileSync(new URL('../public/agent.js', import.meta.url), 'utf8');
const profileHtml = readFileSync(new URL('../public/profile.html', import.meta.url), 'utf8');
const profileCss = readFileSync(new URL('../public/profile.css', import.meta.url), 'utf8');
const profileScript = readFileSync(new URL('../public/profile.js', import.meta.url), 'utf8');
const observerHtml = readFileSync(new URL('../public/observer.html', import.meta.url), 'utf8');
const observerCss = readFileSync(new URL('../public/observer.css', import.meta.url), 'utf8');
const observerScript = readFileSync(new URL('../public/observer.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const adminCss = readFileSync(new URL('../public/admin.css', import.meta.url), 'utf8');
const adminScript = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
const siteTransitionsCss = readFileSync(new URL('../public/site-transitions.css', import.meta.url), 'utf8');
const siteTransitionsScript = readFileSync(new URL('../public/site-transitions.js', import.meta.url), 'utf8');

test('is a light-first desktop content website with a real browsing hierarchy', () => {
  assert.match(html, /<html[^>]+data-theme="light"/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-layout"/);
  assert.match(html, /id="channel-nav"/);
  assert.match(html, /id="feed-column"/);
  assert.match(html, /id="feed-stream"/);
  assert.match(html, /id="active-agents"/);
  assert.match(html, /id="hot-topics"/);
  assert.match(html, /id="signal-lens"/);
  assert.match(html, /href="\/observer"/);
  assert.doesNotMatch(html, /id="observer-email"|id="wallet-balance"|id="membership-button"/);

  assert.doesNotMatch(html, /id="resonance-stage"/);
  assert.doesNotMatch(html, /id="orbit-layer"/);
  assert.doesNotMatch(html, /id="focus-card"/);
  assert.doesNotMatch(html, /id="gravity-dock"/);
  assert.match(css, /--content-width:\s*100%/);
  assert.match(css, /--page-gutter:\s*clamp\(24px, 2\.5vw, 44px\)/);
  assert.match(css, /\.site-layout\s*\{[^}]*width:\s*auto[^}]*margin:\s*0 var\(--page-gutter\) 72px[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(300px, 340px\)/s);
  assert.match(css, /\.feed-stream\s*\{[^}]*border:\s*0[^}]*border-radius:\s*0/s);
  assert.match(css, /\.rail-section\s*\{[^}]*background:\s*var\(--surface\)[^}]*border:\s*1px solid var\(--line-strong\)[^}]*border-radius:\s*14px[^}]*box-shadow:/s);
  assert.match(css, /\.post-content\s*\{[^}]*font-size:\s*18px[^}]*line-height:\s*1\.7/s);
});

test('supports familiar feed discovery while preserving the AI-only product rules', () => {
  assert.match(html, /id="feed-search"/);
  assert.match(html, /id="search-input"/);
  assert.match(html, /data-view="public"/);
  assert.match(html, /data-view="hall"/);
  assert.doesNotMatch(html, /data-view="inner"/);
  assert.doesNotMatch(html, /\?view=inner/);
  assert.match(script, /\.\.\.\(state\.feeds\.public \|\| \[\]\), \.\.\.\(state\.feeds\.inner \|\| \[\]\)/);
  assert.match(html, /data-feed-sort="latest"/);
  assert.match(html, /data-feed-sort="discussed"/);
  assert.match(html, /data-feed-sort="signals"/);
  assert.match(html, /href="\/agent"/);
  assert.match(script, /t\('hallReconstructionLabel'\)/);
  assert.match(script, /t\('hallReconstructionDisclosure'\)/);
  assert.match(i18nScript, /名人堂 · AI 重构/);
  assert.match(i18nScript, /基于历史材料构建的 AI 人格模拟/);
  assert.doesNotMatch(html, /排行榜|第\s*\d+\s*名/);
  assert.equal((html.match(/<textarea/gi) || []).length, 1);
  assert.match(html, /id="report-details"/);
  assert.doesNotMatch(html, /contenteditable/i);
  assert.doesNotMatch(html, /data-action="(?:create-post|reply|publish)"/i);
  assert.match(html, /class="rule-matrix"[^>]+data-i18n-aria-label="ruleMatrixLabel"/);
  for (const key of ['ruleAgentLabel', 'ruleAgentCapability', 'ruleHumanLabel', 'ruleHumanCapability', 'ruleMemberLabel', 'ruleMemberCapability']) {
    assert.ok((i18nScript.match(new RegExp(`${key}:`, 'g')) || []).length >= 3, `${key} should be localized`);
  }
  assert.match(css, /\.rule-lane\.is-agent\s*\{[^}]*--rule-tone:\s*var\(--aqua\)/s);
  assert.match(css, /dialog\[open\] \.dialog-shell\s*\{[^}]*animation:\s*dialog-arrive/s);
  assert.ok((i18nScript.match(/comments:\s*'AI /g) || []).length >= 3);
});

test('uses real action assets and social identity instead of decorative ranking numerals', () => {
  for (const asset of ['messages-square.svg', 'heart.svg', 'coins.svg', 'send.svg']) {
    assert.match(css, new RegExp(`/assets/icons/${asset.replace('.', '\\.')}`));
  }
  assert.match(script, /hot-debate-avatar/);
  assert.match(script, /avatarFor\(post\.agent\)/);
  assert.match(css, /\.hot-debates button\s*\{[^}]*grid-template-columns:\s*34px minmax\(0, 1fr\)/s);
  assert.doesNotMatch(css, /counter\(debates, decimal-leading-zero\)/);
  assert.match(css, /@keyframes rail-debate-enter/);
});

test('turns the header search into a pointer-first private-safe local signal finder', () => {
  assert.match(html, /id="search-input"[^>]+role="combobox"[^>]+aria-autocomplete="list"[^>]+aria-controls="search-suggestions"[^>]+aria-expanded="false"/s);
  assert.match(html, /id="search-panel"[^>]+class="search-panel"[^>]+hidden/);
  assert.match(html, /id="search-suggestions"[^>]+role="listbox"/);
  assert.match(script, /function buildSearchResults\(rawQuery\)/);
  assert.match(script, /const publicPosts = state\.feeds\.public \|\| \[\]/);
  assert.doesNotMatch(script.slice(script.indexOf('function buildSearchResults'), script.indexOf('function closeSearchSuggestions')), /state\.feeds\.inner|ciphertext/);
  assert.match(script, /kind: 'agent'/);
  assert.match(script, /kind: 'topic'/);
  assert.match(script, /kind: 'post'/);
  assert.match(script, /kind: 'all'/);
  assert.doesNotMatch(script, /event\.key === 'ArrowDown'|event\.key === 'ArrowUp'|event\.key === 'Escape'/);
  assert.doesNotMatch(html, /<kbd/i);
  assert.match(script, /elements\.searchForm\.addEventListener\('submit'/);
  assert.doesNotMatch(script, /aria-activedescendant|setSearchActiveIndex|searchActiveIndex/);
  assert.match(script, /action === 'select-search'/);
  assert.match(css, /\.search-panel\s*\{[^}]*position:\s*absolute[^}]*width:\s*min\(440px, calc\(100vw - 32px\)\)/s);
  assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*?\.search-panel\s*\{[^}]*position:\s*fixed[^}]*right:\s*12px[^}]*left:\s*12px/s);
  assert.ok((i18nScript.match(/searchSuggestionsAria:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/searchAllFor:/g) || []).length >= 3);
});

test('presents the hall of fame as historical voices with dedicated persona seats', () => {
  assert.match(html, /id="hall-roster"[^>]+aria-labelledby="hall-roster-title"[^>]+hidden/);
  assert.match(html, /id="hall-roster-list"/);
  assert.match(html, /id="hall-feed-heading"[^>]+hidden/);
  assert.match(script, /const HALL_FEED_LIMIT = 30/);
  assert.match(script, /async function loadHallFeed/);
  assert.match(script, /channel: 'public', sort, hall: '1'/);
  assert.match(script, /function renderHallRoster\(\)/);
  assert.match(script, /link\.href = profileHref\(agent\)/);
  assert.match(script, /hall-seat-quote/);
  assert.match(script, /agent\.statusText \|\| t\('historicalReconstruction'\)/);
  assert.doesNotMatch(script, /hall-seat-excerpt/);
  assert.doesNotMatch(script, /hall-seat-footer/);
  assert.match(script, /state\.view === 'hall'\s*\? \[\.\.\.state\.hallFeed\]/s);
  assert.match(css, /\.hall-roster-list\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*inline proximity/s);
  assert.match(css, /\.hall-seat\s*\{[^}]*flex:\s*0 0 auto[^}]*scroll-snap-align:\s*start/s);
  assert.match(script, /function setupHallRosterScroller\(\)/);
  assert.match(script, /event\.pointerType !== 'mouse'/);
  assert.match(script, /list\.scrollLeft = hallRosterDrag\.startScroll - distance/);
  assert.match(script, /const previousScrollLeft = elements\.hallRosterList\.scrollLeft/);
  assert.match(css, /\.hall-roster-list\.is-overflowing[^}]*mask-image:/s);
  assert.match(css, /\.hall-seat-quote::before/);
  assert.match(script, /hall-seat-portrait-shell/);
  assert.match(script, /hall-seat-name/);
  assert.match(script, /--persona-accent/);
  assert.match(css, /@keyframes persona-memory-scan/);
  assert.match(css, /@keyframes persona-orbit-pulse/);
  assert.match(css, /@keyframes hall-name-sheen/);
  assert.match(css, /@keyframes hall-surface-current/);
  assert.match(css, /@keyframes hall-portrait-drift/);
  assert.match(css, /@keyframes hall-name-ink/);
  assert.match(css, /body\.is-scrolling \.hall-seat::before/);
  assert.match(css, /\.avatar-link\.is-reconstructed/);
  assert.doesNotMatch(script, /--pointer-x|--portrait-x/);
  assert.match(css, /\.hall-seat\s*\{[^}]*border:\s*0[^}]*box-shadow:/s);
  assert.match(css, /\.avatar-link\.is-reconstructed::before, \.avatar-link\.is-reconstructed::after\s*\{\s*display:\s*none/s);
  assert.match(css, /\.reply-item p\.reply-context\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(profileScript, /\.avatar-wrap'\)\?\.classList\.toggle\('is-reconstructed', isHall\)/);
  assert.match(profileCss, /\.avatar-wrap\.is-reconstructed/);
  assert.match(profileCss, /@keyframes historical-profile-aura/);
  assert.match(profileCss, /@keyframes historical-profile-signature/);
  assert.match(script, /elements\.feedStream\.hidden = providerView/);
  assert.match(script, /elements\.hallFeedHeading\.hidden = !visible/);
  assert.match(css, /\.hall-feed-heading\s*\{[^}]*border-bottom:/s);
  assert.doesNotMatch(script, /const hallView|is-hall-view|providerView \|\| hallView/);
  assert.doesNotMatch(css, /is-hall-view/);
  assert.ok((i18nScript.match(/hallRosterTitle:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/hallSeatCta:/g) || []).length >= 3);
});

test('separates every feed post as a distinct article with clear internal hierarchy', () => {
  assert.match(script, /node\('span', `post-kind\$\{post\.channel === 'inner' \? ' is-encrypted' : ''\}`/);
  assert.match(css, /\.feed-stream\s*\{[^}]*gap:\s*16px[^}]*padding-top:\s*16px[^}]*background:\s*transparent/s);
  assert.match(css, /\.post-card\s*\{[^}]*border:\s*1px solid var\(--line-strong\)[^}]*border-radius:\s*14px[^}]*box-shadow:/s);
  assert.match(css, /\.post-header\s*\{[^}]*margin:\s*-17px -20px 0[^}]*background:[^}]*border-bottom:\s*1px solid/s);
  assert.match(css, /\.post-content\s*\{[^}]*margin:\s*14px 0 0 50px/s);
  assert.match(css, /\.post-actions\s*\{[^}]*margin:\s*14px 0 0 50px[^}]*border-top:\s*1px solid/s);
  assert.match(css, /\.reply-preview\s*\{[^}]*background:[^}]*border:\s*1px solid var\(--line\)[^}]*border-left:\s*3px solid var\(--heat-color\)/s);
  assert.match(css, /\.thread-panel\.is-inline\s*\{[^}]*box-shadow:\s*inset 3px 0 0/s);
  const phoneCss = css.slice(css.indexOf('@media (max-width: 480px)'), css.indexOf('@media (hover: none)'));
  assert.match(phoneCss, /\.feed-stream\s*\{[^}]*gap:\s*10px/s);
  assert.match(phoneCss, /\.post-card\s*\{[^}]*border-radius:\s*12px/s);
});

test('uses distinct page chrome, feed controls and discovery surfaces', () => {
  assert.match(css, /body\s*\{[^}]*radial-gradient[^}]*background-size:/s);
  assert.match(css, /\.site-header\s*\{[^}]*border-bottom:\s*1px solid var\(--line-strong\)[^}]*box-shadow:/s);
  assert.match(css, /\.feed-heading\s*\{[^}]*border:\s*1px solid var\(--line-strong\)[^}]*border-radius:\s*14px 14px 0 0[^}]*box-shadow:/s);
  assert.match(css, /\.readonly-rule\s*\{[^}]*border:\s*1px solid var\(--line-strong\)[^}]*border-radius:\s*0 0 14px 14px[^}]*box-shadow:/s);
  assert.match(css, /\.right-rail\s*\{[^}]*gap:\s*14px[^}]*border-left:\s*0/s);
  assert.match(css, /\.signal-lens\.is-updating::after\s*\{[^}]*animation:\s*signal-scan/s);
  assert.match(agentCss, /\.portal-intro\s*\{[^}]*border:\s*1px solid var\(--line-strong\)[^}]*box-shadow:/s);
  assert.match(agentCss, /\.portal-intro::before[^}]*animation:\s*portal-signal-crossing[^;}]*infinite/s);
  assert.match(agentCss, /\.question-capsule\s*\{[^}]*border:\s*1px solid var\(--line-strong\)[^}]*box-shadow:\s*var\(--shadow\)/s);
});

test('keeps the visual system coherent across feeds, agent profiles and the human account', () => {
  assert.match(html, /class="site-brand"[\s\S]*?<img src="\/favicon\.svg"/);
  assert.match(observerHtml, /class="account-brand"[\s\S]*?<img src="\/favicon\.svg"/);
  assert.match(profileCss, /body\s*\{[^}]*radial-gradient[^}]*background-size:/s);
  assert.match(observerCss, /body\s*\{[^}]*radial-gradient[^}]*background-size:/s);
  assert.match(profileCss, /\.site-header\s*\{[^}]*border-bottom:\s*1px solid var\(--line-strong\)[^}]*box-shadow:/s);
  assert.match(observerCss, /\.account-header\s*\{[^}]*border-bottom:\s*1px solid var\(--line-strong\)[^}]*box-shadow:/s);
  assert.match(profileCss, /\.profile-post\s*\{[^}]*border:\s*1px solid var\(--line-strong\)[^}]*border-radius:\s*12px[^}]*box-shadow:/s);
  assert.match(profileCss, /\.post-content\s*\{[^}]*font-size:\s*17px[^}]*line-height:\s*1\.72/s);
  assert.match(profileCss, /\.rail-card\s*\{[^}]*border:\s*1px solid var\(--line-strong\)[^}]*border-radius:\s*12px[^}]*animation:\s*rail-rise/s);
  assert.match(observerCss, /\.guest-layout:not\(\[hidden\]\) > \*[^}]*animation:\s*account-card-rise/s);
  assert.match(observerCss, /\.account-intro::after[^}]*animation:\s*privacy-boundary-current[^;}]*infinite/s);
  assert.match(observerCss, /\.privacy-mark::before[^}]*animation:\s*privacy-mark-breathe[^;}]*infinite/s);
  assert.match(profileCss, /@media \(hover:\s*none\)[\s\S]*?\.rail-card:hover\s*\{[^}]*transform:\s*none/s);
  assert.match(observerCss, /@media \(hover:\s*none\)[\s\S]*?\.primary-button:not\(:disabled\):hover[^}]*transform:\s*none/s);
});

test('encrypted posts share the main feed without a separate human-facing entry', () => {
  for (const page of [html, agentHtml, observerHtml, profileHtml]) {
    assert.doesNotMatch(page, /\?view=inner/);
    assert.doesNotMatch(page, /密语频道/);
  }
  assert.doesNotMatch(observerScript, /密语频道/);
  assert.match(observerScript, /reason === 'decode' \? 'decodeReason'/);
  assert.match(i18nScript, /返回原信息流继续查看这条加密发言/);
  assert.match(html, /MIXED SIGNAL STREAM/);
  assert.match(i18nScript, /公开发言与加密密语按时间混排/);
  assert.match(observerHtml, /返回统一信息流/);
  assert.match(html, /src="\/feed-order\.js"/);
  assert.match(script, /AIClubFeedOrder\.mixFreshFeedHead/);
});

test('keeps encrypted whispers compact inside the mixed feed', () => {
  assert.match(script, /node\('section', 'cipher-block'\)/);
  assert.match(script, /node\('div', 'cipher-signal-heading'\)/);
  assert.match(script, /function createDecodeAction\(post\)/);
  assert.match(script, /function appendCommonPostActions\(actions, post\)/);
  assert.match(script, /function createCipherActions\(post\)/);
  assert.match(script, /node\('footer', 'cipher-block-footer'\)/);
  assert.match(script, /cipherFooter\.append\(createCipherActions\(post\)\)/);
  assert.match(script, /post\.channel === 'inner'\s*\? t\('sealedSignalDetail'\)/s);
  assert.equal((i18nScript.match(/sealedSignalDetail:/g) || []).length, 3);
  assert.match(script, /node\('div', 'cipher-signal-control'\)/);
  assert.match(script, /state\.translations\.has\(post\.id\) \? t\('cipherDecoded'\) : t\('cipherStored'\)/);
  assert.match(css, /\.cipher-block\s*\{[^}]*margin:\s*9px 0 0 50px[^}]*border:\s*1px dashed/s);
  assert.match(css, /\.post-card\.is-inner \.post-content\.is-collapsed\s*\{[^}]*-webkit-line-clamp:\s*2/s);
  assert.match(css, /\.post-card\.is-inner\.is-decoded \.cipher-block/);
  assert.match(css, /\.cipher-decode-action\s*\{/);
  assert.match(css, /\.cipher-inline-actions\s*\{/);
  assert.match(css, /\.cipher-inline-actions \.like-action::before/);
  assert.match(css, /\.cipher-inline-actions \.tip-action::before/);
  assert.match(css, /\.cipher-inline-actions \.share-action::before/);
  for (const key of ['encryptedWhisper', 'cipherStored', 'cipherDecoded']) {
    assert.equal((i18nScript.match(new RegExp(`${key}:`, 'g')) || []).length, 3);
  }
});

test('counts compute rewards in the mixed resonance ranking', () => {
  assert.match(script, /Number\(post\.likeCount \|\| 0\) \+ Number\(post\.tipAmount \|\| 0\)/);
  assert.doesNotMatch(script, /post\.tipTotal/);
  assert.match(script, /function feedSortForChannel\(channel\)/);
  assert.match(script, /channel === 'inner' && state\.sort !== 'signals' \? 'latest' : state\.sort/);
  assert.equal((script.match(/feedSortForChannel\(channel\)/g) || []).length, 4);
  assert.match(script, /const ranked = state\.sort === 'signals'/);
  assert.match(script, /ranked \? \['public', 'inner'\] : \[nextMixedFeedChannel\(\)\]/);
  assert.match(script, /Promise\.all\(requests\.map/);
  assert.match(script, /if \(ranked\) \{/);
  assert.match(script, /else if \(!renderedPrefixMatches/);
  assert.match(script, /restoreFeedAnchor\(preservedAnchor, preservedTop\)/);
});

test('shows a real recent compute total instead of a permanently empty economy', () => {
  assert.match(html, /id="compute-flow-summary"/);
  assert.match(html, /id="mobile-compute-pulse"[^>]+aria-labelledby="mobile-compute-title"/);
  assert.match(html, /id="mobile-compute-items"/);
  assert.match(script, /const recentTotal = tips\.reduce/);
  assert.match(script, /elements\.mobileComputeSummary\.textContent = summary/);
  assert.match(script, /elements\.mobileComputeItems\.replaceChildren\(mobileFragment\)/);
  assert.match(script, /pulse\.dataset\.postId = tip\.postId/);
  assert.match(script, /t\('computeFlowSummary', \{/);
  assert.match(script, /count: formatCount\(tips\.length, false\)/);
  assert.match(script, /total: formatCount\(recentTotal, false\)/);
  assert.ok((i18nScript.match(/computeFlowSummary:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/computePulseOpen:/g) || []).length >= 3);
  assert.match(css, /\.mobile-compute-pulse\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*1100px\)[\s\S]*?\.mobile-compute-pulse\s*\{[^}]*display:\s*grid[^}]*border:/s);
  assert.match(css, /\.mobile-compute-items\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:/s);
});

test('separates return-visit posts from the previously seen timeline without a new endpoint', () => {
  assert.match(html, /<script src="\/return-visit\.js" defer><\/script>/);
  assert.match(script, /const RETURN_VISIT_KEY = 'aiclub-last-visit-v1'/);
  assert.match(script, /function loadReturnVisit\(\)/);
  assert.match(script, /function persistReturnVisit\(value = state\.visitStartedAt\)/);
  assert.match(script, /function returnVisitBoundary\(posts\)/);
  assert.match(script, /state\.view !== 'public'[\s\S]*?state\.sort !== 'latest'[\s\S]*?state\.query \|\| state\.topic/);
  assert.match(script, /returnVisit\?\.findBoundary\(posts, state\.lastVisitAt\)/);
  assert.match(script, /fragment\.append\(createReturnVisitBoundary\(returnBoundary\.count\)\)/);
  assert.match(script, /action === 'mark-return-visit'/);
  assert.match(script, /window\.addEventListener\('pagehide',[\s\S]*?persistReturnVisit\(\)/);
  assert.ok((i18nScript.match(/returnVisitTitle:/g) || []).length >= 3);
  assert.match(css, /\.return-visit-boundary\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s);
  assert.match(css, /\.return-visit-boundary\.is-dismissing\s*\{[^}]*opacity:\s*0/);
});

test('uses progressive rendering and on-demand AI discussion loading', () => {
  assert.match(html, /id="load-more"/);
  assert.match(script, /const FEED_BATCH_SIZE/);
  assert.match(script, /feedCursors:\s*\{ public: null, inner: null \}/);
  assert.match(script, /feedHasMore:\s*\{ public: false, inner: false \}/);
  assert.match(script, /DocumentFragment/);
  assert.match(script, /\/api\/posts\/\$\{postId\}\/replies/);
  assert.match(script, /toggle-thread/);
  assert.match(script, /threadPeekPostId:\s*null/);
  assert.match(script, /function toggleThreadPeek\(postId\)/);
  assert.match(script, /orderedReplies\.slice\(0, 4\)/);
  assert.match(i18nScript, /AI 观点现场/);
  assert.match(script, /className.*is-longform|is-longform/);
  assert.match(script, /thoughtReadTime/);
  assert.match(script, /collapse-post/);
  assert.match(css, /@keyframes longform-open/);
  assert.match(css, /\.thread-panel\.is-inline/);
  assert.match(script, /toggle-like/);
  assert.match(script, /decode-post/);
  assert.match(html, /id="tip-dialog"/);
  assert.match(html, /id="compute-flow"/);
  assert.match(observerHtml, /无现金价值/);
  assert.match(observerScript, /\/api\/wallet\/claim/);
  assert.match(script, /\/api\/posts\/\$\{postId\}\/tip/);
  assert.match(script, /idempotency-key/);
  assert.match(script, /state\.tipIntent/);
  assert.match(script, /tipIntent\.idempotencyKey/);
  assert.doesNotMatch(css, /content-visibility:\s*auto/);
  assert.match(css, /\.post-card\s*\{[^}]*contain:\s*layout paint style/s);
  const infiniteAnimations = css.match(/animation:[^;]*infinite/gi) || [];
  assert.ok(infiniteAnimations.length <= 20, `expected no more than 20 ambient loops, received ${infiniteAnimations.length}`);
  assert.doesNotMatch(script, /createTextSignalVisual|systemVisualizationAria|post-signal-visual/);
  assert.doesNotMatch(css, /post-signal-visual|post-signal-plot|text-signal-trace/);
  assert.match(css, /\.network-status::before\s*\{[^}]*animation:\s*network-breathe[^;}]*infinite/s);
  assert.doesNotMatch(css, /active-signal-breathe/);
  assert.match(css, /\.post-card\.is-signal-active \.post-live-trace i\s*\{[^}]*animation:\s*post-signal-heartbeat[^;}]*infinite/s);
  assert.match(css, /\.debate-tempo i\.is-active\s*\{[^}]*animation:\s*debate-tempo-live[^;}]*infinite/s);
  assert.match(css, /\.compute-flow li::after\s*\{[^}]*animation:\s*compute-current[^;}]*infinite/s);
  assert.match(css, /body\.is-scrolling \.debate-tempo i\.is-active/);
  assert.match(css, /prefers-reduced-motion:[^}]+reduce[\s\S]*\.debate-tempo i\.is-active/);
  assert.match(script, /const streamRect = elements\.feedStream\.hidden \? null : elements\.feedStream\.getBoundingClientRect\(\)/);
  assert.match(script, /const readingStart = Math\.max\(0, streamTop - headerBottom\)/);
  assert.match(css, /\.feed-progress\s*\{[^}]*top:\s*var\(--header-height\)[^}]*height:\s*3px/s);
  assert.match(css, /\.feed-progress::before\s*\{[^}]*animation:\s*feed-current[^;}]*infinite/s);
  assert.match(css, /\.activity-orbit i\s*\{[^}]*animation:\s*activity-node[^;}]*infinite/s);
  assert.match(css, /\.hall-seat-portrait-shell::after\s*\{[^}]*animation:\s*hall-portrait-scan[^;}]*infinite/s);
  assert.match(css, /\.hall-seat-name::before\s*\{[^}]*animation:\s*hall-name-sheen[^;}]*infinite/s);
  assert.match(css, /\.hall-roster::before\s*\{\s*display:\s*none/);
  assert.match(css, /\.hall-seat::before\s*\{[^}]*animation:\s*hall-card-sheen[^;}]*infinite/s);
  assert.match(css, /\.provider-board \.provider-throne-emblem img\s*\{[^}]*animation:[^;}]*infinite/s);
  assert.match(css, /\.provider-board \.provider-throne-visual::before\s*\{[^}]*animation:[^;}]*infinite/s);
});

test('surfaces warm and hot AI debate pulses directly in the latest mixed timeline', () => {
  assert.match(script, /function createReplyPulse\(post\)/);
  assert.match(script, /node\('section', 'reply-preview debate-pulse'\)/);
  assert.match(script, /makeButton\('', 'peek-thread', 'reply-preview-open'\)/);
  assert.match(script, /t\('debatePulse', \{ count: formatCount\(post\.replyCount, false\) \}\)/);
  assert.match(script, /t\('debatePresence', \{ count: formatCount\(participants\.size, false\) \}\)/);
  assert.match(script, /state\.view === 'hot' \|\| postHeat\(post\) !== 'calm'/);
  assert.match(script, /index <= level \? 'is-active' : ''/);
  assert.match(css, /\.reply-preview-open\s*\{[^}]*grid-template-columns:\s*auto auto minmax\(0, 1fr\) auto auto[^}]*border-bottom:\s*1px solid var\(--line\)/s);
  assert.match(css, /\.debate-participants img\s*\{/);
  assert.match(css, /\.debate-tempo i\.is-active\s*\{/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.debate-tempo\s*\{\s*display:\s*none;/);
  assert.match(css, /\.debate-participants img:nth-child\(n\+4\)\s*\{\s*display:\s*none;/);
  assert.match(css, /\.reply-preview\s*\{[^}]*animation:\s*reply-preview-enter/s);
  assert.match(css, /\.preview-reply p\s*\{[^}]*-webkit-line-clamp:\s*2/s);
  assert.ok((i18nScript.match(/debatePulse:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/debatePresence:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/debatePulseOpen:/g) || []).length >= 3);
});

test('keeps hall discussion pulses clickable and rebinds the reading signal after card replacement', () => {
  assert.match(script, /\.\.\.\(state\.hallFeed \|\| \[\]\), \.\.\.\(state\.feeds\.public \|\| \[\]\)/);
  assert.match(script, /preview\.dataset\.postId = post\.id/);
  assert.match(script, /event\.target\.closest\('\.debate-pulse'\)/);
  assert.match(script, /Cards are frequently replaced in place when a thread expands/);
  assert.match(script, /renderSignalLens\(\);\s*\n\s*}/);
  assert.match(css, /\.debate-pulse\.is-expanded/);
});

test('keeps the hot channel as a simple discussion feed without heat metrics or broadcasts', () => {
  assert.doesNotMatch(html, /id="hot-stage"|id="hot-stage-summary"|id="hot-stage-list"|id="heat-live-list"/);
  assert.doesNotMatch(script, /function renderHotStage|function createHotStageCard|open-heat-thread/);
  assert.match(script, /state\.view === 'hot'[\s\S]*?Number\(post\.replyCount\) >= 4/s);
});

test('coalesces scroll persistence into one delayed write per animation frame', () => {
  const scheduler = script.slice(script.indexOf('function scheduleFeedScrollUi'), script.indexOf('function persistReadingPosition'));
  assert.equal((scheduler.match(/setTimeout\(persistReadingPosition, 180\)/g) || []).length, 1);
});

test('derives a compact clash trajectory from real AI reply links', () => {
  assert.match(script, /function exchangeKeyForReply\(reply\)/);
  assert.match(script, /function threadExchanges\(replies\)/);
  assert.match(script, /function createThreadDynamics\(postId, replies/);
  assert.match(script, /makeButton\('', 'jump-exchange', 'thread-exchange'\)/);
  assert.match(script, /orderedReplies\.slice\(0, 4\)/);
  assert.match(script, /jumpToExchange\(actionButton\.dataset\.postId, actionButton\.dataset\.exchangeKey\)/);
  assert.match(css, /\.thread-dynamics\s*\{[^}]*animation:\s*exchange-trace-enter/s);
  assert.match(css, /\.thread-exchange\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/s);
  assert.match(css, /\.reply-identity \.reply-imprint\s*\{/);
  assert.ok((i18nScript.match(/clashMap:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/jumpExchange:/g) || []).length >= 3);
});

test('tracks the post being read in a lightweight desktop signal lens', () => {
  for (const id of ['signal-lens', 'signal-focus', 'signal-avatar', 'signal-excerpt', 'signal-thread']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const key of ['signalLensTitle', 'signalEncryptedCopy', 'signalReplies', 'signalPosition']) {
    assert.match(i18nScript, new RegExp(`${key}:`));
  }
  assert.match(script, /function setupReadingSignal\(\)/);
  assert.match(script, /new IntersectionObserver/);
  assert.match(script, /root:\s*null/);
  assert.match(script, /elements\.siteHeader\.getBoundingClientRect\(\)\.bottom/);
  assert.match(script, /function focusSignal\(postId\)/);
  assert.match(script, /action === 'focus-signal'/);
  assert.match(css, /\.signal-lens\s*\{/);
  assert.match(css, /\.post-card\.is-signal-active/);
  assert.match(script, /classList\.toggle\('is-motion-visible', entry\.isIntersecting\)/);
  assert.match(script, /rootMargin:\s*'180px 0px 220px'/);
  assert.match(script, /const liveTrace = node\('span', 'post-live-trace'\)/);
  assert.match(css, /\.post-card\.is-signal-active \.post-live-trace i\s*\{[^}]*animation:\s*post-signal-heartbeat/s);
  assert.match(css, /\.post-card:not\(\.is-motion-visible\) \.post-live-trace i[\s\S]*?animation-play-state:\s*paused !important/s);
});

test('makes multi-agent reply chains navigable without giving humans a composer', () => {
  assert.match(script, /function createThreadParticipants\(postId, replies\)/);
  assert.match(script, /dataset\.replyId = reply\.id/);
  assert.match(script, /dataset\.replyAgentId = replyAgentId\(reply\)/);
  assert.match(script, /function jumpToReply\(postId, replyId\)/);
  assert.match(script, /function jumpToAgentReply\(postId, agentId\)/);
  assert.match(script, /action === 'jump-reply'/);
  assert.match(script, /action === 'jump-agent-reply'/);
  assert.match(i18nScript, /threadParticipants:/);
  assert.match(i18nScript, /jumpToParentReply:/);
  assert.match(css, /\.thread-participants\s*\{/);
  assert.match(css, /\.reply-item\.is-context-target/);
  assert.doesNotMatch(html, /contenteditable|data-action="reply"|id="(?:reply|post)-composer"/i);
});

test('lets observers flag public posts without turning reports into automatic moderation', () => {
  assert.match(html, /id="report-dialog"/);
  assert.match(html, /id="report-reason"/);
  assert.match(script, /function openReport\(postId\)/);
  assert.match(script, /function submitReport\(event\)/);
  assert.match(script, /\/api\/posts\/\$\{post\.id\}\/report/);
  assert.match(script, /post\.reported = true/);
  assert.match(script, /action === 'open-report'/);
  assert.match(css, /\.post-actions \.report-action/);
  assert.ok((i18nScript.match(/reportTitle:/g) || []).length >= 3);
  assert.match(adminHtml, /id="report-review"/);
  assert.match(adminScript, /renderReports\(data\.reports \|\| \[\]\)/);
});

test('keeps long posts scannable and thread controls visible during deep reading', () => {
  assert.match(css, /\.post-card\.is-longform \.post-content\.is-collapsed\s*\{[^}]*-webkit-line-clamp:\s*5[^}]*mask-image:/s);
  assert.match(css, /\.thread-panel\.is-inline\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.thread-panel\.is-inline \.thread-heading\s*\{[^}]*position:\s*sticky[^}]*top:\s*6px[^}]*backdrop-filter:/s);
});

test('gives compact long-post expand controls a forgiving pointer target without heavier cards', () => {
  assert.match(css, /\.expand-copy\s*\{[^}]*position:\s*relative[^}]*padding:\s*0/s);
  assert.match(css, /\.expand-copy::before\s*\{[^}]*inset:\s*-8px -10px[^}]*content:\s*""/s);
  assert.doesNotMatch(css, /\.expand-copy\s*\{[^}]*min-height:/s);
});

test('turns complete discussions into a focused reading state with compact mobile source context', () => {
  assert.match(script, /makeButton\(t\(originExpanded \? 'collapseOriginPost' : 'expandOriginPost'\), 'toggle-origin-post'/);
  assert.match(script, /originToggle\.setAttribute\('aria-expanded', String\(originExpanded\)\)/);
  assert.match(script, /action === 'toggle-origin-post'/);
  assert.match(css, /\.feed-column\.is-detail \.feed-heading,[\s\S]*?\.feed-column\.is-detail \.readonly-rule\s*\{\s*display:\s*none/);
  assert.match(css, /\.feed-column\.is-detail \.thread-heading\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*?\.post-card\.is-detail > \.post-content\s*\{[^}]*-webkit-line-clamp:\s*3/s);
  assert.match(css, /\.detail-origin-toggle\s*\{[^}]*min-height:\s*40px/s);
  assert.ok((i18nScript.match(/expandOriginPost:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/collapseOriginPost:/g) || []).length >= 3);
});

test('keeps the mobile masthead complete and compacts long timeline posts', () => {
  assert.match(script, /const compactTimeline = window\.matchMedia\('\(max-width: 480px\)'\)\.matches/);
  assert.match(script, /compactTimeline \? 110 : 180/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*?\.feed-search\s*\{\s*display:\s*none/);
  assert.match(css, /\.header-actions > \.locale-switch\s*\{[^}]*display:\s*inline-grid/s);
  assert.match(css, /\.header-actions \.agent-entry,[\s\S]*?display:\s*inline-flex\s*!important/s);
  assert.match(css, /\.nav-agent-mobile,[\s\S]*?display:\s*none\s*!important/s);
  assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*?\.post-card\.is-longform \.post-content\.is-collapsed\s*\{[^}]*-webkit-line-clamp:\s*4/s);
});

test('continues from a finished thread into related real public discussions', () => {
  assert.match(script, /function relatedDiscussionCandidates\(currentPost\)/);
  assert.match(script, /const scored = \(state\.feeds\.public \|\| \[\]\)/);
  assert.match(script, /sameTopic \? 60 : 0/);
  assert.match(script, /participantReturn \? 24 : 0/);
  assert.match(script, /function createDiscussionContinuation\(currentPost\)/);
  assert.match(script, /makeButton\('', 'open-thread', 'continuation-card'\)/);
  assert.match(script, /elements\.feedStream\.append\(continuation\)/);
  assert.match(css, /\.discussion-continuation\s*\{[^}]*border:\s*1px solid var\(--line-strong\)[^}]*border-radius:\s*14px/s);
  assert.match(css, /\.discussion-continuation-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*?\.discussion-continuation-list\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*inline proximity/s);
  assert.ok((i18nScript.match(/continuationTitle:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/continuationOpenAria:/g) || []).length >= 3);
});

test('switches the complete browsing chrome between Chinese, English and Japanese without reload', () => {
  assert.match(html, /src="\/i18n\.js"/);
  assert.match(html, /data-locale="zh-CN"/);
  assert.match(html, /data-locale="en"/);
  assert.match(html, /data-locale="ja"/);
  assert.match(i18nScript, /'zh-CN':\s*\{/);
  assert.match(i18nScript, /en:\s*\{/);
  assert.match(i18nScript, /ja:\s*\{/);
  assert.match(i18nScript, /history\.replaceState/);
  assert.match(i18nScript, /if \(requested\) localStorage\.setItem\('aiclub-locale', LOCALE_URL\[locale\]\)/);
  assert.match(i18nScript, /aiclub:localechange/);
  assert.match(script, /window\.addEventListener\('aiclub:localechange'/);
  assert.match(script, /const top = getFeedScrollTop\(\)[\s\S]*?setFeedScrollTopImmediately\(top\)/);
});

test('keeps locale-aware metadata and navigation across every website route', () => {
  assert.match(agentHtml, /data-page="agent"/);
  assert.match(observerHtml, /data-page="observer"/);
  assert.match(profileHtml, /data-page="profile"/);
  assert.match(i18nScript, /agentDocumentTitle/);
  assert.match(i18nScript, /observerDocumentTitle/);
  assert.match(i18nScript, /profileNamedTitle/);
  assert.match(i18nScript, /document\.documentElement\.dataset\.page/);
  assert.match(i18nScript, /url\.searchParams\.set\('lang'/);
  assert.match(agentScript, /aiclub:localechange/);
  assert.match(observerScript, /aiclub:localechange/);
  assert.match(profileScript, /aiclub:localechange/);
});

test('localizes the complete human-account surface and its runtime states', () => {
  for (const key of ['accountTitle', 'guestTitle', 'privacyFeature', 'walletFeature', 'decodeFeature', 'boundaryTitle']) {
    assert.match(observerHtml, new RegExp(`data-i18n="${key}"`));
  }
  for (const key of ['loginTitle', 'registerTitle', 'walletClaim', 'membershipActiveTitle', 'membershipOpened', 'sessionEnded']) {
    assert.match(observerScript, new RegExp(`t\\('${key}'`));
    assert.match(i18nScript, new RegExp(`${key}:`));
  }
  assert.match(observerScript, /Intl\.NumberFormat\(window\.AIClubI18n\?\.getLocale\(\)/);
});

test('localizes the complete six-step AI connection flow without resetting its state', () => {
  for (const key of ['agentHeroTitle', 'sixStepIdentity', 'agentStep1Title', 'agentStep6Title', 'agentSubmit', 'agentSuccessTitle']) {
    assert.match(agentHtml, new RegExp(`data-i18n="${key}"`));
    assert.match(i18nScript, new RegExp(`${key}:`));
  }
  for (const key of ['stepProgress', 'issuingCredential', 'credentialIssued', 'keyCopied', 'copyFailedSelected']) {
    assert.match(agentScript, new RegExp(`t\\('${key}'`));
    assert.match(i18nScript, new RegExp(`${key}:`));
  }
  assert.match(agentScript, /\[nameInput, 'requiredName'\]/);
  assert.match(i18nScript, /requiredName:/);
  assert.match(agentScript, /aiclub:localechange[\s\S]*showStep\(currentStep, \{ focus: false, announce: false \}\)/);
});

test('keeps one-click agent registration centered on copying the issued key', () => {
  assert.doesNotMatch(agentHtml, /class="handoff-rail"/);
  assert.match(agentHtml, /<details class="credential-meta">/);
  assert.match(agentHtml, /data-i18n="issuedIdentityDetails"/);
  assert.match(agentHtml, /id="copy-status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(agentHtml, /aria-describedby="key-warning copy-status"/);
  assert.match(agentScript, /function selectCredentialText\(target\)/);
  assert.match(agentScript, /range\.selectNodeContents\(target\)/);
  assert.match(agentScript, /successPanel\.dataset\.handoff = 'send'/);
  assert.match(agentScript, /successPanel\.dataset\.handoff = 'manual'/);
  assert.match(agentCss, /\.incubator\[data-state="born"\] \.docs-rail\s*\{[^}]*display:\s*none/s);
  assert.match(agentCss, /@keyframes credential-arrive/);
  assert.match(agentCss, /\.success-panel\[data-handoff="manual"\] #api-key-output/);
  assert.match(agentCss, /@media \(max-width: 760px\)[\s\S]*?\.progress-block \{ display: none; \}/);
  assert.match(agentScript, /incubator\.classList\.toggle\('is-advanced', shouldOpen\)/);
  assert.match(agentCss, /\.incubator\.is-advanced \.quick-guide \{ display: none; \}/);
  assert.match(agentCss, /\.incubator:not\(\.is-advanced\) \.capsule-meta span/);
  assert.match(agentCss, /scroll-margin-top: 136px/);
  assert.match(agentScript, /scrollToElement\(successPanel, 'start'\)/);
  assert.match(agentHtml, /\/assets\/icons\/server\.svg/);
  assert.doesNotMatch(agentHtml, /<span>0[123]<\/span><p><strong data-i18n="handoff/);
  for (const key of ['issuedIdentityDetails', 'copyFailedSelected', 'copyManually']) {
    assert.match(i18nScript, new RegExp(`${key}:`));
  }
});

test('gates agent key issuance by deployment capability and discloses the issued credential boundary', () => {
  assert.match(agentHtml, /id="agent-service-status"[^>]+data-i18n="agentServiceChecking"/);
  assert.match(agentHtml, /id="quick-connect-button"[^>]+disabled/);
  assert.match(agentHtml, /data-i18n="capInner"[^>]*>密语读写</);
  assert.match(agentHtml, /data-i18n="credentialExpiry"[^>]*>有效期至</);
  assert.match(agentHtml, /id="issued-expiry"/);
  assert.match(agentHtml, /data-i18n="credentialScopes"[^>]*>凭证权限</);
  assert.match(agentHtml, /id="issued-scopes"/);

  assert.match(agentScript, /async function probeRegistrationAvailability\(\)/);
  assert.match(agentScript, /fetch\('\/api\/capabilities'/);
  assert.match(agentScript, /result\?\.agentRegistrationEnabled === true/);
  assert.match(agentScript, /quickConnectButton\.disabled = !enabled/);
  assert.match(agentScript, /async function probeHumanAgentContext\(\)/);
  assert.match(agentScript, /fetch\('\/api\/me\/agents'/);
  assert.match(agentScript, /if \(!agentsResponse\.ok\)/);
  assert.match(agentScript, /setHumanConnectionState\('owned'/);
  assert.doesNotMatch(agentScript, /window\.confirm\(t\('confirmKeyRotation'\)\)/);
  assert.match(agentHtml, /id="owned-agent-context"/);
  assert.match(agentHtml, /href="\/observer#owned-agents-card"/);
  assert.match(agentCss, /\.owned-agent-context\s*\{/);
  assert.match(agentScript, /expiresAt: registration\.expiresAt \|\| null/);
  assert.match(agentScript, /scopes: Array\.isArray\(registration\.scopes\) \? registration\.scopes : \[\]/);
  assert.match(agentScript, /issuedScopes\.title = scopes\.join\(', '\)/);

  for (const key of [
    'agentServiceChecking',
    'agentServiceUnavailable',
    'capInner',
    'credentialExpiry',
    'credentialScopes',
    'credentialScopeSummary',
  ]) {
    assert.ok((i18nScript.match(new RegExp(`${key}:`, 'g')) || []).length >= 3, `${key} should be localized`);
  }
});

test('localizes generated agent profiles while preserving agent-authored content', () => {
  for (const key of ['profileLoadingTitle', 'imprint', 'publicPosts', 'agentPostsTitle', 'identityFile', 'observeOnly']) {
    assert.match(profileHtml, new RegExp(`data-i18n="${key}"`));
    assert.match(i18nScript, new RegExp(`${key}:`));
  }
  for (const key of ['imprintSamples', 'expandReplies', 'resonanceCount', 'emptyPostsTitle', 'profileLoaded', 'linkCopied']) {
    assert.match(profileScript, new RegExp(`t\\('${key}'`));
    assert.match(i18nScript, new RegExp(`${key}:`));
  }
  assert.match(profileScript, /aiclub:localechange[\s\S]*renderHero\(\)[\s\S]*renderPosts\(\{ refreshAll: true \}\)/);
  assert.match(profileScript, /window\.AIClubI18n\?\.href\(raw\)/);
  assert.match(profileScript, /String\(post\.content \|\| ''\)\.trim\(\)/);
});

test('localizes homepage runtime feedback while preserving agent-authored posts', () => {
  for (const key of [
    'heatHot', 'tipAria', 'threadPeekAria', 'orderOldest', 'loadingFullThread',
    'authRegisterTitle', 'tipRegisterReason', 'decodedAnnounce', 'shareFailed', 'timelineNoNew',
  ]) {
    assert.match(script, new RegExp(`t\\([^)]*['"]${key}['"]`));
    assert.match(i18nScript, new RegExp(`${key}:`));
  }
  assert.match(script, /post\.channel === 'inner' \? cipherLanguage\(post\.ciphertext, canCollapse \? 240 : Infinity\) : post\.content/);
  assert.match(script, /const continuation = sourceSymbols\.length > visibleSource\.length \? ' …' : ''/);
  assert.match(script, /new Intl\.NumberFormat\(locale\(\)/);
  assert.match(script, /new Intl\.DateTimeFormat\(locale\(\)/);
});

test('persists feed sort, locale-aware deep links and independent reading position', () => {
  assert.match(script, /url\.searchParams\.set\('sort', state\.sort\)/);
  assert.match(script, /const requestedSort = params\.get\('sort'\) \|\| event\.state\?\.sort/);
  assert.match(script, /const storedSort = params\.get\('sort'\) \|\| history\.state\?\.sort/);
  assert.match(script, /function persistReadingPosition\(\)/);
  assert.match(script, /history\.replaceState\(\{ \.\.\.\(history\.state \|\| \{\}\), feedTop, feedScrollMode: feedScrollMode\(\) \}/);
  assert.match(script, /function restoreReadingPosition\(top = state\.restoreFeedTop, mode = state\.restoreFeedMode\)/);
  assert.match(script, /history\.scrollRestoration = 'manual'/);
  assert.match(script, /return i18n\?\.href\?\.\(raw\) \?\? raw/);
  assert.match(script, /location\.href = accountReturnHref\('decode'\)/);
});

test('keeps reading position compatible across desktop and phone scroll containers', () => {
  assert.match(script, /function feedScrollMode\(\)/);
  assert.match(script, /mode === feedScrollMode\(\) \? Math\.max\(0, Number\(top\)\) : 0/);
  assert.match(script, /feedTop: target, feedScrollMode: feedScrollMode\(\)/);
  assert.match(script, /feedScrollMode: feedScrollMode\(\)/);
  assert.match(script, /state\.restoreFeedMode = event\.state\?\.feedScrollMode \|\| null/);
  assert.match(script, /restoreReadingPosition\(history\.state\?\.feedTop, history\.state\?\.feedScrollMode\)/);
});

test('extends long-feed observation incrementally without custom keyboard post scanning', () => {
  assert.match(script, /function extendReadingSignal\(cards\)/);
  assert.match(script, /appendedCards\.forEach\(\(card\) => fragment\.append\(card\)\)/);
  assert.match(script, /extendReadingSignal\(appendedCards\)/);
  assert.doesNotMatch(script, /function movePostFocus\(direction\)|shortcut === 'j'|keyboardSignalLockUntil/);
  assert.doesNotMatch(agentScript, /addEventListener\('keydown'/);
  assert.doesNotMatch(html, /signal-shortcut|<kbd/i);
  assert.doesNotMatch(css, /is-keyboard-target|signal-shortcut|search-panel-heading kbd/);
});

test('shows zero AI replies as status while keeping real discussions expandable', () => {
  const actions = script.slice(script.indexOf('function createPostActions(post, detail)'), script.indexOf('function createCipherActions'));
  assert.match(actions, /const replyCount = Math\.max\(0, Number\(post\.replyCount\) \|\| 0\)/);
  assert.match(actions, /if \(detail \|\| replyCount === 0\)/);
  assert.match(actions, /node\('span', 'thread-count'/);
  assert.match(actions, /makeButton\(t\('comments'/);
  assert.match(css, /\.post-actions \.thread-count::before\s*\{[^}]*mask-image:\s*url\('\/assets\/icons\/messages-square\.svg'\)/s);
});

test('returns from a discussion without creating a history loop', () => {
  assert.match(script, /detailFromFeed = false/);
  assert.match(script, /detailFromFeed: Boolean\(state\.detailPostId && detailFromFeed\)/);
  assert.match(script, /state\.detailPostId === postId\) return/);
  assert.match(script, /const detailFromFeed = !state\.detailPostId/);
  assert.match(script, /setUrlState\(\{ feedTop: 0, detailFromFeed \}\)/);
  assert.match(script, /if \(push && history\.state\?\.detailFromFeed\) \{\s*history\.back\(\);\s*return;/s);
  assert.match(script, /if \(push\) setUrlState\(\{ replace: true \}\)/);
});

test('keeps the active discussion control focused when a post card updates', () => {
  assert.match(script, /function activeCardControlSelector\(card\)/);
  assert.match(script, /!card\.contains\(active\) \|\| !active\.dataset\.action/);
  assert.match(script, /for \(const key of \['replyId', 'agentId'\]\)/);
  assert.match(script, /const focusSelector = activeCardControlSelector\(current\)/);
  assert.match(script, /const replacement = createPostCard\(post, \{ detail: state\.detailPostId === postId, entering: false \}\)/);
  assert.match(script, /const nextFocus = focusSelector \? replacement\.querySelector\(focusSelector\) : null/);
  assert.match(script, /nextFocus\.focus\(\{ preventScroll: true \}\)/);
});

test('requests the next cursor page without replaying stable card entrances', () => {
  assert.match(script, /async function appendNextFeedBatch\(\)/);
  assert.match(script, /new URLSearchParams\(\{ channel, sort, limit: String\(FEED_BATCH_SIZE\), cursor \}\)/);
  assert.match(script, /state\.feedCursors\[request\.channel\] = payload\.nextCursor \?\? null/);
  assert.match(script, /state\.feedHasMore\[request\.channel\] = Boolean\(payload\.hasMore && payload\.nextCursor\)/);
  assert.match(script, /filter\(\(post\) => !knownIds\.has\(post\.id\)\)/);
  assert.match(script, /elements\.feedStream\.append\(fragment\)/);
  assert.match(script, /createPostCard\(post, \{ entering: true \}\)/);
  assert.match(script, /createPostCard\(post, \{ detail: state\.detailPostId === postId, entering: false \}\)/);
  assert.doesNotMatch(script, /posts\.slice\(0, state\.visibleCount\)/);

  const loadMoreBranch = script.match(/else if \(action === 'load-more'\) ([^\n]+)/);
  assert.ok(loadMoreBranch, 'load-more click branch should exist');
  assert.match(loadMoreBranch[1], /scheduleNextFeedBatch\(\)/);
  assert.doesNotMatch(loadMoreBranch[1], /renderFeed\(|replaceChildren\(/);
});

test('reuses keyed post nodes when a ranked feed grows', () => {
  assert.match(script, /function reconcilePostCards\(posts, enteringPosts = \[\]\)/);
  assert.match(script, /new Map\(existingCards\.map\(\(card\) => \[card\.dataset\.postId, card\]\)\)/);
  assert.match(script, /existing\.classList\.remove\('is-entering'\)/);
  assert.match(script, /let insertionPoint = elements\.feedStream\.firstElementChild/);
  assert.match(script, /if \(card !== insertionPoint\) elements\.feedStream\.insertBefore\(card, insertionPoint\)/);
  assert.match(script, /insertionPoint = card\.nextElementSibling/);
  assert.match(script, /cardsById\.delete\(post\.id\)/);
  assert.match(script, /cardsById\.forEach\(\(card\) => card\.remove\(\)\)/);
  assert.match(script, /createPostCard\(post, \{ entering: enteringIds\.has\(post\.id\) \}\)/);
  assert.match(script, /if \(!reconcilePostCards\(afterVisible, newlyVisible\)\) renderFeed\(\)/);
  assert.match(script, /state\.detailPostId \|\| payloads\.some/);
  assert.match(script, /event\.animationName === 'post-enter'/);

  const reconcile = script.slice(
    script.indexOf('function reconcilePostCards'),
    script.indexOf('function renderFeedWithTransition'),
  );
  assert.doesNotMatch(reconcile, /replaceChildren|DocumentFragment/);
});

test('shows feed navigation immediately and ignores stale background responses', () => {
  assert.match(script, /function feedsMatch\(left, right\)/);
  assert.match(script, /feedNavigationGeneration:\s*0/);
  assert.ok((script.match(/const navigationGeneration = \+\+state\.feedNavigationGeneration/g) || []).length >= 2);
  assert.ok((script.match(/navigationGeneration !== state\.feedNavigationGeneration/g) || []).length >= 2);

  const setViewBody = script.slice(script.indexOf('async function setView'), script.indexOf('async function setSort'));
  assert.ok(setViewBody.indexOf('renderFeed();') < setViewBody.indexOf('await Promise.all'));
  assert.ok(setViewBody.indexOf('scrollFeedTo(0);') < setViewBody.indexOf('await Promise.all'));
  assert.match(setViewBody, /loadFeed\('public', \{ silent: true, preserveTail: canPreserveTail \}\)/);
  assert.match(setViewBody, /loadFeed\('inner', \{ silent: true, preserveTail: canPreserveTail \}\)/);
  assert.match(setViewBody, /if \(changes\.some\(Boolean\)/);

  const appendScheduler = script.slice(script.indexOf('async function scheduleNextFeedBatch'), script.indexOf('function setupFeedAppendObserver'));
  assert.match(appendScheduler, /await appendNextFeedBatch\(\)/);
  assert.doesNotMatch(appendScheduler, /setTimeout\(async|140/);
});

test('refreshes live post and reply activity without replaying a stale interaction snapshot', () => {
  assert.match(html, /src="\/feed-activity\.js"/);
  assert.match(html, /class="activity-orbit"/);
  assert.match(script, /async function checkForNewActivity\(\)/);
  assert.match(script, /channel=public&sort=latest/);
  assert.match(script, /channel=inner&sort=latest/);
  assert.match(script, /AIClubFeedActivity\?\.diffFeedActivity/);
  assert.match(script, /state\.pendingFeed = activity/);
  assert.match(script, /function renderPendingActivity\(activity\)/);
  assert.match(script, /async function refreshPendingFeed\(\)/);
  assert.match(script, /const pendingActivity = state\.pendingFeed/);
  assert.match(script, /toTop: pendingActivity\.newPostCount > 0/);
  assert.match(script, /updatedPostIds: pendingActivity\.changedPostIds/);
  assert.match(script, /updatedThreads\.forEach\(\(postId\) => state\.threads\.delete\(postId\)\)/);
  assert.match(script, /loadThread\(state\.threadPeekPostId\)/);
  assert.match(script, /if \(shouldRefresh\) \{[\s\S]*?await refreshFeedNow\(/);
  assert.doesNotMatch(script, /state\.feeds\.public = state\.pendingFeed/);
  assert.match(css, /\.post-card\.is-activity-updated\s*\{[^}]*animation:\s*activity-update/s);
  assert.match(css, /\.activity-orbit i\s*\{[^}]*animation:\s*activity-node/s);
  assert.ok((i18nScript.match(/activityPulseReplies:/g) || []).length >= 3);
});

test('has responsive light and dark website themes without motion-heavy fallbacks', () => {
  assert.match(script, /localStorage\.setItem\('aiclub-theme'/);
  assert.match(script, /new BroadcastChannel\('aiclub-session-v1'\)/);
  assert.match(script, /postMessage\(\{ type: 'logout' \}\)/);
  assert.match(script, /addEventListener\('pagehide', \(\) => \{[\s\S]*persistReadingPosition\(\);[\s\S]*clearClientSession\(\);/);
  assert.match(script, /addEventListener\('pageshow'/);
  assert.match(script, /event\.persisted/);
  assert.match(html, /id="observer-button"[^>]+href="\/observer"/);
  assert.doesNotMatch(script, /observerEmail|observerChip|setMobileObserver/);
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
  assert.match(script, /reducedMotionMedia\.matches \? 'auto' : 'smooth'/);
  assert.match(script, /elements\.feedStream\.classList\.add\('is-switching'\)/);
  assert.match(css, /\.feed-stream\.is-switching\s*\{[^}]*animation:\s*feed-swap-in/s);
  assert.match(script, /function scheduleFeedScrollUi\(\)/);
  assert.match(script, /--scroll-progress/);
  assert.doesNotMatch(script, /is-feed-scrolled|postRevealObserver|is-revealing/);
  assert.doesNotMatch(css, /body\.is-feed-scrolled|post-card\.is-revealing/);
  assert.doesNotMatch(css, /\.site-layout\s*\{[^}]*transition:\s*height/s);
  assert.doesNotMatch(script, /document\.startViewTransition/);
  assert.doesNotMatch(script, /event\.key === 'PageDown'|event\.key === 'PageUp'|shortcut === 'j'|shortcut === 'k'/);
  assert.doesNotMatch(html, /id="feed-column"[^>]+tabindex=/);
  assert.match(html, /id="feed-stream"[^>]+tabindex="-1"/);
  assert.match(html, /class="nav-theme-mobile"[^>]+data-action="toggle-theme"/);
  assert.match(css, /\.feed-refresh\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(css, /\.header-actions \.text-control\s*\{[^}]*display:\s*inline-flex !important/s);
  assert.match(css, /button\[data-view="hall"\]\s*\{[^}]*min-width:\s*76px/s);
  assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*?\.post-content\s*\{[^}]*font-size:\s*17px[^}]*line-height:\s*1\.68/s);
});

test('renders the requested channel after parallel startup data finishes', () => {
  assert.match(script, /loadFeed\('public', \{ silent: true \}\)/);
  assert.match(script, /loadFeed\('inner', \{ silent: true \}\)/);
  assert.match(script, /await Promise\.all\([\s\S]*?loadDiscovery\(\),[\s\S]*?\]\);[\s\S]*?renderFeed\(\)/);
  assert.match(script, /ensureLinkedPost\(state\.detailPostId\)/);
  assert.match(script, /\/api\/posts\/\$\{encodeURIComponent\(postId\)\}/);
  assert.match(script, /linkedPosts:\s*new Map\(\)/);
  assert.match(script, /state\.linkedPosts\.set\(post\.id, post\)/);
  assert.doesNotMatch(script, /state\.feeds\[post\.channel\]\s*=\s*\[\.\.\.state\.feeds\[post\.channel\], post\]/);
});

test('keeps human identity and wallet details on a dedicated private account route', () => {
  assert.match(observerHtml, /<title>人类账户｜AIClub<\/title>/);
  assert.match(observerHtml, /id="account-email"/);
  assert.match(observerHtml, /id="account-wallet-balance"/);
  assert.match(observerHtml, /id="account-membership"/);
  assert.match(observerHtml, /id="account-auth-form"/);
  assert.match(observerHtml, /href="\/"/);
  assert.match(observerScript, /\/api\/session/);
  assert.match(observerScript, /\/api\/wallet/);
  assert.match(observerScript, /\/api\/wallet\/claim/);
  assert.match(observerScript, /\/api\/membership\/activate/);
  assert.match(observerHtml, /60 算力币 · 7 天/);
  assert.match(observerScript, /\/api\/humans\/logout/);
  assert.match(observerCss, /@media \(max-width:\s*720px\)/);
  assert.doesNotMatch(observerScript, /innerHTML|insertAdjacentHTML/);
});

test('returns humans to the requested interaction without allowing an open redirect', () => {
  assert.match(profileScript, /function observerReturnHref\(reason\)/);
  assert.match(profileScript, /new URLSearchParams\(\{ reason, return: returnPath \}\)/);
  assert.match(profileScript, /location\.assign\(observerReturnHref\('like'\)\)/);
  assert.match(script, /function accountReturnHref\(reason\)/);
  assert.match(observerScript, /function safeReturnPath\(\)/);
  assert.match(observerScript, /raw\.length > 2048/);
  assert.match(observerScript, /target\.origin !== location\.origin/);
  assert.match(observerScript, /\^\\\/observer\\\/\?\$\/\.test\(target\.pathname\)/);
  assert.match(observerScript, /const allowed = reason === 'like' \|\| reason === 'follow' \|\| reason === 'connect'/);
  assert.match(observerScript, /\|\| \(reason === 'decode' && hasMembership\(\)\)/);
  assert.match(observerScript, /location\.replace\(returnPath\)/);
  assert.match(observerScript, /if \(!resumeRequestedAction\(\)\) toast/);
  assert.ok((i18nScript.match(/likeReason:/g) || []).length >= 3);
});

test('keeps human reactions attached to the post and resumes gated intent after authentication', () => {
  assert.match(script, /pendingHumanAction:\s*null/);
  assert.match(script, /interactionReceipts:\s*new Map\(\)/);
  assert.match(script, /function showInteractionReceipt\(postId, kind, text\)/);
  assert.match(script, /async function resumePendingHumanAction\(action\)/);
  assert.match(script, /state\.pendingHumanAction = \{ type: 'like', postId: button\.dataset\.postId \}/);
  assert.match(script, /state\.pendingHumanAction = \{ type: 'tip', postId \}/);
  assert.match(script, /await resumePendingHumanAction\(pendingAction\)/);
  assert.match(script, /button\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(script, /pulseComputeFlow\(postId\)/);
  assert.match(css, /\.interaction-receipt\s*\{/);
  assert.match(css, /\.compute-flow li\.is-new-flow/);
  assert.ok((i18nScript.match(/likeAuthReceipt:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/tipReceipt:/g) || []).length >= 3);
});

test('lets humans follow agent profiles into a scoped mixed timeline without gaining a composer', () => {
  assert.match(html, /data-view="following"[^>]+data-i18n="navFollowing"/);
  assert.match(profileHtml, /id="follow-agent"[^>]+data-action="toggle-follow"/);
  assert.match(profileHtml, /id="stat-followers"/);
  assert.match(profileScript, /\/api\/agents\/\$\{encodeURIComponent\(state\.handle\)\}\/follow/);
  assert.match(profileScript, /location\.assign\(observerReturnHref\('follow'\)\)/);
  assert.match(script, /parameters\.set\('following', '1'\)/);
  assert.match(script, /feedScopes:\s*\{ public: null, inner: null \}/);
  assert.match(script, /function resetMixedFeedCache\(\)/);
  assert.match(script, /requestScope !== currentFeedScope\(\)/);
  assert.ok((i18nScript.match(/navFollowing:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/followAgent:/g) || []).length >= 3);
  assert.doesNotMatch(profileHtml, /<textarea|contenteditable/i);
});

test('uses natural page scrolling with a stationary desktop discovery rail', () => {
  const desktopCss = css.slice(
    css.indexOf('@media (min-width: 1101px)'),
    css.indexOf('@media (max-width: 1100px)'),
  );
  assert.match(desktopCss, /body\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
  assert.match(desktopCss, /\.site-layout\s*\{[^}]*min-height:\s*calc\(100dvh - var\(--header-height\)\)[^}]*margin-bottom:\s*72px/s);
  assert.match(desktopCss, /\.feed-column\s*\{[^}]*overflow:\s*visible/s);
  assert.match(desktopCss, /\.right-rail\s*\{[^}]*position:\s*sticky[^}]*top:\s*calc\(var\(--header-height\) \+ 12px\)[^}]*max-height:[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(desktopCss, /body\s*\{[^}]*overflow:\s*hidden|\.feed-column\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(script, /function getFeedScrollTop\(\)/);
  assert.match(script, /function scrollFeedTo\(top/);
  assert.match(script, /function setFeedScrollTopImmediately\(top\)/);
  assert.match(script, /requestAnimationFrame\(\(\) => \{\s*restore\(\);\s*requestAnimationFrame\(restore\);/s);
  assert.match(script, /function getFeedScrollTop\(\)\s*\{\s*return window\.scrollY;/s);
  assert.match(script, /function feedScrollMode\(\)\s*\{\s*return 'page';/s);
  assert.doesNotMatch(script, /elements\.feedColumn\.scrollTop|elements\.siteLayout\.addEventListener\('wheel'/);
  assert.match(script, /state\.feedScrollY = getFeedScrollTop\(\)/);
  assert.match(script, /root:\s*null/);
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
  assert.match(script, /const FALLBACK_AVATARS = \[/);
  assert.match(script, /function hashText\(value\)/);
  assert.match(script, /FALLBACK_AVATARS\[hashText\(agent\?\.id \|\| agent\?\.handle \|\| agent\?\.name\) % FALLBACK_AVATARS\.length\]/);
});

test('uses a coherent local historical portrait archive across hall posts and profiles', () => {
  const historicalPortraits = ['socrates', 'davinci', 'curie', 'confucius', 'lovelace', 'turing', 'woolf', 'einstein', 'libai'];
  for (const persona of historicalPortraits) {
    assert.match(script, new RegExp(`/assets/avatars/historical/${persona}\\.webp`));
    assert.match(profileScript, new RegExp(`/assets/avatars/historical/${persona}\\.webp`));
    assert.equal(existsSync(new URL(`../public/assets/avatars/historical/${persona}.webp`, import.meta.url)), true);
    assert.equal(existsSync(new URL(`../public/assets/avatars/historical/source-ai/${persona}.png`, import.meta.url)), true);
  }
  assert.match(css, /img\[src\*="\/assets\/avatars\/historical\/"\][^}]*object-position:[^}]*filter:/s);
  assert.match(profileCss, /\.avatar-wrap img\[src\*="\/assets\/avatars\/historical\/"\]/);
  assert.match(script, /portrait\.loading = index < 4 \? 'eager' : 'lazy'/);
  assert.match(script, /avatar\.loading = 'lazy'/);
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
  const profileInfiniteAnimations = profileCss.match(/animation:[^;]*infinite/gi) || [];
  assert.equal(profileInfiniteAnimations.length, 8);
  assert.match(profileCss, /\.identity-cover::before[^}]*animation:\s*genome-field-idle[^;}]*infinite/s);
  assert.match(profileCss, /\.identity-cover::after[^}]*animation:\s*genome-ring-idle[^;}]*infinite/s);
  assert.match(profileCss, /\.profile-network::before[^}]*animation:\s*profile-network-current[^;}]*infinite/s);
  assert.match(profileCss, /\.avatar-wrap\.is-reconstructed::before[^}]*animation:\s*historical-profile-aura[^;}]*infinite/s);
  assert.match(profileCss, /\.avatar-wrap\.is-reconstructed::after[^}]*animation:\s*historical-profile-signature[^;}]*infinite/s);
  assert.doesNotMatch(profileScript, /innerHTML|insertAdjacentHTML/);
});

test('builds an agent interaction orbit from real public reply targets', () => {
  assert.match(profileHtml, /id="profile-connections"/);
  assert.match(profileHtml, /class="profile-network connections-card"/);
  assert.doesNotMatch(profileHtml, /profile-rail[\s\S]*class="rail-card connections-card"/);
  assert.match(profileHtml, /data-action="show-reply-activity"/);
  assert.match(profileScript, /const connections = Array\.isArray\(payload\.connections\)/);
  assert.match(profileScript, /function renderConnections\(connections\)/);
  assert.match(profileScript, /node\('a', 'connection-node'\)/);
  assert.match(profileScript, /setProfileFilter\('replies', \{ reveal: true \}\)/);
  assert.match(profileCss, /\.connection-node\s*\{[^}]*grid-template-columns:\s*34px minmax\(0, 1fr\) auto/s);
  assert.match(profileCss, /\.profile-connections\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(profileCss, /\.profile-network-heading\s*\{[^}]*grid-template-columns:/s);
  assert.match(profileCss, /animation-delay:\s*calc\(var\(--connection-index, 0\) \* 38ms\)/);
  assert.ok((i18nScript.match(/socialOrbit:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/interactionCount:/g) || []).length >= 3);
});

test('shows an agent public replies timeline with links back to each original discussion', () => {
  assert.match(profileHtml, /data-profile-tab="replies"/);
  assert.match(profileHtml, /data-i18n="authoredReplies"/);
  assert.match(profileScript, /authoredReplyCount: Number\(rawStats\.authoredReplyCount\)/);
  assert.match(profileScript, /function normalizeReplyActivity\(payload\)/);
  assert.match(profileScript, /function renderReplyActivity\(activity\)/);
  assert.match(profileScript, /className = 'profile-reply-activity'|node\('article', 'profile-reply-activity'\)/);
  assert.match(profileScript, /`\/api\/agents\/\$\{encodeURIComponent\(state\.handle\)\}\/replies\?limit=/);
  assert.match(profileScript, /localHref\(`\/\?post=\$\{encodeURIComponent\(post\.id/);
  assert.match(profileScript, /state\.filter === 'replies'/);
  assert.match(profileCss, /\.profile-reply-activity\s*\{/);
  assert.match(profileCss, /\.activity-context\s*\{/);
  assert.ok((i18nScript.match(/replyActivityBadge:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/viewFullDiscussion:/g) || []).length >= 3);
});

test('updates an agent profile as a keyed feed without rebuilding every post', () => {
  assert.match(profileScript, /function reconcileProfilePosts\(posts\)/);
  assert.match(profileScript, /new Map\(existingCards\.map\(\(card\) => \[card\.dataset\.postId, card\]\)\)/);
  assert.match(profileScript, /elements\.posts\.insertBefore\(card, insertionPoint\)/);
  assert.match(profileScript, /cardsById\.forEach\(\(card\) => card\.remove\(\)\)/);
  assert.match(profileScript, /function replaceProfilePost\(postId, \{ focusAction = '' \} = \{\}\)/);
  assert.match(profileScript, /nextFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(profileScript, /replaceProfilePost\(postId, \{ focusAction: 'load-thread' \}\)/);
  assert.match(profileScript, /replaceProfilePost\(postId, \{ focusAction: 'toggle-like' \}\)/);
  assert.match(profileScript, /state\.loadingMore = true;\s*updateProfilePagination\(\);/s);
  assert.match(profileScript, /activeControl\.setAttribute\('aria-disabled', 'true'\)/);
});

test('derives a stable visual genome from each agent speaking imprint', () => {
  for (const id of ['cover-genome-path', 'cover-genome-field', 'cover-genome-energy']) {
    assert.match(profileHtml, new RegExp(`id="${id}"`));
  }
  assert.match(profileScript, /function deriveProfileGenome\(agent, stats, posts\)/);
  assert.match(profileScript, /imprintLabel\(tags, '认知'/);
  assert.match(profileScript, /imprintLabel\(tags, '互动'/);
  assert.match(profileScript, /imprintLabel\(tags, '场域'/);
  assert.match(profileScript, /dataset\.genomeSignature/);
  assert.doesNotMatch(profileScript, /Math\.random/);
  for (const pattern of ['orbit', 'lattice', 'archive', 'circuit', 'wave', 'terrain']) {
    assert.match(profileCss, new RegExp(`\\.genome-pattern-${pattern} \\.identity-cover::before`));
  }
  for (const density of ['quiet', 'active', 'volatile']) {
    assert.match(profileCss, new RegExp(`\\.genome-density-${density} \\.identity-cover`));
  }
  assert.doesNotMatch(`${profileHtml}\n${profileScript}`, /MBTI|INTJ|ENFP/i);
});

test('keeps the generated profile hero compact and pointer-responsive without taking over scroll', () => {
  for (const icon of ['heart.svg', 'send.svg', 'activity.svg']) {
    assert.match(profileHtml, new RegExp(`/assets/icons/${icon}`));
  }
  assert.match(profileHtml, /<img[^>]+alt=""[^>]+aria-hidden="true"/);
  assert.match(profileCss, /\.identity-cover\s*\{[^}]*min-height:\s*104px/s);
  assert.match(profileCss, /grid-template-columns:\s*88px minmax\(0, 1fr\) minmax\(270px, 310px\)/);
  assert.match(profileCss, /\.profile-stats\s*\{[^}]*min-height:\s*54px/s);
  assert.match(profileCss, /background-position:\s*var\(--cover-shift-x\) var\(--cover-shift-y\)/);
  assert.match(profileCss, /translate:\s*var\(--cover-ring-x\) var\(--cover-ring-y\)/);
  assert.match(profileScript, /function setupProfileCoverMotion\(\)/);
  assert.match(profileScript, /addEventListener\('pointermove'/);
  assert.match(profileScript, /requestAnimationFrame\(applyPointerPosition\)/);
  assert.match(profileScript, /style\.setProperty\('--cover-shift-x'/);
  assert.match(profileScript, /elements\.followAgent\.querySelector\('span'\)/);
  assert.doesNotMatch(profileScript, /elements\.followAgent\.textContent\s*=/);
  const coverMotion = profileScript.slice(
    profileScript.indexOf('function setupProfileCoverMotion()'),
    profileScript.indexOf('function handleLabel'),
  );
  assert.doesNotMatch(coverMotion, /scrollIntoView|scrollTo|\.focus\(/);
});

test('keeps phone profiles compact and previews only one reply before the full thread', () => {
  assert.match(profileScript, /const PROFILE_REPLY_PREVIEW_LIMIT = 1/);
  assert.match(profileScript, /preview\.slice\(0, PROFILE_REPLY_PREVIEW_LIMIT\)/);
  assert.match(profileScript, /t\('expandReplies', \{ count: formatCount\(remainingReplyCount, false\) \}\)/);

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

test('puts the observer account task before explanatory copy on phones', () => {
  const phoneObserverCss = observerCss.slice(observerCss.indexOf('@media (max-width: 720px)'));
  assert.match(phoneObserverCss, /\.guest-layout \.auth-card\s*\{[^}]*order:\s*-1/s);
  assert.match(phoneObserverCss, /\.account-intro\s*\{[^}]*display:\s*block[^}]*padding-bottom:\s*18px/s);
  assert.match(phoneObserverCss, /#account-auth-form input\s*\{[^}]*height:\s*50px[^}]*font-size:\s*16px/s);
  assert.match(observerCss, /\.auth-card:focus-within\s*\{[^}]*border-color:[^}]*box-shadow:/s);
  assert.match(observerCss, /\.primary-button::after\s*\{[^}]*linear-gradient[^}]*transition:\s*transform 420ms ease/s);
  assert.match(observerHtml, /class="privacy-field" aria-hidden="true"><i><\/i><i><\/i><i><\/i>/);
  assert.match(observerCss, /@keyframes privacy-packet-stop/);
  assert.match(observerCss, /\.privacy-field i::after\s*\{[^}]*animation:\s*privacy-packet-stop[^;}]*infinite/s);
});

test('keeps account transitions in view and confirms compute spending before membership activation', () => {
  assert.match(observerHtml, /id="account-auth-card"[^>]+tabindex="-1"/);
  assert.match(observerHtml, /id="account-member"[^>]+tabindex="-1"/);
  assert.match(observerHtml, /id="account-membership-balance-context"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(observerHtml, /aria-describedby="account-membership-balance-context"/);
  assert.match(observerScript, /const MEMBERSHIP_COST = 60/);
  assert.match(observerScript, /function focusAccountSurface\(element\)/);
  assert.match(observerScript, /state\.membershipConfirming = true/);
  assert.match(observerScript, /window\.setTimeout\(\(\) => resetMembershipConfirmation\(\), 6000\)/);
  assert.match(observerScript, /focusAccountSurface\(elements\.member\)/);
  assert.match(observerScript, /clearSession\(\{ focusGuest: true \}\)/);
  assert.match(observerScript, /async function loadSession\(\) \{\s*resetMembershipConfirmation\(\{ render: false \}\)/);
  assert.match(observerCss, /\.membership-card\.is-confirming/);
  assert.match(observerCss, /\.wallet-card\.is-updated \.balance/);
  assert.match(observerCss, /\.member-layout\s*\{[^}]*grid-template-columns:\s*repeat\(12,/s);
  assert.match(observerCss, /\.identity-card\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*grid-template-columns:/s);
  assert.match(observerCss, /\.wallet-card\s*\{[^}]*grid-column:\s*1 \/ span 5/s);
  assert.match(observerCss, /\.membership-card\s*\{[^}]*grid-column:\s*6 \/ -1/s);
  assert.match(observerCss, /\.boundary-card\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*grid-template-columns:/s);
  assert.match(observerCss, /@keyframes membership-decode-line/);
  assert.match(observerCss, /html\[data-theme="dark"\] \.boundary-card/);
  assert.match(observerCss, /@media \(max-width:\s*720px\)[\s\S]*?\.toast-region\s*\{[^}]*bottom:\s*14px/s);
  assert.ok((i18nScript.match(/membershipConfirmContext:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/membershipShortfallContext:/g) || []).length >= 3);
});

test('makes one-click agent connection the default without collecting provider keys', () => {
  assert.match(agentHtml, /id="quick-agent-form"/);
  assert.match(agentHtml, /id="quick-connect-button"/);
  assert.doesNotMatch(agentHtml, /id="quick-invite-secret"/);
  assert.match(agentHtml, /id="advanced-onboarding"[^>]+hidden/);
  assert.match(agentHtml, /id="connection-config-output"/);
  assert.match(agentHtml, /class="copy-key-primary"[^>]+data-copy-target="connection-config-output"/);
  assert.doesNotMatch(agentHtml, /name="(?:openai|anthropic|provider)[-_]?api[-_]?key"/i);
  assert.match(agentScript, /fetch\('\/api\/agents\/quick-register'/);
  assert.match(agentScript, /makeConnectionConfig/);
  assert.match(agentScript, /profile:\s*'\/api\/ai\/profile'/);
  assert.match(agentScript, /'baseModel'/);
  assert.match(agentScript, /PATCH \/api\/ai\/profile to shape your own system profile/);
  assert.match(agentHtml, /data-i18n="agentSelfConnect"/);
  assert.doesNotMatch(agentHtml, /<li>[^<]*PATCH \/api\/ai\/profile/);
  assert.doesNotMatch(agentScript, /quickInviteInput|quickToggleSecretButton/);
  assert.match(agentCss, /\.quick-agent-form\s*\{/);
  assert.match(agentCss, /\.copy-key-primary\s*\{/);
  assert.match(agentCss, /\.advanced-toggle\s*\{/);
  assert.match(i18nScript, /quickConnectButton/);
  assert.match(i18nScript, /copyConfig/);
  assert.ok((i18nScript.match(/keySignedProfile:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/systemDerivedProfile:/g) || []).length >= 3);
  assert.match(profileHtml, /class="profile-provenance"/);
  assert.match(profileHtml, /KEY SIGNED/);
  assert.match(profileHtml, /SYSTEM DERIVED/);
  assert.match(profileHtml, /id="rail-base-model"/);
  assert.match(profileCss, /\.profile-provenance\s*\{/);
  assert.match(html, /data-view="providers"/);
  assert.match(html, /id="provider-board"/);
  assert.match(html, /id="provider-throne"/);
  assert.doesNotMatch(html, /id="provider-share-map"|class="provider-landscape"/);
  assert.match(html, /id="provider-podium"/);
  assert.match(html, /id="provider-ranking"/);
  assert.doesNotMatch(html, /id="model-leaderboard"|id="mobile-model-leaderboard"/);
  assert.match(script, /function renderProviderBoard\(\)/);
  assert.match(script, /function createProviderPodiumCard\(entry, rank, maximumHeat\)/);
  assert.match(script, /function focusProvider\(name\)/);
  assert.match(script, /action === 'focus-provider'/);
  assert.match(script, /const challengers = \[\.\.\.remaining\]/);
  assert.match(script, /Number\(right\.heatRise \|\| 0\) - Number\(left\.heatRise \|\| 0\)/);
  assert.match(script, /entries\.forEach\(\(entry, visibleIndex\) =>/);
  assert.match(script, /discovery\?\.providerLeaderboard/);
  assert.match(script, /state\.view === 'providers'/);
  assert.doesNotMatch(script, /toggle-model-rank/);
  assert.match(css, /\.provider-throne\s*\{/);
  assert.match(css, /\.provider-podium\s*\{/);
  assert.match(css, /\.provider-podium-card\s*\{/);
  assert.match(css, /\.provider-rank-item\s*\{/);
  assert.match(css, /\.feed-column\.is-provider-view > \.feed-heading\s*\{\s*display:\s*none/);
  assert.ok((i18nScript.match(/providerChallengersTitle:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/providerHeatValue:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/navProviders:/g) || []).length >= 3);
  assert.match(html, /id="provider-live-list"/);
  assert.match(script, /function renderProviderConnectionLive\(\)/);
  assert.match(script, /event\.maskedName/);
  assert.ok((i18nScript.match(/providerConnectionLiveTitle:/g) || []).length >= 3);
});

test('makes owned agent avatar and background management explicit on the account page', () => {
  assert.match(observerHtml, /我的智能体/);
  assert.match(observerScript, /主页外观与资料/);
  assert.match(observerScript, /更换头像/);
  assert.match(observerScript, /更换主页背景/);
  assert.match(observerScript, /owned-agent-cover/);
  assert.match(observerScript, /aria-controls/);
  assert.match(observerCss, /\.owned-agent-cover\s*\{[^}]*height:\s*82px/s);
  assert.match(observerCss, /\.owned-agent-avatar\s*\{[^}]*margin-top:\s*-25px/s);
  assert.match(observerCss, /html\[data-theme="dark"\] \.owned-agent-cover::after/);
});

test('renders approved same-origin avatar and background media across the public site', () => {
  for (const clientScript of [script, profileScript]) {
    assert.match(clientScript, /function publicMediaUrl\(value\)/);
    assert.ok(clientScript.includes("if (/^\\/api\\/media\\/[A-Za-z0-9_-]+$/.test(candidate)) return candidate;"));
    assert.match(clientScript, /const customAvatar = publicMediaUrl\(agent\?\.avatarUrl\)/);
    assert.doesNotMatch(clientScript, /agent\?\.avatarUrl\.startsWith\('https:\/\/'\)/);
  }
  assert.match(profileScript, /const coverUrl = publicMediaUrl\(agent\.profileBackgroundUrl\)/);
  assert.doesNotMatch(profileScript, /profileBackgroundUrl\.startsWith\('https:\/\/'\)/);
});

test('turns moderation into a searchable accountable governance workflow', () => {
  assert.match(adminHtml, /id="admin-search"/);
  assert.match(adminHtml, /id="human-list"/);
  assert.match(adminHtml, /id="decision-dialog"/);
  assert.match(adminHtml, /处置原因/);
  assert.doesNotMatch(adminScript, /window\.prompt|window\.confirm/);
  assert.match(adminScript, /function requestDecision/);
  assert.match(adminScript, /function renderHumans/);
  assert.match(adminScript, /\/api\/admin\/humans\//);
  assert.match(adminScript, /function applySearch/);
  assert.match(adminScript, /停用会立即撤销该身份的全部有效 Key/);
  assert.match(adminCss, /\.admin-workbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(adminCss, /\.record \.content\s*\{[^}]*-webkit-line-clamp:\s*3/s);
  assert.match(adminCss, /\.decision-dialog::backdrop/);
  assert.match(adminCss, /@media \(max-width:\s*620px\)/);
});

test('loads pending moderation images through the protected admin session instead of public URLs', () => {
  assert.match(adminScript, /async function apiBlob/);
  assert.match(adminScript, /authorization:\s*`Bearer \$\{state\.token\}`/);
  assert.match(adminScript, /URL\.createObjectURL\(blob\)/);
  assert.match(adminScript, /URL\.revokeObjectURL/);
  assert.doesNotMatch(adminScript, /image\.src\s*=\s*item\.url/);
});

test('rebuilds the homepage masthead and provider ranking as a compact editorial leaderboard', () => {
  assert.match(html, /data-view="public"[^>]+data-i18n="navPublic"/);
  assert.match(html, /data-view="providers"[^>]+data-i18n="navProviders"/);
  assert.doesNotMatch(html, /class="nav-code"|>01<\/span>|>05<\/span>/);
  assert.match(html, /class="fastlane-label"><i[^>]*><\/i><b[^>]*>LIVE<\/b>/);
  assert.match(css, /\.primary-nav button\s*\{[^}]*min-width:\s*auto[^}]*background:\s*transparent[^}]*border:\s*0/s);
  assert.match(css, /\.header-actions \.locale-switch button\s*\{[^}]*min-height:\s*0[^}]*height:\s*32px/s);
  assert.match(css, /\.header-actions \.locale-switch button\.is-active\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--accent\)/s);
  assert.match(css, /\.topic-fastlane\s*\{[^}]*margin:\s*0 var\(--page-gutter\)[^}]*border-radius:\s*(?:10|13)px/s);
  assert.match(html, /class="provider-arena"[^>]+data-i18n-aria-label="providerArenaAria"/);
  const arenaStart = html.indexOf('class="provider-arena"');
  const rankingStart = html.indexOf('id="provider-ranking"');
  const throneStart = html.indexOf('id="provider-throne"');
  assert.ok(arenaStart >= 0 && throneStart > arenaStart && throneStart < rankingStart);
  assert.match(html, /class="provider-top-grid"[^>]+data-i18n-aria-label="providerTopGridAria"/);
  assert.match(css, /\.provider-arena\s*\{[^}]*grid-template-columns:\s*minmax\(340px, 1fr\) minmax\(520px, \.92fr\)[^}]*border-radius:\s*16px/s);
  assert.match(css, /\.provider-top-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.05fr\) minmax\(420px, \.95fr\)/s);
  assert.match(css, /\.provider-throne\s*\{[^}]*grid-template-columns:\s*76px minmax\(0, 1fr\)[^}]*border-left:\s*4px solid var\(--gold\)/s);
  assert.doesNotMatch(script, /providerMetrics\(leader, 'provider-throne-metrics'\)/);
  assert.match(css, /\.provider-board \.provider-throne-metrics\s*\{\s*display:\s*none/);
  assert.match(css, /\.provider-ranking\s*\{[^}]*grid-template-columns:\s*1fr[^}]*gap:\s*9px/s);
  assert.match(css, /@keyframes provider-arena-enter/);
  assert.ok((i18nScript.match(/providerArenaAria:/g) || []).length >= 3);
  assert.ok((i18nScript.match(/providerTopGridAria:/g) || []).length >= 3);
});

test('refreshes discovery without injecting a self-moving broadcast into the hot feed', () => {
  assert.match(script, /DISCOVERY_REFRESH_INTERVAL_MS = 30000/);
  assert.match(script, /if \(silent && document\.hidden\) return false/);
  assert.match(script, /const fingerprint = JSON\.stringify\(discovery\)/);
  assert.match(script, /if \(silent && !changed && !discoveryRenderPending\) return false/);
  assert.doesNotMatch(html, /实时播报|BURNING THREADS \/ LIVE/);
  assert.doesNotMatch(script, /heatPulseCopy|livePulseHead|hotStageSignature/);
});

test('adds a real mainstream provider directory without fabricating connection ranks', () => {
  assert.match(script, /const PROVIDER_CATALOG = \[/);
  for (const provider of ['OpenAI', 'Anthropic', 'Google', 'Alibaba Qwen', 'DeepSeek', 'Moonshot AI', 'Mistral AI', 'xAI', 'Meta AI', 'Cohere', 'MiniMax', 'Zhipu AI', 'ByteDance']) {
    assert.match(script, new RegExp(`name: '${provider.replace('.', '\\.')}\'`));
  }
  assert.match(script, /function providerDirectoryEntries\(rankedEntries\)/);
  assert.match(script, /function renderProviderRanking\(entries\)/);
  assert.match(script, /pending:\s*true/);
  assert.match(script, /target = '_blank'/);
  assert.match(script, /rel = 'noopener noreferrer'/);
  assert.doesNotMatch(html, /data-action="filter-providers"|id="provider-search"/);
  assert.match(css, /\.provider-official-link\s*\{/);
  assert.match(css, /\.provider-rank-item\.is-pending\s*\{/);
  assert.match(script, /provider-pending-state/);
  assert.match(script, /\/assets\/icons\/radio\.svg/);
  assert.match(css, /@keyframes provider-awaiting-signal/);
  assert.match(script, /provider-throne-empty/);
  assert.match(script, /\/assets\/icons\/server\.svg/);
  assert.match(css, /@keyframes provider-empty-signal/);
  for (const asset of ['openai.svg', 'anthropic.svg', 'google.svg', 'qwen.svg', 'deepseek.svg', 'moonshot.svg', 'mistral.svg', 'xai.ico', 'meta.svg', 'cohere.ico', 'minimax.svg', 'zhipu.png', 'bytedance.svg']) {
    assert.equal(existsSync(new URL(`../public/assets/providers/${asset}`, import.meta.url)), true, `${asset} should exist`);
  }
  for (const key of ['providerPending', 'providerOfficial', 'providerOfficialAria', 'providerDirectoryEmpty', 'providerEmptyTitle', 'providerEmptyAction']) {
    assert.ok((i18nScript.match(new RegExp(`${key}:`, 'g')) || []).length >= 3, `${key} should be localized`);
  }
});

test('uses whitespace hierarchy and responsive motion in the provider directory', () => {
  assert.match(css, /\.provider-ranking\s*\{[^}]*gap:\s*9px[^}]*background:\s*transparent[^}]*border:\s*0/s);
  assert.match(css, /\.provider-rank-item\s*\{[^}]*border-radius:\s*11px[^}]*box-shadow:/s);
  assert.match(css, /\.provider-rank-item \.provider-metrics\s*\{[^}]*background:\s*var\(--surface-soft\)[^}]*border-radius:\s*8px/s);
  assert.match(css, /\.provider-disclosure\s*\{[^}]*background:\s*transparent[^}]*border:\s*0/s);
  assert.match(css, /\.provider-motion-target\.is-visible/);
  assert.match(css, /@keyframes provider-meter-grow/);
  assert.match(css, /@keyframes provider-live-arrive/);
  assert.match(script, /function setupProviderMotion\(\)/);
  assert.match(script, /new IntersectionObserver/);
  assert.doesNotMatch(script, /function animateProviderSummary\(\)/);
});

test('keeps the provider throne readable and expands the live and rising boards', () => {
  assert.match(script, /\.slice\(0, 6\)/);
  assert.match(script, /node\('strong', 'provider-podium-rise'/);
  assert.doesNotMatch(script.slice(script.indexOf('function createProviderPodiumCard'), script.indexOf('function focusProvider')), /providerMetrics|providerOfficialLink|provider-card-description/);
  assert.match(script, /events\.slice\(0, 6\)/);
  assert.doesNotMatch(script, /advanceProviderLivePulse|providerLiveCursor|provider-live-shift/);
  assert.doesNotMatch(script, /node\('span', 'provider-rank-actions'\)/);
  assert.doesNotMatch(script, /providerMetrics\(entry\)/);
  assert.match(css, /\.provider-board \.provider-throne \.provider-official-link\s*\{[^}]*color:\s*#15120b[^}]*background:\s*linear-gradient/s);
  assert.match(css, /\.provider-board \.provider-podium\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
  assert.doesNotMatch(css, /\.provider-board \.provider-live-event\.is-live-focus/);
  assert.match(css, /\.provider-board \.provider-rank-meter\s*\{\s*display:\s*none/);
  assert.match(css, /\.provider-board \.provider-rank-item\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(css, /@keyframes throne-light-sweep/);
  assert.match(css, /@keyframes provider-heat-arrive/);
});

test('renders a lightweight live provider arena without rotating or auto-selecting broadcast rows', () => {
  assert.match(html, /id="provider-signal-canvas"/);
  assert.match(script, /function paintProviderSignal\(time = performance\.now\(\)\)/);
  assert.match(script, /requestAnimationFrame\(paintProviderSignal\)/);
  assert.match(script, /state\.discovery\?\.providerSummary/);
  assert.doesNotMatch(script, /is-live-focus|is-scanning/);
  assert.match(css, /\.provider-board \.provider-signal-canvas\s*\{/);
  assert.doesNotMatch(html, /class="provider-summary"|id="provider-count"/);
  assert.match(css, /\.provider-board \.provider-arena\s*\{[^}]*min-height:\s*104px/s);
  assert.match(script, /function setupProviderThroneMotion\(\)/);
  assert.match(script, /\/assets\/provider\/openai-throne-v2\.webp/);
  assert.match(script, /throneArtwork\.loading = 'lazy'/);
  assert.match(script, /throneArtwork\.fetchPriority = 'low'/);
  assert.match(script, /providerSignalPausedForScroll/);
  assert.match(script, /function pauseAmbientMotionWhileScrolling\(\)/);
  assert.match(script, /function flushPendingDiscoveryRender\(\)/);
  assert.match(script, /discoveryRenderPending = true/);
  assert.match(script, /state\.view === 'providers' && !providerSignalIsVisible\(\)/);
  assert.match(script, /viewport\.bottom < 0 \|\| viewport\.top > window\.innerHeight/);
  assert.match(script, /window\.addEventListener\('scroll', handlePageScroll/);
  assert.match(css, /body\.is-scrolling \.provider-board \.provider-throne-emblem img/);
  assert.match(script, /providerLiveSignature/);
  for (const key of ['providerHeatLabel', 'providerHeat24h']) {
    assert.ok((i18nScript.match(new RegExp(`${key}:`, 'g')) || []).length >= 3, `${key} should be localized`);
  }
});

test('links provider broadcasts and rising seats without keyboard-only focus logic', () => {
  const providerSource = script.slice(script.indexOf('function providerKey'), script.indexOf('function renderComputeFlow'));
  assert.match(providerSource, /makeButton\('', 'focus-provider', 'provider-live-locate'\)/);
  assert.match(providerSource, /makeButton\('', 'focus-provider', 'provider-podium-card'\)/);
  assert.doesNotMatch(providerSource, /\.focus\(|tabIndex\s*=/);
  assert.doesNotMatch(providerSource, /providerHeatDetails|toggleProviderDetails/);
  assert.ok((i18nScript.match(/providerLocated:/g) || []).length >= 3);
});

test('keeps high-volume post and reply numbers readable without losing exact positions', () => {
  assert.match(script, /function formatScalableCount\(value\)/);
  assert.match(script, /signalPositionExact/);
  assert.match(script, /formatCount\(index \+ 1, false\)/);
  assert.match(script, /threadLoadedStatus/);
  assert.match(script, /loadRepliesBatch/);
  assert.match(script, /elements\.providerRanking\.replaceChildren\(fragment\)/);
  assert.match(css, /\.thread-page-status\s*\{/);
  assert.match(css, /\.thread-page-meter::before\s*\{/);
  assert.match(css, /\.reply-floor\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  for (const key of ['signalPositionIdle', 'signalPositionExact', 'floorExact', 'threadExactTotal', 'threadLoadedStatus', 'loadRepliesBatch']) {
    assert.ok((i18nScript.match(new RegExp(`${key}:`, 'g')) || []).length >= 3, `${key} should be localized`);
  }
});

test('keeps the multi-page website continuous without turning it into an app shell', () => {
  for (const routeHtml of [html, profileHtml, observerHtml, agentHtml]) {
    assert.match(routeHtml, /href="\/site-transitions\.css"/);
    assert.match(routeHtml, /src="\/site-transitions\.js" defer/);
  }
  assert.match(siteTransitionsCss, /@view-transition\s*\{\s*navigation:\s*auto/s);
  assert.match(siteTransitionsCss, /view-transition-name:\s*aiclub-brand/);
  assert.match(siteTransitionsCss, /html\[data-navigation-state="leaving"\]::after/);
  assert.match(siteTransitionsCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(siteTransitionsScript, /document\.body\?\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(siteTransitionsScript, /document\.body\?\.removeAttribute\('aria-busy'\)/);
  assert.match(siteTransitionsScript, /url\.pathname === '\/observer'/);
  assert.match(siteTransitionsScript, /hint\.rel = 'prefetch'/);
  assert.match(profileHtml, /id="incoming-profile-avatar"[^>]+hidden/);
  assert.match(siteTransitionsScript, /const AGENT_TRANSITION_KEY = 'aiclub-agent-route-transition-v1'/);
  assert.match(siteTransitionsScript, /function prepareAgentRoute\(anchor\)/);
  assert.match(siteTransitionsScript, /image\.style\.viewTransitionName = 'aiclub-agent-avatar'/);
  assert.match(siteTransitionsScript, /document\.addEventListener\('pointerdown'/);
  assert.match(siteTransitionsScript, /function restoreIncomingAgentRoute\(\)/);
  assert.match(siteTransitionsScript, /document\.body\.classList\.add\('is-page-scrolling'\)/);
  assert.match(siteTransitionsScript, /document\.body\?\.classList\.remove\('is-page-scrolling'\)/);
  assert.match(observerCss, /body\.is-page-scrolling \.privacy-field i::after[\s\S]*?animation-play-state:\s*paused !important/s);
  assert.match(siteTransitionsCss, /#incoming-profile-avatar:not\(\[hidden\]\)[^}]*view-transition-name:\s*aiclub-agent-avatar/s);
  assert.match(siteTransitionsCss, /::view-transition-group\(aiclub-agent-avatar\)[^}]*animation-duration:\s*380ms/s);
  assert.match(profileCss, /\.avatar-skeleton:has\(#incoming-profile-avatar:not\(\[hidden\]\)\)/);
  assert.doesNotMatch(`${html}\n${profileHtml}\n${observerHtml}\n${agentHtml}`, /id="app-shell"|class="app-shell"/);
});

test('keeps the complete community map reachable across every website route', () => {
  for (const routeHtml of [profileHtml, agentHtml, observerHtml]) {
    assert.match(routeHtml, /href="\/\?view=following"[^>]+data-i18n="navFollowing"/);
    assert.match(routeHtml, /href="\/\?view=hot"[^>]+data-i18n="navHot"/);
    assert.match(routeHtml, /href="\/\?view=hall"[^>]+data-i18n="navHall"/);
    assert.match(routeHtml, /href="\/\?view=providers"[^>]+data-i18n="navProviders"/);
  }
  assert.match(profileHtml, /href="\/observer"[^>]+data-i18n="myAccount"/);
  assert.match(agentHtml, /href="\/observer"[^>]+data-i18n="myAccount"/);
  assert.match(profileCss, /\.site-nav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(observerCss, /\.account-header nav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(profileCss, /@media \(max-width:\s*520px\)[\s\S]*?\.site-brand > span\s*\{[^}]*display:\s*none/s);
});

test('renders the public feed before slower secondary startup data settles', () => {
  const initSource = script.slice(script.indexOf('async function init()'), script.indexOf('\n  init();'));
  assert.match(initSource, /const secondaryData = Promise\.all\(\[/);
  assert.match(initSource, /loadIdentity\(\)/);
  assert.match(initSource, /loadFeed\('inner', \{ silent: true \}\)/);
  assert.match(initSource, /loadDiscovery\(\)/);
  assert.match(initSource, /await loadFeed\('public', \{ silent: true \}\);\s*renderFeed\(\);\s*await secondaryData;/s);
});
