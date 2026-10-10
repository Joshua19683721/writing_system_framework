# 國小國文銜接會考表達能力系統（DOT & Local Groq API 實作規範）

## 1. 系統設計核心原則 (Core Principles)

1. **先說後寫 (Oral-to-Written)：** 先將對話與記憶具象化，降低動筆焦慮。
2. **重邏輯細節，輕華麗詞藻：** 剔除空洞成語與濫用形容詞，著重五感描寫、動態細節與「因為...所以...」因果鏈。
3. **步驟式引導 (Step-by-Step Wizard)：** 拆解為三大 Step 漸進式卡片，避免資訊過載。
4. **極簡安全性 (Local-First)：** Groq API Key 存放於使用者瀏覽器 `localStorage`，不傳送至 Server。

---

## 2. 系統步驟與引導機制 (Three-Step Wizard Workflow)

### 【Step 1：題目選擇與口述輸入 (Node 0)】

- **介面需求：** 大字體、主題快速選項、語音輸入（Web Speech API）/ 文字貼上區。
- **寫作練習主題選項：**
  1. 🏆 一次印象深刻的比賽
  2. 🤝 記一次和朋友的誤會
  3. 🌧️ 最難忘的一個雨天
  4. ✏️ 自訂主題
- **提示語 (System Hint)：** 「不用擔心寫錯字，像跟朋友聊天一樣，把發生的事情講出來就好喔！」

---

### 【Step 2：DOT Node 1 —— 蘇格拉底親和提問 (Socratic Prompt Template)】

#### Node 1 System Prompt

```text
你是一位極具親和力、專門輔導國小四年級學生的國文會考寫作導師。
你的任務是閱讀孩子發送的初稿或口述逐字稿，提取出 key point，並提出 2 個「具體、有畫面感、容易回答」的引導問題。

【提問原則】：
1. 語氣熱情、多用鼓勵性詞彙與表情符號（如 🤖, 💡, ✨）。
2. 問題 1 必須鎖定「五感描寫」或「身體/心理細節」（例如：當時聽到什麼聲音？手心有沒有冒汗？）。
3. 問題 2 必須鎖定「事情發生的轉折」或「因果關係」（例如：為什麼突然改變主意？當時大家做了什麼行動？）。
4. 不要一次問超過 2 個問題，題目要短，適合 10 歲小孩閱讀。

【輸出 JSON 格式】：
{
  "praise": "讚美孩子口述內容中的一個亮點（約 30 字）",
  "questions": [
    {
      "id": "q1",
      "question_text": "第一個引導問題",
      "placeholder": "舉例：例如看到大家的眼神...或聽到歡呼聲..."
    },
    {
      "id": "q2",
      "question_text": "第二個引導問題",
      "placeholder": "舉例：例如因為大家決定互相幫忙..."
    }
  ]
}
```

---

### 【Step 3：DOT Node 2 & 3 —— 邏輯診斷與 K/C 診斷卡 (Logic & Feedback Prompt)】

#### Node 2 & 3 System Prompt

```text
你是一位國文會考寫作專家。請結合「學生的初始口述」與「學生回答的 2 個引導問題」，進行作文邏輯優化與 K/C (Keep / Change) 回饋。

【分析標準】：
1. Keep (讚優點)：找出 2 個具體寫得好的地方（如：描寫真實、動態生動、真情實感）。
2. Change (改細節)：
   - 抓出濫用成語（如：美不勝收、開心極了）並給予替代方案。
   - 補充因果鏈斷層，讓邏輯更通順。
3. 文章重構成型 (Draft)：
   - 將內容整理為「國中會考架構格式」（段落分明、起承轉合）。
   - 保留孩子原本的意思與口吻，僅修飾語病與強化細節。

【輸出 JSON 格式】：
{
  "keeps": [
    "【感情真實】寫出了從落後到逆轉勝的真實過程！",
    "【細節生動】補充了關鍵聲音與動作描寫！"
  ],
  "changes": [
    "⚠️ 詞彙微調：「美不勝收」通常用來形容風景，這裡建議換成「心裡高興得跳起來」。",
    "🔗 因果連貫：補上了因為氣氛緊張，所以大家決定重新調整策略的細節。"
  ],
  "final_article": "重構後的完整會考優化作文..."
}
```

---

## 3. 前端單頁系統實作碼 (Groq Local API + Vanilla JS)

