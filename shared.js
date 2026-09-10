/* ============================================================
   Super 7 Live · shared code for the student and teacher screens
   - DB: Firebase Realtime Database, or a local demo store that syncs
     tabs in one browser through BroadcastChannel + localStorage
   - Board: a pointer-drawn canvas whose strokes sync as compact arrays
   - checkAnswer: forgiving numeric / ratio / text marking
   - tex: KaTeX auto-render if the CDN loaded, otherwise plain text
   ============================================================ */
(function(){
"use strict";
var S7 = window.S7 = {};

/* ---------- ids ---------- */
S7.uid = function(){
  try{ var u=localStorage.getItem('s7uid'); if(u) return u;
    u='u'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); localStorage.setItem('s7uid',u); return u; }
  catch(e){ return 'u'+Math.random().toString(36).slice(2,10); }
};
S7.param = function(k, d){ var m=new RegExp('[?&]'+k+'=([^&]*)').exec(location.search); return m?decodeURIComponent(m[1]):d; };
S7.esc = function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
S7.now = function(){ return Date.now(); };

/* ============================================================
   DB abstraction
   set(path,val) update(path,obj) get(path)->Promise on(path,cb)->unsub remove(path)
   ============================================================ */
function FirebaseDB(cfg){
  firebase.initializeApp(cfg);
  var db = firebase.database();
  this.kind='firebase';
  this.set=function(p,v){ return db.ref(p).set(v); };
  this.update=function(p,o){ return db.ref(p).update(o); };
  this.remove=function(p){ return db.ref(p).remove(); };
  this.get=function(p){ return db.ref(p).get().then(function(s){ return s.val(); }); };
  this.on=function(p,cb){ var r=db.ref(p); var h=function(s){ cb(s.val()); }; r.on('value',h); return function(){ r.off('value',h); }; };
  this.onDisconnectRemove=function(p){ db.ref(p).onDisconnect().remove(); };
  this.serverTime=function(){ return firebase.database.ServerValue.TIMESTAMP; };
}
/* Local demo store: a JSON tree in localStorage, changes broadcast to every tab. */
function LocalDB(){
  var KEY='s7demo', self=this, bc=null;
  try{ bc=new BroadcastChannel('s7demo'); }catch(e){}
  this.kind='local';
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){ return {}; } }
  function save(t){ try{ localStorage.setItem(KEY, JSON.stringify(t)); }catch(e){} }
  function parts(p){ return p.split('/').filter(Boolean); }
  function getAt(t,p){ var n=t, ps=parts(p); for(var i=0;i<ps.length;i++){ if(n==null||typeof n!=='object') return null; n=n[ps[i]]; } return n===undefined?null:n; }
  function setAt(t,p,v){ var ps=parts(p); if(!ps.length) return v; var n=t; for(var i=0;i<ps.length-1;i++){ if(n[ps[i]]==null||typeof n[ps[i]]!=='object') n[ps[i]]={}; n=n[ps[i]]; }
    if(v===null||v===undefined) delete n[ps[ps.length-1]]; else n[ps[ps.length-1]]=v; return t; }
  var subs=[];
  function notify(){ var t=load(); subs.forEach(function(s){ var v=getAt(t,s.p); var j=JSON.stringify(v); if(j!==s.last){ s.last=j; try{ s.cb(v); }catch(e){ console.error(e); } } }); }
  if(bc) bc.onmessage=function(){ notify(); };
  window.addEventListener('storage',function(e){ if(e.key===KEY) notify(); });
  function commit(t){ save(t); if(bc) bc.postMessage('x'); notify(); }
  this.set=function(p,v){ var t=load(); t=setAt(t,p,JSON.parse(JSON.stringify(v===undefined?null:v))); commit(t); return Promise.resolve(); };
  this.update=function(p,o){ var t=load(); for(var k in o){ t=setAt(t,p+'/'+k,JSON.parse(JSON.stringify(o[k]===undefined?null:o[k]))); } commit(t); return Promise.resolve(); };
  this.remove=function(p){ return this.set(p,null); };
  this.get=function(p){ return Promise.resolve(getAt(load(),p)); };
  this.on=function(p,cb){ var s={p:p,cb:cb,last:undefined}; subs.push(s); setTimeout(function(){ var v=getAt(load(),p); s.last=JSON.stringify(v); cb(v); },0);
    return function(){ subs=subs.filter(function(x){return x!==s;}); }; };
  this.onDisconnectRemove=function(){};
  this.serverTime=function(){ return Date.now(); };
}
S7.openDB=function(){
  if(window.S7_FIREBASE && window.firebase){ try{ return new FirebaseDB(window.S7_FIREBASE); }catch(e){ console.error('Firebase failed, using local demo',e); } }
  return new LocalDB();
};

/* ============================================================
   Answer checking
   answer: {value:number|string, unit?, accept?:[...], tol?:number, kind?:'ratio'}
   ============================================================ */
