let pokemonState=null;
const pokemonById=id=>window.POKEMON_CATALOG.find(item=>item.id===Number(id));
const pokemonElement=id=>document.getElementById(id);
const pokemonPlaceholder=`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Crect width='140' height='140' rx='20' fill='%23eef2f6'/%3E%3Ctext x='70' y='84' text-anchor='middle' font-size='48'%3E?%3C/text%3E%3C/svg%3E`;
const pokemonLevel=item=>Math.min(50,(item?.experienceSeconds||0)/3600);
const levelText=value=>Number.isInteger(value)?String(value):value.toFixed(1);

function currentPokemon(){return pokemonState?.owned.find(item=>item.id===pokemonState.currentPokemonId)||null}
function evolutionStages(baseId){return window.POKEMON_EVOLUTIONS[baseId]||[[0,baseId]]}
function displaySpecies(item){
  if(!item)return null;
  if(item.baseSpeciesId===133&&item.evolvedSpeciesId)return item.evolvedSpeciesId;
  let result=item.baseSpeciesId;
  for(const [level,speciesId] of evolutionStages(item.baseSpeciesId)){if(pokemonLevel(item)>=level)result=speciesId}
  return result;
}
function unlockedSpecies(){
  const unlocked=new Set();
  for(const item of pokemonState?.owned||[]){
    unlocked.add(item.baseSpeciesId);
    for(const [level,speciesId] of evolutionStages(item.baseSpeciesId)){if(pokemonLevel(item)>=level)unlocked.add(speciesId)}
    if(item.evolvedSpeciesId)unlocked.add(item.evolvedSpeciesId);
  }
  return unlocked;
}
function safePokemonImages(root=document){
  root.querySelectorAll('img[data-pokemon-image]').forEach(image=>image.addEventListener('error',()=>{image.src=pokemonPlaceholder},{once:true}));
}

function renderPokemonDashboard(){
  if(!pokemonState)return;
  const current=currentPokemon(),level=pokemonLevel(current),display=pokemonById(displaySpecies(current));
  pokemonElement('pokemonLevel').textContent=levelText(level);
  pokemonElement('pokemonGraduated').textContent=pokemonState.graduatedCount;
  pokemonElement('pokemonUnspent').textContent=formatHours(pokemonState.unspentXpSeconds);
  pokemonElement('pokemonLevelLabel').textContent=`${levelText(level)} / 50`;
  pokemonElement('pokemonLevelFill').style.width=`${Math.min(100,level*2)}%`;
  pokemonElement('pokemonRewardHint').textContent=pokemonState.unspentXpSeconds?`有 ${formatHours(pokemonState.unspentXpSeconds)} 等待分配`:'完成计时获得经验';
  const claim=pokemonElement('claimPokemon');
  claim.hidden=!pokemonState.pendingCandidates.length;
  claim.textContent=current?.graduated?'🎯 领养新伙伴':'🎯 选择初始伙伴';

  const partner=pokemonElement('pokemonPartner');
  if(!current){
    partner.innerHTML='<div class="pokemon-empty"><span>🥚</span><strong>等待你的第一位伙伴</strong><p>从三只随机出现的宝可梦中选择一只，开始学习冒险。</p></div>';
    pokemonElement('pokemonStage').textContent='未选择';
  }else{
    const needsBranch=current.baseSpeciesId===133&&!current.evolvedSpeciesId&&current.experienceSeconds>=30*3600;
    partner.innerHTML=`<div class="pokemon-sprite-wrap"><img data-pokemon-image src="${display.sprite}" alt="${escapeHtml(display.name)}"><i></i></div><h2>${escapeHtml(display.name)} ${current.graduated?'🌟':''}</h2><p>Lv. ${levelText(level)} / 50</p>${current.graduated?'<strong class="pokemon-graduated">🎓 已毕业，可以领养新伙伴</strong>':''}${needsBranch?'<button id="chooseEeveeEvolution" class="primary">✨ 选择进化方向</button>':''}`;
    const stages=evolutionStages(current.baseSpeciesId),stage=Math.max(0,stages.findLastIndex(([required])=>level>=required));
    pokemonElement('pokemonStage').textContent=current.graduated?'已毕业':needsBranch?'等待进化':stages.length===1?'伙伴':`${stage+1} 阶段`;
    pokemonElement('chooseEeveeEvolution')?.addEventListener('click',showEeveeDialog);
  }
  renderEvolutionChain(current);
  renderPokedex();
  safePokemonImages(pokemonElement('view-home'));
}