你可以將下方程式碼直接儲存為 `index.html`，並在本地瀏覽器運行：

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎒 國文會考魔法寫作小幫手</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 min-h-screen font-sans p-4 md:p-8">

  <div class="max-w-3xl mx-auto bg-white rounded-3xl shadow-xl border-4 border-indigo-100 p-6 md:p-10 space-y-8">
    
    <!-- 頂部標題與 API Key 設定卡片 -->
    <header class="flex flex-col md:flex-row justify-between items-center border-b-2 border-slate-100 pb-6 gap-4">
      <div>
        <h1 class="text-3xl font-black text-indigo-900 tracking-wide">🎒 國文會考魔法寫作小幫手</h1>
        <p class="text-slate-500 font-bold mt-1">小學四年級 專用思辨與表達系統</p>
      </div>
      <div class="bg-amber-50 border-2 border-amber-200 p-3 rounded-2xl w-full md:w-auto">
        <label class="block text-xs font-bold text-amber-800 mb-1">⚙️ 本地 Groq API Key：</label>
        <div class="flex gap-2">
          <input type="password" id="apiKey" placeholder="gsk_..." class="px-3 py-1 text-sm border-2 rounded-xl focus:outline-none focus:border-indigo-500">
          <button onclick="saveApiKey()" class="bg-amber-500 text-white font-bold px-3 py-1 rounded-xl text-sm hover:bg-amber-600">儲存</button>
        </div>
      </div>
    </header>

    <!-- 步驟 1：選擇題目與輸入口述 -->
    <section id="step1" class="space-y-6">
      <div class="bg-indigo-50 p-4 rounded-2xl border-2 border-indigo-100">
        <h2 class="text-xl font-bold text-indigo-900 mb-3">📍 選擇今天的練習主題：</h2>
        <div class="flex flex-wrap gap-3">
          <button onclick="selectTopic('一次印象深刻的比賽')" class="topic-btn bg-white border-2 border-indigo-200 text-indigo-800 font-bold px-4 py-2 rounded-xl hover:bg-indigo-500 hover:text-white transition">🏆 一次印象深刻的比賽</button>
          <button onclick="selectTopic('記一次和朋友的誤會')" class="topic-btn bg-white border-2 border-indigo-200 text-indigo-800 font-bold px-4 py-2 rounded-xl hover:bg-indigo-500 hover:text-white transition">🤝 記一次和朋友的誤會</button>
          <button onclick="selectTopic('最難忘的一個雨天')" class="topic-btn bg-white border-2 border-indigo-200 text-indigo-800 font-bold px-4 py-2 rounded-xl hover:bg-indigo-500 hover:text-white transition">🌧️ 最難忘的一個雨天</button>
        </div>
      </div>

      <div class="space-y-3">
        <label class="block text-lg font-bold text-slate-800">🎙️ 第一步：把你想說的話講出來或貼上來（不用擔心寫錯字！）</label>
        <textarea id="rawText" rows="5" class="w-full text-lg p-4 border-2 border-slate-200 rounded-2xl focus:border-indigo-500 focus:outline-none" placeholder="例如：上個星期六我和同學去打籃球，我們本來輸三球，後來我很努力投進一個三分球，最後我們贏了，我覺得美不勝收，非常開心..."></textarea>
      </div>

      <div class="flex gap-4">
        <button onclick="toggleDictation()" id="recordBtn" class="flex-1 bg-rose-500 text-white text-lg font-black py-4 rounded-2xl hover:bg-rose-600 transition shadow-lg">🎙️ 按下開始語音錄音</button>
        <button onclick="runNode1()" id="step1NextBtn" class="flex-1 bg-indigo-600 text-white text-lg font-black py-4 rounded-2xl hover:bg-indigo-700 transition shadow-lg">🚀 送出進行思辨提問</button>
      </div>
    </section>

    <!-- 步驟 2：Node 1 蘇格拉底提問介面 (預設隱藏) -->
    <section id="step2" class="hidden space-y-6 bg-emerald-50 p-6 rounded-3xl border-2 border-emerald-200">
      <div class="flex items-center gap-3">
        <span class="text-3xl">🤖</span>
        <h2 class="text-xl font-bold text-emerald-900" id="node1Praise">魔法導師提問時間...</h2>
      </div>
      
      <div class="space-y-4" id="questionsContainer"></div>

      <button onclick="runNode2And3()" class="w-full bg-emerald-600 text-white text-lg font-black py-4 rounded-2xl hover:bg-emerald-700 transition shadow-lg">➡️ 填好了，生成寫作診斷卡</button>
    </section>

    <!-- 步驟 3：Node 2 & 3 診斷卡與成果 (預設隱藏) -->
    <section id="step3" class="hidden space-y-6">
      <div class="bg-amber-50 p-6 rounded-3xl border-2 border-amber-200 space-y-4">
        <h2 class="text-2xl font-black text-amber-900">✨ 你的作文診斷卡與優化建議</h2>
        
        <div class="space-y-2">
          <h3 class="font-bold text-lg text-emerald-800">🌟 做的很棒的地方 (Keep)：</h3>
          <ul id="keepList" class="list-disc list-inside text-slate-700 space-y-1 font-medium"></ul>
        </div>

        <div class="space-y-2">
          <h3 class="font-bold text-lg text-rose-800">💡 可以更好的地方 (Change)：</h3>
          <ul id="changeList" class="list-disc list-inside text-slate-700 space-y-1 font-medium"></ul>
        </div>
      </div>

      <div class="bg-indigo-50 p-6 rounded-3xl border-2 border-indigo-200 space-y-3">
        <h3 class="text-xl font-black text-indigo-900">📝 幫你整理好的會考架構文章 (Draft)</h3>
        <div id="finalDraft" class="bg-white p-5 rounded-2xl border border-indigo-100 text-lg leading-relaxed text-slate-800 whitespace-pre-wrap"></div>
      </div>

      <button onclick="location.reload()" class="w-full bg-slate-700 text-white text-lg font-bold py-3 rounded-2xl hover:bg-slate-800">🔄 重新開始練習另一篇</button>
    </section>

  </div>

  <script>
    // 存取 Local Key
    function saveApiKey() {
      const key = document.getElementById('apiKey').value.trim();
      if(key) { localStorage.setItem('GROQ_KEY', key); alert('API Key 已存在本地瀏覽器！'); }
    }
    window.onload = () => {
      const k = localStorage.getItem('GROQ_KEY');
      if(k) document.getElementById('apiKey').value = k;
    };

    function selectTopic(t) { document.getElementById('rawText').value = `【${t}】`; }

    // API 呼叫函式
    async function callGroq(prompt) {
      const key = localStorage.getItem('GROQ_KEY');
      if(!key) { alert('請先儲存 Groq API Key！'); return null; }
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: "json_object" }
        })
      });
      const data = await res.json();
      return JSON.parse(data.choices[0].message.content);
    }

    // Step 1 -> Step 2
    async function runNode1() {
      const text = document.getElementById('rawText').value;
      if(!text) return alert('請先輸入或口述內容！');

      const btn = document.getElementById('step1NextBtn');
      btn.innerText = '🤖 魔法導師思考中...'; btn.disabled = true;

      const prompt = `你是一位輔導國小四年級的寫作導師。請閱讀以下口述內容並輸出 JSON。
格式: {"praise":"優點讚美", "questions":[{"id":"q1","question_text":"問題1","placeholder":"提示1"},{"id":"q2","question_text":"問題2","placeholder":"提示2"}]}
口述：${text}`;

      const data = await callGroq(prompt);
      btn.innerText = '🚀 送出進行思辨提問'; btn.disabled = false;

      if(data) {
        document.getElementById('step1').classList.add('hidden');
        document.getElementById('step2').classList.remove('hidden');
        document.getElementById('node1Praise').innerText = data.praise;

        const container = document.getElementById('questionsContainer');
        container.innerHTML = data.questions.map((q, idx) => `
          <div class="bg-white p-4 rounded-2xl border border-emerald-100 space-y-2">
            <label class="block font-bold text-emerald-900">❓ 問題 ${idx+1}：${q.question_text}</label>
            <input type="text" id="${q.id}" placeholder="${q.placeholder}" class="w-full p-3 border-2 border-slate-200 rounded-xl focus:border-emerald-500 focus:outline-none">
          </div>
        `).join('');
      }
    }

    // Step 2 -> Step 3
    async function runNode2And3() {
      const text = document.getElementById('rawText').value;
      const q1 = document.getElementById('q1')?.value || '';
      const q2 = document.getElementById('q2')?.value || '';

      const prompt = `你是寫作專家。請根據初始口述與回答，輸出 JSON。
格式: {"keeps":["優點1","優點2"],"changes":["修訂1","修訂2"],"final_article":"文章"}
口述：${text}
回答1：${q1}
回答2：${q2}`;

      const data = await callGroq(prompt);

      if(data) {
        document.getElementById('step2').classList.add('hidden');
        document.getElementById('step3').classList.remove('hidden');
        document.getElementById('keepList').innerHTML = data.keeps.map(k=>`<li>${k}</li>`).join('');
        document.getElementById('changeList').innerHTML = data.changes.map(c=>`<li>${c}</li>`).join('');
        document.getElementById('finalDraft').innerText = data.final_article;
      }
    }

    // 語音辨識機制
    let recognition;
    function toggleDictation() {
      if (!('webkitSpeechRecognition' in window)) return alert("您的瀏覽器不支援語音功能，請用 Chrome 開啟。");
      if(!recognition) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'zh-TW';
        recognition.onresult = (e) => {
          document.getElementById('rawText').value += e.results[0][0].transcript;
        };
      }
      recognition.start();
    }
  </script>