function norm(s){ return String(s==null?'':s).toLowerCase().replace(/\s+/g,'').replace(/£|€|\$/g,'').replace(/,/g,''); }
function stripUnits(s){ return s.replace(/(cm|mm|m|km|ml|l|litres?|liters?|kg|g|km\/h|m\/s|mph|degrees?|°|%|²|³|\^2|\^3|squared|cubed|units?)+$/,''); }
function toNumber(s){
  s=stripUnits(norm(s));
  var m=/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(s); if(m) return parseFloat(m[1])/parseFloat(m[2]);
  m=/^(-?\d+)\s*(\d+)\/(\d+)$/.exec(s); if(m) return parseFloat(m[1])+parseFloat(m[2])/parseFloat(m[3]);
  if(/^-?\d+(?:\.\d+)?(e-?\d+)?$/.test(s)) return parseFloat(s);
  return NaN;
}
S7.checkAnswer=function(ans, given){
  if(!ans) return null;
  var g=norm(given); if(!g) return null;
  var acc=(ans.accept||[]).map(norm);
  if(acc.indexOf(g)>=0) return true;
  if(ans.kind==='ratio' || typeof ans.value==='string'){
    var want=norm(ans.value);
    if(g===want) return true;
    /* ratio a:b compared as a fraction */
    var r1=/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(g), r2=/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(want);
    if(r1&&r2){ return Math.abs(parseFloat(r1[1])/parseFloat(r1[2]) - parseFloat(r2[1])/parseFloat(r2[2]))<1e-6; }
    var gn=toNumber(g), wn=toNumber(want);
    if(!isNaN(gn)&&!isNaN(wn)) return Math.abs(gn-wn)<=Math.max(ans.tol||0, Math.abs(wn)*0.002, 0.005);
    return false;
  }
  var n=toNumber(g); if(isNaN(n)) return false;
  var tol=Math.max(ans.tol||0, Math.abs(ans.value)*0.002, 0.005);
  return Math.abs(n-ans.value)<=tol;
};

/* ============================================================
   KaTeX
   ============================================================ */
var texPending=[], texTimer=null;
function texNow(el){ try{ renderMathInElement(el,{delimiters:[{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}],throwOnError:false}); }catch(e){} }
S7.tex=function(el){
  if(!el) return;
  if(window.renderMathInElement){ texNow(el); return; }
  /* KaTeX is loaded with defer, so early renders queue until it arrives;
     if it never does (offline), the delimiters are stripped after 4 s. */
  texPending.push(el);
  if(!texTimer){ var tries=0; texTimer=setInterval(function(){
    tries++;
    if(window.renderMathInElement){ clearInterval(texTimer); texTimer=null; texPending.forEach(function(x){ if(x.isConnected) texNow(x); }); texPending=[]; }
    else if(tries>20){ clearInterval(texTimer); texTimer=null; texPending.forEach(function(x){ x.innerHTML=x.innerHTML.replace(/\\\(|\\\)|\\\[|\\\]/g,''); }); texPending=[]; }
  },200); }
};

/* ============================================================
   Board: drawing canvas with stroke sync
   strokes: [{c:'#hex'|null(erase), w:number, p:[[x,y],...]}] normalised 0..1, 3dp
   ============================================================ */
