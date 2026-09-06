/* =====================================================
   jm.js —— 三章共用的引擎
   -----------------------------------------------------
   每章的 HTML 必须在加载本文件【之前】定义好这些全局量：
     SAVE_KEY  SCENES  NODE_POS  MAX_CHAPTER  CH_KANJI  SVG_ART
   经典脚本的顶层 const 共享同一个全局词法环境，
   所以先定义、后加载即可，不需要挂到 window 上。
===================================================== */



const OMIKUJI = [
  {rank:"大吉", cls:"daikichi", body:"願い事：思うままなり\n旅立ち：よし\n待ち人：来たる",
   zh:"愿望：如你所愿。出行：吉。等的人：会来。"},
  {rank:"大吉", cls:"daikichi", body:"学問：励めば大いに実る\n商い：利あり\n縁談：整う",
   zh:"学业：努力必有大成。生意：有利。姻缘：可成。"},
  {rank:"大吉", cls:"daikichi", body:"願い事：早く叶う\n失せ物：近くにあり\n健康：すこぶる良し",
   zh:"愿望：很快实现。失物：就在近处。健康：极佳。"},
  {rank:"吉", cls:"kichi", body:"願い事：叶うが急ぐべからず\n失せ物：出づる\n商い：焦らねば利あり",
   zh:"愿望：能实现，但不可心急。失物：会找到。生意：不急躁则有利。"},
  {rank:"吉", cls:"kichi", body:"旅立ち：さわりなし\n待ち人：遅れて来たる\n学問：こつこつと励むべし",
   zh:"出行：无碍。等的人：会来，但要迟一些。学业：应踏实努力。"},
  {rank:"吉", cls:"kichi", body:"願い事：人の助けにて叶う\n健康：養生すれば良し\n争い事：避けるが吉",
   zh:"愿望：借他人之力可成。健康：注意保养则安。争执：避开为吉。"},
  {rank:"吉", cls:"kichi", body:"縁談：良し。ただし高望みは禁物\n商い：ほどほどに利あり\n失せ物：西の方にあり",
   zh:"姻缘：好。但不可要求过高。生意：适度经营有利。失物：在西边。"},
  {rank:"凶", cls:"kyo", body:"願い事：叶いがたし。時を待て\n病：長引く恐れあり\n慎め",
   zh:"愿望：难以实现，等待时机。疾病：恐会拖延。凡事谨慎。"},
  {rank:"凶", cls:"kyo", body:"旅立ち：見合わせるべし\n失せ物：出でがたし\n心静かに過ごせ",
   zh:"出行：应暂缓。失物：难寻。静心度日。"},
  {rank:"凶", cls:"kyo", body:"待ち人：来たらず\n争い事：負けなり\n耐えて春を待て",
   zh:"等的人：不会来。争执：会输。忍耐，等待春天。"}
];
// 大吉20% / 吉50% / 凶30%（浅草寺传统：凶签就是多）
const OMIKUJI_WEIGHTS = [
  {idx:[0,1,2], w:20},
  {idx:[3,4,5,6], w:50},
  {idx:[7,8,9], w:30}
];

/* =====================================================
   STORAGE  (window.storage -> localStorage -> memory)
===================================================== */
let REVIEW = false;   /* 评审模式（见文件末尾「后门」一节）。开启后一律不写存档 */
let state = { learned:{}, cleared:{}, gold:{}, qdone:{}, omikuji:null, eggTaps:{}, seenGuide:false, seenV2:false,
  /* 二周目（高阶版）。纯追加，旧存档读进来时这一层是空的 */
  adv: { learned:{}, cleared:{}, gold:{}, qdone:{} },
  tier: "basic",        /* 她上次停在哪一周目 */
  doneBasic: false,     /* 基础版通关（跨章解锁靠这两个旗子） */
  doneAdv: false };

/* 当前周目。P() 取进度，QP() 取题库——玩法主体一律走这两个口子 */
let TIER = "basic";
function P(){ return TIER === "adv" ? state.adv : state; }
function QP(h){ return (TIER === "adv" ? h.advanced : h.questions) || []; }
function advExists(){ return SCENES.some(sc=>sc.hotspots.some(h=>h.learn && h.advanced && h.advanced.length)); }
function tierLabel(){ return TIER === "adv" ? "二周目" : "一周目"; }

async function loadState(){
  if (window.storage) {
    try {
      const r = await window.storage.get(SAVE_KEY);
      if (r && r.value) { state = Object.assign(state, JSON.parse(r.value)); afterLoad(); return; }
    } catch(e){ /* key missing or unavailable */ }
  }
  try {
    const v = localStorage.getItem(SAVE_KEY);
    if (v) state = Object.assign(state, JSON.parse(v));
  } catch(e){}
  afterLoad();
}
/* 旧存档没有 adv 这一层，补上；再把周目恢复到她上次停的地方 */
function afterLoad(){
  if (!state.adv) state.adv = { learned:{}, cleared:{}, gold:{}, qdone:{} };
  ["learned","cleared","gold","qdone"].forEach(k=>{ if (!state.adv[k]) state.adv[k] = {}; });
  TIER = (state.tier === "adv" && advUnlocked()) ? "adv" : "basic";
}
async function saveState(){
  if (REVIEW) return;   /* 评审模式绝不落盘，试玩不会污染已有进度 */
  /* 目录页要靠这几个数算进度条，但它不加载各章的 SCENES，所以存档里带着走 */
  state.meta = {
    name: (CHT.area || ""),
    basic: tierTotal("basic"),
    adv: tierTotal("adv")
  };
  const v = JSON.stringify(state);
  if (window.storage) {
    try { await window.storage.set(SAVE_KEY, v); return; } catch(e){}
  }
  try { localStorage.setItem(SAVE_KEY, v); } catch(e){}
}

