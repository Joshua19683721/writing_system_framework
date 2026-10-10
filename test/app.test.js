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
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
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
    // 首頁的訓練模式卡（data-mode），需掛到 modeCards 容器下
    const mre = /<button\b([^>]*\bdata-mode="[^"]+"[^>]*)>/g;
    while ((m = mre.exec(HTML)) !== null) {
      const attrs = m[1];
      const el = make('button');
      applyClass(el, attrs);
      el.setAttribute('data-mode', attrs.match(/\bdata-mode="([^"]+)"/)[1]);
      getById('modeCards').appendChild(el);
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
async function boot(responses, keyValue, opts) {
  const env = makeEnv();
  const calls = [];
  const queue = responses.slice();
  if (opts && opts.SpeechRecognition) env.ctx.window.SpeechRecognition = opts.SpeechRecognition;
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
      })) },
      { status: 200, body: groqBody('{"corrections":[],"corrected_article":""}') }
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
    eq('model \u9810\u8a2d', sent.model, 'qwen/qwen3.8-27b');
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
    eq('\u5168\u7a0b 3 \u6b21\u8acb\u6c42\uff08node1+node23+\u6aa2\u5b57\uff09', r.calls.length, 3);
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
    eq('\u91cd\u958b\u5f8c\u56de\u5230\u7009\u6a21\u5f0f\u9801', env.get('modeSection').classList.contains('hidden'), false);
