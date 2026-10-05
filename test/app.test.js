const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DIR = path.join(__dirname, '..');
const HTML_SRC = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
// 直接從單檔 index.html 抽出應用腳本，確保測試永遠對應實際交付物
const SRC = (function () {
  const m = HTML_SRC.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
  if (!m) throw new Error('index.html 內找不到應用腳本');
  return m[1];
})();
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
class ClassList {
  constructor() { this.set = new Set(); }
  add() { for (const c of arguments) this.set.add(c); }
  remove() { for (const c of arguments) this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    if (force === undefined) { if (this.set.has(c)) this.set.delete(c); else this.set.add(c); }
    else if (force) { this.set.add(c); } else { this.set.delete(c); }
    return this.set.has(c);
  }
}
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.classList = new ClassList();
    this.className = '';
    this._text = '';
    this.attrs = {};
    this.style = {};
    this.listeners = {};
    this.value = '';
    this.offsetWidth = 100;
    this.parentNode = null;
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, ev) { (this.listeners[t] || []).forEach(f => f(ev || {})); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  focus() {} select() {}
  closest(sel) {
    const cls = String(sel).replace(/^\./, '');
    if (this.classList.contains(cls)) return this;
    return this.parentNode && this.parentNode.closest ? this.parentNode.closest(sel) : null;
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children.length = 0; }
}
const HTML = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
function makeEnv() {
  const byId = new Map();
  const all = [];
  function make(tag) { const e = new El(tag); all.push(e); return e; }
  function getById(id) {
    if (!byId.has(id)) {
      let e = null;
      for (const c of all) { if (c.id === id) { e = c; break; } }
      if (!e) { e = make('div'); e.id = id; }
      byId.set(id, e);
    }
    return byId.get(id);
  }
  function applyClass(el, attrs) {
    const cm = attrs.match(/\bclass="([^"]*)"/);
    if (cm) cm[1].split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
  }
  function seedFromHtml() {
    const re = /<([a-zA-Z][\w-]*)\b([^>]*\bid="[^"]+"[^>]*)>/g;
    let m;
    while ((m = re.exec(HTML)) !== null) {
      const attrs = m[2];
      const idm = attrs.match(/\bid="([^"]+)"/);
      if (!idm) continue;
      const el = getById(idm[1]);
      el.tagName = m[1].toUpperCase();
      applyClass(el, attrs);
    }
    const cre = /<button\b([^>]*\bdata-topic="[^"]+"[^>]*)>/g;
    while ((m = cre.exec(HTML)) !== null) {
      const attrs = m[1];
      const el = make('button');
      applyClass(el, attrs);
      el.setAttribute('data-topic', attrs.match(/\bdata-topic="([^"]+)"/)[1]);
      el.setAttribute('aria-pressed', attrs.match(/\baria-pressed="([^"]+)"/)[1]);
    }
  }
  const body = make('body');
  const document = {
    readyState: 'complete', body: body,
    getElementById: getById, createElement: make,
    addEventListener() {}, execCommand: () => true,
    querySelectorAll(sel) {
      const cls = String(sel).replace(/^\./, '');
      return all.filter(e => e.classList.contains(cls));
    }
  };
  seedFromHtml();
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const win = {
    localStorage: localStorage, scrollTo() {}, print() {}, confirm: () => true
  };
  const sandbox = {
    window: win, document: document,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    console: console, fetch: null,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, JSON: JSON, Math: Math, Object: Object, Array: Array,
    String: String, Number: Number, Error: Error, RegExp: RegExp, Date: Date,
    AbortController: AbortController, isFinite: isFinite, parseInt: parseInt
  };
  sandbox.globalThis = sandbox;
  return { ctx: vm.createContext(sandbox), get: getById, all: all, make: make, store: store };
}
function resp(status, obj, raw) {
  const body = raw !== undefined ? raw : JSON.stringify(obj);
  return { ok: status >= 200 && status < 300, status: status, text: () => Promise.resolve(body), __b: body };
}
function groqBody(content) { return { choices: [{ message: { content: content } }] }; }
function waitFor(fn, ms) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      let v = false;
      try { v = fn(); } catch (e) { v = false; }
      if (v) return res(true);
      if (Date.now() - t0 > (ms || 6000)) return rej(new Error('waitFor timeout'));
      setTimeout(tick, 5);
    })();
  });
}
async function boot(responses, keyValue) {
  const env = makeEnv();
  const calls = [];
  const queue = responses.slice();
  env.ctx.fetch = function (url, opts) {
    const next = queue.shift();
    const rr = next ? resp(next.status, next.body, next.raw) : resp(500, { error: { message: 'NO STUB LEFT' } });
    var parsed = JSON.parse(opts.body);
    var peek = '';
    try { peek = rr.__b.slice(0, 90); } catch (x) { peek = '?'; }
    calls.push({ url: url, opts: opts, status: rr.status, ok: rr.ok,
      jsonMode: !!parsed.response_format,
      node: parsed.messages[0].content.indexOf('final_article') !== -1 ? 'node23' : 'node1',
      raw: peek });
    return Promise.resolve(rr);
  };
  vm.runInContext(SRC, env.ctx, { filename: 'app.js' });
  if (keyValue !== undefined) env.store.set('wsm.key', keyValue);
  return { env: env, calls: calls, left: queue.length };
}
(async function main() {
  const ARTICLE = '\u7b2c\u4e00\u6bb5\u8d77\u59cb\u3002\n\n\u7b2c\u4e8c\u6bb5\u4e2d\u9593\u3002';
  const F = String.fromCharCode(96,96,96);
  function diag(env, calls) {
    const rows = calls.map((c, i) => '\n     #' + (i+1) + ' http=' + c.status + ' ' + c.node);
    return '\n   [diag] error="' + env.get('step2Error').textContent + '"'
      + ' step2Hidden=' + env.get('step2').classList.contains('hidden') + ' calls=' + calls.length + rows;
  }
  console.log('\n== 1. Happy path ==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({
        praise: '\u4f60\u628a\u6bd4\u8cfd\u7684\u7d81\u5f35\u611f\u8b14\u5f97\u597d\u751f\u52d5\uff01',
        questions: [
          { id: 'q1', question_text: '\u7576\u6642\u807d\u5230\u4ec0\u9ebc\u8072\u97f3\uff1f', placeholder: '\u4f8b\u5982\u7403\u978b\u6469\u64e6\u5730\u677f' },
          { id: 'q2', question_text: '\u70ba\u4ec0\u9ebc\u6539\u8b8a\u6230\u8853\uff1f', placeholder: '\u4f8b\u5982\u56e0\u70ba\u968a\u9577\u8aaa' }
        ]
      })) },
      { status: 200, body: groqBody(JSON.stringify({
        keeps: ['\u3010\u611f\u60c5\u771f\u5be6\u3011\u9006\u8f49\u5f88\u6e05\u6959\uff01', '\u3010\u7d30\u984c\u751f\u52d5\u3011\u807d\u97f3\u5f88\u7dca\u5bc6\u3002'],
        changes: ['\u26a0\ufe0f \u8a5e\u5f59\u5fae\u8abf\uff1a\u300c\u7f8e\u4e0d\u52dd\u6536\u300d\u6539\u70ba\u300c\u5fc3\u88e1\u9ad8\u8208\u5f97\u8df3\u8d77\u4f86\u300d\u3002'],
        final_article: ARTICLE
      })) }
    ], 'gsk_testkey');
    const env = r.env;
    env.get('rawText').value = '\u6211\u5011\u6253\u7bee\u7403\u672c\u4f86\u8f38\u4e09\u7403\uff0c\u5f8c\u4f86\u52dd\u4e86\u3002';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('loadingOverlay').classList.contains('hidden'));
    ok('step2 \u986f\u793a', !env.get('step2').classList.contains('hidden'));
    ok('step1 \u96b1\u85cf', env.get('step1').classList.contains('hidden'));
    ok('praise \u6b63\u78ba', env.get('node1Praise').textContent.indexOf('\u7d81\u5f35\u611f') !== -1);
    eq('\u6e32\u67d3 2 \u5f35\u554f\u984c\u5361', env.get('questionsContainer').children.length, 2);
    eq('q1 \u662f input', env.get('q1').tagName, 'INPUT');
    eq('q2 \u662f input', env.get('q2').tagName, 'INPUT');
    ok('focus \u6a19\u7c64\u986f\u793a\u4e94\u611f', env.get('questionsContainer').children[0].children[0].textContent.indexOf('\u4e94\u611f') !== -1);
    eq('\u7121\u932f\u8aa4\u6846', env.get('step1Error').children.length, 0);
    eq('node1 \u53ea\u8b21\u4e00\u6b21\u7d50\u675f', r.calls.length, 1);
    const sent = JSON.parse(r.calls[0].opts.body);
    eq('endpoint \u6b63\u78ba', r.calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    eq('model \u9810\u8a2d', sent.model, 'llama-3.3-70b-versatile');
    eq('system role', sent.messages[0].role, 'system');
    eq('user role', sent.messages[1].role, 'user');
    ok('Node1 system prompt', sent.messages[0].content.indexOf('\u5f15\u5c0e\u554f\u984c') !== -1);
    ok('user \u5e36\u5165\u53e3\u8ff0', sent.messages[1].content.indexOf('\u6253\u7bee\u7403') !== -1);
    ok('\u555f\u7528 json_object', sent.response_format && sent.response_format.type === 'json_object');
    env.get('q1').value = '\u807d\u5230\u7403\u978b\u6469\u64e6\u5730\u677f\u3002';
    env.get('q2').value = '\u56e0\u70ba\u968a\u9577\u8aaa\u63db\u4eba\u9632\u5b88\u3002';
    env.get('toNode23Btn').fire('click');
    try {
      await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    } catch (e) { console.log(diag(env, r.calls)); throw e; }
    ok('step3 \u986f\u793a', !env.get('step3').classList.contains('hidden'));
    eq('Keep 2 \u7b46', env.get('keepList').children.length, 2);
    eq('Change 1 \u7b46', env.get('changeList').children.length, 1);
    eq('\u6587\u7ae0\u6b63\u78ba', env.get('finalDraft').textContent, ARTICLE);
    ok('\u5b57\u6578\u63d0\u793a\u51fa\u73fe', env.get('wordCountNote').textContent.indexOf('\u5168\u6587\u7d04') !== -1);
    ok('\u5217\u5370 meta \u6709\u65e5\u671f', env.get('printMeta').textContent.length > 3);
    eq('node23 \u53ea\u8b21\u4e00\u6b21\u7d50\u675f', r.calls.length, 2);
    const s2 = JSON.parse(r.calls[1].opts.body);
    ok('Node2/3 prompt \u5e36\u5165\u56de\u7b54', s2.messages[1].content.indexOf('\u6469\u64e6\u5730\u677f') !== -1);
    ok('Node2/3 system prompt', s2.messages[0].content.indexOf('Keep') !== -1 && s2.messages[0].content.indexOf('final_article') !== -1);
  }
  console.log('\n== 2. \u6a21\u578b\u56f4\u7bc6\u820a\u683c\u5f0f ==');
  {
    const fenced = '\u597d\u7684\uff0c\u9019\u662f\u7d50\u679c\uff1a\n' + F + 'json\n'
      + '{"praise":"\u5f88\u68d2","questions":["\u4f60\u7576\u6642\u807d\u5230\u4ec0\u9ebc\uff1f","\u5f8c\u4f86\u70ba\u4ec0\u9ebc\u6703\u8b8a\uff1f"]}' + '\n' + F;
    const r = await boot([
      { status: 200, body: groqBody(fenced) },
      { status: 200, body: groqBody(JSON.stringify({ keeps: '\u55ae\u5b57\u4e32 Keep', changes: [{ text: '\u7269\u4ef6\u5f0f Change' }], final_article: '\u77ed\u6587' })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66\u5167\u5bb9';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    eq('\u570d\u7bc6+\u524d\u8a5e\u6389\u9805\u89e3\u6790\u6210\u529f', env.get('questionsContainer').children.length, 2);
    eq('\u4e0d\u61c9\u91cd\u8a66', r.calls.length, 1);
    ok('praise \u6b63\u78ba\u89e3\u6790', env.get('node1Praise').textContent.indexOf('\u5f88\u68d2') !== -1);
    ok('\u5b57\u4e32\u9663\u5217\u554f\u984c\u5df2\u6b63\u898f\u5316', env.get('q1').tagName === 'INPUT' && env.get('q1').placeholder.length > 0);
    env.get('toNode23Btn').fire('click');
    try {
      await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    } catch (e) { console.log(diag(env, r.calls)); throw e; }
    eq('\u55ae\u5b57\u4e32 keeps \u5305\u6210\u9663\u5217', env.get('keepList').children.length, 1);
    eq('\u7269\u4ef6\u5f0f changes \u53d6\u51fa\u6587\u5b57', env.get('changeList').children[0].textContent, '\u7269\u4ef6\u5f0f Change');
  }
  console.log('\n== 3. \u6b04\u4f4d\u7f3a\u6f0f\u7684\u4fdd\u5e95 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"\u53ea\u6709\u8b9d\u7f8e"}') },
      { status: 200, body: groqBody('{"final_article":"\u53ea\u6709\u6587\u7ae0"}') }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    eq('questions \u7f3a\u6f0f\u6642\u88dc\u6eff 2 \u984c', env.get('questionsContainer').children.length, 2);
    env.get('toNode23Btn').fire('click');
    try {
      await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    } catch (e) { console.log(diag(env, r.calls)); throw e; }
    ok('keeps \u7a7a\u9663\u5217\u986f\u793a\u63d0\u793a\u8a5e', env.get('keepList').children[0].textContent.indexOf('\u6c92\u6709\u7279\u5225\u5efa\u8b70') !== -1);
  }
  console.log('\n== 4. HTTP \u932f\u8aa4 ==');
  {
    const r = await boot([{ status: 401, body: { error: { message: 'Invalid API Key' } } }], 'gsk_bad');
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step1Error').children.length > 0);
    const msg = env.get('step1Error').children[0].children[0].textContent;
    ok('401 \u986f\u793a\u53cb\u5be7\u8a0b\u5f0f', msg.indexOf('API Key \u4e0d\u6b63\u78ba') !== -1, msg);
    eq('401 \u7121\u91cd\u8a66\u6309\u9215', env.get('step1Error').children[0].children.length, 1);
    eq('401 \u53ea\u8b21\u4e00\u6b21\u7d50\u675f', r.calls.length, 1);
  }
  console.log('\n== 5. 429 \u81ea\u52d5\u91cd\u8a66 ==');
  {
    const r = await boot([
      { status: 429, body: { error: { message: 'rate limit' } } },
      { status: 200, body: groqBody('{"praise":"\u597d","questions":[{"question_text":"A"},{"question_text":"B"}]}') }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false, 8000);
    eq('429 \u5f8c\u91cd\u8a66\u6210\u529f', r.calls.length, 2);
    eq('\u91cd\u8a66\u5f8c\u6b63\u78ba\u6e32\u67d3', env.get('questionsContainer').children.length, 2);
  }
  console.log('\n== 6. \u4e0d\u652f\u63f4 json_object \u6642\u964d\u7d1a ==');
  {
    const r = await boot([
      { status: 400, raw: '{"error":{"message":"response_format json_object is not supported"}}' },
      { status: 200, body: groqBody('{"praise":"\u597d","questions":[{"question_text":"A"},{"question_text":"B"}]}') }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false, 8000);
    eq('\u964d\u7d1a\u91cd\u8a66\u4e00\u6b21', r.calls.length, 2);
    ok('\u7b2c2\u6b21\u4e0d\u518d\u5e36 response_format', JSON.parse(r.calls[1].opts.body).response_format === undefined);
  }
  console.log('\n== 7. \u56de\u61c9\u640d\u58de / \u7a7a\u5167\u5bb9 ==');
  {
    const r = await boot([{ status: 200, body: groqBody('\u62b1\u6b49\uff0c\u6211\u4e0d\u80fd\u5354\u52a9\u9019\u500b\u8acb\u6c42\u3002') }], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step1Error').children.length > 0);
    ok('\u975e JSON \u56de\u61c9\u986f\u793a\u932f\u8aa4', env.get('step1Error').children[0].children[0].textContent.indexOf('\u8b80\u4e0d\u61c2') !== -1);
    eq('\u640d\u58de\u56de\u61c9\u63d0\u4f9b\u91cd\u8a66\u9215', env.get('step1Error').children[0].children.length, 2);
  }
  {
    const emptyStub = { status: 200, body: { choices: [{ message: { content: '' } }] } };
    const r = await boot([emptyStub, emptyStub, emptyStub], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step1Error').children.length > 0);
    ok('\u7a7a\u5167\u5bb9\u986f\u793a\u932f\u8aa4', env.get('step1Error').children[0].children[0].textContent.indexOf('\u6c92\u6709\u8aaa\u8a71') !== -1);
  }
  console.log('\n== 8. \u672a\u8a2d\u5b9a API Key ==');
  {
    const r = await boot([]);
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step1Error').children.length > 0);
    ok('\u63d0\u793a\u8a2d\u5b9a Key', env.get('step1Error').children[0].children[0].textContent.indexOf('Groq API Key') !== -1);
    ok('\u81ea\u52d5\u958b\u555f\u8a2d\u5b9a\u9762\u677f', env.get('settingsPanel').classList.contains('hidden') === false);
    eq('\u5b8c\u5168\u6c92\u6709\u767c\u51fa\u8acb\u6c42', r.calls.length, 0);
  }
  console.log('\n== 9. XSS \u9a57\u8b49 ==');
  {
    const evil = '<img src=x onerror=alert(1)><b>bold</b>';
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ praise: evil, questions: [{ question_text: evil }, { question_text: 'B' }] })) },
      { status: 200, body: groqBody(JSON.stringify({ keeps: [evil], changes: [evil], final_article: evil })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '\u6e2c\u8a66';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    ok('praise \u70ba\u7d14\u6587\u5b57', env.get('node1Praise').children.length === 0 && env.get('node1Praise').textContent === evil);
    env.get('toNode23Btn').fire('click');
    await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    ok('\u6587\u7ae0\u70ba\u7d14\u6587\u5b57\u7121\u5b50\u5143\u7d20', env.get('finalDraft').children.length === 0 && env.get('finalDraft').textContent === evil);
    eq('Keep \u4ee5\u6587\u5b57\u7bc0\u9ede\u5448\u73fe', env.get('keepList').children[0].children.length, 0);
  }
  console.log('\n== 10. \u4e3b\u984c / \u8349\u7a3f / \u5b57\u6578 ==');
  {
    const r = await boot([], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '\u4e94\u500b\u5b57\u55a8';
    env.get('rawText').fire('input');
    eq('\u5b57\u6578\u5373\u6642\u66f4\u65b0', env.get('charCount').textContent, '4');
    eq('\u8349\u7a3f\u5df2\u81ea\u52d5\u4fdd\u5b58', env.store.get('wsm.draft'), '\u4e94\u500b\u5b57\u55a8');
    const chip = env.make('button');
    chip.classList.add('topic-chip');
    chip.setAttribute('data-topic', '__custom__');
    env.get('topicChips').fire('click', { target: chip });
    ok('\u81ea\u8a02\u4e3b\u984c\u8f38\u5165\u6846\u5c55\u958b', env.get('customTopicWrap').classList.contains('hidden') === false);
    ok('\u672a\u586b\u6642\u4e0d\u986f\u793a\u5fbd\u7ae0', env.get('topicBadge').classList.contains('hidden'));
    env.get('customTopic').value = '\u6211\u6700\u559c\u6b61\u7684\u4e00\u500b\u9031\u665a';
    env.get('customTopic').fire('input');
    ok('\u81ea\u8a02\u4e3b\u984c\u5beb\u5165\u5fbd\u7ae0', env.get('topicBadge').textContent.indexOf('\u9031\u665a') !== -1);
    env.get('restartBtn').fire('click');
    eq('\u91cd\u958b\u5f8c\u8349\u7a3f\u5df2\u6e05', env.get('rawText').value, '');
    eq('\u91cd\u958b\u5f8c\u56de\u5230 Step1', env.get('step1').classList.contains('hidden'), false);
    eq('\u91cd\u958b\u5f8c API Key \u4fdd\u7559\uff08\u88dd\u7f6e\u5c64\uff09', env.store.get('wsm.key'), 'gsk_k');
    eq('\u91cd\u958b\u5f8c\u4e3b\u984c\u5df2\u6e05', env.store.get('wsm.topic'), undefined);
    eq('\u91cd\u958b\u5f8c\u56de\u7b54\u5df2\u6e05', env.store.get('wsm.a-q1'), undefined);
  }
  console.log('\n== 11. \u8a9e\u97f3\u4e0d\u652f\u63f4\u6642\u512a\u96c5\u964d\u7d1a ==');
  {
    const r = await boot([], 'gsk_k');
    ok('\u9ea5\u514b\u98a8\u6309\u9215\u96b1\u85cf', r.env.get('micBtn').classList.contains('hidden'));
    ok('\u986f\u793a\u66ff\u4ee3\u63d0\u793a', r.env.get('speechUnsupported').classList.contains('hidden') === false);
  }
  console.log('\n== 12. HTML \u2194 JS \u95dc\u806f\u9759\u614e\u6aa2\u67e5 ==');
  {
    const htmlIds = new Set();
    const re = /\bid="([^"]+)"/g;
    let m;
    while ((m = re.exec(HTML)) !== null) htmlIds.add(m[1]);
    const used = new Set();
    const dre = /\$\('([^']+)'\)/g;
    const gre = /getElementById\('([^']+)'\)/g;
    while ((m = dre.exec(SRC)) !== null) used.add(m[1]);
    while ((m = gre.exec(SRC)) !== null) used.add(m[1]);
    const dynamic = new Set(['q1', 'q2']);
    const missing = [];
    used.forEach(id => { if (!htmlIds.has(id) && !dynamic.has(id)) missing.push(id); });
    ok('JS \u5f15\u7528\u7684 id \u90fd\u5b58\u5728\u65bc HTML', missing.length === 0, missing.join(','));
    console.log('        (' + used.size + ' used / ' + htmlIds.size + ' defined)');
    const buttons = ['settingsToggle','saveKeyBtn','clearKeyBtn','clearBtn','micBtn','toNode1Btn','toNode23Btn',
      'regenQuestionsBtn','backToStep1Btn','backToStep2Btn','copyArticleBtn','printBtn','restartBtn','cancelBtn'];
    const noBtn = buttons.filter(b => !htmlIds.has(b));
    ok('\u6240\u6709\u6309\u9215\u90fd\u5b58\u5728\u65bc HTML', noBtn.length === 0, noBtn.join(','));
    const containers = ['step1Error','step2Error','step3Error','interim','charCount','topicBadge'];
    const noCt = containers.filter(c => !htmlIds.has(c));
    ok('\u6240\u6709\u5bb9\u5668\u90fd\u5b58\u5728\u65bc HTML', noCt.length === 0, noCt.join(','));
  }
  console.log('\n' + '='.repeat(46));
  console.log('  PASS ' + pass + ' / FAIL ' + fail);
  console.log('='.repeat(46));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
