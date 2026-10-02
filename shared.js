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
  /* child listeners: the whole point of the 500-student rebuild. A 'value'
     listener on a node with 500 children re-sends all 500 on every change.
     These send one child at a time, so the teacher screen costs almost nothing. */
  this.onChild=function(p,h){
    var r=db.ref(p);
    var a=function(s){ if(h.added) h.added(s.key, s.val()); };
    var c=function(s){ if(h.changed) h.changed(s.key, s.val()); };
    var d=function(s){ if(h.removed) h.removed(s.key); };
    r.on('child_added',a); r.on('child_changed',c); r.on('child_removed',d);
    return function(){ r.off('child_added',a); r.off('child_changed',c); r.off('child_removed',d); };
  };
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
  this.onChild=function(p,h){
    var seen={};
    return this.on(p,function(v){
      v=v||{};
      for(var k in v){ var j=JSON.stringify(v[k]);
        if(!(k in seen)){ seen[k]=j; if(h.added) h.added(k,v[k]); }
        else if(seen[k]!==j){ seen[k]=j; if(h.changed) h.changed(k,v[k]); } }
      for(var k2 in seen){ if(!(k2 in v)){ delete seen[k2]; if(h.removed) h.removed(k2); } }
    });
  };
  this.onDisconnectRemove=function(){};
  this.serverTime=function(){ return Date.now(); };
}
S7.openDB=function(){
  if(window.S7_FIREBASE && window.firebase){ try{ return new FirebaseDB(window.S7_FIREBASE); }catch(e){ console.error('Firebase failed, using local demo',e); } }
  return new LocalDB();
};

/* ============================================================
   Answer checking
   answer: {value:number|string, unit?, accept?:[...], tol?:number, kind?:'ratio', strict?:true}
   strict: use tol only, with no 0.2% relative slack (money to the penny, years)
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
/* ---------- answers with more than one number, equations and algebra ----------
   kind:'set'   values:[a,b]       two or more numbers in any order (quadratic roots)
   kind:'vars'  vars:{x:3,y:-2}    named values, typed "x = 3, y = -2" or "3, -2" in that order
   kind:'line'  m:2, c:-3          any correct equation of the line y = mx + c
   kind:'expr'  expr:'(a+b)/c', subject:'x'   an expression, checked by evaluating at random values
   ratio values may have any number of parts (12:10:15)                                   */
var NUMRE=/-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?/g;
function numsIn(s){ return (String(s).replace(/−/g,'-').replace(/\s+/g,'').match(NUMRE)||[]).map(function(t){ var p=t.split('/'); return p.length>1?parseFloat(p[0])/parseFloat(p[1]):parseFloat(p[0]); }); }
function close(a,b,tol){ return Math.abs(a-b)<=Math.max(tol||0, Math.abs(b)*0.002, 0.005); }
/* a small safe expression evaluator: numbers, single-letter variables, + - * / ^, brackets,
   sqrt/√, pi/π, implicit multiplication (2x, 3(x+1), ab) */