ok('\u91cd\u958b\u5f8c step1 \u5df2\u6b78\u85cf\uff08\u4e0d\u76f4\u63a5\u8fdb\u5165\u4e3b\u984c\u9801\uff09', env.get('step1').classList.contains('hidden'));
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
  console.log('\n== 13. 簡體 → 繁體 轉換（逐字）==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({
        praise: '你把比赛寫得很好！学习很专注。',
        questions: [
          { id: 'q1', question_text: '当时听到什么声音？', placeholder: '例如听到球鞋摩擦地板' },
          { id: 'q2', question_text: '为什么后来改变想法？', placeholder: '例如因为队长说了一句' }
        ]
      })) },
      { status: 200, body: groqBody(JSON.stringify({
        keeps: ['【感情真实】写得很清楚！', '【细节生动】补充了声音。'],
        changes: ['词汇微调：建议改用情绪化的句子。', '词辞调整：请使用繁体中文。'],
        final_article: '我们学习这个词，老师说要专注。这是我们的学习记录，许多人认为牢记最重要。'
      })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '我们学校比赛得了冠军。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    const praise = env.get('node1Praise').textContent;
    const qText = env.get('questionsContainer').children[0].children[0].textContent;
    const qPh = env.get('q1').placeholder;
    ok('praise：比赛→比賽', praise.indexOf('比賽') !== -1, praise);
    ok('praise：学习→學習', praise.indexOf('學習') !== -1, praise);
    ok('praise：专注→專注', praise.indexOf('專注') !== -1, praise);
    ok('praise 不含簡體字', praise.indexOf('比赛') === -1 && praise.indexOf('学习') === -1 && praise.indexOf('专注') === -1, praise);
    ok('問題：当时听到→當時聽到', qText.indexOf('當時聽到什麼聲音') !== -1, qText);
    ok('問題不含簡體字', qText.indexOf('当时听到') === -1, qText);
    ok('placeholder：听到→聽到', qPh.indexOf('聽到') !== -1, qPh);
    ok('placeholder 不含簡體字', qPh.indexOf('听到') === -1, qPh);
    env.get('q1').value = '聽到球鞋聲。';
    env.get('q2').value = '因為隊長說。';
    env.get('toNode23Btn').fire('click');
    try {
      await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    } catch (e) { console.log(diag(env, r.calls)); throw e; }
    const art = env.get('finalDraft').textContent;
    const keep0 = env.get('keepList').children[0].textContent;
    const chg1 = env.get('changeList').children[1].textContent;
    ok('Keep：真实→真實', keep0.indexOf('真實') !== -1, keep0);
    ok('Change：词辞调整→詞辭調整', chg1.indexOf('詞辭調整') !== -1, chg1);
    ok('文章：学习/记录/认为/牢记 全轉繁體',
      art.indexOf('我們學習') !== -1 && art.indexOf('學習記錄') !== -1 && art.indexOf('認為牢記') !== -1, art);
    ok('文章不含簡體字', art.indexOf('我们学习') === -1 && art.indexOf('学习记录') === -1 && art.indexOf('认为牢记') === -1, art);
    ok('全文字數仍能計算', env.get('wordCountNote').textContent.indexOf('全文約') !== -1);
  }
  console.log('\n== 14. 台灣慣用詞替換 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({
        praise: '你遇到软件问题的时候，结果用用户账号了。',
        questions: [{ question_text: '你无法输入经过证书的写法是什么？' }, { question_text: '这份数据的质量如何？' }]
      })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '软件会安装在电脑上。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    const p = env.get('node1Praise').textContent;
    const q1t = env.get('questionsContainer').children[0].children[0].textContent;
    const q2t = env.get('questionsContainer').children[1].children[0].textContent;
    ok('软件→軟體', p.indexOf('軟體') !== -1, p);
    ok('用户→使用者', p.indexOf('使用者') !== -1, p);
    ok('账号→帳號', p.indexOf('帳號') !== -1, p);
    ok('軟體/使用者 不殘留簡體', p.indexOf('软件') === -1 && p.indexOf('用户') === -1 && p.indexOf('账号') === -1, p);
    ok('证书→證書', q1t.indexOf('證書') !== -1, q1t);
    ok('写法→寫法', q1t.indexOf('寫法') !== -1, q1t);
    ok('数据→資料', q2t.indexOf('資料') !== -1, q2t);
    ok('质量→品質', q2t.indexOf('品質') !== -1, q2t);
    ok('資料/品質 不殘留簡體', q2t.indexOf('数据') === -1 && q2t.indexOf('质量') === -1, q2t);
  }
  console.log('\n== 15. 錯別字檢核（即時字典）==');
  {
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') },
      { status: 200, body: groqBody(JSON.stringify({
        keeps: ['【感情真實】寫得很好！'],
        changes: ['成語「迫不急待」建議改成「迫不及待」。'],
        final_article: '我既使很想參加，比賽前一晚還是按奈不住地練習。\n\n一但想到觀眾在場、怕迫不急待，我們既使緊張得心跳加快，還是決對要拼到底。\n\n名符其實，比賽前我想的是計劃要放棄，沒想到最後拿到冠軍。'
      })) },
      { status: 200, body: groqBody('{"corrections":[],"corrected_article":""}') }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '我參加比賽很緊張。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    env.get('toNode23Btn').fire('click');
    await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    const art = env.get('finalDraft').textContent;
    ok('迫不急待→迫不及待', art.indexOf('迫不及待') !== -1, art);
    ok('按奈不住→按捺不住', art.indexOf('按捺不住') !== -1, art);
    ok('既使→即使（出現 2 處）', art.indexOf('即使') !== -1, art);
    ok('決對→絕對', art.indexOf('絕對') !== -1, art);
    ok('名符其實→名副其實', art.indexOf('名副其實') !== -1, art);
    ok('計劃→計畫', art.indexOf('計畫') !== -1, art);
    ok('已無「既使」殘留', art.indexOf('既使') === -1, art);
    ok('已無「決對」殘留', art.indexOf('決對') === -1, art);
    ok('已無「名符其實」殘留', art.indexOf('名符其實') === -1, art);
    ok('已無「按奈不住」殘留', art.indexOf('按奈不住') === -1, art);
    const chg0 = env.get('changeList').children[0].textContent;
    ok('Change 欄位也一併修正', chg0.indexOf('迫不及待') !== -1, chg0);
    ok('檢核卡片已顯示', env.get('proofreadCard').classList.contains('hidden') === false);
    const badge = env.get('proofBadge').textContent;
    ok('已修正徽章出現', badge.indexOf('已修正') !== -1, badge);
    ok('徽章不在隱藏狀態', env.get('proofBadge').classList.contains('hidden') === false);
  }
  console.log('\n== 16. 錯別字檢核（LLM 深度校對）==');
  {
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') },
      { status: 200, body: groqBody(JSON.stringify({
        keeps: ['寫得清楚'], changes: ['可再加細節'],
        final_article: '我仔細的看著終場哨聲響起的那一刻。'
      })) },
      { status: 200, body: groqBody(JSON.stringify({
        corrections: ['「仔細的看」應為「仔細地看」，因為修飾動作要用「地」。', '「終場哨聲響起那一刻」句尾缺標點。'],
        corrected_article: '我仔細地看著終場哨聲響起的那一刻。'
      })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '比賽很精彩。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    env.get('toNode23Btn').fire('click');
    await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    await waitFor(() => env.get('proofreadNote').textContent.indexOf('複核完畢') !== -1, 8000);
    const art = env.get('finalDraft').textContent;
    ok('LLM 修正後的文章已更新', art.indexOf('仔細地看著') !== -1, art);
    ok('原錯誤已消失', art.indexOf('仔細的看') === -1, art);
    eq('檢核清單 2 項', env.get('proofreadList').children.length, 2);
    ok('清單含「地」的說明', env.get('proofreadList').children[0].textContent.indexOf('地') !== -1);
    ok('完成訊息正確', env.get('proofreadNote').textContent.indexOf('複核完畢') !== -1);
    ok('總修正數 = 2', env.get('proofBadge').textContent.indexOf('2 處') !== -1, env.get('proofBadge').textContent);
    const req = JSON.parse(r.calls[2].opts.body);
    ok('第 3 次請求使用檢字 Prompt', req.messages[0].content.indexOf('錯別字') !== -1);
    ok('第 3 次請求帶入文章', req.messages[1].content.indexOf('仔細的看著') !== -1);
  }
  console.log('\n== 17. 深度校對失敗時仍保留字典修正 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') },
      { status: 200, body: groqBody(JSON.stringify({ keeps: [], changes: [], final_article: '我迫不急待地出發了。' })) },
      { status: 401, body: { error: { message: 'Invalid API Key' } } }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '出發很緊張。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    env.get('toNode23Btn').fire('click');
    await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    await waitFor(() => env.get('proofreadNote').textContent.indexOf('⚠️') !== -1, 8000);
    ok('文章仍保留字典修正', env.get('finalDraft').textContent.indexOf('迫不及待') !== -1, env.get('finalDraft').textContent);
    ok('顯示失敗但不崩潰', env.get('proofreadNote').textContent.indexOf('內建字典') !== -1, env.get('proofreadNote').textContent);
    ok('仍停留在 Step3', env.get('step3').classList.contains('hidden') === false);
  }
  console.log('\n== 18. 複核：語意與邏輯已納入 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') },
      { status: 200, body: groqBody('{"keeps":[],"changes":[],"final_article":"原本的文章內容。"}') },
      { status: 200, body: groqBody('{"corrections":[],"corrected_article":""}') }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '測試語意檢查。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    env.get('toNode23Btn').fire('click');
    await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    await waitFor(() => env.get('proofreadNote').textContent.indexOf('複核完畢') !== -1, 8000);
    const p = JSON.parse(r.calls[2].opts.body);
    const sys = p.messages[0].content;
    ok('含「語意與邏輯」區塊', sys.indexOf('語意與邏輯') !== -1);
    ok('要求檢查語意跳接', sys.indexOf('語意跳接') !== -1);
    ok('要求檢查前後矛盾', sys.indexOf('前後敘述是否矛盾') !== -1);
    ok('要求檢查人稱一致', sys.indexOf('人稱是否一致') !== -1);
    ok('要求檢查時序', sys.indexOf('時序') !== -1);
    ok('允許調整語序', sys.indexOf('可以調整語序') !== -1);
    ok('仍禁止新增無關事件', sys.indexOf('不可增加與原稿無關的新事件') !== -1);
    ok('要求不得留下錯別字', sys.indexOf('不得留下任何錯別字') !== -1);
    ok('user 帶入待複核文章', p.messages[1].content.indexOf('待複核文章') !== -1);
  }
  console.log('\n== 19. 守門：拒絕整篇改寫 ==');
  {
    const original = '第一段原本的內容在這裡。\n\n第二段原本的內容也在這裡。';
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') },
      { status: 200, body: groqBody(JSON.stringify({ keeps: [], changes: [], final_article: original })) },
      { status: 200, body: groqBody(JSON.stringify({
        corrections: ['模型把整篇文章改寫了。'],
        corrected_article: '這是一篇完全不同的新文章，內容被整個替換掉了，長度也差很多很多很多。'
      })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '測試守門機制。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    env.get('toNode23Btn').fire('click');
    await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    await waitFor(() => env.get('proofreadNote').textContent.indexOf('改寫') !== -1, 8000);
    ok('拒絕套用改寫後文章', env.get('finalDraft').textContent === original, env.get('finalDraft').textContent);
    ok('提示已保留原文', env.get('proofreadNote').textContent.indexOf('保留修正前的版本') !== -1, env.get('proofreadNote').textContent);
    ok('仍顯示修正說明', env.get('proofreadList').children.length >= 1);
  }
  console.log('\n== 20. 守門：段落數改變也拒絕 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') },
      { status: 200, body: groqBody(JSON.stringify({ keeps: [], changes: [], final_article: '原本只有一段文章在這裡，內容長度剛好。' })) },
      { status: 200, body: groqBody(JSON.stringify({ corrections: ['合併成三段。'], corrected_article: '第一段。\n\n第二段。\n\n第三段。' })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '測試段落守門。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    env.get('toNode23Btn').fire('click');
    await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    await waitFor(() => env.get('proofreadNote').textContent.indexOf('改寫') !== -1, 8000);
    ok('段落數改變時拒絕套用', env.get('finalDraft').textContent.indexOf('第三段') === -1, env.get('finalDraft').textContent);
  }
  console.log('\n== 21. 守門：同段小幅修正允許 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') },
      { status: 200, body: groqBody(JSON.stringify({ keeps: [], changes: [], final_article: '我仔細的看著球場。' })) },
      { status: 200, body: groqBody(JSON.stringify({ corrections: ['「的」改「地」。'], corrected_article: '我仔細地看著球場。' })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '測試正常修正。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    env.get('toNode23Btn').fire('click');
    await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    await waitFor(() => env.get('proofreadNote').textContent.indexOf('複核完畢') !== -1, 8000);
    ok('小幅修正正常套用', env.get('finalDraft').textContent === '我仔細地看著球場。', env.get('finalDraft').textContent);
    ok('未觸發改寫警告', env.get('proofreadNote').textContent.indexOf('改寫') === -1);
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
  console.log('\n== 22. \u6a21\u578b\u8f38\u51fa\u6b8b\u7559\u7c21\u9ad4\u5b57\uff08\u88dc\u9f4a\u5b57\u8868\uff09==');
  {
    const ART_S = '\u6211\u4eec\u8001\u5e08\u8bf4\uff0c\u4ece\u6b64\u4ee5\u540e\u8981\u597d\u597d\u8bfb\u4e66\uff0c\u518c\u5b50\u4e0a\u7684\u8bb0\u5f55\u662f\u5170\u82b1\u7684\u4ebf\u4e07\u500d\u3002\u4ed6\u8f7b\u677e\u5730\u73a9\u6e38\u620f\u3002';
    const ART_T = '我們老師說，從此以後要好好讀書，冊子上的記錄是蘭花的億萬倍。他輕鬆地玩遊戲。';
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({
        praise: '\u8001\u5e08\u8bf4\u4f60\u4ece\u8fd9\u6b21\u6bd4\u8d5b\u91cc\u5b66\u5230\u5f88\u591a\u3002',
        questions: [
          { id: 'q1', question_text: '\u8001\u5e08\u5f53\u65f6\u8bf4\u4e86\u4ec0\u4e48\uff1f', placeholder: '例如他說你很努力' },
          { id: 'q2', question_text: '\u4f60\u4ece\u4e2d\u5b66\u5230\u4e86\u4ec0\u4e48\uff1f', placeholder: '例如學會了堅持' }
        ]
      })) },
      { status: 200, body: groqBody(JSON.stringify({
        keeps: ['\u5185\u5bb9\u771f\u5b9e'],
        changes: ['\u8bcd\u6c47\u53ef\u4ee5\u66f4\u4e30\u5bcc'],
        final_article: ART_S
      })) },
      { status: 200, body: groqBody('{"corrections":[],"corrected_article":""}') }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '我參加了一場比賽。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    const praise = env.get('node1Praise').textContent;
    ok('praise\uff1a\u8001\u5e08\u2192\u8001\u5e2b', praise.indexOf('老師') !== -1, praise);
    ok('praise\uff1a\u4ece\u2192\u5f9e', praise.indexOf('從') !== -1, praise);
    ok('praise\uff1a\u5b66\u2192\u5b78', praise.indexOf('學') !== -1, praise);
    ok('praise \u5df2\u7121\u7c21\u9ad4\u6b8b\u7559',
      praise.indexOf('\u8001\u5e08') === -1 && praise.indexOf('\u4ece') === -1 && praise.indexOf('\u5b66') === -1, praise);
    const q1t = env.get('questionsContainer').children[0].children[0].textContent;
    ok('\u554f\u984c\uff1a\u8001\u5e08\u2192\u8001\u5e2b', q1t.indexOf('老師') !== -1, q1t);
    ok('\u554f\u984c\uff1a\u8bf4\u2192\u8aaa', q1t.indexOf('說') !== -1, q1t);
    env.get('toNode23Btn').fire('click');
    try {
      await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    } catch (e) { console.log(diag(env, r.calls)); throw e; }
    eq('\u6574\u7bc7\u7c21\u9ad4\u6587\u7ae0\u5168\u90e8\u8f49\u70ba\u7e41\u9ad4', env.get('finalDraft').textContent, ART_T);
    ok('Keep\uff1a\u5185\u5bb9\u771f\u5b9e\u2192\u5167\u5bb9\u771f\u5be6', env.get('keepList').children[0].textContent.indexOf('真實') !== -1);
    ok('Change\uff1a\u8bcd\u6c47\u2192\u8a5e\u5f59', env.get('changeList').children[0].textContent.indexOf('詞彙') !== -1);
  }
  console.log('\n== 23. \u6b63\u78ba\u7e41\u9ad4\u5b57\u4e0d\u5f97\u88ab\u6539\u58de\uff08\u5169\u7528\u5b57\uff09==');
  {
    const ART = '他表示，只有松樹下的那次出征最難忘。游泳之後，岳父帶我去買布料，順便聊到系統、考卷與台灣的天氣。早上起床時，我把秘密告訴一群正在吃粽子的同學。';
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') },
      { status: 200, body: groqBody(JSON.stringify({ keeps: [], changes: [], final_article: ART })) },
      { status: 200, body: groqBody('{"corrections":[],"corrected_article":""}') }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '測試兩用字。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    env.get('toNode23Btn').fire('click');
    try {
      await waitFor(() => env.get('step3').classList.contains('hidden') === false);
    } catch (e) { console.log(diag(env, r.calls)); throw e; }
    eq('\u6b63\u78ba\u7e41\u9ad4\u8a5e\u539f\u6a23\u4fdd\u7559\uff08\u8868\u793a/\u53ea\u6709/\u677e\u6a39/\u51fa\u5f81/\u6e38\u6cf3/\u5cb3\u7236/\u5e03\u6599/\u7cfb\u7d71/\u8003\u5377/\u53f0\u7063/\u8d77\u5e8a/\u79d8\u5bc6/\u4e00\u7fa4/\u7cbd\u5b50\uff09',
      env.get('finalDraft').textContent, ART);
  }
  console.log('\n== 24. \u96a8\u6a5f\u4e3b\u984c\u8207\u5beb\u6cd5\u63d0\u793a ==');
  {
    const bankBlock = HTML.match(/var TOPIC_BANK = \[([\s\S]*?)\];/);
    ok('index.html 有 TOPIC_BANK', !!bankBlock);
    const entries = bankBlock[1].split('\n').map(s => s.trim()).filter(s => s.charAt(0) === "'");
    eq('\u96a8\u6a5f\u984c\u5eab\u5171 300 \u500b\u4e3b\u984c', entries.length, 300);
    ok('\u6bcf\u4e00\u984c\u90fd\u5e36\u300c\u958b\u982d\u2192\u4e2d\u9593\u2192\u7d50\u679c\u300d\u63d0\u793a',
      entries.every(s => /開頭：.+中間：.+結果：/.test(s)));
    ok('\u4e3b\u984c\u4e0d\u91cd\u8907', new Set(entries.map(s => s.split('|')[0])).size === entries.length);
    ok('\u63d0\u793a\u90fd\u4e0d\u7a7a\u767d', entries.every(s => s.split('|')[1] && s.split('|')[1].length >= 30));
    const bankMap = new Map(entries.map(s => {
      const body = s.replace(/^'/, '').replace(/',?$/, '');   // 去掉外層引號與行尾逗號
      const i = body.indexOf('|');
      return [body.slice(0, i), body.slice(i + 1)];
    }));
    const HINT_PREFIX = '📝 寫法提示（開頭 → 中間 → 結果）：';
    eq('\u984c\u5eab\u6bcf\u4e00\u984c\u90fd\u6709\u5c0d\u61c9\u63d0\u793a', bankMap.size, entries.length);
    ok('\u984c\u5eab\u7684\u63d0\u793a\u90fd\u4e0d\u542b\u5916\u5c64\u5f15\u865f',
      Array.from(bankMap.values()).every(v => v.indexOf("'") === -1 && v.indexOf('開頭：') === 0));

    const r = await boot([], 'gsk_k');
    const env = r.env;
    ok('\u63d0\u793a\u5340\u4e00\u958b\u59cb\u662f\u96b1\u85cf\u7684', env.get('topicHint').classList.contains('hidden'));
    env.get('randomTopicBtn').fire('click');
    const topic = env.store.get('wsm.customTopic');
    ok('\u96a8\u6a5f\u9215\u62bd\u51fa\u4e3b\u984c', !!topic && topic.length > 3, String(topic));
    ok('\u4e3b\u984c\u5df2\u5beb\u5165\u81ea\u8a02\u4e3b\u984c\u6846', env.get('customTopic').value === topic);
    ok('\u96a8\u6a5f\u4e3b\u984c\u6210\u70ba\u76ee\u524d\u4e3b\u984c', env.store.get('wsm.topic') === '__custom__');
    ok('\u5fbd\u7ae0\u986f\u793a\u62bd\u5230\u7684\u4e3b\u984c', env.get('topicBadge').textContent.indexOf(topic) !== -1);
    const hint = env.get('topicHint').textContent;
    ok('\u8f38\u5165\u6846\u4e0a\u65b9\u51fa\u73fe\u5beb\u6cd5\u63d0\u793a', hint.indexOf('寫法提示') !== -1 && hint.indexOf('開頭：') !== -1, hint);
    ok('\u63d0\u793a\u6db5\u84cb\u958b\u982d\u5230\u7d50\u679c', hint.indexOf('開頭') !== -1 && hint.indexOf('中間') !== -1 && hint.indexOf('結果') !== -1, hint);
    ok('\u63d0\u793a\u5340\u5df2\u986f\u793a', env.get('topicHint').classList.contains('hidden') === false);
    ok('\u62bd\u5230\u7684\u4e3b\u984c\u771f\u7684\u5728\u984c\u5eab\u88e1', bankMap.has(topic), String(topic));
    ok('\u63d0\u793a\u5c31\u662f\u8a72\u4e3b\u984c\u7684\u5efa\u8b70', hint === HINT_PREFIX + bankMap.get(topic), hint);

    // 連抽 40 次都必須落在題庫內，且提示跟著換
    let allOk = true;
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      env.get('randomTopicBtn').fire('click');
      const t = env.store.get('wsm.customTopic');
      const h = env.get('topicHint').textContent;
      seen.add(t);
      if (!bankMap.has(t) || h !== HINT_PREFIX + bankMap.get(t)) allOk = false;
    }
    ok('\u91cd\u8907\u62bd\u984c\u63d0\u793a\u90fd\u8ddf\u8457\u63db', allOk && seen.size >= 5, 'distinct topics=' + seen.size);
    env.get('restartBtn').fire('click');
    ok('\u91cd\u958b\u5f8c\u63d0\u793a\u6536\u8d77\u4f86', env.get('topicHint').classList.contains('hidden'));
  }
  console.log('\n== 25. \u6bcf\u500b\u63d0\u554f\u91cd\u9ede\u63d0\u4f9b 3\u20136 \u500b\u554f\u984c ==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({
        praise: '很棒',
        questions: [
          { id: 'q1', question_text: '當時你聽到什麼聲音？', placeholder: '例如球鞋摩擦地板' },
          { id: 'q2', question_text: '為什麼後來改變戰術？', placeholder: '例如因為隊長說' }
        ]
      })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('rawText').value = '我參加了一場比賽。';
    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    const cards = env.get('questionsContainer').children;
    eq('\u5169\u5f35\u554f\u984c\u5361', cards.length, 2);
    for (let i = 0; i < 2; i++) {
      const card = cards[i];
      const alt = card.children[card.children.length - 1];
      const chips = alt.children[1];
      const n = chips.children.length;
      ok('\u554f\u984c' + (i + 1) + ' \u6709 3\u20136 \u500b\u554f\u984c\uff08\u66ff\u4ee3 ' + n + ' + \u4e3b\u984c 1\uff09', n + 1 >= 3 && n + 1 <= 6, String(n + 1));
      ok('\u554f\u984c' + (i + 1) + ' \u66ff\u4ee3\u554f\u6cd5\u90fd\u4e0d\u7a7a\u767d',
        Array.prototype.every.call(chips.children, c => c.textContent.length > 5));
    }
    const before = cards[0].children[0].textContent;
    const chips0 = cards[0].children[cards[0].children.length - 1].children[1];
    chips0.children[0].fire('click');
    const after = cards[0].children[0].textContent;
    ok('\u9ede\u66ff\u4ee3\u554f\u6cd5\u6703\u63db\u6210\u90a3\u4e00\u984c', after !== before && after.indexOf(chips0.children[0].textContent) !== -1, after);
    ok('\u63db\u984c\u5f8c\u4ecd\u4fdd\u7559\u4e94\u611f\u6a19\u7c64', after.indexOf('五感') !== -1, after);
    ok('\u7b2c\u4e8c\u984c\u4ecd\u4fdd\u7559\u8f49\u6298\u6a19\u7c64', cards[1].children[0].textContent.indexOf('轉折') !== -1);
  }
  console.log('\n== 26. \u6bcf\u500b\u8f38\u5165\u6846\u90fd\u80fd\u7528\u8a9e\u97f3\u8f38\u5165 ==');
  {
    class FakeSR {
      constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; FakeSR.last = this; }
      start() { if (this.onstart) this.onstart(); }
      stop() { if (this.onend) this.onend(); }
      emit(text, isFinal) {
        const item = [{ transcript: text }];
        item.isFinal = isFinal !== false;
        if (this.onresult) this.onresult({ resultIndex: 0, results: [item] });
      }
    }
    const r = await boot([
      { status: 200, body: groqBody('{"praise":"很棒","questions":[{"question_text":"A"},{"question_text":"B"}]}') }
    ], 'gsk_k', { SpeechRecognition: FakeSR });
    const env = r.env;
    ok('\u652f\u63f4\u8a9e\u97f3\u6642\u4e0d\u986f\u793a\u4e0d\u652f\u63f4\u8b66\u544a', env.get('speechUnsupported').classList.contains('hidden'));
    ok('\u9ea5\u514b\u98a8\u6309\u9215\u4fdd\u7559', env.get('micBtn').classList.contains('hidden') === false);

    env.get('micBtn').fire('click');
    FakeSR.last.emit('我昨天去打籃球');
    ok('\u53e3\u8ff0\u6846\u6536\u5230\u8a9e\u97f3\u6587\u5b57', env.get('rawText').value.indexOf('我昨天去打籃球') !== -1, env.get('rawText').value);
    eq('\u5b57\u6578\u5373\u6642\u540c\u6b65', env.get('charCount').textContent, String(env.get('rawText').value.trim().length));
    eq('\u8349\u7a3f\u4e5f\u540c\u6b65\u5b58\u4e0b\u4f86', env.store.get('wsm.draft'), env.get('rawText').value);
    FakeSR.last.emit('因為下雨', false);
    ok('\u5373\u6642\u5b57\u5e55\u986f\u793a\u5728\u53e3\u8ff0\u6846\u4e0b\u65b9', env.get('interim').textContent.indexOf('因為下雨') !== -1, env.get('interim').textContent);
    FakeSR.last.stop();
    ok('\u505c\u6b62\u5f8c\u5373\u6642\u5b57\u5e55\u6e05\u6389', env.get('interim').textContent === '');

    env.get('toNode1Btn').fire('click');
    await waitFor(() => env.get('step2').classList.contains('hidden') === false);
    const cards = env.get('questionsContainer').children;
    const mic1 = cards[0].children[1].children[1];
    mic1.fire('click');
    FakeSR.last.emit('我聽到全場的歡呼聲');
    ok('\u554f\u984c1 \u56de\u7b54\u6846\u4e5f\u80fd\u8a9e\u97f3\u8f38\u5165', env.get('q1').value.indexOf('我聽到全場的歡呼聲') !== -1, env.get('q1').value);
    eq('\u56de\u7b54\u5df2\u66ab\u5b58', env.store.get('wsm.a-q1'), env.get('q1').value);
    FakeSR.last.stop();
    const mic2 = cards[1].children[1].children[1];
    mic2.fire('click');
    FakeSR.last.emit('因為教練提醒大家換位置');
    ok('\u554f\u984c2 \u56de\u7b54\u6846\u4e5f\u80fd\u8a9e\u97f3\u8f38\u5165', env.get('q2').value.indexOf('因為教練提醒大家換位置') !== -1, env.get('q2').value);
    eq('\u56de\u7b54\u4e8c\u4e5f\u5df2\u66ab\u5b58', env.store.get('wsm.a-q2'), env.get('q2').value);
  }
  const STAGE10 = ['人物','時間','地點','起因','五感','心情','轉折','行動','結果','感想'];
  const Q10 = STAGE10.map(function (s, i) {
    return { id: 'g' + (i + 1), stage: s, question_text: '第' + (i + 1) + '題：' + s + '？',
      options: ['選項A' + (i + 1), '選項B' + (i + 1), '選項C' + (i + 1), '選項D' + (i + 1)] };
  });
  const pickAll = function (env, idx) {
    const cards = env.get('pathList').children;
    for (let i = 0; i < cards.length; i++) cards[i].children[1].children[idx].fire('click');
  };
  const stageOf = function (card) { return card.children[0].children[1].textContent; };
  const optsOf = function (card) { return card.children[1].children; };
  const pickMode = function (env, idx) {
    const cards = env.get('modeCards').children;
    env.get('modeCards').fire('click', { target: cards[idx] });
  };

  console.log('\n== 27. 108 課綱引導寫作：隨機主題 → 10 題 → 4 選 1 → 合成文章 ==');
  {
    const ESSAY = '第一段：事情的開始。\n\n第二段：經過與轉折。\n\n第三段：結果與感想。';
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: Q10 })) },
      { status: 200, body: groqBody(JSON.stringify({ final_article: ESSAY })) }
    ], 'gsk_k');
    const env = r.env;

    env.get('randomTopicBtn').fire('click');
    const topic = env.store.get('wsm.customTopic');
    ok('隨機抽到一個主題', !!topic, String(topic));

    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);

    ok('引導區顯示', !env.get('pathSection').classList.contains('hidden'));
    ok('步驟一已隱藏', env.get('step1').classList.contains('hidden'));
    ok('徽章帶出題目', env.get('pathTopicBadge').textContent.indexOf(topic) !== -1, env.get('pathTopicBadge').textContent);
    eq('剛好 10 張題目卡', env.get('pathList').children.length, 10);
    eq('進度起點 0 / 10', env.get('pathProgress').textContent, '已回答 0 / 10');
    ok('還沒選完不能合成', env.get('pathComposeBtn').disabled === true);
    eq('只送出 1 次請求（出題）', r.calls.length, 1);

    let fourOpt = true, orderOk = true;
    for (let i = 0; i < 10; i++) {
      const card = env.get('pathList').children[i];
      if (optsOf(card).length !== 4) fourOpt = false;
      if (stageOf(card) !== STAGE10[i]) orderOk = false;
    }
    ok('每一題都是 4 選 1', fourOpt);
    ok('依 108 課綱順序：人物→時間→地點→起因→五感→心情→轉折→行動→結果→感想', orderOk);

    const g1 = JSON.parse(r.calls[0].opts.body);
    ok('出題 prompt 講明 108 課綱', g1.messages[0].content.indexOf('108') !== -1);
    ok('出題 prompt 要求剛好 4 個選項', g1.messages[0].content.indexOf('剛好 4 個選項') !== -1);
    ok('出題 prompt 要求共 10 題', g1.messages[0].content.indexOf('10 個') !== -1);
    ok('user 帶入隨機主題', g1.messages[1].content.indexOf(topic) !== -1, g1.messages[1].content);
    ok('啟用 json_object', g1.response_format && g1.response_format.type === 'json_object');

    pickAll(env, 2);
    eq('進度更新為 10 / 10', env.get('pathProgress').textContent, '已回答 10 / 10');
    ok('選完即可合成', env.get('pathComposeBtn').disabled === false);
    const cards = env.get('pathList').children;
    ok('被選項標記為已選', optsOf(cards[3])[2].getAttribute('aria-pressed') === 'true');
    ok('同題其他選項取消', optsOf(cards[3])[0].getAttribute('aria-pressed') === 'false');

    env.get('pathComposeBtn').fire('click');
    await waitFor(() => env.get('pathResult').classList.contains('hidden') === false);

    ok('成果區顯示', !env.get('pathResult').classList.contains('hidden'));
    ok('引導題目區已隱藏', env.get('pathSection').classList.contains('hidden'));
    eq('文章內容正確', env.get('pathEssay').textContent, ESSAY);
    eq('摘要列出 10 個選擇', env.get('pathSummary').children.length, 10);
    ok('摘要帶出實際選項', env.get('pathSummary').children[2].textContent.indexOf('選項C3') !== -1, env.get('pathSummary').children[2].textContent);
    ok('字數提示出現', env.get('pathWordNote').textContent.indexOf('全文約') !== -1);
    ok('列印資訊含主題', env.get('pathMeta').textContent.indexOf(topic) !== -1, env.get('pathMeta').textContent);
    eq('全程 2 次請求（出題＋合成）', r.calls.length, 2);

    const g2 = JSON.parse(r.calls[1].opts.body);
    ok('合成 prompt 帶入 10 個選擇', (g2.messages[1].content.match(/選項C/g) || []).length === 10);
    ok('合成 prompt 帶入主題', g2.messages[1].content.indexOf(topic) !== -1);
    ok('合成 prompt 列出全部 10 題階段', STAGE10.every(s => g2.messages[1].content.indexOf(s) !== -1));
    ok('合成 system prompt 要求 final_article', g2.messages[0].content.indexOf('final_article') !== -1);
    ok('合成 system prompt 規定依 108 課綱結構', g2.messages[0].content.indexOf('108 課綱') !== -1);
  }

  console.log('\n== 28. 出題數量／選項缺漏時自動補滿 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({
        questions: [
          { stage: '人物', question_text: '模型回的第 1 題', options: ['甲', '乙', '丙', '丁'] },
          { stage: '時間', question_text: '模型回的第 2 題', options: ['甲', '乙'] }
        ]
      })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('randomTopicBtn').fire('click');
    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);

    const cards = env.get('pathList').children;
    eq('仍補滿 10 題', cards.length, 10);
    eq('保留模型回的第 1 題', cards[0].children[0].children[2].textContent, '模型回的第 1 題');
    eq('只有 2 個選項也被補成 4 個', optsOf(cards[1]).length, 4);
    ok('補上的選項不重複', new Set(optsOf(cards[1]).map(b => b.textContent)).size === 4,
       JSON.stringify(optsOf(cards[1]).map(b => b.textContent)));
    let allFour = true, tailOk = true;
    for (let i = 0; i < cards.length; i++) if (optsOf(cards[i]).length !== 4) allFour = false;
    for (let i = 2; i < cards.length; i++) if (stageOf(cards[i]) !== STAGE10[i]) tailOk = false;
    ok('全部題目都有 4 個選項', allFour);
    ok('不足的題目以 108 課綱階段補齊', tailOk,
       cards.map(c => stageOf(c)).join('>'));
    ok('最後一題是「感想」', stageOf(cards[9]) === '感想', stageOf(cards[9]));
  }

  console.log('\n== 29. 出題失敗時的降級與保底 ==');
  {
    const r1 = await boot([
      { status: 200, body: groqBody('這不是 JSON，只是一句話') }
    ], 'gsk_k');
    const e1 = r1.env;
    e1.get('randomTopicBtn').fire('click');
    e1.get('startPathBtn').fire('click');
    await waitFor(() => e1.get('pathError').children.length > 0);
    ok('壞回應時題目區不會開啟', e1.get('pathSection').classList.contains('hidden'));
    ok('顯示錯誤訊息', e1.get('pathError').children[0].children[0].textContent.indexOf('😵') === 0,
       e1.get('pathError').children[0].children[0].textContent);
    ok('提供「再試一次」按鈕', e1.get('pathError').children[0].children[1].textContent.indexOf('再試一次') !== -1);
    ok('載入遮罩已關閉（不會卡住）', e1.get('loadingOverlay').classList.contains('hidden'));
    eq('壞回應不無限重試', r1.calls.length, 1);
  }
  {
    const r2 = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: [] })) }
    ], 'gsk_k');
    const e2 = r2.env;
    e2.get('randomTopicBtn').fire('click');
    e2.get('startPathBtn').fire('click');
    await waitFor(() => e2.get('pathSection').classList.contains('hidden') === false);
    eq('沒有題目時補滿 10 題', e2.get('pathList').children.length, 10);
    ok('全數走 108 課綱保底階段',
       STAGE10.every((s, i) => stageOf(e2.get('pathList').children[i]) === s),
       e2.get('pathList').children.map(c => stageOf(c)).join('>'));
    ok('保底題目也有 4 個選項',
       e2.get('pathList').children.every(c => optsOf(c).length === 4));
    eq('保底題目仍可作答', e2.get('pathProgress').textContent, '已回答 0 / 10');
  }

  console.log('\n== 30. 沒選完不得合成 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: Q10 })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('randomTopicBtn').fire('click');
    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);

    const cards = env.get('pathList').children;
    for (let i = 0; i < 9; i++) optsOf(cards[i])[0].fire('click');
    eq('只選了 9 題', env.get('pathProgress').textContent, '已回答 9 / 10');
    ok('未選完時按鈕維持停用', env.get('pathComposeBtn').disabled === true);
    env.get('pathComposeBtn').disabled = false; // 繞過 UI 強制觸發
    env.get('pathComposeBtn').fire('click');
    ok('不足 10 題時不發請求', r.calls.length === 1, 'calls=' + r.calls.length);
    ok('不會跳出成果區', env.get('pathResult').classList.contains('hidden'));
  }

  console.log('\n== 31. 未選主題時不啟動引導 ==');
  {
    const r = await boot([{ status: 200, body: groqBody('{}') }], 'gsk_k');
    const env = r.env;
    env.get('startPathBtn').fire('click');
    ok('沒有主題就不發請求', r.calls.length === 0, 'calls=' + r.calls.length);
    ok('引導區保持隱藏', env.get('pathSection').classList.contains('hidden'));
  }

  console.log('\n== 32. 回去改選擇後可重新合成 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: Q10 })) },
      { status: 200, body: groqBody(JSON.stringify({ final_article: '第一版文章。' })) },
      { status: 200, body: groqBody(JSON.stringify({ final_article: '第二版文章。' })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('randomTopicBtn').fire('click');
    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);
    pickAll(env, 1);
    env.get('pathComposeBtn').fire('click');
    await waitFor(() => env.get('pathResult').classList.contains('hidden') === false);
    eq('第一次合成的文章', env.get('pathEssay').textContent, '第一版文章。');

    env.get('pathEditBtn').fire('click');
    ok('回到題目區', env.get('pathSection').classList.contains('hidden') === false);
    ok('成果區收起', env.get('pathResult').classList.contains('hidden'));
    const cards = env.get('pathList').children;
    ok('先前的選擇仍保留', optsOf(cards[0])[1].getAttribute('aria-pressed') === 'true');

    optsOf(cards[0])[3].fire('click');
    ok('改選後舊選項取消', optsOf(cards[0])[1].getAttribute('aria-pressed') === 'false');
    ok('改選後新選項選中', optsOf(cards[0])[3].getAttribute('aria-pressed') === 'true');
    env.get('pathComposeBtn').fire('click');
    await waitFor(() => env.get('pathEssay').textContent === '第二版文章。');
    eq('重新合成成功', env.get('pathEssay').textContent, '第二版文章。');
    const g2 = JSON.parse(r.calls[2].opts.body);
    ok('第二次合成帶入新選擇', g2.messages[1].content.indexOf('選項D1') !== -1);
  }

  console.log('\n== 33. 列印樣式涵蓋每一個成果區 ==');
  {
    const pi = HTML.indexOf('@media print');
    const printBlock = pi === -1 ? '' : HTML.slice(pi, HTML.indexOf('</style>'));
    ok('存在 @media print 區塊', pi !== -1);
    // 只取選擇器，排除十六進位色碼（#fff / #aabbcc / #aabbccdd）
    const isHex = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const sels = [...new Set(printBlock.match(/#[A-Za-z][\w-]*/g) || [])]
      .filter(s => !isHex.test(s));
    const dead = sels.filter(s => HTML.indexOf('id="' + s.slice(1) + '"') === -1);
    eq('印表 CSS 沒有指向不存在元素的死選擇器', dead.join(', ') || '(無)', '(無)');

    // 每個成果區都必須有印表樣式，否則 body *{visibility:hidden} 會讓它變成空白頁
    ['printArea', 'pathPrintArea'].forEach(id => {
      ok('成果區 #' + id + ' 有 visibility:visible 例外', sels.indexOf('#' + id) !== -1);
    });
    ['printMeta', 'pathMeta'].forEach(id => {
      ok('列印資訊 #' + id + ' 有 display:block 例外', sels.indexOf('#' + id) !== -1);
    });
    ok('列印時會先隱藏整頁', /body\s*\*\s*\{[^}]*visibility:\s*hidden/.test(printBlock));
    ok('接著對成果區補回 visibility:visible', /visibility:\s*visible/.test(printBlock));
    ok('.no-print 在列印時被移除', /\.no-print\s*\{[^}]*display:\s*none/.test(printBlock));
    ok('兩個成果區都有 .print-plain 去框線',
       /#printArea \.print-plain/.test(printBlock) && /#pathPrintArea \.print-plain/.test(printBlock));
  }

  console.log('\n== 34. 引導寫作的 prompt 品質 ==');
  {
    const pi = HTML.indexOf('@media print');
    // 取出兩份 path prompt 原文
    const grab = (name) => {
      const i = HTML.indexOf('var ' + name + ' = [');
      const j = HTML.indexOf('].join', i);
      return HTML.slice(i, j);
    };
    const q = grab('PROMPT_PATH_QUESTIONS');
    const c = grab('PROMPT_PATH_COMPOSE');
    ok('取得出題 prompt', q.length > 100);
    ok('取得合成 prompt', c.length > 100);

    // 缺陷 1：示範例的問與答自相矛盾
    ok('示範例不再問「有哪兩個人」', q.indexOf('哪兩個人') === -1);
    ok('示範例改用可並列的問法', q.indexOf('故事裡有誰一起參與') !== -1);
    ok('明列選項不可互相矛盾', q.indexOf('不能互相矛盾') !== -1);

    // 缺陷 2：UI 檢查 300～600 字，但 prompt 從未要求篇幅
    ok('合成 prompt 有要求 300～600 字', /300～600 字/.test(c));
    ok('合成 prompt 說明要展開成具體細節', c.indexOf('不要只把選項短短串接') !== -1);
    const ca = grab('PROMPT_ARG_COMPOSE');
    ok('UI \u6aa2\u7684\u5b57\u6578\u5340\u9593\u8207 prompt \u4e00\u81f4',
       /var lo = isArg \? 350 : 300, hi = isArg \? 650 : 600;/.test(HTML) &&
       ca.indexOf('350～650 字') !== -1 &&
       c.indexOf('300～600 字') !== -1);
    ok('說理文要求保留反方意見與回應',
       ca.indexOf('反方意見') !== -1 && ca.indexOf('我的回應') !== -1);
    ok('說理文禁止情緒化用詞',
       ca.indexOf('不要用情緒化或罵人的詞') !== -1);

    // 強化：降低模型只回 2 題、需要保底補滿的機率
    ok('強調只是格式示範、仍須輸出 10 個物件', q.indexOf('你必須實際輸出 g1 到 g10 共 10 個物件') !== -1);
    ok('要求 stage 沿用既有環節名稱', q.indexOf('不要改寫、不要自創新名稱') !== -1);

    // 回歸：確保沒有損壞字元（撰寫文件／prompt 時曾發生過）
    // 用跳脫序列比對，不可直接內嵌 U+FFFD，否則這個檢查會把自己判成損壞
    const FFFD = /\uFFFD/g;
    eq('index.html 沒有損壞字元 (U+FFFD)', (HTML.match(FFFD) || []).length, 0);
    const badT = (fs.readFileSync(path.join(DIR, 'test/app.test.js'), 'utf8').match(FFFD) || []).length;
    eq('test/app.test.js 沒有損壞字元', badT, 0);
    const badD = (fs.readFileSync(path.join(DIR, 'writing_system_framework.md'), 'utf8').match(FFFD) || []).length;
    eq('規格文件沒有損壞字元', badD, 0);
  }

  console.log('\n== 35. 成果頁可直接重新生成文章 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: Q10 })) },
      { status: 200, body: groqBody(JSON.stringify({ final_article: '太短的一版。' })) },
      { status: 200, body: groqBody(JSON.stringify({ final_article: '長一點的第二版，' + '有更多細節描寫。'.repeat(40) })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('randomTopicBtn').fire('click');
    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);
    pickAll(env, 0);
    env.get('pathComposeBtn').fire('click');
    await waitFor(() => env.get('pathResult').classList.contains('hidden') === false);
    eq('第一次產出較短', env.get('pathEssay').textContent, '太短的一版。');
    ok('長度不足時給出提示', env.get('pathWordNote').textContent.indexOf('可以再想想') !== -1,
       env.get('pathWordNote').textContent);

    // 不改任何選擇，直接重新生成
    env.get('pathRegenBtn').fire('click');
    await waitFor(() => env.get('pathEssay').textContent.length > 20);
    ok('保留原本的 10 個選擇', env.get('pathProgress').textContent === '已回答 10 / 10');
    ok('重新生成後仍在成果區', !env.get('pathResult').classList.contains('hidden'));
    ok('新文章已換成較長版本', env.get('pathEssay').textContent.indexOf('第二版') !== -1);
    ok('長度提示改為適合', env.get('pathWordNote').textContent.indexOf('✅') !== -1,
       env.get('pathWordNote').textContent);
    const g2 = JSON.parse(r.calls[2].opts.body);
    ok('再次帶入 10 個選擇', (g2.messages[1].content.match(/選項A/g) || []).length === 10);
    eq('總共 3 次請求（出題＋生成×2）', r.calls.length, 3);
  }
  {
    // 選擇未完成時不應從成果頁發出請求
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: Q10 })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('randomTopicBtn').fire('click');
    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);
    const cards = env.get('pathList').children;
    for (let i = 0; i < 5; i++) optsOf(cards[i])[0].fire('click');
    env.get('pathRegenBtn').fire('click');
    ok('選擇未完成時不發請求', r.calls.length === 1, 'calls=' + r.calls.length);
    ok('會自動回到題目區', env.get('pathSection').classList.contains('hidden') === false);
  }

  console.log('\n== 36. 首頁三種訓練模式 ==');
  {
    const r = await boot([], 'gsk_k');
    const env = r.env;
    ok('入口顯示模式選擇頁', !env.get('modeSection').classList.contains('hidden'));
    ok('主題頁尚未顯示', env.get('step1').classList.contains('hidden'));
    const cards = env.get('modeCards').children;
    eq('提供三種模式', cards.length, 3);
    eq('模式鍵值正確',
       cards.map(c => c.getAttribute('data-mode')).join(','), 'guided,free,argue');

    // 選「引導式記敘」
    pickMode(env, 0);
    ok('選擇後進入主題頁', !env.get('step1').classList.contains('hidden'));
    ok('模式選擇頁收起', env.get('modeSection').classList.contains('hidden'));
    ok('顯示引導區塊', !env.get('guidedBlock').classList.contains('hidden'));
    ok('隱藏自由書寫區塊', env.get('freeBlock').classList.contains('hidden'));
    ok('顯示模式橫幅', env.get('modeBanner').textContent.indexOf('引導式記敘') !== -1);
    ok('引導按鈕文案正確', env.get('startPathBtn').textContent.indexOf('10 題') !== -1);
    eq('記住模式', env.store.get('wsm.mode'), 'guided');

    // 選「先說後寫」
    env.get('backToModeBtn').fire('click');
    ok('可回到模式頁', !env.get('modeSection').classList.contains('hidden'));
    pickMode(env, 1);
    ok('診斷模式顯示自由書寫區', !env.get('freeBlock').classList.contains('hidden'));
    ok('診斷模式隱藏引導區', env.get('guidedBlock').classList.contains('hidden'));
    eq('記住診斷模式', env.store.get('wsm.mode'), 'free');

    // 選「說理・議論」
    env.get('backToModeBtn').fire('click');
    pickMode(env, 2);
    ok('說理模式顯示引導區', !env.get('guidedBlock').classList.contains('hidden'));
    ok('說理按鈕文案正確', env.get('startPathBtn').textContent.indexOf('說理') !== -1);
    ok('說理模式提示提到反方', env.get('guidedHint').textContent.indexOf('反對') !== -1);
    ok('說理模式抽題說明正確', env.get('randomTopicNote').textContent.indexOf('30 個') !== -1,
       env.get('randomTopicNote').textContent);
    eq('記住說理模式', env.store.get('wsm.mode'), 'argue');
  }

  console.log('\n== 37. 說理模式完整流程 ==');
  {
    const ARG = ['議題','立場','理由一','例子','理由二','反方','回應','影響','結論','建議'];
    const AQ = ARG.map((s, i) => ({ id: 'g' + (i + 1), stage: s,
      question_text: '請選擇：' + s, options: ['甲' + (i+1), '乙' + (i+1), '丙' + (i+1), '丁' + (i+1)] }));
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: AQ })) },
      { status: 200, body: groqBody(JSON.stringify({ final_article: '我認為應該討論這個問題。\\n\\n理由是這樣。\\n\\n有人可能不同意，但我認為仍值得。\\n\\n所以我提出這個建議。' })) }
    ], 'gsk_k');
    const env = r.env;
    pickMode(env, 2);
    env.get('randomTopicBtn').fire('click');
    const topic = env.store.get('wsm.customTopic');
    ok('抽到的是議題庫裡的主題', !!topic, topic);

    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);

    const cards = env.get('pathList').children;
    eq('說理模式也是 10 題', cards.length, 10);
    ok('依說理文順序',
       ARG.every((s, i) => stageOf(cards[i]) === s),
       cards.map(c => stageOf(c)).join('>'));
    ok('每題 4 選 1', cards.every(c => optsOf(c).length === 4));
    ok('徽章標示為議題', env.get('pathTopicBadge').textContent.indexOf('議題') !== -1,
       env.get('pathTopicBadge').textContent);

    const g1 = JSON.parse(r.calls[0].opts.body);
    ok('使用說理出題 prompt', g1.messages[0].content.indexOf('說理與議論能力') !== -1);
    ok('user 帶入議題', g1.messages[1].content.indexOf(topic) !== -1);

    pickAll(env, 0);
    env.get('pathComposeBtn').fire('click');
    await waitFor(() => env.get('pathResult').classList.contains('hidden') === false);

    ok('產出說理文', env.get('pathEssay').textContent.length > 0);
    eq('摘要列出 10 個論點', env.get('pathSummary').children.length, 10);
    ok('字數提示用說理文標準',
       env.get('pathWordNote').textContent.indexOf('國中說理文') !== -1,
       env.get('pathWordNote').textContent);
    ok('meta 標示說理文', env.get('pathMeta').textContent.indexOf('說理文主題') !== -1);

    const g2 = JSON.parse(r.calls[1].opts.body);
    ok('使用說理合成 prompt', g2.messages[0].content.indexOf('說理文與議論文') !== -1);
    ok('合成 prompt 帶入 10 個選擇', (g2.messages[1].content.match(/甲/g) || []).length === 10);
    ok('合成 prompt 標示說理路徑', g2.messages[1].content.indexOf('說理文寫作路徑選擇') !== -1);
  }

  console.log('\n== 38. 說理模式缺漏時以 ARG_STAGES 補滿 ==');
  {
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: [] })) }
    ], 'gsk_k');
    const env = r.env;
    pickMode(env, 2);
    env.get('randomTopicBtn').fire('click');
    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);
    const cards = env.get('pathList').children;
    eq('保底補滿 10 題', cards.length, 10);
    ok('保底走說理階段而非記敘階段',
       cards[0] && stageOf(cards[0]) === '議題' && stageOf(cards[9]) === '建議',
       cards.map(c => stageOf(c)).join('>'));
    ok('不會誤用記敘的「人物」', cards.map(c => stageOf(c)).indexOf('人物') === -1);
    ok('保底題目有 4 個選項', cards.every(c => optsOf(c).length === 4));
  }

  console.log('\n== 39. 議題題庫品質 ==');
  {
    const start = HTML.indexOf('var ARG_TOPIC_BANK = [');
    const block = HTML.slice(start, HTML.indexOf('];', start));
    const items = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
    eq('有 30 個議題', items.length, 30);
    ok('每個議題都有寫作提示', items.every(s => s.split('|').length === 2 && s.split('|')[1].length > 4));
    ok('議題不重複', new Set(items.map(s => s.split('|')[0])).size === 30);
    ok('議題都是可辯論的問句', items.every(s => /嗎|該不該|有沒有|好不好|還是|哪種|比較/.test(s.split('|')[0])),
       items.filter(s => !/嗎|該不該|有沒有|好不好|還是|哪種|比較/.test(s.split('|')[0])).join(' / '));
    ok('沒有殘留「看看看」錯字', block.indexOf('看看看') === -1);

    const ARGST = HTML.slice(HTML.indexOf('var ARG_STAGES = ['), HTML.indexOf('];', HTML.indexOf('var ARG_STAGES = [')));
    const stages = [...ARGST.matchAll(/stage: '([^']+)'/g)].map(m => m[1]);
    eq('ARG_STAGES 有 10 個環節', stages.length, 10);
    ok('包含反方與回應（說理文核心）', stages.indexOf('反方') !== -1 && stages.indexOf('回應') !== -1);
    const optCounts = [...ARGST.matchAll(/options: \[([^\]]*)\]/g)].map(m => (m[1].match(/'/g) || []).length / 2);
    ok('每個環節 4 個選項', optCounts.length === 10 && optCounts.every(c => c === 4));
  }

  console.log('\n== 40. 每一題都有第 5 個選項「自己寫」 ==');
  {
    const ownOf = function (card) { return card.children[2]; };
    const ownInputOf = function (card) { return ownOf(card).children[1]; };
    const r = await boot([
      { status: 200, body: groqBody(JSON.stringify({ questions: Q10 })) },
      { status: 200, body: groqBody(JSON.stringify({ final_article: '用自己寫的內容組成的文章。' })) },
      { status: 200, body: groqBody(JSON.stringify({ final_article: '第二次合成，含自己寫的內容。' })) }
    ], 'gsk_k');
    const env = r.env;
    env.get('randomTopicBtn').fire('click');
    env.get('startPathBtn').fire('click');
    await waitFor(() => env.get('pathSection').classList.contains('hidden') === false);

    const cards = env.get('pathList').children;
    eq('10 題都有自己寫的欄位',
       cards.filter(c => c.children.length === 3 && ownInputOf(c).tagName === 'INPUT').length, 10);
    ok('第 5 選項有標題', ownOf(cards[0]).children[0].textContent.indexOf('我自己寫') !== -1);
    ok('有依環節給的寫作提示', ownInputOf(cards[0]).placeholder.indexOf('還有誰也在場') !== -1,
       ownInputOf(cards[0]).placeholder);
    ok('提示依環節不同', ownInputOf(cards[4]).placeholder !== ownInputOf(cards[0]).placeholder);
    eq('一開始不算已作答', env.get('pathProgress').textContent, '已回答 0 / 10');

    // 填入自己寫的內容即視為作答，並取代 4 個選項
    optsOf(cards[0])[1].fire('click');
    eq('先選第 2 個選項', env.get('pathProgress').textContent, '已回答 1 / 10');
    ownInputOf(cards[0]).value = '還有導師站在後面幫忙';
    ownInputOf(cards[0]).fire('input');
    eq('自己寫也算已作答', env.get('pathProgress').textContent, '已回答 1 / 10');
    ok('自己寫的欄位被標示啟用', ownOf(cards[0]).getAttribute('data-active') === 'true');
    ok('原本選的按鈕已取消選取', optsOf(cards[0])[1].getAttribute('aria-pressed') === 'false');

    // 清空後就不再算已作答
    ownInputOf(cards[0]).value = '';
    ownInputOf(cards[0]).fire('input');
    eq('清空後回到未作答', env.get('pathProgress').textContent, '已回答 0 / 10');

    // 只有空白字元不算
    ownInputOf(cards[0]).value = '   ';
    ownInputOf(cards[0]).fire('input');
    eq('只有空白字元不算已作答', env.get('pathProgress').textContent, '已回答 0 / 10');
    ownInputOf(cards[0]).value = '';

    // 改選上面按鈕會清掉自己寫的內容
    ownInputOf(cards[0]).value = '我自己寫的答案';
    ownInputOf(cards[0]).fire('input');
    optsOf(cards[0])[3].fire('click');
    eq('改選按鈕會清空自己寫的欄位', ownInputOf(cards[0]).value, '');
    eq('改選後仍算已作答（用該按鈕）', env.get('pathProgress').textContent, '已回答 1 / 10');

    // 混合作答：3 題按鈕、7 題自己寫
    for (let i = 0; i < 3; i++) optsOf(cards[i])[0].fire('click');
    for (let i = 3; i < 10; i++) {
      ownInputOf(cards[i]).value = '第' + (i + 1) + '題我自己寫的內容';
      ownInputOf(cards[i]).fire('input');
    }
    eq('混合作答全數計入', env.get('pathProgress').textContent, '已回答 10 / 10');
    ok('全部完成即可合成', env.get('pathComposeBtn').disabled === false);

    env.get('pathComposeBtn').fire('click');
    await waitFor(() => env.get('pathResult').classList.contains('hidden') === false);
    const g = JSON.parse(r.calls[1].opts.body);
    ok('自己寫的內容有帶給模型',
       g.messages[1].content.indexOf('第4題我自己寫的內容') !== -1);
    ok('按鈕選的內容也有帶入', g.messages[1].content.indexOf('選項A1') !== -1);
    eq('選擇摘要仍是 10 筆', env.get('pathSummary').children.length, 10);
    ok('摘要標示出是自己寫的', env.get('pathSummary').children[3].textContent.indexOf('✏️') !== -1,
       env.get('pathSummary').children[3].textContent);
    ok('摘要含自己寫的內容', env.get('pathSummary').children[3].textContent.indexOf('第4題我自己寫的內容') !== -1);
    ok('摘要裡按鈕選的不加符號', env.get('pathSummary').children[0].textContent.indexOf('✏️') === -1);

    // XSS：自己寫的內容只當純文字
    env.get('pathEditBtn').fire('click');
    ownInputOf(cards[0]).value = '<img src=x onerror=alert(1)>';
    ownInputOf(cards[0]).fire('input');
    for (let i = 1; i < 10; i++) {
      if (env.get('pathComposeBtn').disabled) { optsOf(cards[i])[0].fire('click'); }
    }
    env.get('pathComposeBtn').fire('click');
    await waitFor(() => env.get('pathResult').classList.contains('hidden') === false);
    const li = env.get('pathSummary').children[0];
    ok('自己寫的 HTML 只顯示為文字', li.children.length === 0 && li.textContent.indexOf('<img') !== -1,
       li.textContent.slice(0, 40));
  }

  console.log('\n' + '='.repeat(46));
  console.log('  PASS ' + pass + ' / FAIL ' + fail);
  console.log('='.repeat(46));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