function renderEvolutionChain(current){
  const container=pokemonElement('pokemonEvolutionChain');
  if(!current){container.innerHTML='<span class="muted">选择伙伴后显示进化链</span>';return}
  const ids=current.baseSpeciesId===133?[133,134,135,136]:evolutionStages(current.baseSpeciesId).map(([,id])=>id);
  if(ids.length===1){container.innerHTML='<span class="muted">这只宝可梦不会进化</span>';return}
  const currentDisplay=displaySpecies(current);
  container.innerHTML=ids.map((id,index)=>{const item=pokemonById(id),active=current.baseSpeciesId===133?(id===currentDisplay):(evolutionStages(current.baseSpeciesId).findIndex(([,species])=>species===id)<=evolutionStages(current.baseSpeciesId).findIndex(([,species])=>species===currentDisplay));return `${index?'<b>›</b>':''}<div class="pokemon-evolution-item ${active?'active':''}"><img loading="lazy" data-pokemon-image src="${item.sprite}" alt="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span></div>`}).join('');
}

function renderPokedex(){
  const unlocked=unlockedSpecies();
  pokemonElement('pokedexCount').textContent=`${unlocked.size} / 151`;
  pokemonElement('pokedexGrid').innerHTML=window.POKEMON_CATALOG.map(item=>`<div class="pokedex-item ${unlocked.has(item.id)?'unlocked':'locked'}"><img loading="lazy" data-pokemon-image src="${item.sprite}" alt="${unlocked.has(item.id)?escapeHtml(item.name):'未解锁宝可梦'}"><span>${unlocked.has(item.id)?escapeHtml(item.name):'???'}</span><small>#${String(item.id).padStart(3,'0')}</small></div>`).join('');
}

function pokemonDialog(title,subtitle,choices,onChoice){
  let dialog=pokemonElement('pokemonChoiceDialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='pokemonChoiceDialog';dialog.className='pokemon-choice-dialog';document.body.appendChild(dialog)}
  dialog.innerHTML=`<div class="dialog-head"><div><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(subtitle)}</p></div><button class="dialog-close" aria-label="关闭">×</button></div><div class="pokemon-choices">${choices.map(choice=>{const item=pokemonById(choice.id);return `<button data-choice="${choice.id}"><img data-pokemon-image src="${item.sprite}" alt="${escapeHtml(item.name)}"><strong>${escapeHtml(item.name)}</strong><span>${choice.tag||'选择伙伴'}</span></button>`}).join('')}</div>`;
  dialog.querySelector('.dialog-close').onclick=()=>dialog.close();
  dialog.querySelectorAll('[data-choice]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await onChoice(Number(button.dataset.choice),dialog)}finally{if(button.isConnected)button.disabled=false}});
  safePokemonImages(dialog);dialog.showModal();
}
function showClaimDialog(){pokemonDialog('选择你的新伙伴','候选一旦生成，刷新页面也不会改变。',pokemonState.pendingCandidates.map(id=>({id,tag:[144,145,146,150,151].includes(id)?'👑 传说伙伴':'开始培养'})),async(id,dialog)=>{try{pokemonState=await apiFetch('/api/pokemon/claim',{method:'POST',body:{baseSpeciesId:id,stateVersion:pokemonState.stateVersion}});dialog.close();renderPokemonDashboard();toast(`已选择 ${pokemonById(id).name}`)}catch(error){dialog.close();toast(error.message);await refreshPokemon()}})}
function showEeveeDialog(){pokemonDialog('伊布进化选择','选择后将永久决定这只伊布的进化形态。',[{id:134,tag:'💧 水伊布'},{id:135,tag:'⚡ 雷伊布'},{id:136,tag:'🔥 火伊布'}],async(id,dialog)=>{try{pokemonState=await apiFetch('/api/pokemon/evolve',{method:'POST',body:{pokemonId:currentPokemon().id,targetSpeciesId:id,stateVersion:pokemonState.stateVersion}});dialog.close();renderPokemonDashboard();toast(`恭喜进化为 ${pokemonById(id).name}`)}catch(error){dialog.close();toast(error.message);await refreshPokemon()}})}
async function refreshPokemon(){pokemonState=await apiFetch('/api/pokemon/bootstrap',{method:'POST'});renderPokemonDashboard()}
pokemonElement('claimPokemon').addEventListener('click',showClaimDialog);
window.pokemonDashboardRefresh=refreshPokemon;