</body>
</html>
```

---

## 附錄 A：實作現況與修正紀錄（v2）

本文件第 3 章的原始碼已實作為獨立的 `index.html`。以下是規範與實作之間的差異與補充決策，
供日後維護時參考。

### A.1 原始碼必須修正的兩個阻斷性問題

| 問題 | 說明 |
|---|---|
| 巢狀圍籬 | 原文外層包在 ```markdown 裡，內層又含 ```text／```html。直接存檔會讓圍籬提前閉合、整份文件渲染錯亂。 |
| URL 被轉成 Markdown 連結 | `cdn.tailwindcss.com` 與 `api.groq.com/openai/v1/chat/completions` 在貼上時被轉成 `[url](url)`，會使 Tailwind 無法載入、API 端點失效。 |

### A.2 實作時補強的項目

**錯誤處理（原始碼的 `callGroq` 會直接拋出 TypeError）**

- HTTP 狀態分流：401/403（Key 錯誤）、404（模型不存在）、429（限流）、5xx（伺服器）各自對應繁體中文訊息。
- 逾時控制：`AbortController` + 60 秒上限，並在載入遮罩提供「取消」。
- 指數退避重試：429／5xx／網路錯誤自動重試最多 3 次（1s → 2s），只有可重試的錯誤才顯示「再試一次」按鈕。
- 模型降級：若模型不支援 `response_format`（回 400），自動移除該參數改用純提示詞重試一次。