S7.Board=function(canvas, opts){
  opts=opts||{};
  var st={cv:canvas,strokes:[],cur:null,colour:'#19151C',width:3.5,erase:false,readonly:!!opts.readonly,onChange:opts.onChange||null,grid:opts.grid!==false};
  function pos(e){ var r=canvas.getBoundingClientRect(); return [Math.round((e.clientX-r.left)/r.width*1000)/1000, Math.round((e.clientY-r.top)/r.height*1000)/1000]; }
  var changeT=null;
  function changed(){ if(!st.onChange) return; clearTimeout(changeT); changeT=setTimeout(function(){ st.onChange(st.strokes); },120); }
  if(!st.readonly){
    canvas.addEventListener('pointerdown',function(e){ e.preventDefault(); try{canvas.setPointerCapture(e.pointerId);}catch(x){}
      st.cur={c:st.erase?null:st.colour,w:st.erase?26:st.width,p:[pos(e)]}; st.strokes.push(st.cur); draw(); });
    canvas.addEventListener('pointermove',function(e){ if(!st.cur) return; e.preventDefault(); var p=pos(e); var last=st.cur.p[st.cur.p.length-1];
      if(Math.abs(p[0]-last[0])<0.002&&Math.abs(p[1]-last[1])<0.002) return; st.cur.p.push(p); draw(); });
    function end(){ if(st.cur){ st.cur=null; changed(); } }
    canvas.addEventListener('pointerup',end); canvas.addEventListener('pointercancel',end); canvas.addEventListener('pointerleave',end);
  }
  function draw(){
    var w=canvas.clientWidth,h=canvas.clientHeight; if(!w||!h) return;
    var dpr=window.devicePixelRatio||1;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    var g=canvas.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
    g.fillStyle='#fff'; g.fillRect(0,0,w,h);
    if(st.grid){ g.strokeStyle='rgba(97,0,100,.10)'; g.lineWidth=1; var step=Math.max(16,Math.round(h/12));
      for(var x=step;x<w;x+=step){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
      for(var y=step;y<h;y+=step){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();} }
    g.lineCap='round'; g.lineJoin='round';
    var sc=Math.max(0.5, w/700);
    st.strokes.forEach(function(s){ if(!s||!s.p||!s.p.length) return;
      g.strokeStyle=s.c||'#fff'; g.lineWidth=s.w*sc;
      g.beginPath(); g.moveTo(s.p[0][0]*w,s.p[0][1]*h);
      for(var k=1;k<s.p.length;k++) g.lineTo(s.p[k][0]*w,s.p[k][1]*h);
      if(s.p.length===1) g.lineTo(s.p[0][0]*w+0.1,s.p[0][1]*h+0.1);
      g.stroke(); });
  }
  st.draw=draw;
  st.setStrokes=function(a){ st.strokes=Array.isArray(a)?a:[]; draw(); };
  st.undo=function(){ st.strokes.pop(); draw(); changed(); };
  st.clear=function(){ st.strokes=[]; draw(); changed(); };
  st.setColour=function(c){ st.colour=c; st.erase=false; };
  st.setWidth=function(w){ st.width=w; st.erase=false; };
  st.setErase=function(on){ st.erase=on; };
  window.addEventListener('resize',draw);
  draw();
  return st;
};
/* toolbar for a board: returns html; wire with S7.wireTools(container, board) */
S7.toolsHTML=function(){
  var pens=['#19151C','#610064','#C0392B','#1E8E5A','#1E5AAF'];
  return '<div class="tools">'+pens.map(function(c,k){return '<button class="pen'+(k===0?' on':'')+'" style="background:'+c+'" data-pen="'+c+'" title="pen"></button>';}).join('')+
    '<span class="ws"><button data-w="2" title="thin"><i style="width:5px;height:5px"></i></button><button data-w="3.5" class="on" title="medium"><i style="width:9px;height:9px"></i></button><button data-w="6" title="thick"><i style="width:14px;height:14px"></i></button></span>'+
    '<button class="tb" data-erase>Rubber</button><button class="tb" data-undo>Undo</button><button class="tb" data-clear>Clear</button></div>';
};
S7.wireTools=function(root, board){
  root.addEventListener('click',function(e){
    var t=e.target.closest('button'); if(!t) return;
    if(t.dataset.pen){ board.setColour(t.dataset.pen); root.querySelectorAll('.pen').forEach(function(b){b.classList.remove('on');}); t.classList.add('on'); var er=root.querySelector('[data-erase]'); if(er) er.classList.remove('on'); }
    else if(t.dataset.w){ board.setWidth(+t.dataset.w); root.querySelectorAll('[data-w]').forEach(function(b){b.classList.remove('on');}); t.classList.add('on'); }
    else if(t.hasAttribute('data-erase')){ board.erase=!board.erase; t.classList.toggle('on',board.erase); }
    else if(t.hasAttribute('data-undo')){ board.undo(); }
    else if(t.hasAttribute('data-clear')){ board.clear(); }
  });
};
/* draw strokes onto any canvas (thumbnails) */
S7.paint=function(canvas, strokes){
  var w=canvas.clientWidth||canvas.width, h=canvas.clientHeight||canvas.height; if(!w||!h) return;
  var dpr=window.devicePixelRatio||1;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  var g=canvas.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h); g.fillStyle='#fff'; g.fillRect(0,0,w,h);
  g.lineCap='round'; g.lineJoin='round'; var sc=Math.max(0.35, w/700);
  (strokes||[]).forEach(function(s){ if(!s||!s.p||!s.p.length) return; g.strokeStyle=s.c||'#fff'; g.lineWidth=Math.max(1,s.w*sc);
    g.beginPath(); g.moveTo(s.p[0][0]*w,s.p[0][1]*h); for(var k=1;k<s.p.length;k++) g.lineTo(s.p[k][0]*w,s.p[k][1]*h);
    if(s.p.length===1) g.lineTo(s.p[0][0]*w+0.1,s.p[0][1]*h+0.1); g.stroke(); });
};

/* ---------- packs ---------- */
S7.packList=function(){ return Object.keys(window.S7PACKS||{}).sort(); };
S7.pack=function(id){ return (window.S7PACKS||{})[id]; };

/* ---------- names ---------- */
S7.cleanName=function(n){ n=String(n||'').replace(/[^A-Za-z' \-]/g,'').replace(/\s+/g,' ').trim(); return n.slice(0,24); };
})();
