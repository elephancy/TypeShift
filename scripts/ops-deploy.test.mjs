import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { run } from './ops-deploy.mjs';

const source = 'https://ops.elfeel.me/standards/cloudflare/deploy.mjs';
function response(body = '/* synthetic deployment fixture */', options = {}) {
  const result = new Response(body, {status:200,headers:{'content-type':'application/javascript'},...options});
  Object.defineProperty(result, 'url', {value:source, configurable:true});
  return result;
}
test('bootstrap delegates exact arguments to the complete Ops script and cleans its protected temporary file', async () => {
  let downloaded;
  const args = ['--engine','wrangler','--config','apps/api/wrangler.jsonc'];
  const status = await run(args, {
    fetcher: async (url, options) => { assert.equal(url,source); assert.equal(options.redirect,'error'); assert.ok(options.signal); return response(); },
    execute: (node, argv, options) => {
      assert.equal(node,process.execPath); assert.deepEqual(argv.slice(1),args); assert.equal(options.stdio,'inherit');
      downloaded = argv[0]; assert.equal(readFileSync(downloaded,'utf8'),'/* synthetic deployment fixture */');
      if (process.platform !== 'win32') assert.equal(statSync(downloaded).mode & 0o777,0o600);
      return {status:7};
    },
  });
  assert.equal(status,7); assert.ok(!existsSync(downloaded));
});
test('HTTP failure, redirects, wrong origin, invalid media type and oversized scripts never execute', async () => {
  const wrongOrigin = response(); Object.defineProperty(wrongOrigin,'url',{value:'https://example.invalid/deploy.mjs'});
  for (const result of [response('failure',{status:503}),response('',{status:302}),wrongOrigin,response('html',{headers:{'content-type':'text/html'}}),response('x'.repeat(256*1024+1)),response('x',{headers:{'content-type':'text/javascript','content-length':'262145'}})]) {
    await assert.rejects(run([], {fetcher:async () => result,execute:() => assert.fail('unsafe script executed')}));
  }
});
test('fetch failure never invokes a local fallback', async () => {
  await assert.rejects(run([], {fetcher:async () => {throw new Error('fixture network unavailable');},execute:() => assert.fail('fallback executed')}));
});