function parseExpr(src){
  var s=String(src).replace(/−/g,'-').replace(/[×·]/g,'*').replace(/÷/g,'/')
    .replace(/π/g,'pi').replace(/√/g,'sqrt').replace(/\s+/g,'')
    .replace(/[½¼¾⅓⅔]/g,function(c){ return '('+({'½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3'})[c]+')'; })
    .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g,function(t){ return '^('+t.split('').map(function(c){ return '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)===0?'-':String('⁻⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)-1); }).join('')+')'; })
    .toLowerCase();
  var toks=[], i=0, m;
  while(i<s.length){
    var r=s.slice(i);
    if((m=/^\d+(\.\d+)?|^\.\d+/.exec(r))){ toks.push({t:'n',v:parseFloat(m[0])}); i+=m[0].length; continue; }
    if((m=/^(sqrt|cbrt|pi)/.exec(r))){ toks.push(m[1]==='pi'?{t:'n',v:Math.PI}:{t:'f',v:m[1]}); i+=m[0].length; continue; }
    if(/^[a-z]/.test(r)){ toks.push({t:'v',v:r[0]}); i++; continue; }
    if(/^[-+*\/^()]/.test(r)){ toks.push({t:r[0]}); i++; continue; }
    throw new Error('bad char '+r[0]);
  }
  /* insert implicit multiplication */
  var out=[];
  for(var k=0;k<toks.length;k++){
    var a=out[out.length-1], b=toks[k];
    if(a && (a.t==='n'||a.t==='v'||a.t===')') && (b.t==='n'||b.t==='v'||b.t==='('||b.t==='f')) out.push({t:'*'});
    out.push(b);
  }
  var pos=0;
  function peek(){ return out[pos]; }
  function eat(t){ if(out[pos]&&out[pos].t===t){ pos++; return true; } return false; }
  function expr(){ var n=term(); while(peek()&&(peek().t==='+'||peek().t==='-')){ var o=out[pos++].t, r=term(); n=(function(l,r,o){ return function(e){ return o==='+'?l(e)+r(e):l(e)-r(e); }; })(n,r,o); } return n; }
  function term(){ var n=unary(); while(peek()&&(peek().t==='*'||peek().t==='/')){ var o=out[pos++].t, r=unary(); n=(function(l,r,o){ return function(e){ return o==='*'?l(e)*r(e):l(e)/r(e); }; })(n,r,o); } return n; }
  function unary(){ if(eat('-')){ var u=unary(); return function(e){ return -u(e); }; } if(eat('+')) return unary(); return power(); }
  function power(){ var b=prim(); if(eat('^')){ var x=unary(); return function(e){ return Math.pow(b(e),x(e)); }; } return b; }
  function prim(){
    var t=out[pos++]; if(!t) throw new Error('end');
    if(t.t==='n') return function(){ return t.v; };
    if(t.t==='v') return function(e){ if(!(t.v in e)) throw new Error('var '+t.v); return e[t.v]; };
    if(t.t==='('){ var n=expr(); if(!eat(')')) throw new Error(')'); return n; }
    if(t.t==='f'){ var a=power(); return t.v==='sqrt'?function(e){ return Math.sqrt(a(e)); }:function(e){ return Math.cbrt(a(e)); }; }
    throw new Error('unexpected '+t.t);
  }
  var f=expr(); if(pos!==out.length) throw new Error('trailing');
  return f;
}
S7.parseExpr=parseExpr;
function sameFn(f, g, names, n){
  var ok=0, tries=0, seed=7;
  function rnd(){ seed=(seed*16807)%2147483647; return seed/2147483647; }
  while(ok<(n||6) && tries<60){
    tries++; var e={}; names.forEach(function(v){ e[v]=tries<=20?1.3+2.4*rnd():0.5+40*rnd(); });   /* wider values later, so sqrt(x - 7) gets tested too */
    var a, b; try{ a=f(e); b=g(e); }catch(x){ return false; }
    if(!isFinite(b)) continue;
    if(!isFinite(a) || Math.abs(a-b)>1e-6*Math.max(1,Math.abs(b))) return false;
    ok++;
  }
  return ok>=3;
}
function varsOf(src){ var v={}; String(src).toLowerCase().replace(/sqrt|cbrt|pi/g,'').replace(/[a-z]/g,function(c){ v[c]=1; return c; }); return Object.keys(v); }
function checkKind(ans, raw){
  var s=String(raw).replace(/−/g,'-').trim();
  if(ans.kind==='set'){
    var got=numsIn(s), want=(ans.values||[]).slice();
    if(got.length!==want.length) return false;
    got.sort(function(a,b){return a-b;}); want.sort(function(a,b){return a-b;});
    for(var i=0;i<want.length;i++) if(!close(got[i],want[i],ans.tol)) return false;
    return true;
  }
  if(ans.kind==='vars'){
    var names=Object.keys(ans.vars), low=s.toLowerCase().replace(/\s+/g,''), vals={};
    var re=/([a-z])=(-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)/g, mm, named=false;
    while((mm=re.exec(low))){ named=true; var p=mm[2].split('/'); vals[mm[1]]=p.length>1?parseFloat(p[0])/parseFloat(p[1]):parseFloat(p[0]); }
    if(!named){ var ns=numsIn(low); if(ns.length!==names.length) return false; names.forEach(function(k,i){ vals[k]=ns[i]; }); }
    return names.every(function(k){ return (k in vals) && close(vals[k], ans.vars[k], ans.tol); }) && Object.keys(vals).length===names.length;
  }
  if(ans.kind==='line'){
    var parts=s.split('='); if(parts.length>2) return false;
    var L, R;
    try{ if(parts.length===1){ L=parseExpr('y'); R=parseExpr(parts[0]); } else { L=parseExpr(parts[0]); R=parseExpr(parts[1]); } }catch(x){ return false; }
    function F(x,y){ var e={x:x,y:y}; return L(e)-R(e); }
    var C, A, B, T;
    try{ C=F(0,0); A=F(1,0)-C; B=F(0,1)-C; T=F(2.5,-1.5); }catch(x){ return false; }
    if(!isFinite(C)||!isFinite(A)||!isFinite(B)||Math.abs(B)<1e-9) return false;
    if(Math.abs(T-(2.5*A-1.5*B+C))>1e-6*Math.max(1,Math.abs(T))) return false;   /* not a straight line */
    return close(-A/B, ans.m, 1e-6) && close(-C/B, ans.c, 1e-6);
  }
  if(ans.kind==='expr'){
    s=s.replace(/±|\+\/-/g,'');                 /* t = ±√(2s/a): the ± is fine, check the root */
    if(ans.subject && /[,;]|\band\b/.test(s)){       /* "x = p/4, y = 3p/2": keep the part for the subject */
      var bits=s.split(/[,;]|\band\b/).filter(function(t){ return t.replace(/\s+/g,'').toLowerCase().indexOf(ans.subject+'=')===0; });
      if(bits.length===1) s=bits[0].trim();
    }
    var body=s;
    if(ans.subject){
      var eq=s.split('='); if(eq.length===2){ if(eq[0].replace(/\s+/g,'').toLowerCase()!==ans.subject) return false; body=eq[1]; }
      else if(eq.length>2) return false;
    } else {
      var eq2=s.split('='); if(eq2.length===2) body=eq2[1];        /* f⁻¹(x) = ..., or y = ... when no subject is set */
    }
    var want2, got2;
    try{ want2=parseExpr(ans.expr); got2=parseExpr(body); }catch(x){ return false; }
    var names2=varsOf(ans.expr); varsOf(body).forEach(function(v){ if(names2.indexOf(v)<0) names2.push(v); });
    return sameFn(got2, want2, names2);
  }
  return null;
}
/* what to type, for answers with more than one part (shown under the question) */
S7.askHTML=function(ans){ return (ans&&ans.ask)?'<div class="askline">Type '+S7.esc(ans.ask)+'</div>':''; };
S7.ph=function(ans, d){ return S7.esc((ans&&ans.ask)?ans.ask.charAt(0).toUpperCase()+ans.ask.slice(1):d); };
/* a mixed number typed with a space, 2 7/9, before the spaces are squeezed out */
function mixedNum(raw){
  var m=/^\s*(-?)(\d+)\s+(\d+)\s*\/\s*(\d+)\s*$/.exec(String(raw).replace(/−/g,'-').replace(/£|€|\$/g,''));
  if(!m) return null;
  var v=parseFloat(m[2])+parseFloat(m[3])/parseFloat(m[4]);
  return m[1]==='-'?-v:v;
}
S7.checkAnswer=function(ans, given){
  if(!ans) return null;
  /* a probability typed as a percentage, 56.25%, is the same as 0.5625 */
  if(ans.prob && !ans.kind && /%\s*$/.test(String(given))){ var pv=toNumber(String(given).replace(/%\s*$/,'')); if(!isNaN(pv)) given=String(pv/100); }
  var g=norm(given); if(!g) return null;
  var mx=mixedNum(given);
  if(mx!==null && !ans.kind && typeof ans.value==='number'){
    var tl=ans.strict?(ans.tol||0.005):Math.max(ans.tol||0, Math.abs(ans.value)*0.002, 0.005);
    return Math.abs(mx-ans.value)<=tl;
  }
  var acc=(ans.accept||[]).map(norm);
  if(acc.indexOf(g)>=0) return true;
  if(ans.kind==='set'||ans.kind==='vars'||ans.kind==='line'||ans.kind==='expr') return !!checkKind(ans, given);
  if(ans.kind==='ratio'){
    /* ratios with any number of parts, compared by proportion */
    var pg=g.split(':'), pw=norm(ans.value).split(':');
    if(pg.length>2 && pg.length===pw.length){
      var ng=pg.map(toNumber), nw=pw.map(toNumber);
      if(ng.some(isNaN)||nw.some(isNaN)) return false;
      return ng.every(function(v,i){ return Math.abs(v/ng[0] - nw[i]/nw[0])<1e-6; });
    }
  }
  if(ans.kind==='ratio' || typeof ans.value==='string'){
    var want=norm(ans.value);
    if(g===want) return true;
    /* ratio a:b compared as a fraction */
    var r1=/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(g), r2=/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(want);
    if(r1&&r2){ return Math.abs(parseFloat(r1[1])/parseFloat(r1[2]) - parseFloat(r2[1])/parseFloat(r2[2]))<1e-6; }
    var gn=toNumber(g), wn=toNumber(want);
    if(!isNaN(gn)&&!isNaN(wn)) return Math.abs(gn-wn)<=(ans.strict?(ans.tol||0.005):Math.max(ans.tol||0, Math.abs(wn)*0.002, 0.005));
    return false;
  }
  var n=toNumber(g); if(isNaN(n)) return false;
  var tol=ans.strict?(ans.tol||0.005):Math.max(ans.tol||0, Math.abs(ans.value)*0.002, 0.005);
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
    if(st.grid){ g.strokeStyle='rgba(97,0,100,.075)'; g.lineWidth=1; var step=Math.max(16,Math.round(h/12));
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
  var pens=[['#19151C','Black'],['#610064','Purple'],['#F93E26','Orange'],['#5949EB','Blue'],['#0F8A63','Green']];
  return '<div class="tools" role="toolbar" aria-label="Whiteboard tools">'+
    '<span class="pens">'+pens.map(function(c,k){return '<button type="button" class="pen'+(k===0?' on':'')+'" style="--c:'+c[0]+'" data-pen="'+c[0]+'" aria-label="'+c[1]+' pen" title="'+c[1]+'"></button>';}).join('')+'</span>'+
    '<span class="ws"><button type="button" data-w="2" aria-label="Thin" title="Thin"><i style="width:4px;height:4px"></i></button><button type="button" data-w="3.5" class="on" aria-label="Medium" title="Medium"><i style="width:8px;height:8px"></i></button><button type="button" data-w="6" aria-label="Thick" title="Thick"><i style="width:13px;height:13px"></i></button></span>'+
    '<span class="acts"><button type="button" class="tb" data-erase>Rubber</button><button type="button" class="tb" data-undo>Undo</button><button type="button" class="tb" data-clear>Clear</button></span></div>';
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

/* ---------- brand: the three Aston pillars and the full-bleed stage ----------
   Three equal parallelograms, one per secondary colour, each bleeding off the
   page with one end showing. Drawn in 1-unit SVGs so the CSS can place and
   size them per screen without touching the geometry. */
S7.pillars='<div class="pillars" aria-hidden="true">'+
  '<svg class="pl p1" viewBox="0 0 1 1" focusable="false"><polygon points="-10.00,1.41 10.00,-1.41 -139.13,-214.39 -159.13,-211.57"/></svg>'+
  '<svg class="pl p2" viewBox="0 0 1 1" focusable="false"><polygon points="6.18,-8.35 -6.18,8.35 252.15,37.79 264.51,21.08"/></svg>'+
  '<svg class="pl p3" viewBox="0 0 1 1" focusable="false"><polygon points="-9.41,-4.35 9.41,4.35 32.08,263.36 13.25,254.66"/></svg></div>';
/* "Example 2, You do, Percentage of an amount" -> "Percentage of an amount" */
S7.subTitle=function(sub){ return String(sub||'').replace(/^\s*Example\s+\d+\s*,\s*You do\s*,\s*/i,'').trim(); };
/* o = {kicker, title (html), lede (html), body (html), layout} */
S7.stage=function(o){
  return '<section class="stage'+(o.layout?' '+o.layout:'')+'">'+S7.pillars+
    '<div class="stage-in">'+
      (o.kicker?'<p class="kicker">'+o.kicker+'</p>':'')+
      '<h1>'+o.title+'</h1>'+
      (o.lede?'<p class="lede">'+o.lede+'</p>':'')+
      (o.body||'')+
    '</div></section>';
};

/* ---------- packs ---------- */
S7.packList=function(){ return Object.keys(window.S7PACKS||{}).sort(); };
S7.pack=function(id){ return (window.S7PACKS||{})[id]; };

/* ---------- names ---------- */
S7.cleanName=function(n){ n=String(n||'').replace(/[^A-Za-z' \-]/g,'').replace(/\s+/g,' ').trim(); return n.slice(0,24); };
})();
