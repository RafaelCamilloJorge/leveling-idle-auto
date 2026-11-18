// ==UserScript==
// @name         Leveling Idle - Auto Pontos & Equipar
// @namespace    leveling-idle-auto
// @version      1.11.0
// @description  Distribui pontos pela build, equipa os melhores itens, monta o melhor time do Exército e vai para a área de caça recomendada, sozinho.
// @match        https://levelingidle2d.com.br/jogar*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Como funciona
 * -------------
 * O script só clica nos botões que o próprio jogo já tem, como você faria na mão:
 *   - Status  -> "Distribuir pela build" (na build escolhida) -> confirma.
 *   - Inventário -> "Equipar melhores" (com o critério escolhido) -> confirma.
 *   - Exército -> "Montar melhor time".
 *   - Caçadas -> "★ Recomendada" -> "Entrar no portal" (se não for a área atual).
 * Ele não manda nada diferente para o servidor.
 *
 * Painel: aparece um botão roxo "AUTO" no canto inferior esquerdo da tela do jogo.
 * Clique nele para abrir as configurações. Tudo fica salvo neste navegador.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------
  const STORE_KEY = 'lvlAuto.config.v1';
  const CRITERION_KEY = 'leveling.inventory.equip-criterion'; // preferência do próprio jogo

  // Valores do enum do jogo (EquipBestCriterion)
  const CRITERIA = [
    { id: 1, label: 'Efetivo (combate real)' },
    { id: 2, label: 'Poder' },
    { id: 6, label: 'Poder base (sem forja/gemas)' },
    { id: 3, label: 'Ataque' },
    { id: 4, label: 'Defesa' },
    { id: 5, label: 'Vida' },
  ];

  const DEBUG = false; // true: log detalhado da troca de área

  // Build usada quando o painel fica em "Build padrão da classe" (uma por classe; os nomes não se repetem).
  const PREFERRED_BUILDS = ['Destruidor', 'Lâmina Letal', 'Rajada Arcana', 'Chuva de Flechas', 'Julgador'];
  const isPreferred = (name) => PREFERRED_BUILDS.some((p) => norm(p) === norm(name));

  const DEFAULTS = {
    enabled: false,
    autoPoints: true,
    buildName: '',          // '' = build padrão da classe (PREFERRED_BUILDS) ou a primeira da lista
    minPoints: 5,           // só distribui com pelo menos N pontos livres
    autoEquip: true,
    criterion: 1,
    equipEveryMin: 10,      // roda o "Equipar melhores" a cada N minutos
    pointsEveryMin: 15,     // checa pontos a cada N minutos (além de quando o nível muda)
    autoTeam: true,         // roda o "Montar melhor time" do Exército
    teamEveryMin: 30,
    shadowGear: true,       // "Equipar melhores" em cada sombra do time
    shadowTrainee: true,    // vaga 6 para a sombra de fora com multiplicadores melhores (para upar)
    autoHunt: true,         // vai para a área "Recomendada" pelo jogo nas Caçadas
    huntEveryMin: 20,
    expCompare: true,       // sozinho: mede o EXP/h da recomendada e da área logo abaixo e fica na melhor
    expSampleMin: 15,       // minutos caçando em cada área antes de medir
    autoTalents: true,      // investe os pontos de talento pelo plano da build
    talentBuild: '',        // '' = mesmo nome da build de atributos (ou a 1ª da classe)
    talentsEveryMin: 20,
    autoRewards: true,      // resgata Missões, Diária e Correio
    rewardsEveryMin: 15,
    autoExped: true,        // coleta e manda Sombras do Armazém em expedição
    expedEveryMin: 20,
    autoEnchant: true,      // encanta as peças vestidas só enquanto for "Garantido" (até +5)
    enchantEveryMin: 30,
    deathGuard: true,       // depois de mortes seguidas, caça uma área abaixo por um tempo
    deathLimit: 2,          // mortes...
    deathWindowMin: 15,     // ...dentro desta janela
    deathPauseMin: 60,      // por quanto tempo fica na área de baixo
    autoShop: true,         // vai até o Brok na cidade e completa poções e Revivers
    shopEveryHours: 6,
    shopHp: 300,            // Poção Grande
    shopMp: 100,            // Poção de Mana Grande
    shopRevive: 20,         // Reviver Grande
    shopGoldReserve: 20000, // nunca deixa o ouro cair abaixo disto
    lastShop: 0,
    deaths: [],
    huntPauseUntil: 0,
    expTest: null,          // medição em andamento: {rec, low, recXph, lowXph, win, at, enteredAt}
    talentPlanSeen: '',
    knownBuilds: [],
    log: [],
  };

  const cfg = loadCfg();
  function loadCfg() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
    catch { return Object.assign({}, DEFAULTS); }
  }
  function saveCfg() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* sem storage */ }
  }

  // ---------------------------------------------------------------------------
  // Utilidades de DOM
  // ---------------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.25);
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('#lvlAutoRoot')) return false; // nunca clicar no nosso painel
    const r = el.getClientRects();
    if (!r.length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  }

  function buttons(root = document) {
    return [...root.querySelectorAll('button, [role="button"], [role="menuitem"]')].filter(visible);
  }

  function findButton(pred, root = document) {
    return buttons(root).find((b) => pred(norm(b.innerText || b.textContent), b)) || null;
  }

  async function waitFor(fn, timeout = 6000, step = 150) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function click(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    return true;
  }

  function pressKey(key, code) {
    // Um único evento que sobe até document/window (disparar em vários alvos
    // faria a tecla contar mais de uma vez e abrir/fechar o painel).
    const opts = { key, code, bubbles: true, cancelable: true };
    const a = document.activeElement;
    const target = a && a !== document.body && !a.closest('#lvlAutoRoot') ? a : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function log(msg) {
    const line = `${new Date().toLocaleTimeString()} ${msg}`;
    console.log('[lvlAuto]', line);
    cfg.log = [line, ...(cfg.log || [])].slice(0, 30);
    saveCfg();
    renderLog();
  }

  // Algum diálogo/janela do jogo bloqueando? (teste de promoção, confirmação, etc.)
  function isBusyScene() {
    const t = norm(document.body.innerText).slice(0, 20000);
    if (visible(document.querySelector('.slHudDeath'))) return true; // morto: espera voltar
    return /teste de promocao em andamento|chefe diario em andamento/.test(t);
  }

  // ---------------------------------------------------------------------------
  // Navegação nos painéis do jogo
  // ---------------------------------------------------------------------------
  // Abre o menu "CAÇADOR" do HUD e escolhe uma entrada pelo texto.
  async function openFromHunterMenu(entryMatch) {
    const menuBtn = findButton((t) => t === 'cacador' || /^cacador\b/.test(t) || /\bcacador$/.test(t));
    if (menuBtn) {
      click(menuBtn);
      const entry = await waitFor(() => findButton(entryMatch), 2500);
      if (entry) { click(entry); return true; }
      pressKey('Escape', 'Escape');
    }
    return false;
  }

  async function openStatus() {
    if (statusOpen()) return true;
    // No IdleDeck (painel estreito) o menu CAÇADOR some e a tecla C simulada
    // não é aceita: o "+N" de pontos (.slHudPoints) e o selo de nível
    // (.slHudSeal) do cartão do personagem abrem o Status direto.
    const hudBtn = [document.querySelector('button.slHudPoints'), document.querySelector('.slHudSeal')]
      .find((el) => visible(el));
    if (hudBtn) {
      click(hudBtn);
      if (await waitFor(statusOpen, 3000)) return true;
    }
    if (!(await openFromHunterMenu((t) => /^status\b/.test(t) && t.includes('atributos')))) {
      pressKey('c', 'KeyC');
    }
    return !!(await waitFor(statusOpen, 4000));
  }
  const statusOpen = () => findButton((t) => t === 'distribuir pela build');

  async function openInventory() {
    if (invOpen()) return true;
    if (!(await openFromHunterMenu((t) => /^inventario\b/.test(t)))) {
      pressKey('i', 'KeyI');
    }
    return !!(await waitFor(invOpen, 4000));
  }
  const invOpen = () => document.querySelector('.slInvBestBtn') && visible(document.querySelector('.slInvBestBtn'))
    ? document.querySelector('.slInvBestBtn')
    : findButton((t) => t === 'equipar melhores');

  // Exército das Sombras: o "Montar melhor time" é o .slShBestBtn da aba Time.
  const armyBestBtn = () => {
    const b = document.querySelector('.slShBestBtn');
    return visible(b) ? b : null;
  };
  const armyOpen = () => armyBestBtn() || [...document.querySelectorAll('.slShTeamGrid, .slShExPill')].find(visible) || null;

  // Itens dos menus do jogo (button.slGmItem com rótulo .slGmItemLabel).
  // labelRe pode ser o id do painel (data-id do item, ex.: 'mail') ou um regex do rótulo.
  const menuItem = (labelRe, needVisible) => [...document.querySelectorAll('button.slGmItem')].find((b) => {
    if (typeof labelRe === 'string') return b.dataset.id === labelRe && (!needVisible || visible(b));
    const lbl = b.querySelector('.slGmItemLabel') || b;
    return labelRe.test(norm(lbl.innerText || lbl.textContent)) && (!needVisible || visible(b));
  }) || null;
  const anyMenuOpen = () => [...document.querySelectorAll('button.slGmItem')].some(visible);
  let menuOpener = null; // botão que abriu o menu (clicar de novo fecha; Escape não fecha)

  // Abre um painel pelo menu do jogo. No layout largo o menu tem abas por categoria
  // ("CAÇADOR", "AVENTURA"...); no estreito (grade do IdleDeck) sobra um ícone
  // dentro de .slHudMenu que abre o menu completo.
  async function openFromGameMenu(labelRe, categoryRe, isOpen, hotkey) {
    if (isOpen()) return true;
    const opener = findButton((t) => categoryRe.test(t))
      || buttons(document.querySelector('.slHudMenu') || document.createElement('div'))[0];
    if (opener) {
      menuOpener = opener;
      click(opener);
      const item = await waitFor(() => menuItem(labelRe, true), 2500);
      if (item) {
        click(item);
        if (await waitFor(isOpen, 4000)) return true;
      }
      if (anyMenuOpen()) { pressKey('Escape', 'Escape'); await sleep(300); }
    }
    // Item do menu já existe, mesmo escondido: o clique dispara o mesmo atalho.
    const hidden = menuItem(labelRe, false);
    if (hidden) {
      hidden.click();
      if (await waitFor(isOpen, 3000)) return true;
    }
    if (hotkey) pressKey(hotkey[0], hotkey[1]);
    return !!(await waitFor(isOpen, 3000));
  }

  const armyMenuItem = (needVisible) => menuItem(/^exercito\b/, needVisible);
  const openArmy = () => openFromGameMenu(/^exercito\b/, /(^|\s)cacador$/, armyOpen, ['h', 'KeyH']);

  // Caçadas: painel com o botão "★ Recomendada" e o "Entrar no portal" da área escolhida.
  const huntRecBtn = () => findButton((t) => t.length < 20 && /recomendada$/.test(t));
  const huntsOpen = () => huntRecBtn();
  const openHunts = () => openFromGameMenu(/^cacadas\b/, /(^|\s)aventura$/, huntsOpen, ['m', 'KeyM']);

  async function closePanels() {
    for (let i = 0; i < 3; i++) {
      if (!statusOpen() && !invOpen() && !armyOpen() && !huntsOpen() && !talOpen() && !rewardsPanelOpen() && !forgeOpen()) break;
      pressKey('Escape', 'Escape');
      await sleep(350);
    }
    // O menu suspenso de categoria (CAÇADOR, AVENTURA...) fecha clicando no botão de novo.
    if (anyMenuOpen() && menuOpener && visible(menuOpener)) {
      click(menuOpener);
      await sleep(300);
    }
  }

  // ---------------------------------------------------------------------------
  // 1) Pontos de atributo pela build
  // ---------------------------------------------------------------------------
  function readFreePoints() {
    const toNum = (s) => Number(String(s).replace(/\./g, ''));
    // Selo "20 PONTOS LIVRES" do painel Status (o outro .slCharFree é o de "pendentes").
    const el = [...document.querySelectorAll('.slCharFree')]
      .find((e) => visible(e) && !e.classList.contains('slCharPendingBadge'));
    if (el) {
      const m = norm(el.innerText).match(/([\d.]+)/);
      if (m) return toNum(m[1]);
    }
    // Reserva: o bloco do topo "PONTOS LIVRES 20 Distribua nos atributos".
    const m = norm(document.body.innerText).match(/pontos livres ([\d.]+) distribua/);
    return m ? toNum(m[1]) : 0;
  }

  // Lista as builds visíveis: [{name, button}]
  function readBuilds() {
    const list = [];
    for (const b of buttons()) {
      if (norm(b.innerText) !== 'distribuir pela build') continue;
      // sobe até o "card" da build (o bloco que tem as porcentagens STR/AGI/...)
      let card = b.parentElement;
      for (let i = 0; i < 6 && card; i++) {
        const txt = card.innerText || '';
        if (/%/.test(txt) && txt.length < 800) break;
        card = card.parentElement;
      }
      const lines = (card ? card.innerText : '').split('\n').map((s) => s.trim()).filter(Boolean);
      const name = lines.find((l) => norm(l) !== 'distribuir pela build') || `Build ${list.length + 1}`;
      list.push({ name, button: b });
    }
    return list;
  }

  async function doPoints() {
    if (!(await openStatus())) { log('Não consegui abrir o Status.'); return; }
    await sleep(500);

    const builds = readBuilds();
    const names = builds.map((b) => b.name);
    if (names.length && JSON.stringify(names) !== JSON.stringify(cfg.knownBuilds)) {
      cfg.knownBuilds = names; saveCfg(); renderBuildSelect();
    }

    const free = readFreePoints();
    if (free < Math.max(1, cfg.minPoints)) { await closePanels(); return; }
    if (!builds.length) { log('Nenhuma build encontrada no Status.'); await closePanels(); return; }

    const chosen = builds.find((b) => norm(b.name) === norm(cfg.buildName))
      || builds.find((b) => isPreferred(b.name)) || builds[0];
    const before = new Set(buttons().filter((b) => norm(b.innerText) === 'distribuir pela build'));
    click(chosen.button);

    // Diálogo de confirmação: um botão "Distribuir pela build" novo, ao lado de "Cancelar".
    const confirm = await waitFor(() =>
      buttons().find((b) => norm(b.innerText) === 'distribuir pela build' && !before.has(b)), 5000);
    if (!confirm) { log('Confirmação da build não apareceu.'); await closePanels(); return; }
    await waitFor(() => !confirm.disabled, 4000);
    await sleep(400);
    click(confirm);
    log(`Distribuí ${free} ponto(s) pela build "${chosen.name}".`);
    await sleep(800);
    await closePanels();
  }

  // ---------------------------------------------------------------------------
  // 2) Equipar melhores
  // ---------------------------------------------------------------------------
  async function doEquip() {
    try { localStorage.setItem(CRITERION_KEY, String(cfg.criterion)); } catch { /* ok */ }
    if (!(await openInventory())) { log('Não consegui abrir o Inventário.'); return; }
    await sleep(400);

    const openBtn = invOpen();
    const before = new Set(buttons().filter((b) => norm(b.innerText) === 'equipar melhores'));
    click(openBtn);

    // Diálogo "Equipar melhores": o botão de aplicar é outro "Equipar melhores", que liga
    // quando a prévia acha peças melhores. Se ficar desligado, já está tudo no melhor.
    const dialog = await waitFor(() => {
      const d = document.querySelector('.slInvBest');
      return d && visible(d) ? d : null;
    }, 4000);
    const apply = await waitFor(() => {
      const root = dialog || document;
      return buttons(root).find((b) => norm(b.innerText) === 'equipar melhores' && !before.has(b) && b !== openBtn);
    }, 4000);

    if (!apply) { log('Diálogo "Equipar melhores" não abriu.'); await closePanels(); return; }

    const enabled = await waitFor(() => (!apply.disabled ? apply : null), 6000);
    if (enabled) {
      await sleep(300);
      click(enabled);
      log('Equipei peças melhores.');
    }
    await sleep(800);
    pressKey('Escape', 'Escape'); // fecha o diálogo, se ainda estiver aberto
    await sleep(300);
    await closePanels();
  }

  // ---------------------------------------------------------------------------
  // 2a) Forja: encanta só as peças VESTIDAS e só quando a tentativa é "Garantido"
  //     (100%, até +5). Acima disso a falha gasta a pedra: isso fica com o jogador.
  // ---------------------------------------------------------------------------
  const forgeOpen = () => visQ('.slForgeTabs');
  const openForge = () => openFromGameMenu(/^forja\b/, /(^|\s)cacador$/, forgeOpen, null);
  const forgeList = () => document.querySelector('.slForgeList');
  const forgeIdle = () => { const l = forgeList(); return l && l.getAttribute('aria-busy') !== 'true' ? l : null; };
  const forgeItems = () => [...(forgeList() ? forgeList().querySelectorAll('.slForgeTile, .slForgeRow') : [])].filter(visible);
  const forgeKey = (b) => b.getAttribute('aria-label') || b.title || norm(b.innerText);

  // Filtros da lista: "Mostrar: Só vestidas" (select nativo) + chip "Só as que ainda sobem".
  function setForgeFilters() {
    let changed = false;
    for (const sel of document.querySelectorAll('.slForgeFilterPanel select')) {
      const opt = [...sel.options].find((o) => norm(o.textContent) === 'so vestidas');
      if (opt && sel.value !== opt.value) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        changed = true;
      }
    }
    const chip = document.querySelector('.slForgeEligible');
    if (chip && chip.getAttribute('aria-pressed') !== 'true') { chip.click(); changed = true; }
    return changed;
  }

  async function doEnchant() {
    if (!(await openForge())) { log('Não consegui abrir a Forja.'); await closePanels(); return; }
    await sleep(500);
    const tab = document.querySelector('button.slForgeTab[data-tab="enchant"]');
    if (tab && !tab.classList.contains('slForgeTabOn')) { click(tab); await sleep(700); }

    // Sem pedra de encanto: nem mexe na lista.
    const stoneEl = visQ('.slForgeCoinStone b');
    if (stoneEl && Number(String(stoneEl.innerText).replace(/\D/g, '') || 0) === 0) { await closePanels(); return; }

    if (setForgeFilters()) await sleep(900);
    await waitFor(forgeIdle, 5000);
    await sleep(400);

    const done = [];
    const skipped = new Set();
    let stop = '';
    for (let guard = 0; guard < 40; guard++) {
      const item = forgeItems().find((b) => !skipped.has(forgeKey(b)));
      if (!item) {
        // Nada nesta página: passa para a próxima ("›" do paginador), se houver.
        const next = [...document.querySelectorAll('.slForgePager button.slPagBtn')].filter(visible).pop();
        if (next && !next.disabled && /›/.test(next.innerText)) {
          click(next);
          await sleep(900);
          await waitFor(forgeIdle, 4000);
          continue;
        }
        break;
      }
      const key = forgeKey(item);
      if (item.getAttribute('aria-pressed') !== 'true') { click(item); await sleep(800); }
      const card = await waitFor(() => visQ('.slForgeAttempt'), 3000);
      const txt = norm(card ? card.innerText : '');
      if (!card || card.classList.contains('slForgeMaxed') || !card.classList.contains('slForgeAttemptSafe') || !/garantido/.test(txt)) {
        skipped.add(key); // já passou do +5 seguro (ou no máximo): não arrisca
        continue;
      }
      if (/sem pedra/.test(txt)) { stop = 'acabou a pedra de encanto'; break; }
      if (/faltam .* de ouro/.test(txt)) { stop = 'falta ouro'; break; }
      const go = card.querySelector('button.slForgeGo');
      if (!go || go.disabled) { skipped.add(key); continue; }
      const target = ((card.closest('.slForgeStage') || document).querySelector('.slForgeNew') || {}).innerText || '';
      click(go);
      done.push(`${key.split(' · ')[0]} ${String(target).trim()}`.trim());
      await sleep(jitter(1800));
      await waitFor(forgeIdle, 4000);
    }
    if (done.length) log(`Forja: encantei ${done.length}x (${done.join(', ')})` + (stop ? ` — parei: ${stop}.` : '.'));
    await closePanels();
  }

  // ---------------------------------------------------------------------------
  // 3) Exército: "Montar melhor time"
  // ---------------------------------------------------------------------------
  async function doTeam() {
    if (!(await openArmy())) { log('Não consegui abrir o Exército.'); await closePanels(); return; }
    await sleep(400);
    // Se o painel abriu em outra aba (Exército/Expedições), volta para "Time".
    if (!armyBestBtn()) {
      const tab = findButton((t) => /^time\b/.test(t));
      if (tab) { click(tab); await waitFor(armyBestBtn, 2500); }
    }
    const best = armyBestBtn();
    if (!best) { log('Botão "Montar melhor time" não apareceu.'); await closePanels(); return; }
    if (best.disabled) log('Time já é o melhor.');
    else { click(best); log('Montei o melhor time do Exército.'); await sleep(1200); }
    if (cfg.shadowTrainee) await trainSlot();
    if (cfg.shadowGear) await gearTeam();
    await closePanels();
  }

  // Cards do time (aba Time): .slShTCard com o número da vaga em .slShTCardSlot; vaga vazia = .slShTCardEmpty.
  const teamCard = (slot) => [...document.querySelectorAll('.slShTeamGrid .slShTCard')]
    .find((c) => norm(c.querySelector('.slShTCardSlot')?.textContent) === String(slot));
  const teamSideBtn = (label) => waitFor(() => [...document.querySelectorAll('.slShTeamSide button')]
    .find((b) => visible(b) && norm(b.innerText) === label), 2000);

  // Multiplicadores fixos da sombra que aparecem no card (wiki: rank, Desperta, Potencial pela
  // qualidade, especialização Monarca). O nível não entra: ele sobe sozinho no time.
  // shortcut: a origem do corpo (×1 a ×2) não aparece no card e fica de fora da conta.
  const RANK_MULT = { normal: 1, elite: 1.25, cavaleiro: 1.6, 'cavaleiro de elite': 2, general: 2.6, marechal: 3.3, 'grande marechal': 4.2 };
  const QUALITY_MULT = { bruta: 1, refinada: 1.1, superior: 1.25, perfeita: 1.35, absoluta: 1.45 };
  function shadowMult(el) {
    const t = (sel) => norm(el.querySelector(sel)?.textContent).replace(/[\d.,]/g, '').trim();
    return (RANK_MULT[t('.slShRank')] || 1) * (QUALITY_MULT[t('.slShQ')] || 1)
      * (el.querySelector('.slShAwake') ? 1.2 : 1) * (el.querySelector('.slShSpecRare') ? 1.05 : 1);
  }

  // Vaga de treino: o "Montar melhor time" olha só o poder de agora, então uma sombra de nível
  // baixo com multiplicadores melhores nunca entra para upar. Troca a vaga 6 pela de fora do time
  // com o maior multiplicador (10% acima da que sai). A lista do jogo mostra as 40 mais fortes.
  async function trainSlot() {
    const last = teamCard(6);
    if (!last || last.classList.contains('slShTCardEmpty')) return; // time incompleto: o "Montar melhor time" resolve
    const outMult = shadowMult(last);
    click(last);
    const rm = await teamSideBtn('tirar do time');
    if (!rm) return;
    click(rm);
    const empty = await waitFor(() => (teamCard(6)?.classList.contains('slShTCardEmpty') ? teamCard(6) : null), 3000);
    if (!empty) return;
    click(empty);
    await waitFor(() => document.querySelector('.slShSwap .slShSwapCard'), 4000);
    const pick = [...document.querySelectorAll('.slShSwap .slShSwapCard')]
      .map((el) => ({ el, mult: shadowMult(el), power: num(el.querySelector('.slShPower')?.textContent) }))
      .filter((c) => c.mult >= outMult * 1.1)
      .sort((a, b) => b.mult - a.mult || b.power - a.power)[0];
    if (pick) { // a lista do jogo já esconde as sombras fora do seu comando
      const name = (pick.el.querySelector('.slShSwapName')?.textContent || 'sombra').trim();
      click(pick.el);
      await waitFor(() => !teamCard(6)?.classList.contains('slShTCardEmpty'), 3000);
      log(`Sombras: ${name} entrou na vaga 6 para treinar (×${pick.mult.toFixed(2)} contra ×${outMult.toFixed(2)}).`);
      return;
    }
    const cancel = [...document.querySelectorAll('.slShSwap button')].find((b) => visible(b) && norm(b.innerText) === 'cancelar');
    if (cancel) { click(cancel); await sleep(400); }
    // Sem sombra melhor: o "Montar melhor time" devolve a vaga 6.
    const best = await waitFor(() => { const b = armyBestBtn(); return b && !b.disabled ? b : null; }, 2000);
    if (best) { click(best); await sleep(1200); }
  }

  // "Equipar melhores" de cada sombra do time (só funciona com a sombra no time).
  async function gearTeam() {
    let done = 0;
    for (let slot = 1; slot <= 6; slot++) {
      const card = teamCard(slot);
      if (!card || card.classList.contains('slShTCardEmpty')) continue;
      click(card);
      const btn = await waitFor(() => [...document.querySelectorAll('.slShTeamSide section.slShEquip button')]
        .find((b) => visible(b) && norm(b.innerText) === 'equipar melhores'), 2000);
      if (!btn || btn.disabled) continue;
      click(btn);
      done++;
      await sleep(jitter(800));
    }
    if (done) log(`Sombras: rodei "Equipar melhores" em ${done} sombra(s) do time.`);
  }

  // ---------------------------------------------------------------------------
  // 3a) Recompensas: Missões, Recompensa Diária, Correio e Expedições de Sombras
  // ---------------------------------------------------------------------------
  const visQ = (sel) => [...document.querySelectorAll(sel)].find(visible) || null;
  const msnOpen = () => visQ('.slMsnDaily, .slMsnJourney, .slMsnCards');
  const dailyOpen = () => visQ('.drwToday');
  const mailOpen = () => visQ('.slMailClaimAll, .slMailSummary');
  const rewardsPanelOpen = () => msnOpen() || dailyOpen() || mailOpen();
  const openMissions = () => openFromGameMenu('missions', /(^|\s)cacador$/, msnOpen, ['j', 'KeyJ']);
  const openMail = () => openFromGameMenu('mail', /(^|\s)social$/, mailOpen, null);
  async function openDaily() {
    if (dailyOpen()) return true;
    const chatBtn = visQ('button.slChatDaily'); // botão "DIÁRIA" do chat
    if (chatBtn) { click(chatBtn); if (await waitFor(dailyOpen, 3000)) return true; }
    return openFromGameMenu('daily', /(^|\s)aventura$/, dailyOpen, null);
  }

  async function doMissions() {
    if (!(await openMissions())) { log('Não consegui abrir as Missões.'); await closePanels(); return; }
    await sleep(600);
    let n = 0;
    // A Jornada passa para o próximo passo depois de cada resgate: repete enquanto houver.
    for (let i = 0; i < 12; i++) {
      const b = buttons(document).find((x) => !x.disabled && x.closest('.slMsnActions, .slMsnCard')
        && /^resgatar\b/.test(norm(x.innerText)));
      if (!b) break;
      click(b); n++;
      await sleep(jitter(1100));
    }
    if (n) log(`Missões: resgatei ${n} recompensa(s).`);
    await closePanels();
  }

  async function doDaily() {
    if (!(await openDaily())) { await closePanels(); return; } // diária pode não existir (nível baixo / pausada)
    await sleep(500);
    const b = visQ('button.drwClaim');
    if (b && !b.disabled) {
      click(b);
      log('Recompensa Diária resgatada (vai para o Correio).');
      await sleep(1500);
      mailSoon = Date.now() + 45000; // a correspondência chega em seguida: volta ao Correio em ~1 min
    }
    await closePanels();
  }

  async function doMail() {
    if (!(await openMail())) { log('Não consegui abrir o Correio.'); await closePanels(); return; }
    // O botão fica desligado enquanto a lista carrega: espera ele ligar (ou desiste em 6 s = nada a reivindicar).
    const b = await waitFor(() => {
      const x = visQ('button.slMailClaimAll');
      return x && !x.disabled && !/reivindicando/.test(norm(x.innerText)) ? x : null;
    }, 6000);
    await sleep(500);
    if (b && !b.disabled) {
      click(b);
      await waitFor(() => visQ('.slMailResult'), 5000);
      const r = visQ('.slMailResult');
      log('Correio: reivindiquei tudo.' + (r && r.classList.contains('slMailResultWarn') ? ' (mochila cheia: parte ficou lá)' : ''));
      await sleep(800);
    }
    await closePanels();
  }

  // Expedições: aba "Expedições" do Exército. Coleta as que voltaram e manda Sombras
  // do ARMAZÉM (nunca as do time) para as vagas livres, no destino mais alto que a
  // Sombra aguenta (o jogo desliga o "Enviar Sombra" quando ela é fraca demais).
  async function closeExpReport() {
    const modal = await waitFor(() => visQ('.slShExReportModal'), 2500);
    if (!modal) return;
    const box = modal.closest('[role="dialog"], .slModal') || modal.parentElement || modal;
    const close = buttons(box).find((x) => /^(fechar|ok|entendi|continuar)\b/.test(norm(x.innerText)));
    if (close) click(close); else pressKey('Escape', 'Escape');
    await sleep(500);
  }

  function expSlots() {
    const pill = [...document.querySelectorAll('.slShExPill')].filter(visible)
      .map((p) => norm(p.innerText).match(/em expedicao\s*(\d+)\s*\/\s*(\d+)/)).find(Boolean);
    return pill ? { away: Number(pill[1]), total: Number(pill[2]) } : null;
  }
  const expSend = () => visQ('button.slShExSend');

  async function doExpeditions() {
    if (!(await openArmy())) { log('Não consegui abrir o Exército.'); await closePanels(); return; }
    await sleep(400);
    if (!expSlots()) {
      const tab = findButton((t) => /^expedicoes\b/.test(t));
      if (!tab) { await closePanels(); return; } // nível baixo ou expedição desligada
      click(tab);
      await waitFor(expSlots, 3000);
    }
    if (!expSlots()) { await closePanels(); return; }
    await sleep(500);

    const collect = findButton((t) => /^coletar tudo\b/.test(t));
    if (collect) {
      click(collect);
      log('Expedições: coletei as que voltaram.');
      await closeExpReport();
      await sleep(600);
    }

    // Filtro "Armazém" para nunca mandar Sombra do time.
    const storTab = findButton((t) => /^armazem\b/.test(t));
    if (storTab) { click(storTab); await sleep(500); }

    let sent = 0;
    const tried = new Set();
    for (let guard = 0; guard < 8; guard++) {
      const s = expSlots();
      if (!s || s.away >= s.total) break;
      const cand = [...document.querySelectorAll('.slShExCand')].filter(visible)
        .find((c) => !tried.has(c.dataset.uid) && /armazem/.test(norm(c.innerText)));
      if (!cand) break;
      tried.add(cand.dataset.uid);
      click(cand);
      await sleep(900);
      let send = expSend();
      const ok = () => { send = expSend(); return send && !send.disabled; };
      // Tenta as dificuldades do destino atual (da mais difícil para a mais fácil);
      // se nenhuma servir, tenta os outros destinos abertos, do mais alto para o mais baixo.
      async function tryDifs() {
        const difs = [...document.querySelectorAll('.slShExDifs button.slShExSeg')].filter((b) => visible(b) && !b.disabled);
        for (const d of difs.reverse()) {
          click(d);
          await sleep(900);
          if (ok()) return true;
        }
        return false;
      }
      if (!ok() && !(await tryDifs())) {
        const gates = [...document.querySelectorAll('.slShExGates button')].filter((b) => visible(b) && !b.disabled);
        for (const g of gates.reverse()) {
          click(g);
          await sleep(900);
          if (ok() || (await tryDifs())) break;
        }
      }
      if (!send || send.disabled) continue; // fraca demais para qualquer destino aberto
      click(send);
      sent++;
      await sleep(jitter(1400));
    }
    if (sent) log(`Expedições: mandei ${sent} Sombra(s) do Armazém.`);
    // Volta o Exército para a aba "Time" (o "Montar melhor time" depende dela).
    const teamTab = findButton((t) => /^time\b/.test(t));
    if (teamTab) { click(teamTab); await sleep(300); }
    await closePanels();
  }

  // ---------------------------------------------------------------------------
  // 3b) Talentos: segue o plano da build (talent-plans.js, gerado da wiki oficial)
  // ---------------------------------------------------------------------------
  // A árvore é um SVG: cada nó é um g.slTalNode com data-senda, data-estado
  // (complete | progress | available | locked), data-fechado (escolha/ramo fechado)
  // e o rótulo "a/b" ou "MAX". Duplo clique no nó aprende 1 nível, sem confirmação.
  const PLANS = window.__lvlTalentPlans || null;
  const TREE_OF = window.__lvlTalentTree || {};
  const TAL_NAME = window.__lvlTalentName || {};
  const CLASS_TREES = ['guerreiro', 'assassino', 'mago', 'arqueiro', 'healer'];

  const talTabs = () => [...document.querySelectorAll('.slTalTab')].filter(visible);
  const talOpen = () => (talTabs().length ? talTabs()[0] : null);
  const openTalents = () => openFromGameMenu(/^talentos\b/, /(^|\s)cacador$/, talOpen, ['k', 'KeyK']);

  // Pontos para gastar: o título das abas diz "N ponto(s) para gastar" (os pontos valem para todas).
  function talPoints() {
    for (const t of talTabs()) {
      const m = norm(t.getAttribute('title') || '').match(/(\d+) ponto/);
      if (m) return Number(m[1]);
    }
    return 0;
  }
  const talClass = () => {
    const t = talTabs().map((b) => b.dataset.senda).find((s) => CLASS_TREES.includes(s));
    return t || null;
  };

  function talNode(id) {
    for (const g of document.querySelectorAll('g.slTalNode')) {
      const img = g.querySelector('image.slTalSprite');
      const href = (img ? img.getAttribute('href') || '' : '').split('?')[0];
      if (href.endsWith(`/${id}.png`)) return g;
    }
    return null;
  }
  function talLevel(g) {
    if (!g) return null;
    if (g.getAttribute('data-estado') === 'complete') return 99;
    const lbl = g.querySelector('.slTalLevel');
    const m = (lbl ? lbl.textContent : '').match(/(\d+)\s*\/\s*\d+/);
    if (m) return Number(m[1]);
    return g.getAttribute('data-estado') === 'progress' ? 1 : 0;
  }

  // Uma aba pode mostrar mais de uma senda (a da classe vem junto com a Fundação),
  // então procura o nó na aba aberta e, se não estiver, passa pelas outras abas.
  async function talFind(id) {
    let g = talNode(id);
    if (g) return g;
    const tree = TREE_OF[id];
    const tabs = talTabs();
    const ordered = [...tabs.filter((b) => b.dataset.senda === tree), ...tabs.filter((b) => b.dataset.senda !== tree)];
    for (const tab of ordered) {
      if (tab.getAttribute('aria-selected') === 'true') continue;
      click(tab);
      g = await waitFor(() => talNode(id), 1500);
      if (g) { await sleep(250); return talNode(id); }
    }
    return null;
  }

  function talPlanFor(cls) {
    const list = PLANS && PLANS[cls];
    if (!list || !list.length) return null;
    const want = cfg.talentBuild || cfg.buildName;
    return list.find((p) => norm(p.build) === norm(want)) || list.find((p) => isPreferred(p.build)) || list[0];
  }

  async function doTalents() {
    if (!PLANS) return;
    // Só abre a árvore quando há pontos: o HUD marca o menu com "pontos" pendentes,
    // mas o jeito garantido é ler o título das abas com o painel aberto.
    if (!(await openTalents())) { log('Não consegui abrir os Talentos.'); await closePanels(); return; }
    await sleep(500);
    let points = talPoints();
    const cls = talClass();
    const plan = cls && talPlanFor(cls);
    if (!plan) { log('Não achei o plano de talentos da classe.'); await closePanels(); return; }
    if (cfg.talentPlanSeen !== plan.build) { cfg.talentPlanSeen = plan.build; saveCfg(); renderTalentSelect(); }
    if (points < 1) { await closePanels(); return; }

    const learned = [];
    let stop = '';
    for (const step of plan.passos) {
      if (points < 1) break;
      const [id, lvlStr] = step.split(':');
      const target = Number(lvlStr);
      let g = await talFind(id);
      if (!g) continue;
      let lvl = talLevel(g);
      while (lvl < target && points > 0) {
        if (g.hasAttribute('data-fechado') || g.getAttribute('data-estado') === 'locked') break; // fechado: pula
        g.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        const ok = await waitFor(() => {
          const ng = talNode(id);
          return ng && talLevel(ng) > lvl ? ng : null;
        }, 3000, 200);
        if (!ok) { stop = `faltam pontos para ${TAL_NAME[id] || id}`; break; }
        g = ok;
        lvl = talLevel(g);
        learned.push(id);
        await sleep(jitter(350));
        points = talPoints();
      }
      if (stop) break;
    }
    if (learned.length) {
      const counts = {};
      for (const id of learned) counts[id] = (counts[id] || 0) + 1;
      log(`Talentos (${plan.build}): ${Object.entries(counts).map(([k, v]) => `${TAL_NAME[k] || k} +${v}`).join(', ')}.`);
    } else if (stop && points >= 1) {
      log(`Talentos: ${stop}`);
    }
    await sleep(500);
    await closePanels();
  }

  // ---------------------------------------------------------------------------
  // 4) Caçadas: ir para a área "Recomendada" pelo jogo
  // ---------------------------------------------------------------------------
  const CONFIRM_WORDS = /^(confirmar|entrar|sim|continuar|ok|trocar|ir)( |$)/;

  async function doHunt() {
    // Lê a party antes de abrir o painel: na grade do IdleDeck o painel cobre os quadros.
    const party = partyLevels();
    const own0 = ownLevel();

    // Em party só o líder escolhe a área (os outros vão junto). Quem não é líder só volta para
    // a caçada do grupo: o jogo mostra "Ir para a caçada do grupo" quando você está fora dela.
    if (party.length && partyLeaderIsOther()) {
      const go = [...document.querySelectorAll('button.slPdmGo')].find(visible);
      if (go) { await clickConfirm(go); log('Party: voltei para a caçada do grupo.'); }
      return;
    }

    // Abre as Caçadas na aba "Caçadas" e espera a trilha (ou o "Recomendada") aparecer.
    const openList = async () => {
      if (!(await openHunts())) return false;
      await sleep(500);
      const tab = findButton((t) => t === 'cacadas'); // se abriu em Masmorras, Fenda...
      if (tab) { click(tab); await sleep(400); }
      await waitFor(() => huntAreaNodes().length || huntRecBtn(), 2500);
      await showTrail();
      return true;
    };
    if (!(await openList())) { log('Não consegui abrir as Caçadas.'); await closePanels(); return; }

    // Trava de morte ativa: usa a trilha com o limite 5 níveis abaixo (uma área a menos).
    const guardOn = cfg.deathGuard && Date.now() < (cfg.huntPauseUntil || 0);

    // Escolhe uma área da trilha, reabrindo a lista se a ficha de outra área tomou o lugar dela.
    const selectNode = async (w) => {
      await showTrail();
      let n = huntAreaNodes().find((x) => x.start === w.start && x.end === w.end);
      if (!n) {
        await closePanels();
        if (!(await openList())) return null;
        n = huntAreaNodes().find((x) => x.start === w.start && x.end === w.end);
        if (!n) return null;
      }
      click(n.el);
      await sleep(800);
      return selectedAreaState();
    };

    if (!party.length && !guardOn) {
      // Sozinho: segue a "Recomendada" do jogo (ou a área logo abaixo, se ela render mais EXP/h).
      const nodes = huntAreaNodes(); // lê antes de clicar: na grade a ficha toma o lugar da trilha
      const rec = huntRecBtn();
      if (!rec) { log('Botão "Recomendada" não apareceu.'); await closePanels(); return; }
      click(rec);
      await sleep(900);
      const st = selectedAreaState();
      if (DEBUG) log(`[caçada] sem party; recomendada: ${st}`);
      const R = nodes.find((n) => n.rec) || (st === 'current' ? nodes.find((n) => n.state === 'live') : null); // ★ só aparece fora da atual
      if (cfg.expCompare && R && (await compareLower(nodes, R, selectNode))) return;
      if (st === 'enter') { await enterSelectedArea('recomendada'); return; }
      if (st === 'precision') log('Área recomendada pede mais Precisão; fiquei na atual.');
      await closePanels();
      return;
    }

    // Em party: a área tem que abrir para todo mundo, então o limite é o menor nível
    // entre você e os membros. A trilha já diz qual é a atual (live) e quais estão
    // trancadas (locked). Lê tudo ANTES de clicar: na grade, ao escolher uma área o
    // painel troca a trilha pela ficha dela.
    const own = own0 || ownLevel();
    const cap = Math.min(own || Infinity, ...party) - (guardOn ? 5 : 0);
    if (!Number.isFinite(cap)) { log('Não consegui ler o meu nível nas Caçadas.'); await closePanels(); return; }
    const nodes = huntAreaNodes();
    const live = nodes.find((n) => n.state === 'live');
    const wanted = nodes.filter((n) => n.start <= cap && n.state !== 'locked').sort((a, b) => b.start - a.start);
    if (DEBUG) log(`[caçada] party ${party.join(',')}; eu ${own}; limite ${cap}; atual ${live ? `${live.start}-${live.end}` : '?'}; opções ${wanted.map((n) => `${n.start}-${n.end}`).join(' ') || 'nenhuma'}`);
    if (!nodes.length) { log('Não achei a trilha de áreas nas Caçadas.'); await closePanels(); return; }
    // Líder: compara a melhor área da party com a logo abaixo (o EXP/h do líder sobe e desce junto com o do grupo).
    if (cfg.expCompare && !guardOn && wanted[0] && (await compareLower(nodes, wanted[0], selectNode))) return;

    for (const w of wanted) {
      if (w.state === 'live') { await closePanels(); return; } // a melhor área possível já é a atual
      const st = await selectNode(w);
      if (DEBUG) log(`[caçada] ${w.start}-${w.end}: ${st}`);
      if (st === 'current') { await closePanels(); return; }
      if (st === 'enter') {
        await enterSelectedArea(guardOn
          ? `trava de morte até ${new Date(cfg.huntPauseUntil).toLocaleTimeString()}`
          : `menor nível da party: ${cap}`);
        return;
      }
      // null, 'locked' ou 'precision': tenta a próxima área abaixo.
    }
    log(`Nenhuma área até o Nv ${cap}${guardOn ? ' (trava de morte)' : ' (menor da party)'} está aberta para mim.`);
    await closePanels();
  }

  // EXP/h: mede a área R (a Recomendada ou, em party, a melhor que abre para todos) e a logo
  // abaixo (expSampleMin cada, uma rodada por vez) e fica na que render mais. Mede de novo
  // quando R muda ou a cada 4 h. Devolve true quando já resolveu a rodada; false = fluxo normal.
  const EXP_RETEST_MS = 4 * 3600000;
  const EXP_MARGIN = 0.1; // a de baixo precisa render 10% a mais: o HUD arredonda o EXP/h
  async function compareLower(nodes, R, selectNode) {
    const key = (n) => `${n.start}-${n.end}`;
    const live = nodes.find((n) => n.state === 'live');
    const L = nodes.filter((n) => n.start < R.start && n.state !== 'locked').sort((a, b) => b.start - a.start)[0];
    if (!L) return false;
    let t = cfg.expTest;
    if (!t || t.rec !== key(R) || t.low !== key(L) || Date.now() - t.at > EXP_RETEST_MS) {
      t = cfg.expTest = { rec: key(R), low: key(L), at: Date.now(), enteredAt: 0 };
    }
    const here = live && key(live);
    const r = huntRate();
    if (!t.win && here && !r && !t.noRate) { t.noRate = true; log('EXP/h: não achei o EXP/h do Auto-Helper no HUD; fico na área de cima.'); }
    if (!t.win && r && r.secs >= cfg.expSampleMin * 60) {
      // O relógio tem que ter começado depois da nossa última troca de área.
      if (t.enteredAt && r.secs > (Date.now() - t.enteredAt) / 1000 + 120) {
        t.win = t.rec;
        log('EXP/h: o relógio do Auto-Helper não zerou ao trocar de área; fico na área de cima.');
      } else if (here === t.rec && t.recXph == null) t.recXph = r.xph;
      else if (here === t.low && t.lowXph == null) t.lowXph = r.xph;
      if (t.recXph != null && t.lowXph != null) {
        t.win = t.lowXph > t.recXph * (1 + EXP_MARGIN) ? t.low : t.rec;
        log(`EXP/h: ${t.rec} = ${fmtCompact(t.recXph)}, ${t.low} = ${fmtCompact(t.lowXph)}. Fico na ${t.win}.`);
      }
    }
    saveCfg();
    const goal = t.win || (t.recXph == null || !r ? t.rec : t.low);
    if (here === goal) { await closePanels(); return true; }
    const toR = goal === t.rec;
    if ((await selectNode(toR ? R : L)) !== 'enter') {
      if (toR) return false; // R pede Precisão ou está selada: segue o fluxo normal
      t.win = t.rec; saveCfg(); // a de baixo não abre para mim: volta para R já
      await closePanels(); lastHunt = 0;
      return true;
    }
    t.enteredAt = Date.now(); saveCfg();
    await enterSelectedArea(`${toR ? 'área melhor' : 'área de baixo'}, ${t.win ? 'mais EXP/h' : 'medindo EXP/h'}`);
    return true;
  }

  // EXP/h e tempo da caçada atual no HUD do Auto-Helper (navegador: .slHudAh; app desktop:
  // .slStripAuto). O jogo mostra o número compacto ("345,2 mil", "1,2 mi") e o relógio hh:mm:ss.
  function huntRate() {
    const strip = document.querySelector('section.slStripAuto');
    const rows = strip ? [...strip.querySelectorAll('.slStripAutoStats > div')] : [];
    const row = rows.find((d) => /^(exp|xp) ?\/ ?h/.test(norm(d.querySelector('dt')?.textContent))) || rows[3]; // ordem fixa: ouro, ouro/h, EXP, EXP/h
    const pairs = [
      [document.querySelector('.slHudAhRateVal'), document.querySelector('.slHudAhTime')],
      [row && row.querySelector('dd'), strip && strip.querySelector('.slStripAutoClock')],
    ];
    for (const [v, c] of pairs) {
      const xph = v ? parseCompact(v.textContent) : null;
      const secs = c ? parseClock(c.textContent) : null;
      if (xph != null && secs != null) return { xph, secs };
    }
    return null;
  }
  function parseCompact(text) {
    const m = norm(text).replace(/\s/g, '').match(/^([\d.,]+)(mil|mi|bi|tri|k|m|b|t)?$/);
    if (!m) return null;
    const n = m[2] ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, ''); // com sufixo, o separador é decimal
    const mult = { mil: 1e3, k: 1e3, mi: 1e6, m: 1e6, bi: 1e9, b: 1e9, tri: 1e12, t: 1e12 }[m[2]] || 1;
    return Number.isFinite(Number(n)) ? Math.round(Number(n) * mult) : null;
  }
  function parseClock(text) {
    const m = String(text || '').trim().match(/^(\d+):(\d\d):(\d\d)$/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  }
  const fmtCompact = (n) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  console.assert(parseCompact('345,2 mil') === 345200 && parseCompact('1,2 mi') === 1200000 && parseCompact('1.5M') === 1500000
    && parseCompact('950') === 950 && parseCompact('—') === null && parseClock('01:02:03') === 3723 && parseClock('--:--:--') === null,
  '[leveling-idle-auto] leitor do EXP/h quebrou');

  // Na grade, ao escolher uma área a ficha dela toma o lugar da trilha (e o painel
  // reabre nela). O ✕ da ficha (button.slAtlasClose, "Voltar") traz a trilha de volta.
  async function showTrail() {
    if (huntAreaNodes().length) return true;
    const back = [...document.querySelectorAll("button.slAtlasClose")].find(visible);
    if (!back) return false;
    click(back);
    return !!(await waitFor(() => huntAreaNodes().length, 2500));
  }

  // Os quadros da party são dos outros membros; a coroa (.slPartyCrown) marca o líder.
  const partyLeaderIsOther = () => [...document.querySelectorAll('.slPartyFrame')].some((f) => visible(f) && f.querySelector('.slPartyCrown'));

  // Níveis dos outros membros da party (HUD: um .slPartyFrame por membro, com "Nv N").
  function partyLevels() {
    return [...document.querySelectorAll('.slPartyFrame')].filter(visible)
      .map((f) => { const m = norm(f.innerText).match(/\bnv\.? ?(\d+)/); return m ? Number(m[1]) : null; })
      .filter((n) => n !== null);
  }

  // Seu nível: o selo "Nível N" do painel Caçadas, o selo do cartão ou o texto do cartão.
  function ownLevel() {
    const chip = [...document.querySelectorAll('div, span, b, strong, small')].filter(visible)
      .find((e) => /^nivel \d+$/.test(norm(e.innerText)));
    if (chip) return Number(norm(chip.innerText).match(/\d+/)[0]);
    const seal = document.querySelector('.slHudSeal');
    const m = seal && norm(seal.innerText).match(/\d+/);
    return m ? Number(m[0]) : readLevel();
  }

  // Áreas da trilha das Caçadas: cada uma é um button.slAtlasNode, com o nível em
  // .slAtlasNodeLv / aria-label ("Orc Jovem · 21-25") e data-state = live (atual),
  // available ou locked.
  function huntAreaNodes() {
    return [...document.querySelectorAll('button.slAtlasNode')]
      .filter((b) => b.isConnected && b.getClientRects().length)
      .map((b) => {
        const lv = b.querySelector('.slAtlasNodeLv');
        const t = `${lv ? lv.textContent : ''} ${b.getAttribute('aria-label') || ''}`;
        const m = t.match(/(\d+)\s*[^\d\s]{1,3}\s*(\d+)/);
        return m ? { el: b, start: Number(m[1]), end: Number(m[2]), state: b.dataset.state || '', rec: !!b.querySelector('.slAtlasStar') } : null;
      })
      .filter(Boolean);
  }

  // Estado da área selecionada no detalhe das Caçadas.
  function selectedAreaState() {
    // Outra área aberta: o detalhe tem "Entrar no portal".
    const enter = findButton((t) => t === 'entrar no portal');
    if (enter) {
      if (enter.disabled) return 'locked';
      if ([...document.querySelectorAll('.slHuntAccBad')].some(visible)) return 'precision';
      return 'enter';
    }
    // Sem "Entrar no portal": ou está selada ("Portal selado") ou é a área atual
    // (o detalhe troca o botão por "Sair da caçada"). Não dá para contar os
    // "Sair da caçada": na grade o HUD tem mais um com o mesmo nome.
    const sealed = [...document.querySelectorAll('div, span, b, strong, p')].filter(visible)
      .some((e) => e.children.length === 0 && norm(e.innerText) === 'portal selado');
    return sealed ? 'locked' : 'current';
  }

  // Clica e, se o jogo pedir confirmação (party, etc.), confirma só no diálogo novo.
  async function clickConfirm(btn) {
    const before = new Set(buttons());
    click(btn);
    await sleep(1200);
    const confirm = buttons().find((b) => !before.has(b) && CONFIRM_WORDS.test(norm(b.innerText)));
    if (confirm) {
      const box = confirm.closest('[role="dialog"], [class*="Modal"], [class*="Confirm"], [class*="Dialog"]');
      const msg = norm(box ? box.innerText : '').slice(0, 140);
      click(confirm);
      log(`Confirmei troca de área${msg ? ` ("${msg}")` : ''}.`);
      await sleep(1200);
    }
  }

  async function enterSelectedArea(why) {
    const enter = findButton((t) => t === 'entrar no portal');
    // Nome da área: o título logo acima da linha "Portal Azul · Nv 21-25" do detalhe.
    const title = (() => {
      const sub = [...document.querySelectorAll('div, span, small, p')].filter(visible)
        .find((e) => e.children.length === 0 && /^portal .+ nv \d+\s*[-–]\s*\d+$/.test(norm(e.innerText).replace(/[·•]/g, '')));
      const prev = sub && (sub.previousElementSibling || sub.parentElement.previousElementSibling);
      const name = prev ? (prev.innerText || '').trim() : '';
      const where = sub ? (sub.innerText || '').trim() : '';
      return name && name.length < 40 ? `${name} (${where})` : (where || 'área nova');
    })();

    await clickConfirm(enter);
    log(`Fui para ${title} (${why}).`);
    await sleep(800);
    await closePanels();
  }


  // ---------------------------------------------------------------------------
  // 9) Loja do Brok: só abre falando com ele na cidade. O caçador sempre aparece no
  // mesmo ponto ao sair da caçada (na escada, debaixo do portal); dali o Brok fica
  // embaixo e à esquerda. Anda com as setas, aperta E e, se a loja não abrir, procura
  // em volta. Depois volta para a caçada pela rotina normal de área.
  // ---------------------------------------------------------------------------
  function inHunt() {
    const b = document.querySelector('button.slHudQbLeave');
    return !!b && !b.hidden && visible(b);
  }
  function shopOpen() { return [...document.querySelectorAll('.slShopCard')].some(visible); }
  async function walk(code, ms) {
    const o = { key: code, code, bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent('keydown', o));
    await sleep(ms);
    window.dispatchEvent(new KeyboardEvent('keyup', o));
    await sleep(150);
  }
  async function talk() {
    const o = { key: 'e', code: 'KeyE', bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent('keydown', o));
    window.dispatchEvent(new KeyboardEvent('keyup', o));
    return !!(await waitFor(shopOpen, 1300));
  }
  const num = (t) => Number(String(t || '').replace(/[^\d]/g, '')) || 0;
  function shopGold() {
    const p = [...document.querySelectorAll('.slShopPurse')].find((e) => visible(e) && !/Dia|Golden/.test(e.className));
    return p ? num(p.innerText) : 0;
  }
  function shopCard(name) {
    return [...document.querySelectorAll('.slShopCard')].filter(visible).find((c) => {
      const s = c.querySelector('.slShopName strong');
      return s && norm(s.innerText) === norm(name);
    }) || null;
  }
  const ownedOf = (c) => num((c.querySelector('.slShopOwned') || {}).innerText);
  const priceOf = (c) => num(((c.querySelector('.slShopPrice') || {}).innerText || '').split(/cada/i)[0]);

  async function buyItem(name, target) {
    let bought = 0;
    for (let i = 0; i < 40; i++) {
      const card = shopCard(name);
      if (!card) { if (!i) log(`Loja: não achei "${name}".`); break; }
      const have = ownedOf(card), price = priceOf(card);
      const need = target - have;
      if (need <= 0 || !price) break;
      const afford = Math.floor((shopGold() - cfg.shopGoldReserve) / price);
      const qty = [50, 10, 1].find((q) => q <= need && q <= afford);
      if (!qty) { if (afford < 1) log(`Loja: ouro no limite da reserva (${cfg.shopGoldReserve}); parei em ${name}.`); break; }
      const chip = [...card.querySelectorAll('.slShopQuick button')].find((b) => num(b.innerText) === qty);
      if (!chip) break;
      click(chip);
      await sleep(250);
      const before = new Set(buttons());
      click(card.querySelector('.slShopBuy'));
      const ok = await waitFor(() => buttons().find((b) => !before.has(b) && /^(adquirir|comprar)\b/.test(norm(b.innerText))), 3000);
      if (!ok) break;
      click(ok);
      const got = await waitFor(() => { const c = shopCard(name); return c && ownedOf(c) > have; }, 5000);
      if (!got) break;
      bought += qty;
      await sleep(300);
    }
    return bought;
  }

  async function doShop() {
    cfg.lastShop = Date.now();
    saveCfg();
    await closePanels();
    if (inHunt()) {
      const leave = document.querySelector('button.slHudQbLeave');
      const before = new Set(buttons());
      click(leave);
      const ok = await waitFor(() => buttons().find((b) => !before.has(b) && /^sair da cacada\b/.test(norm(b.innerText))), 4000);
      if (!ok) { log('Loja: não consegui sair da caçada.'); return; }
      click(ok);
      if (!(await waitFor(() => !inHunt(), 8000))) { log('Loja: a caçada não fechou.'); return; }
      await sleep(3000); // cena da cidade carregando
    }
    // Rota a partir do ponto de chegada: ~2,1 s para baixo e ~1,5 s para a esquerda.
    await walk('ArrowDown', 2100);
    await walk('ArrowLeft', 1500);
    let open = await talk();
    const search = [['ArrowLeft', 300], ['ArrowRight', 600], ['ArrowLeft', 300], ['ArrowUp', 300], ['ArrowDown', 600],
      ['ArrowUp', 300], ['ArrowLeft', 600], ['ArrowDown', 300], ['ArrowRight', 1200], ['ArrowUp', 600], ['ArrowLeft', 1200]];
    for (const [k, ms] of search) {
      if (open) break;
      await walk(k, ms);
      open = await talk();
    }
    if (!open) { log('Loja: não achei o Brok (voltei para a caçada).'); lastHunt = 0; await doHunt(); return; }
    await sleep(500);
    const tab = findButton((t) => /^consumiveis\b/.test(t));
    if (tab) { click(tab); await sleep(400); }
    const all = findButton((t) => /^todos\b/.test(t));
    if (all) { click(all); await sleep(400); }
    const done = [];
    for (const [name, target] of [['Poção Grande', cfg.shopHp], ['Poção de Mana Grande', cfg.shopMp], ['Reviver Grande', cfg.shopRevive]]) {
      if (!(target > 0)) continue;
      const n = await buyItem(name, target);
      if (n) done.push(`${n} ${name}`);
    }
    log(done.length ? `Loja do Brok: comprei ${done.join(', ')}.` : 'Loja do Brok: estoque já estava completo.');
    pressKey('Escape', 'Escape');
    await sleep(500);
    if (shopOpen()) { pressKey('Escape', 'Escape'); await sleep(400); }
    lastHunt = 0;
    await doHunt();
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  let running = false;
  let lastLevel = null;
  let lastEquip = 0;
  let lastPoints = 0;
  let lastTeam = 0;
  let lastHunt = 0;
  let lastTalents = 0;
  let lastRewards = 0;
  let lastMail = 0;
  let lastExped = 0;
  let lastEnchant = 0;
  let mailSoon = 0;

  function readLevel() {
    const card = document.querySelector('.slHudCard');
    const t = norm(card ? card.innerText : '');
    const m = t.match(/nivel (\d+)/);
    return m ? Number(m[1]) : null;
  }

  function userIsTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) && !a.closest('#lvlAutoRoot');
  }

  async function tick(force = false) {
    if (running || (!cfg.enabled && !force)) return;
    if (!document.querySelector('.slHudCard')) return; // ainda não entrou no jogo
    if (userIsTyping() || isBusyScene()) return;
    running = true;
    setStatus('trabalhando…');
    try {
      const now = Date.now();
      const lvl = readLevel();
      const levelUp = lvl !== null && lastLevel !== null && lvl > lastLevel;
      if (lvl !== null) lastLevel = lvl;
      // O "+N" do cartão (.slHudPoints) só aparece com pontos livres: é o sinal
      // mais confiável (no IdleDeck o cartão compacto nem mostra "Nível N").
      // Espera 1 min entre tentativas para não ficar em loop se algo falhar.
      const pendingBtn = document.querySelector('button.slHudPoints');
      const hasPending = visible(pendingBtn) && Number((pendingBtn.innerText.match(/\d+/) || [0])[0]) >= Math.max(1, cfg.minPoints);
      const pointsDue = hasPending && now - lastPoints > 60000;

      if (cfg.autoPoints && (force || levelUp || pointsDue || now - lastPoints > cfg.pointsEveryMin * 60000)) {
        lastPoints = now;
        await doPoints();
      }
      if (cfg.autoTalents && (force || now - lastTalents > cfg.talentsEveryMin * 60000)) {
        lastTalents = now;
        await doTalents();
      }
      if (cfg.autoEquip && (force || levelUp || now - lastEquip > cfg.equipEveryMin * 60000)) {
        lastEquip = now;
        await doEquip();
      }
      if (cfg.autoTeam && (force || now - lastTeam > cfg.teamEveryMin * 60000)) {
        lastTeam = now;
        await doTeam();
      }
      // Forja antes das Missões: "Encante um item até +1" já sai resgatado na mesma rodada.
      if (cfg.autoEnchant && (force || now - lastEnchant > cfg.enchantEveryMin * 60000)) {
        lastEnchant = now;
        await doEnchant();
      }
      // Expedições antes das Missões: enviar uma conta para o objetivo diário "Envie 1 expedição".
      if (cfg.autoExped && (force || now - lastExped > cfg.expedEveryMin * 60000)) {
        lastExped = now;
        await doExpeditions();
      }
      if (cfg.autoRewards && (force || now - lastRewards > cfg.rewardsEveryMin * 60000)) {
        lastRewards = now;
        await doMissions();
        await doDaily();
      }
      if (cfg.autoRewards && (force || (mailSoon && now > mailSoon) || now - lastMail > cfg.rewardsEveryMin * 60000)) {
        lastMail = now;
        mailSoon = 0;
        await doMail();
      }
      // Loja: a cada N horas, ou logo que estiver na cidade (ex.: depois de morrer).
      const shopAge = now - (cfg.lastShop || 0);
      if (cfg.autoShop && !force && (shopAge > cfg.shopEveryHours * 3600000 || (!inHunt() && shopAge > 30 * 60000))) {
        await doShop();
        lastHunt = now;
      }
      if (cfg.autoHunt && (force || levelUp || now - lastHunt > cfg.huntEveryMin * 60000)) {
        lastHunt = now;
        await doHunt();
      }
    } catch (e) {
      log('Erro: ' + (e && e.message ? e.message : e));
      await closePanels().catch(() => {});
    } finally {
      running = false;
      setStatus(cfg.enabled ? 'ligado' : 'desligado');
    }
  }

  // ---------------------------------------------------------------------------
  // Trava de morte: conta as mortes (tela .slHudDeath do jogo). Com N mortes dentro
  // da janela, a caçada passa a usar uma área abaixo por um tempo. Também fecha o
  // aviso "Seu caçador morreu" depois que o caçador volta para a cidade.
  // ---------------------------------------------------------------------------
  let wasDead = false;
  function deathWatch() {
    if (!document.querySelector('.slHudCard')) return;
    const dead = visible(document.querySelector('.slHudDeath'));
    if (dead && !wasDead) {
      const now = Date.now();
      const win = Math.max(1, cfg.deathWindowMin) * 60000;
      cfg.deaths = (cfg.deaths || []).filter((t) => now - t < win);
      cfg.deaths.push(now);
      saveCfg();
      log(`Morri (${cfg.deaths.length} em ${cfg.deathWindowMin} min).`);
      // Quem não é líder da party não desce sozinho (sairia da caçada do grupo).
      if (cfg.enabled && cfg.deathGuard && !partyLeaderIsOther() && cfg.deaths.length >= Math.max(1, cfg.deathLimit)) {
        cfg.huntPauseUntil = now + Math.max(5, cfg.deathPauseMin) * 60000;
        cfg.deaths = [];
        saveCfg();
        lastHunt = 0; // a próxima rodada já desce de área
        log(`Trava de morte: ${cfg.deathLimit} mortes seguidas. Caço uma área abaixo até ${new Date(cfg.huntPauseUntil).toLocaleTimeString()}.`);
      }
    }
    wasDead = dead;
    if (!dead && cfg.enabled) {
      const pop = [...document.querySelectorAll('.slHudPopupLoss')].find((p) => visible(p) && /morreu/.test(norm(p.innerText)));
      if (pop) {
        const ok = buttons(pop.closest('.slHudPopups') || pop).find((b) => /^entendi\b/.test(norm(b.innerText)));
        if (ok) click(ok);
      }
    }
  }
  setInterval(deathWatch, 2000);

  // Checa a cada ~20 s se o nível mudou; as ações em si respeitam os intervalos.
  (async function loop() {
    for (;;) {
      await sleep(jitter(20000));
      await tick(false);
    }
  })();

  // ---------------------------------------------------------------------------
  // Painel
  // ---------------------------------------------------------------------------
  let $status, $log, $buildSel, $talSel;

  // Planos da classe atual (descoberta ao abrir os Talentos; antes disso, mostra todos).
  function renderTalentSelect() {
    if (!$talSel || !PLANS) return;
    const cls = Object.keys(PLANS).find((c) => PLANS[c].some((p) => p.build === cfg.talentPlanSeen));
    const names = cls ? PLANS[cls].map((p) => p.build) : Object.values(PLANS).flat().map((p) => p.build);
    $talSel.innerHTML = '';
    for (const n of ['', ...names]) {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n || 'Igual à build de atributos';
      if (norm(n) === norm(cfg.talentBuild)) o.selected = true;
      $talSel.appendChild(o);
    }
  }

  function setStatus(s) { if ($status) $status.textContent = s; }
  function renderLog() { if ($log) $log.textContent = (cfg.log || []).join('\n'); }
  function renderBuildSelect() {
    if (!$buildSel) return;
    const opts = ['', ...(cfg.knownBuilds || [])];
    $buildSel.innerHTML = '';
    for (const n of opts) {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n || 'Build padrão da classe';
      if (norm(n) === norm(cfg.buildName)) o.selected = true;
      $buildSel.appendChild(o);
    }
  }

  // No IdleDeck o menu nativo do <select> abre atrás do painel. Então mostra um botão com o
  // valor escolhido e abre a lista (o próprio <select size>) por cima, dentro do painel.
  function dropdown(sel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd';
    const sync = () => { btn.textContent = `${sel.selectedOptions[0]?.textContent || '—'} ▾`; };
    const close = () => { sel.classList.remove('show'); sync(); };
    btn.addEventListener('click', () => {
      for (const s of document.querySelectorAll('#lvlAutoRoot select.show')) if (s !== sel) s.classList.remove('show');
      sel.classList.toggle('show');
    });
    sel.addEventListener('change', close);
    sel.addEventListener('click', close); // clicar na opção que já estava escolhida também fecha
    new MutationObserver(sync).observe(sel, { childList: true }); // as listas de build são recriadas
    sel.before(btn);
    sync();
  }

  function buildPanel() {
    const root = document.createElement('div');
    root.id = 'lvlAutoRoot';
    root.innerHTML = `
      <style>
        #lvlAutoRoot{position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px/1.4 system-ui,sans-serif;color:#eee}
        #lvlAutoRoot .fab{background:#7c4dff;color:#fff;border:0;border-radius:6px;padding:6px 10px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px #0008}
        #lvlAutoRoot .fab.on{background:#2ecc71;color:#06210f}
        #lvlAutoRoot .box{display:none;margin-bottom:6px;width:280px;max-width:calc(100vw - 24px);max-height:calc(100vh - 64px);overflow-y:auto;box-sizing:border-box;background:#15121f;border:1px solid #4b3a8a;border-radius:8px;padding:10px;box-shadow:0 4px 16px #000a}
        #lvlAutoRoot.open .box{display:block}
        #lvlAutoRoot label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0;position:relative}
        #lvlAutoRoot .dd{background:#221c33;color:#eee;border:1px solid #4b3a8a;border-radius:4px;padding:2px 6px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;text-align:left}
        #lvlAutoRoot select[size]{display:none;position:absolute;right:0;top:100%;z-index:1;width:180px;max-width:none;box-shadow:0 4px 12px #000c}
        #lvlAutoRoot select[size].show{display:block}
        #lvlAutoRoot option:checked{background:#7c4dff linear-gradient(#7c4dff,#7c4dff);color:#fff}
        #lvlAutoRoot select,#lvlAutoRoot input[type=number]{height:auto;background:#221c33;color:#eee;border:1px solid #4b3a8a;border-radius:4px;padding:2px 4px;max-width:150px}
        #lvlAutoRoot input[type=number]{width:56px}
        #lvlAutoRoot h4{margin:8px 0 2px;font-size:11px;letter-spacing:.06em;color:#b9a7ff;text-transform:uppercase}
        #lvlAutoRoot .row{display:flex;gap:6px;margin-top:8px}
        #lvlAutoRoot .row button{flex:1;background:#2a2342;color:#eee;border:1px solid #4b3a8a;border-radius:4px;padding:4px;cursor:pointer}
        #lvlAutoRoot pre{max-height:110px;overflow:auto;background:#0d0b14;border-radius:4px;padding:6px;margin:6px 0 0;white-space:pre-wrap;font-size:11px;color:#bbb}
        #lvlAutoRoot .st{color:#9f9}
      </style>
      <div class="box">
        <label><b>Automação</b><input type="checkbox" data-k="enabled"></label>
        <div>Status: <span class="st"></span></div>
        <h4>Pontos de atributo</h4>
        <label>Distribuir sozinho<input type="checkbox" data-k="autoPoints"></label>
        <label>Build<select size="4" data-k="buildName"></select></label>
        <label>Mínimo de pontos<input type="number" min="1" max="500" data-k="minPoints"></label>
        <label>Checar a cada (min)<input type="number" min="2" max="240" data-k="pointsEveryMin"></label>
        <h4>Talentos</h4>
        <label>Investir sozinho<input type="checkbox" data-k="autoTalents"></label>
        <label>Plano<select size="4" data-k="talentBuild"></select></label>
        <label>Checar a cada (min)<input type="number" min="5" max="240" data-k="talentsEveryMin"></label>
        <h4>Equipamento</h4>
        <label>Equipar melhores sozinho<input type="checkbox" data-k="autoEquip"></label>
        <label>Critério<select size="4" data-k="criterion">${CRITERIA.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select></label>
        <label>A cada (min)<input type="number" min="2" max="240" data-k="equipEveryMin"></label>
        <label>Encantar vestidas (só garantido)<input type="checkbox" data-k="autoEnchant"></label>
        <label>A cada (min)<input type="number" min="5" max="240" data-k="enchantEveryMin"></label>
        <h4>Exército</h4>
        <label>Montar melhor time sozinho<input type="checkbox" data-k="autoTeam"></label>
        <label>A cada (min)<input type="number" min="5" max="240" data-k="teamEveryMin"></label>
        <label>Equipar melhores nas sombras<input type="checkbox" data-k="shadowGear"></label>
        <label>Vaga 6 para treinar sombra<input type="checkbox" data-k="shadowTrainee"></label>
        <h4>Recompensas</h4>
        <label>Resgatar Missões, Diária e Correio<input type="checkbox" data-k="autoRewards"></label>
        <label>A cada (min)<input type="number" min="5" max="240" data-k="rewardsEveryMin"></label>
        <label>Expedições (só Armazém)<input type="checkbox" data-k="autoExped"></label>
        <label>A cada (min)<input type="number" min="5" max="240" data-k="expedEveryMin"></label>
        <h4>Caçada</h4>
        <label>Ir para a área recomendada<input type="checkbox" data-k="autoHunt"></label>
        <label>Checar a cada (min)<input type="number" min="5" max="240" data-k="huntEveryMin"></label>
        <label>Comparar EXP/h com a área de baixo<input type="checkbox" data-k="expCompare"></label>
        <label>Medir cada área por (min)<input type="number" min="5" max="120" data-k="expSampleMin"></label>
        <label>Descer de área após mortes<input type="checkbox" data-k="deathGuard"></label>
        <label>Mortes em 15 min para descer<input type="number" min="1" max="10" data-k="deathLimit"></label>
        <label>Ficar na área de baixo (min)<input type="number" min="5" max="480" data-k="deathPauseMin"></label>
        <h4>Loja do Brok</h4>
        <label>Comprar poções e Revivers<input type="checkbox" data-k="autoShop"></label>
        <label>A cada (horas)<input type="number" min="1" max="48" data-k="shopEveryHours"></label>
        <label>Poção Grande (manter)<input type="number" min="0" max="5000" data-k="shopHp"></label>
        <label>Mana Grande (manter)<input type="number" min="0" max="5000" data-k="shopMp"></label>
        <label>Reviver Grande (manter)<input type="number" min="0" max="500" data-k="shopRevive"></label>
        <label>Reserva de ouro<input type="number" min="0" max="99999999" data-k="shopGoldReserve"></label>
        <div class="row"><button data-act="now">Rodar agora</button><button data-act="shop">Comprar agora</button><button data-act="clear">Limpar log</button></div>
        <pre></pre>
      </div>
      <button class="fab">AUTO</button>`;
    document.body.appendChild(root);

    $status = root.querySelector('.st');
    $log = root.querySelector('pre');
    $buildSel = root.querySelector('select[data-k="buildName"]');
    $talSel = root.querySelector('select[data-k="talentBuild"]');
    const fab = root.querySelector('.fab');

    const paintFab = () => { fab.classList.toggle('on', !!cfg.enabled); fab.textContent = cfg.enabled ? 'AUTO ✓' : 'AUTO'; };

    for (const el of root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.checked = !!cfg[k];
      else if (k !== 'buildName' && k !== 'talentBuild') el.value = cfg[k];
      el.addEventListener('change', () => {
        if (el.type === 'checkbox') cfg[k] = el.checked;
        else if (el.type === 'number' || k === 'criterion') cfg[k] = el.value !== '' && Number.isFinite(Number(el.value)) ? Number(el.value) : DEFAULTS[k];
        else cfg[k] = el.value;
        saveCfg();
        paintFab();
        setStatus(cfg.enabled ? 'ligado' : 'desligado');
        if (k === 'enabled' && cfg.enabled) { lastEquip = 0; lastPoints = 0; lastTeam = 0; lastHunt = 0; lastTalents = 0; lastRewards = 0; lastMail = 0; lastExped = 0; lastEnchant = 0; tick(false); }
      });
      // não deixar as teclas do painel virarem atalho do jogo
      el.addEventListener('keydown', (e) => e.stopPropagation());
    }
    for (const s of root.querySelectorAll('select')) dropdown(s); // depois do valor salvo, para o botão já mostrar a escolha
    root.querySelector('[data-act="now"]').addEventListener('click', () => tick(true));
    root.querySelector('[data-act="shop"]').addEventListener('click', async () => {
      if (running) return;
      running = true; setStatus('indo na loja…');
      try { await doShop(); } catch (e) { log('Erro: ' + (e && e.message ? e.message : e)); }
      finally { running = false; setStatus(cfg.enabled ? 'ligado' : 'desligado'); }
    });
    root.querySelector('[data-act="clear"]').addEventListener('click', () => { cfg.log = []; saveCfg(); renderLog(); });
    fab.addEventListener('click', () => root.classList.toggle('open'));

    renderBuildSelect();
    renderTalentSelect();
    renderLog();
    paintFab();
    setStatus(cfg.enabled ? 'ligado' : 'desligado');
  }

  buildPanel();
})();