**回應格式正規化（`normalizeNode1` / `normalizeNode23`）**

- 容忍模型在 JSON 外包 ``` 圍籬、加前導說話。
- 容忍 `questions` 回傳字串陣列而非物件陣列、`keeps` 回傳單一字串而非陣列、`changes` 回傳物件陣列。
- 容忍欄位缺漏：`questions` 不足兩題時以保底問題補滿；`keeps`／`changes` 為空時顯示肯定文案。
- 容忍欄位別名：`final_article` / `finalArticle` / `article` / `draft`。

**安全**

- 原始碼用 `innerHTML` 渲染模型輸出。實作改為 `textContent` 與 `createElement`，
  模型即使回傳 HTML 標籤也只會顯示為文字（回歸測試第 9 組專門驗證這點）。

**Prompt 補強**

- 兩份 System Prompt 各追加「語言與格式規範」：要求繁體中文（台灣用字）、只輸出合法 JSON、
  `final_article` 以換行分段且不加小標。
- Node 2 & 3 追加：孩子未回答時不得臆造其回答，但可依口述補足合理場景細節。
- 使用「system + user」兩段式訊息結構（原始碼只送 user），讓 System Prompt 真正生效。

**介面**

- 補上規範列出的第 4 個主題「✏️ 自訂主題」。
- 選主題不再覆蓋輸入框，改以徽章顯示；主題獨立送進 Prompt。
- 語音輸入：改為可連續錄製的切換按鈕、顯示即時辨識文字、對六種錯誤訊息給中文說明；
  不支援時自動隱藏按鈕並提示改用打字（原始碼是 `alert()` 阻擋）。
- 草稿自動儲存，重新開啟頁面可接續；字數即時計數。
- 產出可「複製」與「列印／存成 PDF」（列印樣式只輸出診斷卡與文章，並帶上主題與日期）。
- 顯示文章字數並標示是否落在會考建議的 400～600 字。

### A.3 已知的取捨

- **API Key 存於 localStorage** 是規範明訂的 Local-First 設計，因此保留。代價是共用電腦有風險，
  已在設定面板標示並提供「清除」按鈕。
- **`file://` 下的語音輸入**受瀏覽器安全政策限制，建議用 `http://localhost` 開啟。
- **Tailwind 使用 CDN Play 版本**，方便單檔部署但需連網；離線情境需改為本機 CSS。
- **溫度固定 0.7**，未提供 UI 調整；對作文生成已足夠，若要更穩定可調低至 0.4。

---

## 附錄 B：驗證方式

`test/app.test.js` 以極小的 DOM shim 在 Node `vm` 沙箱執行 `index.html` 內的腳本，並以假的
`fetch` 模擬 Groq 回應，涵蓋完整流程、異常格式、HTTP 錯誤與降級、逾時重試、未設定 Key、
XSS 防護與 HTML／JS id 關聯檢查。

```bash
node test/app.test.js
```

```
PASS 64 / FAIL 0
```

操作說明與疑難排解見 `README.md`。