/* =====================================================
   TTS
===================================================== */
let jaVoice = null;
function findJaVoice(){
  if (!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices();
  if (!vs || !vs.length) return null;
  const ja = vs.filter(v=>v.lang && v.lang.replace("_","-").toLowerCase().indexOf("ja")===0);
  if (!ja.length) return null;
  const pref = ja.find(v=>/Kyoko|Otoya|Google\s*日本語|Google Japanese|Sayaka|Haruka/i.test(v.name));
  return pref || ja[0];
}
function ensureVoice(){ if(!jaVoice) jaVoice = findJaVoice(); return jaVoice; }
if ("speechSynthesis" in window){
  speechSynthesis.onvoiceschanged = ()=>{ jaVoice = findJaVoice(); };
  let _vtries = 0;
  const _vt = setInterval(()=>{ if (ensureVoice() || ++_vtries>12) clearInterval(_vt); }, 300);
}
function speak(text, rate){
  if (!("speechSynthesis" in window)){ toast("这个浏览器不支持语音朗读"); return; }
  const v = ensureVoice();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  if (v){ u.voice = v; }
  else { toast("没找到日语语音包：请在手机系统设置里添加日语语音，否则可能用中文声音朗读"); }
  u.rate = rate || 0.85;
  speechSynthesis.speak(u);
}
let _toastT = null;
function toast(msg){
  let t = document.getElementById("toast");
  if (!t){
    t = document.createElement("div");
    t.id = "toast";
    t.style.cssText = "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#33302B;color:#FBF3E2;padding:10px 16px;border-radius:10px;font-size:12px;z-index:99;max-width:80%;text-align:center;line-height:1.5;box-shadow:0 4px 12px rgba(0,0,0,.3);display:none";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(_toastT);
  _toastT = setTimeout(()=>{ t.style.display = "none"; }, 3400);
}

/* =====================================================
   HELPERS
===================================================== */
const $ = s => document.querySelector(s);
function el(tag, cls, html){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function shuffledOptions(q){
  if (!q.options) return [];   /* 产出型题目没有选项 */
  const idx = q.options.map((_,i)=>i);
  for (let i=idx.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [idx[i],idx[j]] = [idx[j],idx[i]];
  }
  return idx;
}
function quizHotspots(scene){ return scene.hotspots.filter(h=>h.learn && QP(h).length); }
function totalStamps(){ return SCENES.reduce((n,s)=>n+quizHotspots(s).length,0); }
function stampCount(){ return Object.keys(P().cleared).length; }

/* =====================================================
   NAVIGATION
===================================================== */
let currentScene = null;
function show(viewId){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $("#"+viewId).classList.add("active");
  $("#btn-back").style.display = (viewId==="view-map") ? "none" : "flex";
  window.scrollTo(0,0);
}
$("#btn-back").addEventListener("click", ()=>{ renderMap(); show("view-map"); });
$("#btn-stamps").addEventListener("click", ()=>{ renderStamps(); show("view-stamps"); });

/* =====================================================
   MAP
===================================================== */
function chapterAllGold(ch){
  return SCENES.filter(s=>s.chapter===ch)
    .every(s=>quizHotspots(s).every(h=>P().gold[h.id]));
}
function chapterUnlocked(ch){
  if (REVIEW) return true;
  if (ch===1) return true;
  return chapterAllGold(ch-1);
}
function renderMap(){
  const canvas = $("#map-canvas");
  canvas.querySelectorAll(".lantern-node").forEach(n=>n.remove());
  SCENES.forEach(sc=>{
    const hs = quizHotspots(sc);
    const goldN = hs.filter(h=>P().gold[h.id]).length;
    const unlocked = chapterUnlocked(sc.chapter);
    const small = sc.chapter!==1;
    const node = el("div","lantern-node"+(small?" small":"")+(unlocked?"":" locked")+(goldN===hs.length&&unlocked?" done":""));
    node.style.left = NODE_POS[sc.id].x+"%";
    node.style.top = NODE_POS[sc.id].y+"%";
    node.innerHTML = '<div class="lamp"><span class="nm">'+sc.short+'</span>'+
      (unlocked?'':'<span class="ribbon">'+sc.chapter+'章</span>')+'</div>'+
      (unlocked?('<div class="cnt">金 '+goldN+' / '+hs.length+'</div>'):'<div class="cnt">🔒</div>');
    node.addEventListener("click", ()=>{
      if (!unlocked){ toast("第"+(sc.chapter-1)+"章の全部の地点で金印を集めると、ここが点亮されます"); return; }
      openScene(sc);
    });
    canvas.appendChild(node);
  });
  let open = 1;
  for (let c=1;c<=MAX_CHAPTER;c++){ if (chapterUnlocked(c)) open = c; }
  const chEl = $("#map-chap");
  if (chEl) chEl.textContent = "第 "+CH_KANJI[open]+" 章 · 全 "+CH_KANJI[MAX_CHAPTER]+" 章"+
    (TIER === "adv" ? " · 二周目" : "");
  $("#stamp-count").textContent = stampCount()+"/"+totalStamps();
  renderTierBar();
}

/* =====================================================
   SCENES (SVG art)
===================================================== */


function openScene(sc){
  currentScene = sc;
  $("#scene-title").textContent = sc.name;
  const stage = $("#scene-stage");
  stage.innerHTML = SVG_ART[sc.svg] + '<div id="egg-bubble"></div>';
  sc.hotspots.forEach(h=>{
    const spot = el("button","spot"+(h.egg?" egg":"")+(h.bunjin?" bunjin":""));
    if (P().gold[h.id]) spot.classList.add("gold");
    else if (P().cleared[h.id]) spot.classList.add("cleared");
    else if (P().learned[h.id]) spot.classList.add("learned");
    spot.style.left = h.x+"%";
    spot.style.top = h.y+"%";
    spot.innerHTML = '<span class="dot"></span><span class="tag">'+h.name+'</span>';
    spot.addEventListener("click", ()=>tapHotspot(h, spot));
    stage.appendChild(spot);
  });
  updateSceneProg();
  show("view-scene");
}
function updateSceneProg(){
  const hs = quizHotspots(currentScene);
  const done = hs.filter(h=>P().gold[h.id]).length;
  $("#scene-prog").textContent = "金印 "+done+" / "+hs.length;
  $("#stamp-count").textContent = stampCount()+"/"+totalStamps();
}

/* =====================================================
   HOTSPOT TAP
===================================================== */
function tapHotspot(h, spotEl){
  if (h.egg) return tapEgg(h, spotEl);
  if (h.mikuji) return openOmikuji();
  if (!P().learned[h.id]) openLearn(h, false);
  else openQuiz(h);
}

/* ---------- easter eggs ---------- */
function tapEgg(h, spotEl){
  state.eggTaps[h.id] = (state.eggTaps[h.id]||0)+1;
  const n = state.eggTaps[h.id];
  const bubble = $("#egg-bubble");
  bubble.style.left = h.x+"%";
  bubble.style.top = (h.y-6)+"%";
  bubble.textContent = (n>=h.eggFinalAt) ? h.eggFinal : h.eggLines[(n-1)%h.eggLines.length];
  bubble.style.display = "block";
  clearTimeout(bubble._t);
  bubble._t = setTimeout(()=>{ bubble.style.display="none"; }, 1800);
  // animation
  if (h.id==="pigeons"){
    const g = $("#pigeon-group");
    if (g){
      g.style.transition = "transform .6s ease";
      g.style.transform = "translateY(-34px)";
      setTimeout(()=>{ g.style.transform="translateY(0)"; }, 650);
    }
  }
  if (h.id==="cat"){
    const tail = $("#cat-tail");
    if (tail){
      tail.setAttribute("d", n%2 ? "M172 310 Q158 300 170 294" : "M172 310 Q160 316 168 300");
    }
  }
  saveState();
}

/* =====================================================
   BOTTOM SHEET
===================================================== */
function openSheet(html){
  $("#sheet-content").innerHTML = html;
  $("#sheet-mask").style.display = "block";
  requestAnimationFrame(()=>$("#sheet").classList.add("open"));
}
function closeSheet(){
  $("#sheet").classList.remove("open");
  $("#sheet-mask").style.display = "none";
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
$("#sheet-mask").addEventListener("click", closeSheet);

/* ---------- learn card ---------- */
function openLearn(h, isReview){
  const b = h.bunjin;
  let html = '<div class="sheet-eyebrow">'+(b?"文 人 碑":"学習カード")+'</div>' +
    '<div class="sheet-title">'+h.name+'</div>';
  if (b){
    html += '<div class="bunjin-tag">'+b.life+' · '+b.tag+'</div>'+
      '<div class="bunjin-story">'+b.story+'</div>'+
      '<div class="bunjin-quote">'+
        '<div class="q-jp">'+b.quote.jp+'</div>'+
        '<div class="q-kana">'+b.quote.kana+'<br>'+b.quote.romaji+'</div>'+
        '<div class="q-zh">'+b.quote.zh+'</div>'+
        '<div class="q-src">——'+b.quote.src+'</div>'+
        '<div class="q-play"><button class="btn-tts" data-say="'+b.quote.kana+'">🔊</button></div>'+
      '</div>'+
      '<div class="bunjin-sep">この碑のことば</div>';
  }
  h.learn.words.forEach(w=>{
    html += '<div class="word-row">'+
      '<div class="w-main"><div class="w-kanji">'+w.jp+'</div>'+
      '<div class="w-kana">'+w.kana+' · '+w.romaji+'</div>'+
      '<div class="w-zh">'+w.zh+'</div></div>'+
      '<button class="btn-tts" data-say="'+w.kana+'">🔊</button></div>';
  });
  html += '<div class="learn-note"><div class="n-ja">'+h.learn.noteJa+'</div>'+
    '<div class="n-zh" style="color:#26466D">'+h.learn.noteRomaji+'</div>'+
    '<div class="n-zh">'+h.learn.noteZh+'</div>'+
    '<div class="n-play"><button class="btn-tts" data-say="'+h.learn.noteKana+'">🔊</button></div></div>';
  if (isReview){
    html += '<button class="btn-main" id="btn-to-quiz">去做题</button>';
  } else {
    html += '<button class="btn-main" id="btn-learned">记住了</button>';
  }
  openSheet(html);
  bindTts();
  if (isReview){
    $("#btn-to-quiz").addEventListener("click", ()=>openQuiz(h));
  } else {
    $("#btn-learned").addEventListener("click", async ()=>{
      P().learned[h.id] = true;
      await saveState();
      closeSheet();
      refreshSpots();
    });
  }
}
function bindTts(){
  document.querySelectorAll(".btn-tts").forEach(b=>{
    if (b.dataset.bound) return;
    b.dataset.bound = "1";
    b.addEventListener("click", ()=>speak(b.dataset.say, b.dataset.rate ? Number(b.dataset.rate) : undefined));
  });
}
function refreshSpots(){
  if (currentScene) openScene(currentScene);
}

/* ---------- quiz ---------- */
function shuffleArr(a){
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function openQuiz(h){
  const pool = QP(h);
  const doneSet = P().qdone[h.id] || {};
  const undone = shuffleArr(pool.map((_,i)=>i).filter(i=>!doneSet[i]));
  const doneIdx = shuffleArr(pool.map((_,i)=>i).filter(i=>doneSet[i]));
  const want = Math.min(3, pool.length);
  const picks = undone.slice(0, want);
  let di = 0;
  while (picks.length < want && di < doneIdx.length){ picks.push(doneIdx[di++]); }
  const run = { qi:picks, i:0, wrong:0, order:picks.map(pi=>shuffledOptions(pool[pi])) };
  renderQuestion(h, run);
}
/* =====================================================
   出題
   -----------------------------------------------------
   識別型（既存）  read / listen / vocab / scene / particle
       四択。読める・聞き分けられるを見る。
   産出型（新）    build / rewrite / write / shadow
       自分で文を作らせる。浅草の回は識別だけだったので、
       二十年ぶんの「わかるけど言えない」がそのまま残った。
       上野からは産出を主軸にする。

   run = { qi:[出題する問題の添字], i:今何問目, wrong:間違えた回数,
           order:[各問の選択肢の並び] }
===================================================== */

/* 共通の枠：見出し＋進捗ドット */
function qHead(h, run){
  return '<div class="sheet-eyebrow">' + h.name + '</div>' +
    '<div class="quiz-prog">' + run.qi.map((_, k) =>
      '<i class="' + (k < run.i ? "done" : k === run.i ? "on" : "") + '"></i>').join("") + '</div>';
}
/* 共通の裾：解説欄＋次へ＋学習カードに戻る */
function qTail(){
  return '<div class="q-explain" id="q-explain"></div>' +
    '<button class="btn-main" id="btn-next" style="display:none"></button>' +
    '<button class="link-plain" id="btn-review" style="margin-top:8px">复习学习卡</button>';
}
/* 共通の後始末：正解なら記録して次へ、間違いなら解き直し */
async function qResolve(h, run, correct, extraHtml, sayAfter, retryable){
  const q = QP(h)[run.qi[run.i]];
  const nextBtn = $("#btn-next");
  if (correct){
    if (!P().qdone[h.id]) P().qdone[h.id] = {};
    P().qdone[h.id][run.qi[run.i]] = true;
    await saveState();
    nextBtn.dataset.retry = "";
    nextBtn.textContent = (run.i < run.qi.length - 1 ? "下一题" : "看结果");
  } else {
    run.wrong++;
    nextBtn.dataset.retry = retryable === false ? "" : "1";
    nextBtn.textContent = retryable === false ? "下一题" : "再答一次（答对才能过）";
  }
  const ex = $("#q-explain");
  ex.innerHTML = (extraHtml || "") + q.explain +
    (sayAfter ? '<div style="margin-top:8px"><button class="btn-tts" data-say="' + sayAfter +
      '" style="width:34px;height:34px;font-size:14px">🔊</button> ' +
      '<span style="font-size:11px;color:#8a8272">听正确说法</span></div>' : '');
  ex.style.display = "block";
  bindTts();
  nextBtn.style.display = "block";
}
function qBindNav(h, run){
  $("#btn-next").addEventListener("click", ()=>{
    if ($("#btn-next").dataset.retry){
      const q = QP(h)[run.qi[run.i]];
      if (q.options) run.order[run.i] = shuffledOptions(q);
      renderQuestion(h, run);
      return;
    }
    if (run.i < run.qi.length - 1){ run.i++; renderQuestion(h, run); }
    else finishQuiz(h, run);
  });
  $("#btn-review").addEventListener("click", ()=>openLearn(h, true));
}

function renderQuestion(h, run){
  const q = QP(h)[run.qi[run.i]];
  if (q.type === "build" || q.type === "rewrite") return renderBuild(h, run);
  if (q.type === "write")  return renderWrite(h, run);
  if (q.type === "shadow") return renderShadow(h, run);
  return renderChoice(h, run);
}

/* ---------- 四択（従来どおり） ---------- */
function renderChoice(h, run){
  const q = QP(h)[run.qi[run.i]];
  const ord = run.order[run.i];
  const jp = !!(q.jpOptions || q.type === "read" || q.type === "particle");
  let html = qHead(h, run);

  if (q.type === "listen"){
    html += '<div class="q-text">听一遍，选出正确的意思：</div>' +
      '<div class="q-listen"><button class="btn-tts" data-say="' + (q.ttsKana || q.tts) + '">🔊</button>' +
      '<span class="hint">可以反复播放 · 真实语速</span></div>';
  } else {
    html += '<div class="q-text">' +
      ((q.type === "read" || q.type === "particle") ? '<span class="jp">' + q.prompt + '</span>' : q.prompt) +
      '</div>';
  }
  html += '<div class="opts">' + ord.map(oi =>
    '<button class="opt' + (jp ? ' jp' : '') + '" data-oi="' + oi + '">' + q.options[oi] + '</button>').join("") + '</div>';
  html += qTail();

  openSheet(html);
  bindTts();
  if (q.type === "listen") speak(q.ttsKana || q.tts);

  document.querySelectorAll(".opt").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const chosen = Number(btn.dataset.oi);
      document.querySelectorAll(".opt").forEach(b=>{
        b.disabled = true;
        if (Number(b.dataset.oi) === q.answer) b.classList.add("correct");
      });
      if (chosen !== q.answer) btn.classList.add("wrong");
      let extra = "";
      if (q.type === "listen"){
        extra = '<span class="tr">「' + q.tts + '」</span>' +
          '<span style="display:block;color:#26466D;font-size:12px;margin-bottom:6px">' + (q.ttsKana || "") + '</span>';
      }
      let sayAfter = null;
      if (q.type === "read") sayAfter = q.options[q.answer];
      if (q.type === "particle") sayAfter = q.sayKana || null;
      if (q.phraseKana) sayAfter = q.phraseKana;
      await qResolve(h, run, chosen === q.answer, extra, sayAfter);
    });
  });
  qBindNav(h, run);
}

/* ---------- 組み立て：語順と助詞を自分で組む ---------- */
function renderBuild(h, run){
  const q = QP(h)[run.qi[run.i]];
  const bank = shuffleArr(q.tiles.concat(q.extra || []).map((t, i)=>({t:t, i:i})));
  const picked = [];

  let html = qHead(h, run);
  html += '<div class="q-text">' + q.prompt + '</div>';
  if (q.zhHint) html += '<div class="b-zh">' + q.zhHint + '</div>';
  html += '<div class="build-slot" id="b-slot"></div>';
  html += '<div class="build-bank" id="b-bank"></div>';
  html += '<div class="b-row"><button class="btn-ghost" id="b-clear">全部退回</button>' +
          '<button class="btn-main" id="b-check">这样说</button></div>';
  html += qTail();
  openSheet(html);

  const slotEl = $("#b-slot"), bankEl = $("#b-bank");
  function draw(){
    slotEl.innerHTML = picked.length
      ? picked.map((p, k)=>'<button class="tile in" data-k="' + k + '">' + p.t + '</button>').join("")
      : '<span class="b-ph">点下面的词，按顺序排出这句话</span>';
    bankEl.innerHTML = bank.map((b, k)=>
      picked.indexOf(b) >= 0 ? '' : '<button class="tile" data-b="' + k + '">' + b.t + '</button>').join("");
    slotEl.querySelectorAll(".tile").forEach(el=>{
      el.addEventListener("click", ()=>{ picked.splice(Number(el.dataset.k), 1); draw(); });
    });
    bankEl.querySelectorAll(".tile").forEach(el=>{
      el.addEventListener("click", ()=>{ picked.push(bank[Number(el.dataset.b)]); draw(); });
    });
  }
  draw();

  $("#b-clear").addEventListener("click", ()=>{ picked.length = 0; draw(); });
  $("#b-check").addEventListener("click", async ()=>{
    const got = picked.map(p=>p.t);
    const want = q.tiles;
    let bad = -1;
    for (let k = 0; k < Math.max(got.length, want.length); k++){
      if (got[k] !== want[k]){ bad = k; break; }
    }
    if (bad < 0){
      slotEl.querySelectorAll(".tile").forEach(el=>el.classList.add("ok"));
      $("#b-check").disabled = true;
      $("#b-clear").disabled = true;
      bankEl.innerHTML = "";
      speak(q.kana || want.join(""));
      await qResolve(h, run, true,
        '<div class="b-answer">' + want.join("") + '</div>' +
        (q.kana ? '<div class="b-kana">' + q.kana + '</div>' : ''),
        q.kana || want.join(""));
    } else {
      const tiles = slotEl.querySelectorAll(".tile");
      if (tiles[bad]) tiles[bad].classList.add("bad");
      run.wrong++;
      toast(bad === 0 ? "开头就不对——先想想这句话从哪个词起头"
                      : "前 " + bad + " 个词是对的，第 " + (bad + 1) + " 个开始要改");
    }
  });
  qBindNav(h, run);
}

/* ---------- 書く：短く打たせる ---------- */
function renderWrite(h, run){
  const q = QP(h)[run.qi[run.i]];
  let tries = 0;

  let html = qHead(h, run);
  html += '<div class="q-text">' + q.prompt + '</div>';
  html += '<input class="w-input" id="w-in" type="text" autocomplete="off" autocapitalize="off" ' +
          'spellcheck="false" placeholder="' + (q.placeholder || "ここに日本語で") + '">';
  if (q.hint) html += '<div class="w-hint">提示：' + q.hint + '</div>';
  html += '<div class="b-row"><button class="btn-ghost" id="w-give" style="visibility:hidden">看答案</button>' +
          '<button class="btn-main" id="w-check">这样写</button></div>';
  html += qTail();
  openSheet(html);
  $("#w-in").focus();

  const norm = s => String(s).replace(/[\s　]/g, "")
    .replace(/[。．.、，,！!？?~〜ー]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    /* 片仮名→平仮名。彼女には「ロダン」も「ろだん」も同じ勝ちにする */
    .replace(/[ァ-ヶ]/g, c=>String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase();
  function dist(a, b){
    const m = a.length, n = b.length;
    let prev = Array.from({length:n + 1}, (_, j)=>j);
    for (let i = 1; i <= m; i++){
      const cur = [i];
      for (let j = 1; j <= n; j++){
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i-1] === b[j-1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  const best = s => q.accept.reduce((m, a)=>Math.min(m, dist(norm(s), norm(a))), 99);

  async function pass(near){
    $("#w-in").disabled = true;
    $("#w-check").disabled = true;
    $("#w-give").style.visibility = "hidden";
    speak(q.kana || q.accept[0]);
    await qResolve(h, run, true,
      (near ? '<div class="w-near">差一点点，就当对了。标准说法是：</div>' : '') +
      '<div class="b-answer">' + q.accept[0] + '</div>' +
      (q.kana ? '<div class="b-kana">' + q.kana + '</div>' : ''),
      q.kana || q.accept[0]);
  }
  $("#w-check").addEventListener("click", async ()=>{
    const v = $("#w-in").value.trim();
    if (!v){ toast("先写点什么，写错也没关系"); return; }
    const d = best(v);
    if (d === 0) return pass(false);
    if (d <= 2) return pass(true);
    tries++;
    run.wrong++;
    const inp = $("#w-in");                     /* 先抓住元素：600ms 后可能已经换题了 */
    inp.classList.add("bad");
    setTimeout(()=>inp.classList.remove("bad"), 600);
    toast(tries === 1 ? "还不对，再想想。想不出来就再按一次" : "再试一次，或者点「看答案」");
    if (tries >= 2) $("#w-give").style.visibility = "visible";
  });
  $("#w-give").addEventListener("click", ()=>pass(true));
  qBindNav(h, run);
}

/* ---------- 音読：耳だけ二十年ぶんある人に、口を動かさせる ---------- */
function renderShadow(h, run){
  const q = QP(h)[run.qi[run.i]];
  let html = qHead(h, run);
  html += '<div class="q-text">' + (q.prompt || "听一遍，然后自己出声念一遍") + '</div>';
  const hide = !!q.hideKana;   /* 漢字を見て自力で読ませる。中国語で読む癖への直撃 */
  html += '<div class="sh-card">' +
    '<div class="sh-jp">' + q.jp + '</div>' +
    (hide ? '<button class="link-plain sh-reveal" id="sh-rv">先自己念，念完点这里对答案</button>' +
            '<div class="sh-kana" id="sh-kana" style="display:none">' + q.kana + '</div>'
          : '<div class="sh-kana">' + q.kana + '</div>') +
    '<div class="sh-zh">' + q.zh + '</div>' +
    '<div class="sh-play"><button class="btn-tts" data-say="' + q.kana + '">🔊</button>' +
    '<button class="btn-tts slow" data-say="' + q.kana + '" data-rate="0.6">🐢</button></div>' +
    '</div>';
  html += '<button class="btn-main" id="sh-ok">念出来了</button>';
  html += qTail();
  openSheet(html);
  bindTts();
  if (!hide) speak(q.kana);      /* 隠す回は、先に音を聞かせない */
  const rv = $("#sh-rv");
  if (rv) rv.addEventListener("click", ()=>{
    $("#sh-kana").style.display = "block";
    rv.style.display = "none";
    speak(q.kana);
  });
  $("#sh-ok").addEventListener("click", async ()=>{
    $("#sh-ok").disabled = true;
    await qResolve(h, run, true, "", q.kana);
  });
  qBindNav(h, run);
}

async function finishQuiz(h, run){
  const pool = QP(h);
  const doneSet = P().qdone[h.id] || {};
  const dcount = Object.keys(doneSet).length;
  const nowGold = dcount >= pool.length;
  const newGold = nowGold && !P().gold[h.id];
  P().cleared[h.id] = true;
  if (nowGold) P().gold[h.id] = true;
  await saveState();
  let html = '<div class="result-wrap">'+
    '<div class="r-title">'+(nowGold?"金印達成！":"通関！")+'</div>'+
    '<div class="r-sub">'+(nowGold ? "这里的题全部答完了，盖金印" :
      ("本处题库已答完 "+dcount+" / "+pool.length+" 题<br>每次进来题目会换，把剩下的答完就是金印"))+'</div>'+
    '<div class="seal'+(nowGold?" gold":"")+'"><div class="s-inner"><span class="s-name">'+h.name+'</span></div></div>'+
    (nowGold?'<span class="perfect-tag">金 印</span>':'')+
    '</div>'+
    '<button class="btn-main" id="btn-close-result">返回场景</button>'+
    (!nowGold?'<button class="btn-ghost" id="btn-retry">继续做剩下的题</button>':'');
  openSheet(html);
  $("#btn-close-result").addEventListener("click", ()=>{
    closeSheet(); refreshSpots();
    if (newGold) checkChapter(h);
  });
  const retry = $("#btn-retry");
  if (retry) retry.addEventListener("click", ()=>openQuiz(h));
}
async function checkChapter(h){
  const sc = SCENES.find(s=>s.hotspots.includes(h));
  if (!sc) return;
  if (!chapterAllGold(sc.chapter)) return;
  const wasBasicDone = state.doneBasic;
  refreshDone();
  await saveState();
  if (sc.chapter < MAX_CHAPTER){ showCongrats(sc.chapter); return; }
  /* 本章最后一章也集满了 */
  if (TIER === "basic" && !wasBasicDone && typeof NEXT_STEP !== "undefined" && NEXT_STEP){
    showNextStep();          /* 强提示：回上一章做二周目 */
    return;
  }
  showFinale();
}
function overlayCard(inner){
  let g = document.getElementById("ovl");
  if (!g){
    g = document.createElement("div");
    g.id = "ovl";
    document.body.appendChild(g);
  }
  g.innerHTML = '<div class="g-card">'+inner+'</div>';
  g.style.display = "flex";
  return g;
}
function showCongrats(ch){
  const next = ch+1;
  const nextNames = SCENES.filter(s=>s.chapter===next).map(s=>s.name).join("・");
  const g = overlayCard(
    '<div style="text-align:center;font-size:40px;margin-bottom:6px">🏮</div>'+
    '<h3>第'+ch+'章 制覇！</h3>'+
    '<p style="text-align:center;font-size:14px;line-height:1.8;margin-bottom:6px">'+
    '这一章的每一个角落，你都拿到了金印。<br><b>おめでとうございます！</b></p>'+
    '<p style="text-align:center;font-size:13px;color:#7c7566;line-height:1.7;margin-bottom:4px">'+
    '地图上新点亮了：<br><b>'+nextNames+'</b></p>'+
    '<button class="btn-main" id="btn-congrats-go">去看新地图</button>');
  document.getElementById("btn-congrats-go").addEventListener("click", ()=>{
    g.style.display = "none";
    renderMap(); show("view-map");
  });
}
function showFinale(){
  const g = overlayCard(
    '<div style="text-align:center;font-size:40px;margin-bottom:6px">🗺️</div>'+
    '<h3>' + (CHT.finaleTitle || (CH_KANJI[MAX_CHAPTER] + '章 全制覇！')) + '</h3>'+
    (CHT.finale || '')+
    '<button class="btn-main" id="btn-finale-close">まだまだ歩ける</button>');
  document.getElementById("btn-finale-close").addEventListener("click", ()=>{
    g.style.display = "none";
    renderMap(); show("view-map");
  });
}
/* 老玩家（1〜3章已全金）第一次打开新版本时的招呼 */
function showNewChapters(){
  const g = overlayCard(
    '<div style="text-align:center;font-size:40px;margin-bottom:6px">🏮</div>'+
    '<h3>新しい地図</h3>'+
    (CHT.newChapters || '')+
    '<button class="btn-main" id="btn-nc-go">出発</button>');
  document.getElementById("btn-nc-go").addEventListener("click", async ()=>{
    g.style.display = "none";
    state.seenV2 = true; await saveState();
    renderMap(); show("view-map");
  });
}

/* =====================================================
   OMIKUJI
===================================================== */
function drawOmikuji(excludeKyo){
  const groups = excludeKyo
    ? [{idx:[0,1,2], w:30},{idx:[3,4,5,6], w:70}]
    : OMIKUJI_WEIGHTS;
  let r = Math.random()*100, pick = groups[0];
  for (const g of groups){ if (r < g.w){ pick = g; break; } r -= g.w; }
  return pick.idx[Math.floor(Math.random()*pick.idx.length)];
}
function openOmikuji(){
  const today = todayStr();
  const drawn = state.omikuji && state.omikuji.date===today;
  const prevWasKyo = state.omikuji && state.omikuji.date!==today && OMIKUJI[state.omikuji.idx].cls==="kyo";
  let html = '<div class="sheet-eyebrow">毎日一回</div><div class="sheet-title">おみくじ</div>'+
    '<div class="mikuji-box" id="mikuji-box"><div class="hole"></div><span class="label">御神籤</span></div>'+
    '<div class="mikuji-slip" id="mikuji-slip"></div>';
  if (drawn){
    html += '<p class="mikuji-note">今天的签就是它了 · 明日また来てね</p>';
  } else {
    html += '<button class="btn-main" id="btn-draw">摇一支签</button>'+
      '<p class="mikuji-note">每天一支，新的一天新的运气</p>';
  }
  openSheet(html);
  if (drawn){ showSlip(state.omikuji.idx, true); }
  else {
    $("#btn-draw").addEventListener("click", async ()=>{
      const box = $("#mikuji-box");
      box.classList.add("shaking");
      $("#btn-draw").style.display = "none";
      setTimeout(async ()=>{
        const idx = drawOmikuji(prevWasKyo);
        state.omikuji = {date:today, idx:idx};
        await saveState();
        showSlip(idx, false);
      }, 900);
    });
  }
}
function showSlip(idx, instant){
  const f = OMIKUJI[idx];
  const slip = $("#mikuji-slip");
  slip.innerHTML = '<div class="m-rank '+f.cls+'">'+f.rank+'</div>'+
    '<div class="m-body">'+f.body+'</div>'+
    '<div class="m-zh" id="m-zh">'+f.zh+'</div>'+
    '<button class="link-plain" id="btn-kaisetsu">解説（认输看中文）</button>'+
    (f.cls==="kyo"?'<p class="mikuji-note">凶签系在树上留下就好，明天再来抽过</p>':'');
  slip.style.display = "block";
  if (instant) slip.style.animation = "none";
  $("#btn-kaisetsu").addEventListener("click", function(){
    $("#m-zh").style.display = "block";
    this.style.display = "none";
  });
}

/* =====================================================
   STAMP BOOK
===================================================== */
function renderStamps(){
  const grid = $("#stamp-grid");
  grid.innerHTML = "";
  let got = 0;
  SCENES.forEach(sc=>{
    quizHotspots(sc).forEach(h=>{
      const has = !!P().cleared[h.id];
      const gold = !!P().gold[h.id];
      if (has) got++;
      const cell = el("div","stamp-cell "+(has?("got"+(gold?" gold":"")):"empty"));
      cell.innerHTML = '<div class="c-seal"><div class="c-inner"><span class="c-name">'+h.name+'</span></div></div>'+
        '<div class="c-label">'+sc.short+(gold?' · 金':'')+'</div>';
      grid.appendChild(cell);
    });
  });
  $("#book-sub").textContent = "已集 "+got+" / "+totalStamps()+" 枚 · 答完一处全部题目得金印";
}

/* =====================================================
   PROGRESS CODE  进度码（换设备接着做）
   -----------------------------------------------------
   把 learned / cleared / gold / qdone 压成位图，再用
   Crockford Base32 编码，约 84 个字符。
   带走：学习卡是否看过、朱印、金印、每道题是否答过。
   不带走：omikuji（今日签）、eggTaps（彩蛋计数）——重抽即可。

   注意：位序 = codeHotspots() 的遍历顺序（SCENES → hotspots）。
   以后新增场面或地点【必须追加在末尾】；插在中间会让所有旧码错位。
   旧码比新版短时会自动按短的读完，不报错。
===================================================== */
/* =====================================================
   周目（基础版 / 高阶版）
   -----------------------------------------------------
   同一张地图走两遍。一周目四选一，二周目自己说、自己念。
   两遍之间隔着整整一章，那时候词已经开始忘了，
   逼出来的才是从记忆里捞的，不是从上一页抄的。

   次序：1基 → 2基 → 1高 → 3基 → 2高 → 4基 → 3高 …
   规则不写死在引擎里，各章 HTML 自己声明 REQUIRE：
     REQUIRE = {
       basic: {key:"别章的存档键", flag:"doneAdv", label:"…", href:"…"},
       adv:   {key:"别章的存档键", flag:"doneBasic", label:"…", href:"…"}
     }
   同源，所以读得到别章的 localStorage。
===================================================== */
function tierComplete(tier){
  const keep = TIER;
  TIER = tier;
  const hasAny = SCENES.some(sc=>quizHotspots(sc).length);
  const ok = hasAny && SCENES.every(sc=>quizHotspots(sc).every(h=>P().gold[h.id]));
  TIER = keep;
  return ok;
}
function tierTotal(tier){
  const keep = TIER; TIER = tier;
  const n = SCENES.reduce((a,sc)=>a+quizHotspots(sc).length, 0);
  TIER = keep;
  return n;
}
function tierCount(tier){
  const keep = TIER; TIER = tier;
  const n = Object.keys(P().cleared).length;
  TIER = keep;
  return n;
}
function refreshDone(){
  if (tierComplete("basic")) state.doneBasic = true;
  if (advExists() && tierComplete("adv")) state.doneAdv = true;
}
const GATE = (typeof REQUIRE !== "undefined") ? REQUIRE : null;
function gateMet(cond){
  if (!cond) return true;
  try {
    const v = localStorage.getItem(cond.key);
    if (!v) return false;
    return !!JSON.parse(v)[cond.flag || "doneAdv"];
  } catch(e){ return false; }
}
function basicUnlocked(){ return gateMet(GATE && GATE.basic); }
function advUnlocked(){
  if (REVIEW) return advExists();   /* 评审模式直接放行，否则你没法预览二周目 */
  return advExists() && (state.doneBasic || tierComplete("basic")) && gateMet(GATE && GATE.adv);
}

/* 前提没满足时，整章都不给进 */
function showGate(cond){
  overlayCard(
    '<div style="text-align:center;font-size:40px;margin-bottom:6px">🔒</div>' +
    '<h3>まだ開きません</h3>' +
    '<p style="text-align:center;font-size:14px;line-height:1.9;margin-bottom:12px">' +
    '这里要等你先走完<br><b>' + (cond.label || "上一段") + '</b>。</p>' +
    (cond.hint ? '<p style="text-align:center;font-size:12.5px;color:#7c7566;line-height:1.8;margin-bottom:12px">' +
      cond.hint + '</p>' : '') +
    (cond.href ? '<a class="btn-main" style="display:block;text-align:center;text-decoration:none" href="' +
      cond.href + '">去那边</a>' : '<button class="btn-main" onclick="location.reload()">知道了</button>'));
}

/* 一周目通关时的强提示：把她推回上一章做二周目 */
function showNextStep(){
  const n = NEXT_STEP;
  const g = overlayCard(
    '<div style="text-align:center;font-size:40px;margin-bottom:6px">🔁</div>' +
    '<h3>' + (n.title || "次はここ") + '</h3>' +
    '<p style="text-align:center;font-size:14px;line-height:1.9;margin-bottom:12px">' + n.body + '</p>' +
    '<a class="btn-main" style="display:block;text-align:center;text-decoration:none" href="' + n.href + '">' +
      (n.cta || "去") + '</a>' +
    '<button class="btn-ghost" id="ns-later">先不去</button>');
  document.getElementById("ns-later").addEventListener("click", ()=>{ g.style.display = "none"; });
}

/* 地图上方的周目条 */
function renderTierBar(){
  const canvas = $("#map-canvas");
  if (!canvas) return;
  let bar = document.getElementById("tier-bar");
  if (!bar){
    bar = el("div"); bar.id = "tier-bar";
    canvas.parentNode.insertBefore(bar, canvas);
  }
  document.body.classList.toggle("adv-on", TIER === "adv");
  if (!advExists()){ bar.style.display = "none"; return; }
  bar.style.display = "flex";

  if (TIER === "adv"){
    bar.className = "t-adv";
    bar.innerHTML = '<span><b>二周目</b> · 这次不选，自己说</span><button id="tier-back">回一周目</button>';
    document.getElementById("tier-back").addEventListener("click", async ()=>{
      TIER = "basic"; state.tier = "basic"; await saveState();
      renderMap(); show("view-map");
    });
    return;
  }
  if (advUnlocked()){
    bar.className = "t-open";
    bar.innerHTML = '<span>一周目走完了。<b>二周目开着</b></span><button id="tier-go">再走一遍</button>';
    document.getElementById("tier-go").addEventListener("click", async ()=>{
      TIER = "adv"; state.tier = "adv"; await saveState();
      renderMap(); show("view-map");
      toast("二周目：地方还是那些地方，题目换成自己说、自己念");
    });
    return;
  }
  if (state.doneBasic && GATE && GATE.adv && !gateMet(GATE.adv)){
    bar.className = "t-wait";
    bar.innerHTML = '<span>二周目要等你先走完' + (GATE.adv.label || "上一段") + '</span>' +
      (GATE.adv.href ? '<a href="' + GATE.adv.href + '">去那边</a>' : '');
    return;
  }
  bar.className = "t-lock";
  bar.innerHTML = '<span>集齐全部金印，二周目就开</span>';
}

/* 各章自己的文案。章节 HTML 里定义 CH_TEXT，没定义就退回空对象 */
const CHT = (typeof CH_TEXT !== "undefined") ? CH_TEXT : {};

const CODE_VER = 2;   /* v2 起，一串码同时覆盖一周目与二周目 */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   /* Crockford：不含 I L O U */

function codeHotspots(){
  /* 注意：这里不能用 quizHotspots——那个按周目筛，顺序会变。
     进度码的位序必须两个周目共用同一份，且新地点只能追加在末尾。 */
  const out = [];
  SCENES.forEach(sc => sc.hotspots.forEach(h => { if (h.learn) out.push(h); }));
  return out;
}
function fnv1a(bytes){
  let h = 0x811c9dc5;
  for (let i=0;i<bytes.length;i++){
    h ^= bytes[i] & 0xff;
    h = (h + ((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24))) >>> 0;
  }
  return h >>> 0;
}
function b32enc(bytes){
  let s = "", buf = 0, n = 0;
  for (let i=0;i<bytes.length;i++){
    buf = (buf<<8) | (bytes[i] & 0xff); n += 8;
    while (n >= 5){ s += B32[(buf >> (n-5)) & 31]; n -= 5; }
  }
  if (n) s += B32[(buf << (5-n)) & 31];
  return s;
}
function b32dec(str){
  const out = []; let buf = 0, n = 0;
  for (let i=0;i<str.length;i++){
    const v = B32.indexOf(str.charAt(i));
    if (v < 0) continue;
    buf = (buf<<5) | v; n += 5;
    if (n >= 8){ out.push((buf >> (n-8)) & 255); n -= 8; }
  }
  return out;
}
/* 手抄容错：小写转大写、去掉分隔符、O 当 0、I/L 当 1 */
function normCode(str){
  return String(str).toUpperCase().replace(/[^0-9A-Z]/g,"")
    .replace(/O/g,"0").replace(/I/g,"1").replace(/L/g,"1");
}
function encodeProgress(){
  const bits = [];
  const w = b => bits.push(b ? 1 : 0);
  w(state.seenGuide); w(state.seenV2); w(state.doneBasic); w(state.doneAdv);
  const hs = codeHotspots();
  /* 先铺完一周目，再铺二周目。旧的短码解到一半没位了就停，二周目留空——不会报错 */
  hs.forEach(h=>{
    w(state.learned[h.id]); w(state.cleared[h.id]); w(state.gold[h.id]);
    const d = state.qdone[h.id] || {};
    for (let i=0;i<(h.questions||[]).length;i++) w(d[i]);
  });
  hs.forEach(h=>{
    const A = state.adv;
    w(A.learned[h.id]); w(A.cleared[h.id]); w(A.gold[h.id]);
    const d = A.qdone[h.id] || {};
    for (let i=0;i<(h.advanced||[]).length;i++) w(d[i]);
  });
  const bytes = [];
  for (let i=0;i<bits.length;i+=8){
    let b = 0;
    for (let k=0;k<8;k++) b = (b<<1) | (bits[i+k] || 0);
    bytes.push(b);
  }
  const all = [CODE_VER].concat(bytes);
  all.push(fnv1a(all) & 0xff);
  return b32enc(all).replace(/(.{4})/g, "$1-").replace(/-$/, "");
}
function decodeProgress(str){
  const bytes = b32dec(normCode(str));
  if (bytes.length < 4) return {ok:false, err:"这串码太短了，可能没复制全"};
  const sum = bytes.pop();
  if ((fnv1a(bytes) & 0xff) !== sum)
    return {ok:false, err:"这串码对不上，多半是漏抄或多抄了字符。请整段重新复制"};
  const ver = bytes.shift();
  if (ver !== CODE_VER)
    return {ok:false, err:"这串码来自另一个版本（v"+ver+"），当前是 v"+CODE_VER};
  let bi = 0;
  const rd = ()=>{
    const byte = bytes[bi >> 3];
    if (byte === undefined) return null;
    const b = (byte >> (7 - (bi & 7))) & 1; bi++; return b;
  };
  const d = {learned:{}, cleared:{}, gold:{}, qdone:{}, seenGuide:false, seenV2:false,
             doneBasic:false, doneAdv:false,
             adv:{learned:{}, cleared:{}, gold:{}, qdone:{}}};
  d.seenGuide = !!rd(); d.seenV2 = !!rd(); d.doneBasic = !!rd(); d.doneAdv = !!rd();
  let spots = 0, stamps = 0;
  const hs = codeHotspots();
  function readTier(box, poolOf, count){
    for (let n=0;n<hs.length;n++){
      const h = hs[n];
      const l = rd(); if (l === null) return;
      const c = rd(), g = rd();
      if (l) box.learned[h.id] = true;
      if (c){ box.cleared[h.id] = true; if (count) stamps++; }
      if (g) box.gold[h.id] = true;
      const pool = poolOf(h) || [];
      for (let i=0;i<pool.length;i++){
        const q = rd(); if (q === null) return;
        if (q){ if (!box.qdone[h.id]) box.qdone[h.id] = {}; box.qdone[h.id][i] = true; }
      }
      if (count) spots++;
    }
  }
  readTier(d,     h=>h.questions, true);
  readTier(d.adv, h=>h.advanced,  false);
  return {ok:true, data:d, spots:spots, stamps:stamps};
}
/* 只做并集：不会抹掉这台设备上已经做出来的进度 */
async function applyProgress(d){
  ["learned","cleared","gold"].forEach(k=>{
    Object.keys(d[k]).forEach(id=>{ state[k][id] = true; });
  });
  Object.keys(d.qdone).forEach(id=>{
    if (!state.qdone[id]) state.qdone[id] = {};
    Object.keys(d.qdone[id]).forEach(i=>{ state.qdone[id][i] = true; });
  });
  if (d.adv){
    ["learned","cleared","gold"].forEach(k=>{
      Object.keys(d.adv[k]).forEach(id=>{ state.adv[k][id] = true; });
    });
    Object.keys(d.adv.qdone).forEach(id=>{
      if (!state.adv.qdone[id]) state.adv.qdone[id] = {};
      Object.keys(d.adv.qdone[id]).forEach(i=>{ state.adv.qdone[id][i] = true; });
    });
  }
  if (d.seenGuide)  state.seenGuide = true;
  if (d.seenV2)     state.seenV2 = true;
  if (d.doneBasic)  state.doneBasic = true;
  if (d.doneAdv)    state.doneAdv = true;
  refreshDone();
  await saveState();
}

/* ---------- 进度码的界面 ---------- */
function xferCard(inner){
  let x = document.getElementById("xfer");
  if (!x){ x = el("div"); x.id = "xfer"; document.body.appendChild(x); }
  x.innerHTML = '<div class="g-card x-card">' + inner + '</div>';
  x.style.display = "flex";
  const c = document.getElementById("x-close");
  if (c) c.addEventListener("click", closeXfer);
  return x;
}
function closeXfer(){
  const x = document.getElementById("xfer");
  if (x) x.style.display = "none";
}
function showCodeOut(){
  const code = encodeProgress();
  xferCard(
    '<h3>进度码</h3>' +
    '<p class="x-p">这串字记着你现在的全部进度（朱印 ' + stampCount() + ' / ' + totalStamps() +
      ' 枚）。把它发到新手机上，在新手机的「输入进度码」里粘贴，就能接着做。<br>' +
      '<b>旧手机上的进度不会消失</b>，两边都能继续。</p>' +
    '<textarea class="x-code" id="x-out" readonly rows="4">' + code + '</textarea>' +
    '<button class="btn-main" id="x-copy">复制</button>' +
    '<button class="btn-ghost" id="x-close">关闭</button>');
  const ta = document.getElementById("x-out");
  ta.addEventListener("click", function(){ this.select(); });
  document.getElementById("x-copy").addEventListener("click", async ()=>{
    ta.select(); ta.setSelectionRange(0, 99999);
    let ok = false;
    try { await navigator.clipboard.writeText(code); ok = true; }
    catch(e){ try { ok = document.execCommand("copy"); } catch(e2){} }
    toast(ok ? "已复制，发到新手机上就行" : "复制没成功：请长按上面的框，手动全选复制");
  });
}
function showCodeIn(){
  xferCard(
    '<h3>输入进度码</h3>' +
    '<p class="x-p">把旧手机上生成的那串字粘贴进来。<b>只会往上加，不会抹掉</b>这台手机上已有的进度。</p>' +
    '<textarea class="x-code" id="x-in" rows="4" placeholder="在这里粘贴"></textarea>' +
    '<button class="btn-main" id="x-go">确定</button>' +
    '<button class="btn-ghost" id="x-close">关闭</button>');
  document.getElementById("x-go").addEventListener("click", async ()=>{
    const r = decodeProgress(document.getElementById("x-in").value);
    if (!r.ok){ toast(r.err); return; }
    const before = stampCount();
    await applyProgress(r.data);
    closeXfer();
    renderStamps(); renderMap();
    const now = stampCount();
    toast(REVIEW ? "评审模式下不写存档，刷新后会还原"
                 : "接上了：朱印 " + now + " / " + totalStamps() + " 枚（新增 " + (now-before) + " 枚）");
  });
}
(function bindXfer(){
  const a = document.getElementById("btn-code-out");
  const b = document.getElementById("btn-code-in");
  if (a) a.addEventListener("click", showCodeOut);
  if (b) b.addEventListener("click", showCodeIn);
})();

/* =====================================================
   后门（评审模式）
   -----------------------------------------------------
   入口：在地图页【长按标题「浅草絵図」1.5 秒】，输密码。
   作用：1. 全部章节解锁，不必集金印就能进
         2. 「全文速览」——13 场面 / 全部词表 / 全部题目连答案平铺成一页
         3. 全程不写存档（saveState 被短路），刷新即还原，
            所以在妈妈的手机上试玩也不会动到她的进度。

   注意：仓库是公开的，下面存的只是一个哈希，不是加密。
   它只能挡住顺手翻源码的人，挡不住真想找的人——别当成安全措施。
   换密码：浏览器控制台运行  __pwHash("新密码")  ，把结果填到 REVIEW_PW_HASH。
===================================================== */
const REVIEW_PW_HASH = "cf3d4553";
function __pwHash(str){
  const b = [];
  for (let i=0;i<str.length;i++){
    const c = str.charCodeAt(i);
    b.push(c & 0xff, (c >> 8) & 0xff);
  }
  return ("0000000" + fnv1a(b).toString(16)).slice(-8);
}
window.__pwHash = __pwHash;

function askReviewPw(){
  if (REVIEW){ openReviewIndex(); return; }
  xferCard(
    '<h3>·</h3>' +
    '<input class="x-code" id="x-pw" type="password" autocomplete="off" spellcheck="false">' +
    '<button class="btn-main" id="x-pwgo">確認</button>' +
    '<button class="btn-ghost" id="x-close">取消</button>');
  const inp = document.getElementById("x-pw");
  inp.focus();
  const go = ()=>{
    if (__pwHash(inp.value) === REVIEW_PW_HASH){ closeXfer(); enterReview(); }
    else { inp.value = ""; closeXfer(); }
  };
  document.getElementById("x-pwgo").addEventListener("click", go);
  inp.addEventListener("keydown", e=>{ if (e.key === "Enter") go(); });
}
function enterReview(){
  REVIEW = true;
  renderMap();
  let bar = document.getElementById("rvbar");
  if (!bar){
    bar = el("div"); bar.id = "rvbar";
    bar.innerHTML = '<span>評審モード · 不写存档</span>' +
      '<button id="rv-idx">全文速览</button><button id="rv-aud">体检</button>' +
      '<button id="rv-out">退出</button>';
    document.body.appendChild(bar);
    document.getElementById("rv-idx").addEventListener("click", openReviewIndex);
    document.getElementById("rv-aud").addEventListener("click", showAudit);
    document.getElementById("rv-out").addEventListener("click", ()=>location.reload());
  }
  bar.style.display = "flex";
  toast("评审模式：全部章节已解锁，这台设备的进度不会被改动");
}
/* 长按标题进入 */
(function bindBackdoor(){
  const t = document.querySelector(".map-head h1");
  if (!t) return;
  let timer = null;
  const start = ()=>{ clearTimeout(timer); timer = setTimeout(askReviewPw, 1500); };
  const cancel = ()=>{ clearTimeout(timer); };
  t.addEventListener("touchstart", start, {passive:true});
  t.addEventListener("touchend", cancel);
  t.addEventListener("touchmove", cancel);
  t.addEventListener("touchcancel", cancel);
  t.addEventListener("mousedown", start);
  t.addEventListener("mouseup", cancel);
  t.addEventListener("mouseleave", cancel);
  t.addEventListener("contextmenu", e=>e.preventDefault());
})();

/* ---------- 全文速览 ---------- */
function openReviewIndex(){
  let ov = document.getElementById("rvidx");
  if (!ov){ ov = el("div"); ov.id = "rvidx"; document.body.appendChild(ov); }
  let nq = 0, nw = 0, nh = 0;
  SCENES.forEach(sc => sc.hotspots.forEach(h=>{
    if (!h.learn) return;
    nh++; nw += h.learn.words.length; nq += h.questions.length;
  }));
  let html = '<div class="rv-top"><b>全文速览</b><span>' + SCENES.length + ' 场面 · ' +
    nh + ' 地点 · ' + nw + ' 词 · ' + nq + ' 题</span>' +
    '<button id="rv-x">关闭</button></div><div class="rv-body">';
  let curCh = 0;
  SCENES.forEach(sc=>{
    if (sc.chapter !== curCh){
      curCh = sc.chapter;
      html += '<h2 class="rv-ch">第 ' + CH_KANJI[curCh] + ' 章</h2>';
    }
    html += '<h3 class="rv-sc">' + sc.name + ' <small>' + sc.short + ' · ' + sc.id + '</small></h3>';
    sc.hotspots.forEach(h=>{
      if (!h.learn){
        html += '<div class="rv-hs rv-egg"><div class="rv-hn">' + h.name +
          ' <small>彩蛋 · ' + h.id + '</small></div><div class="rv-egl">' +
          (h.eggLines || []).join(" ／ ") +
          (h.eggFinal ? '　→　' + h.eggFinal + '（第 ' + (h.eggFinalAt || "?") + ' 次）' : '') +
          '</div></div>';
        return;
      }
      html += '<div class="rv-hs"><div class="rv-hn">' + h.name + ' <small>' + h.id +
        ' · ' + h.questions.length + ' 题</small></div>';
      if (h.bunjin){
        const b = h.bunjin;
        html += '<div class="rv-bj"><b>文人碑</b>　' + b.life + ' · ' + b.tag +
          '<div class="rv-story">' + b.story + '</div>' +
          '<div class="rv-quote">' + b.quote.jp + '<br><i>' + b.quote.kana + '</i><br><i>' +
          b.quote.romaji + '</i><br>' + b.quote.zh +
          '<br><small>——' + b.quote.src + '</small></div></div>';
      }
      html += '<table class="rv-w"><tbody>';
      h.learn.words.forEach(w=>{
        html += '<tr><td>' + w.jp + '</td><td>' + w.kana + '</td><td>' +
          w.romaji + '</td><td>' + w.zh + '</td></tr>';
      });
      html += '</tbody></table><div class="rv-note">' + h.learn.noteJa +
        '<br><i>' + h.learn.noteKana + '</i><br><i>' + h.learn.noteRomaji + '</i><br>' +
        h.learn.noteZh + '</div><ol class="rv-q">';
      h.questions.forEach(q=>{
        const prompt = (q.type === "listen")
          ? ('🔊 ' + q.tts + '　<i>' + (q.ttsKana || "") + '</i>')
          : q.prompt;
        html += '<li><span class="rv-t">' + q.type + '</span>' + prompt + '<div class="rv-o">';
        q.options.forEach((o, i)=>{
          html += '<span class="' + (i === q.answer ? "ok" : "") + '">' + o + '</span>';
        });
        html += '</div><div class="rv-ex">' + q.explain + '</div></li>';
      });
      html += '</ol></div>';
    });
  });
  html += '</div>';
  ov.innerHTML = html;
  ov.style.display = "flex";
  document.getElementById("rv-x").addEventListener("click", ()=>{ ov.style.display = "none"; });
}

/* =====================================================
   存档体检 · 修复
   -----------------------------------------------------
   qdone（逐题答对记录）是真实作业量的唯一可信来源：
   gold / cleared 是一次性写入的结论，可能被别的构建写坏，
   但没人会伪造几百条逐题记录。所以用 qdone 反推应有的
   gold / cleared，两者对不上就是异常。

   规则（与 finishQuiz 保持一致）：
     应有金印  <=>  qdone[id] 的条数 >= 该处题目总数
     应有朱印  <=>  qdone[id] 至少有 1 条
===================================================== */
function auditState(){
  const hs = codeHotspots();
  const known = new Set(hs.map(h=>h.id));
  const perCh = {};
  let phantomGold = 0, realGold = 0, phantomCleared = 0, missingGold = 0;

  SCENES.forEach(sc=>{
    if (!perCh[sc.chapter]) perCh[sc.chapter] =
      {gold:0, goldShould:0, cleared:0, q:0, qTotal:0, spots:0};
    const c = perCh[sc.chapter];
    quizHotspots(sc).forEach(h=>{
      const d = P().qdone[h.id] || {};
      const n = Object.keys(d).filter(k=>{
        const i = Number(k); return Number.isInteger(i) && i >= 0 && i < QP(h).length;
      }).length;
      const shouldGold = n >= QP(h).length;
      const isGold = !!P().gold[h.id];
      const isCleared = !!P().cleared[h.id];
      c.spots++; c.q += n; c.qTotal += QP(h).length;
      if (isGold) c.gold++;
      if (shouldGold) c.goldShould++;
      if (isCleared) c.cleared++;
      if (isGold && !shouldGold) phantomGold++;
      if (isGold && shouldGold) realGold++;
      if (!isGold && shouldGold) missingGold++;
      if (isCleared && n === 0) phantomCleared++;
    });
  });
  const stray = {
    gold:    Object.keys(P().gold   ).filter(id=>!known.has(id)),
    cleared: Object.keys(P().cleared).filter(id=>!known.has(id)),
    qdone:   Object.keys(P().qdone  ).filter(id=>!known.has(id)),
  };
  return {perCh, phantomGold, realGold, phantomCleared, missingGold, stray};
}

/* 按 qdone 重算 gold / cleared。learned 保留（只影响圆点颜色）。 */
function rebuildFromQdone(){
  const hs = codeHotspots();
  const known = new Set(hs.map(h=>h.id));
  const gold = {}, cleared = {}, qdone = {}, learned = {};
  hs.forEach(h=>{
    const d = P().qdone[h.id] || {};
    const keys = Object.keys(d).filter(k=>{
      const i = Number(k); return Number.isInteger(i) && i >= 0 && i < QP(h).length;
    });
    if (keys.length){
      qdone[h.id] = {};
      keys.forEach(k=>{ qdone[h.id][k] = true; });
      cleared[h.id] = true;
      if (keys.length >= QP(h).length) gold[h.id] = true;
    }
    if (P().learned[h.id]) learned[h.id] = true;
  });
  Object.keys(state.eggTaps || {}).forEach(id=>{ if (!known.has(id)) delete state.eggTaps[id]; });
  return {gold, cleared, qdone, learned};
}

/* 兜底：只保留前 keepCh 章，之后的章节全部清空 */
function keepChaptersUpTo(keepCh){
  const drop = new Set();
  SCENES.forEach(sc=>{
    if (sc.chapter > keepCh) sc.hotspots.forEach(h=>drop.add(h.id));
  });
  ["learned","cleared","gold","qdone","eggTaps"].forEach(k=>{
    Object.keys(state[k] || {}).forEach(id=>{ if (drop.has(id)) delete state[k][id]; });
  });
}

/* 修复要真正写盘，必须临时解除评审模式的短路 */
async function commitRepair(){
  const wasReview = REVIEW;
  REVIEW = false;
  await saveState();
  REVIEW = wasReview;
}

function showAudit(){
  const a = auditState();
  const bad = a.phantomGold + a.phantomCleared
            + a.stray.gold.length + a.stray.cleared.length + a.stray.qdone.length;

  let rows = '<table class="au-t"><tbody><tr><th>章</th><th>金印</th><th>应有</th><th>答题</th></tr>';
  Object.keys(a.perCh).sort().forEach(ch=>{
    const c = a.perCh[ch];
    const odd = c.gold > c.goldShould;
    rows += '<tr class="' + (odd ? "au-bad" : "") + '"><td>第' + ch + '章</td>' +
      '<td>' + c.gold + '/' + c.spots + '</td>' +
      '<td>' + c.goldShould + '/' + c.spots + '</td>' +
      '<td>' + c.q + '/' + c.qTotal + '</td>' +
      (odd ? '<td class="au-flag">异常</td>' : '<td></td>') + '</tr>';
  });
  rows += '</tbody></table>';

  let verdict;
  if (bad === 0){
    verdict = '<p class="au-ok">没查出矛盾。存档里的金印都有对应的答题记录，' +
      '也就是说这些进度是真做出来的。</p>';
  } else {
    verdict = '<p class="au-ng"><b>查出 ' + bad + ' 处矛盾。</b><br>' +
      (a.phantomGold ? '有 <b>' + a.phantomGold + '</b> 处盖了金印，却没有答完题的记录。<br>' : '') +
      (a.phantomCleared ? '有 <b>' + a.phantomCleared + '</b> 处盖了朱印，却一道题都没答过。<br>' : '') +
      (a.stray.gold.length + a.stray.cleared.length + a.stray.qdone.length ?
        '另有 <b>' + (a.stray.gold.length + a.stray.cleared.length + a.stray.qdone.length) +
        '</b> 条记录不属于当前版本的任何地点。<br>' : '') +
      '这些金印不是答题得来的，是被写进去的。</p>';
  }
  if (a.missingGold)
    verdict += '<p class="au-ng">另有 ' + a.missingGold + ' 处题目已答完却没盖金印。</p>';

  xferCard(
    '<h3>存档体检</h3>' +
    '<div class="au-scroll">' +
      '<p class="x-p">当前：朱印 ' + stampCount() + ' / ' + totalStamps() + '</p>' +
      verdict + rows +
      '<p class="au-note">「应有」＝按逐题答对记录反推出来的金印数。' +
      'qdone 是每答对一题就写一条，最难被伪造，所以拿它当准绳。</p>' +
    '</div>' +
    '<button class="btn-ghost" id="au-backup">先复制当前存档（备份）</button>' +
    '<button class="btn-main" id="au-fix">按答题记录重算</button>' +
    '<button class="btn-ghost" id="au-keep3">只保留第 1〜3 章</button>' +
    '<button class="btn-ghost" id="x-close">关闭</button>');

  document.getElementById("au-backup").addEventListener("click", async ()=>{
    const raw = JSON.stringify(state);
    let ok = false;
    try { await navigator.clipboard.writeText(raw); ok = true; } catch(e){}
    toast(ok ? "当前存档已复制到剪贴板（" + raw.length + " 字符），先粘到备忘录里"
             : "复制失败，请换用「生成进度码」做备份");
  });

  document.getElementById("au-fix").addEventListener("click", async ()=>{
    const before = {s: stampCount(), g: Object.keys(P().gold).length};
    const r = rebuildFromQdone();
    P().gold = r.gold; P().cleared = r.cleared;
    P().qdone = r.qdone; P().learned = r.learned;
    await commitRepair();
    renderMap(); renderStamps();
    toast("已重算：朱印 " + before.s + "→" + stampCount() +
          "，金印 " + before.g + "→" + Object.keys(P().gold).length);
    showAudit();
  });

  document.getElementById("au-keep3").addEventListener("click", async ()=>{
    keepChaptersUpTo(3);
    state.seenV2 = false;          /* 让她重新收到「新地图」的通知 */
    await commitRepair();
    renderMap(); renderStamps();
    toast("已清空第 4 章之后的全部记录，朱印 " + stampCount() + " / " + totalStamps());
    showAudit();
  });
}

/* 评审模式：切到后台就自动退出，避免把「全解锁」的画面留给妈妈 */
document.addEventListener("visibilitychange", ()=>{
  if (REVIEW && document.hidden) location.reload();
});

/* =====================================================
   INIT
===================================================== */
(function bindHelp(){
  const b = document.getElementById("btn-help");
  if (b) b.addEventListener("click", ()=>showGuide(false));
})();
function showGuide(firstTime){
  let g = document.getElementById("guide");
  if (!g){
    g = document.createElement("div");
    g.id = "guide";
    document.body.appendChild(g);
  }
  g.innerHTML = '<div class="g-card">'+
    '<h3>遊び方 · 怎么玩</h3>'+
    '<div class="g-step"><span class="g-ico">🏮</span><span>点地图上的<b>红灯笼</b>，走进一个区域。灰灯笼还在建，以后更新。</span></div>'+
    '<div class="g-step"><span class="g-ico">🔴</span><span><b>红点</b>是新内容：先看学习卡，点 🔊 听发音，看完按「记住了」。</span></div>'+
    '<div class="g-step"><span class="g-ico">🔵</span><span>变<b>蓝</b>之后再点它，开始做题：每次随机3题，答错当场重答。</span></div>'+
    '<div class="g-step"><span class="g-ico">✨</span><span>每个地点藏着5道题，<b>全部答完</b>朱印就变金印。<b>一章集齐全部金印</b>，下一章的灯笼自动点亮。</span></div>'+
    (CHT.guideBunjin || '')+
    '<div class="g-step"><span class="g-ico">🎋</span><span><b>おみくじ</b>每天能抽一支新签；集到的朱印在右上角「印」里随时翻看。</span></div>'+
    '<button class="btn-main" id="btn-guide-go">开始逛' + (CHT.area || '') + '</button></div>';
  g.style.display = "flex";
  document.getElementById("btn-guide-go").addEventListener("click", async ()=>{
    g.style.display = "none";
    if (firstTime){ state.seenGuide = true; await saveState(); }
  });
}
(async function init(){
  await loadState();
  if (!basicUnlocked()){ renderMap(); showGate(GATE.basic); return; }
  /* 旗子要落盘：别章靠读这两个旗子来决定开不开 */
  const before = state.doneBasic + "|" + state.doneAdv;
  refreshDone();
  if (before !== state.doneBasic + "|" + state.doneAdv) await saveState();
  renderMap();
  if (!state.seenGuide) { showGuide(true); state.seenV2 = true; await saveState(); }
  else if (!state.seenV2 && CHT.newChapters && chapterAllGold(3)) showNewChapters();
  else if (!state.seenV2) { state.seenV2 = true; await saveState(); }
})();
