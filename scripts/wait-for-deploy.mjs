#!/usr/bin/env node
// Waits until a published site serves a given commit, so the post-deploy check never
// passes (or fails) against the previous deployment.
//
//   node scripts/wait-for-deploy.mjs <page-url> <commit-sha> [timeout-seconds]
//
// Reads <page-url>build.json, written by scripts/build.mjs. Behind an HTTP proxy, Node's
// fetch needs NODE_USE_ENV_PROXY=1.

const [pageUrl, sha, timeoutSeconds = '600'] = process.argv.slice(2);
if (!pageUrl || !sha) {
  console.error('usage: node scripts/wait-for-deploy.mjs <page-url> <commit-sha> [timeout-seconds]');
  process.exit(2);
}
const deadline = Date.now() + Number(timeoutSeconds) * 1000;
const url = new URL('build.json', pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`);

while (Date.now() < deadline) {
  try {
    url.searchParams.set('t', String(Date.now())); // past any cache between us and Pages
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (response.ok) {
      const build = await response.json();
      if (build.commit === sha) {
        console.log(`${pageUrl} serves ${sha} (built ${build.builtAt})`);
        process.exit(0);
      }
      console.log(`serving ${String(build.commit).slice(0, 12)}, waiting for ${sha.slice(0, 12)}`);
    } else {
      console.log(`build.json: HTTP ${response.status}`);
    }
  } catch (e) {
    console.log(`build.json: ${e.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
console.error(`::error::${pageUrl} did not serve commit ${sha} within ${timeoutSeconds}s`);
process.exit(1);
