import {createMinesweeper} from './minesweeper-core.js';
import {dailySeed} from './shared.js';

const mineIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6"><path d="M12 1v22M1 12h22M4 4l16 16M4 20 20 4"/><circle cx="12" cy="12" r="7" fill="currentColor"/></g><path d="M8 7h3v3H8z" fill="#fff"/></svg>';
const smile=(status)=>`<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="#f2dc56" stroke="#3c3c22" stroke-width="1.2"/>${status==='lost'?'<path d="m8 9 4 4m-4 0 4-4m4 0 4 4m-4 0 4-4M9 20q5-6 10 0" fill="none" stroke="#272b21" stroke-width="1.4"/>':status==='won'?'<path d="M6 9h16l-2 6h-5l-1-3-1 3H8z" fill="#272b21"/><path d="M9 19q5 5 10 0" fill="none" stroke="#272b21" stroke-width="1.4"/>':'<path d="M9 10v3m10-3v3M8 17q6 7 12 0" fill="none" stroke="#272b21" stroke-width="1.6"/>'}</svg>`;
const digits=[['a','b','c','d','e','f'],['b','c'],['a','b','g','e','d'],['a','b','g','c','d'],['f','g','b','c'],['a','f','g','c','d'],['a','f','g','e','c','d'],['a','b','c'],['a','b','c','d','e','f','g'],['a','b','c','d','f','g']];
const segments={a:'3,1 12,1 14,3 12,5 3,5 1,3',b:'13,4 15,6 15,12 13,14 11,12 11,6',c:'13,14 15,16 15,22 13,24 11,22 11,16',d:'3,23 12,23 14,25 12,27 3,27 1,25',e:'2,14 4,16 4,22 2,24 0,22 0,16',f:'2,4 4,6 4,12 2,14 0,12 0,6',g:'3,12 12,12 14,14 12,16 3,16 1,14'};
function led(number){return String(Math.max(-99,Math.min(999,number))).padStart(3,'0').split('').map(d=>`<svg viewBox="0 0 15 28" aria-hidden="true">${Object.entries(segments).map(([k,p])=>`<polygon points="${p}" fill="${(d==='-'?k==='g':digits[Number(d)].includes(k))?'#ff493b':'#402b24'}"/>`).join('')}</svg>`).join('');}
function storageGet(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function storageSet(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
const flagIcon='<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M4 2v10M2 12h7" fill="none" stroke="currentColor"/><path d="M4 2h7L8 5l3 3H4z" fill="currentColor"/></svg>';

/** The row under the window. In the site shell only flag mode is left; standalone it also carries drawing and sound. */
function toolbar(chrome) {
  const flag = `<button type="button" class="flag-mode" aria-pressed="false">${flagIcon}<span>Flag mode</span></button>`;
  if (chrome) return `<div class="game-toolbar" data-chrome>${flag}</div>`;
  const sound = storageGet('stillplay-sound', false);
  return `<div class="game-toolbar">${flag}<span class="separator"></span><button type="button" class="fidelity-toggle">Original pixels</button><span class="separator"></span><button type="button" class="sound-toggle" aria-pressed="${sound}">Sound ${sound ? 'on' : 'off'}</button></div>`;
}

/**
 * Mount Minesweeper. With `chrome: true` the site toolbar already offers new game, sound and the
 * drawing mode, so only the flag-mode toggle (needed on touch screens) is drawn below the window.
 */
export async function mountMinesweeper(container,{daily=false,level='beginner',seed,onWin=()=>{},onStart=()=>{},onLose=()=>{},showDialog=()=>{},showToast=()=>{},sound=()=>{},mini=false,chrome=false}={}){
  const q=new URLSearchParams(location.search);if(!mini&&!daily){level=q.get('level')||level;const n=Number(q.get('seed'));if(q.has('seed')&&Number.isInteger(n)&&n>=0&&n<=0xffffffff)seed=n;}
  if(!['beginner','intermediate','expert'].includes(level))level='beginner';
  seed=seed??(daily?dailySeed():crypto.getRandomValues(new Uint32Array(1))[0]);
  let game=await createMinesweeper({level,seed}), flagMode=false, fidelity=storageGet('stillplay-fidelity','pixels'), start=0, elapsed=0, frozenTime=0, wonShown=false, lostShown=false, destroyed=false, pressTimer, longPressed=false, pointerDown=0;
  container.innerHTML=`<div class="game-window" data-game="minesweeper"><div class="game-titlebar"><span>${mineIcon}Minesweeper</span><div class="window-controls" aria-hidden="true"><span>_</span><span>□</span><span>×</span></div></div><div class="game-menubar"><button class="menu-toggle" id="mine-game-toggle" aria-expanded="false">Game</button><button class="menu-toggle" id="mine-help">Help</button><div class="game-menu" id="mine-menu"><button data-level="new">New game <span>F2</span></button><hr><button data-level="beginner">Beginner <span>9 × 9</span></button><button data-level="intermediate">Intermediate <span>16 × 16</span></button><button data-level="expert">Expert <span>30 × 16</span></button><hr><button data-level="times">Best times…</button></div></div><div class="mine-frame"><div class="mine-dashboard"><div class="led-display mine-counter" role="img" aria-label="10 mines remaining"></div><button class="face-button" aria-label="New game" title="New game (F2)"></button><div class="led-display mine-time" role="timer" aria-label="0 seconds"></div></div><div class="mine-board"><canvas aria-hidden="true"></canvas><div class="cell-overlay" role="group" aria-label="Minesweeper board"></div></div></div><div class="game-statusbar"><span class="mine-status">Beginner</span><span class="mine-help-text">Right-click to flag</span></div></div>${mini?'':toolbar(chrome)}`;
  const windowEl=container.querySelector('.game-window'),canvas=container.querySelector('canvas'),overlay=container.querySelector('.cell-overlay'),board=container.querySelector('.mine-board'),menu=container.querySelector('.game-menu'),menuToggle=container.querySelector('#mine-game-toggle');
  let cellSize=30,lastShape='';
  function closeMenu(){menu.classList.remove('open');menuToggle.setAttribute('aria-expanded','false');}
  function paint(){
    if(destroyed)return;const state=game.state();const available=container.getBoundingClientRect().width||window.innerWidth-53;const maxWidth=Math.min(available-36,window.innerWidth-89,mini?320:900);cellSize=Math.min(state.width===9?30:24,Math.floor(maxWidth/state.width));cellSize=Math.max(8,cellSize);
    const shape=`${state.width}:${state.height}:${cellSize}:${fidelity}`;const scale=fidelity==='crisp'?window.devicePixelRatio||1:1;
    if(lastShape!==shape){canvas.width=state.width*cellSize*scale;canvas.height=state.height*cellSize*scale;canvas.style.width=`${state.width*cellSize}px`;canvas.style.height=`${state.height*cellSize}px`;board.style.setProperty('--columns',state.width);board.style.setProperty('--rows',state.height);board.style.setProperty('--board-width',`${state.width*cellSize}px`);board.style.setProperty('--board-height',`${state.height*cellSize}px`);overlay.innerHTML=state.cells.map((_,i)=>`<button data-cell="${i}" aria-label="Covered cell, row ${Math.floor(i/state.width)+1}, column ${i%state.width+1}"></button>`).join('');lastShape=shape;}
    const ctx=canvas.getContext('2d');ctx.setTransform(scale,0,0,scale,0,0);ctx.imageSmoothingEnabled=false;const s=cellSize;
    const colours=['','#1736a3','#27772c','#c32d2a','#1a2168','#791f26','#177b79','#161b17','#72746e'];
    state.cells.forEach((cell,i)=>{const x=i%state.width*s,y=Math.floor(i/state.width)*s,expose=cell.revealed||state.status==='lost'&&cell.mine;
      ctx.fillStyle=expose?'#bebfba':'#c5c6c1';ctx.fillRect(x,y,s,s);
      if(!expose){const b=Math.max(1,Math.floor(s/10));ctx.fillStyle='#f5f5eb';ctx.fillRect(x,y,s,b);ctx.fillRect(x,y,b,s);ctx.fillStyle='#7c8077';ctx.fillRect(x+s-b,y,b,s);ctx.fillRect(x,y+s-b,s,b);}
      else{ctx.strokeStyle='#9b9f95';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,s-1,s-1);}
      if(cell.flagged&&!expose){ctx.strokeStyle='#2e342a';ctx.lineWidth=Math.max(1,s/14);ctx.beginPath();ctx.moveTo(x+s*.49,y+s*.23);ctx.lineTo(x+s*.49,y+s*.75);ctx.moveTo(x+s*.29,y+s*.76);ctx.lineTo(x+s*.72,y+s*.76);ctx.stroke();ctx.fillStyle='#c64634';ctx.beginPath();ctx.moveTo(x+s*.49,y+s*.22);ctx.lineTo(x+s*.22,y+s*.4);ctx.lineTo(x+s*.49,y+s*.43);ctx.fill();}
      if(expose&&cell.mine){ctx.fillStyle='#262c24';ctx.strokeStyle='#262c24';ctx.lineWidth=Math.max(1,s/17);for(let a=0;a<8;a++){const r=a*Math.PI/4;ctx.beginPath();ctx.moveTo(x+s*.5+Math.cos(r)*s*.18,y+s*.5+Math.sin(r)*s*.18);ctx.lineTo(x+s*.5+Math.cos(r)*s*.35,y+s*.5+Math.sin(r)*s*.35);ctx.stroke();}ctx.beginPath();ctx.arc(x+s*.5,y+s*.5,s*.24,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f2f1e5';ctx.fillRect(x+s*.39,y+s*.34,s*.10,s*.10);}
      else if(cell.revealed&&cell.adjacent){ctx.fillStyle=colours[cell.adjacent];ctx.font=`bold ${Math.floor(s*.74)}px 'Courier New',monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(cell.adjacent),x+s*.5,y+s*.55);}
      const b=overlay.children[i];b.setAttribute('aria-label',`${cell.flagged?'Flagged':cell.revealed?(cell.mine?'Mine':cell.adjacent?`${cell.adjacent} adjacent mines`:'Empty'):'Covered cell'}, row ${Math.floor(i/state.width)+1}, column ${i%state.width+1}`);b.setAttribute('aria-pressed',String(cell.flagged));
    });
    container.querySelector('.mine-counter').innerHTML=led(state.mines-state.flags);container.querySelector('.mine-counter').setAttribute('aria-label',`${state.mines-state.flags} mines remaining`);container.querySelector('.face-button').innerHTML=smile(state.status);
    container.querySelector('.mine-status').textContent=state.status==='won'?'Field cleared. Nicely done.':state.status==='lost'?'One more round?':`${state.level[0].toUpperCase()+state.level.slice(1)}${daily?' · Daily':''}`;
    if(state.status==='won'&&!wonShown){wonShown=true;frozenTime=elapsed;const key=`stillplay-best-${state.level}`;const prev=storageGet(key,null);if(prev===null||elapsed<prev)storageSet(key,elapsed);queueMicrotask(()=>onWin({game:'minesweeper',level:state.level,seed:state.seed,elapsedSeconds:elapsed,daily,flags:game.replay().actions.filter(a=>a.type==='flag').length,replay:game.replay(),params:{level:state.level,seed:state.seed}}));}
    if(state.status==='lost'&&!lostShown){
      lostShown=true;
      if(!frozenTime)frozenTime=elapsed;
      const replay=game.replay();
      queueMicrotask(()=>onLose({game:'minesweeper',level:state.level,seed:state.seed,elapsedSeconds:elapsed,daily,replay}));
    }
    updateTime();
  }
  function updateTime(){if(start&&game.state().status==='playing')elapsed=Math.min(999,Math.floor((performance.now()-start)/1000));container.querySelector('.mine-time').innerHTML=led(elapsed);container.querySelector('.mine-time').setAttribute('aria-label',`${elapsed} seconds`);}
  function action(type,index){const state=game.state();if(state.status==='lost'||state.status==='won')return;const x=index%state.width,y=Math.floor(index/state.width);updateTime();if(type==='reveal'&&state.cells[index].revealed)type='chord';const opened=state.cells.filter(c=>c.revealed).length;game[type](x,y);if(!start&&game.state().status!=='ready')start=performance.now();actionSound(type,index,opened);paint();}
  function actionSound(type,index,openedBefore){
    const next=game.state();
    if(next.status==='lost'){sound('explode');setTimeout(()=>{if(!destroyed)sound('lose');},420);return;}
    if(next.status==='won'){sound('win');return;}
    const opened=next.cells.filter(c=>c.revealed).length-openedBefore;
    if(type==='flag'){if(!next.cells[index].revealed)sound(next.cells[index].flagged?'flag':'unflag');}
    else if(type==='chord'){if(opened>0)sound(opened>3?'reveal-cascade':'chord');}
    else if(opened>1)sound('reveal-cascade');
    else if(opened===1)sound('reveal');
  }
  function newGame(nextLevel=game.state().level, nextSeed){if(container.id==='hero-game'&&nextLevel!=='beginner'){location.assign('/minesweeper?level='+nextLevel);return;}level=nextLevel;seed=nextSeed??(daily?dailySeed():crypto.getRandomValues(new Uint32Array(1))[0]);game.newGame({level,seed});start=0;elapsed=0;frozenTime=0;wonShown=false;lostShown=false;closeMenu();paint();onStart();}
  overlay.addEventListener('click',e=>{const b=e.target.closest('[data-cell]');if(!b||longPressed){longPressed=false;return;}action(flagMode?'flag':'reveal',Number(b.dataset.cell));});
  overlay.addEventListener('contextmenu',e=>{e.preventDefault();const b=e.target.closest('[data-cell]');if(b)action('flag',Number(b.dataset.cell));});
  overlay.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-cell]');if(!b||e.pointerType==='mouse')return;pointerDown=Number(b.dataset.cell);longPressed=false;pressTimer=setTimeout(()=>{longPressed=true;action('flag',pointerDown);navigator.vibrate?.(20);},450);});
  for(const type of ['pointerup','pointercancel','pointerleave','pointermove'])overlay.addEventListener(type,()=>clearTimeout(pressTimer));
  overlay.addEventListener('keydown',e=>{const b=e.target.closest('[data-cell]');if(!b)return;const i=Number(b.dataset.cell),w=game.state().width;let n=i;if(e.key==='f'||e.key==='F'){e.preventDefault();action('flag',i);return;}if(e.key==='ArrowLeft')n=i-1;else if(e.key==='ArrowRight')n=i+1;else if(e.key==='ArrowUp')n=i-w;else if(e.key==='ArrowDown')n=i+w;else return;e.preventDefault();overlay.children[Math.max(0,Math.min(overlay.children.length-1,n))].focus();});
  menuToggle.onclick=()=>{const open=menu.classList.toggle('open');menuToggle.setAttribute('aria-expanded',String(open));};
  menu.onclick=e=>{const btn=e.target.closest('[data-level]');if(!btn)return;const l=btn.dataset.level;if(l==='times'){closeMenu();showDialog('Best times',`<p>Your fastest clear fields, stored on this device.</p>${['beginner','intermediate','expert'].map(l=>`<p><strong>${l[0].toUpperCase()+l.slice(1)}</strong><span style="float:right">${storageGet(`stillplay-best-${l}`,null)===null?'No time yet':`${storageGet(`stillplay-best-${l}`,null)} seconds`}</span></p>`).join('')}`);}else{sound('new-game');newGame(l==='new'?game.state().level:l);}};
  container.querySelector('.face-button').onclick=()=>{sound('new-game');newGame();};
  container.querySelector('#mine-help').onclick=()=>showDialog('A small field. A familiar feeling.','<p>Reveal every square without a mine. A number tells you how many mines touch that square, including diagonals.</p><p><strong>Click / tap:</strong> reveal<br><strong>Right-click / long-press / F:</strong> flag<br><strong>Click an open number:</strong> clear its neighbours when the right number of flags surround it<br><strong>Arrow keys:</strong> move focus<br><strong>F2:</strong> new game</p><p>Your first reveal is safe in this implementation. Original-binary equivalence is awaiting verification.</p>');
  container.querySelector('.flag-mode')?.addEventListener('click',e=>{flagMode=!flagMode;e.currentTarget.classList.toggle('active',flagMode);e.currentTarget.setAttribute('aria-pressed',String(flagMode));container.querySelector('.mine-help-text').textContent=flagMode?'Tap to flag':'Right-click to flag';});
  function setFidelity(value){fidelity=value;storageSet('stillplay-fidelity',value);const b=container.querySelector('.fidelity-toggle');if(b)b.textContent=value==='pixels'?'Original pixels':'Crisp drawing';lastShape='';paint();}
  container.querySelector('.fidelity-toggle')?.addEventListener('click',()=>setFidelity(fidelity==='pixels'?'crisp':'pixels'));
  container.querySelector('.sound-toggle')?.addEventListener('click',e=>{const on=!storageGet('stillplay-sound',false);storageSet('stillplay-sound',on);e.currentTarget.textContent=`Sound ${on?'on':'off'}`;e.currentTarget.setAttribute('aria-pressed',String(on));if(on)sound('toggle-on');});
  function keyboard(e){if(e.key==='F2'&&!document.querySelector('dialog[open]')){e.preventDefault();sound('new-game');newGame();}if(e.key==='Escape')closeMenu();}
  document.addEventListener('keydown',keyboard);window.addEventListener('resize',paint);const timer=setInterval(updateTime,250);setFidelity(fidelity);
  return {destroy(){destroyed=true;clearInterval(timer);clearTimeout(pressTimer);document.removeEventListener('keydown',keyboard);window.removeEventListener('resize',paint);},exportReplay:()=>game.replay(),loadReplay(replay){game.loadReplay(replay);elapsed=Math.floor((replay.actions.at(-1)?.t||0)/1000);start=game.state().status==='playing'?performance.now()-elapsed*1000:0;wonShown=true;lostShown=game.state().status==='lost';paint();},newGame,setFidelity,state:()=>game.state()};
}
