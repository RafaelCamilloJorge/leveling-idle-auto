// ==UserScript==
// @name         Leveling Idle - Auto Pontos & Equipar
// @namespace    leveling-idle-auto
// @version      1.1.0
// @description  Distribui pontos pela build, roda o "Equipar melhores" e o "Montar melhor time" do Exército, sozinho.
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

  const DEFAULTS = {
    enabled: false,
    autoPoints: true,
    buildName: '',          // '' = primeira build da lista da classe
    minPoints: 5,           // só distribui com pelo menos N pontos livres
    autoEquip: true,
    criterion: 1,
    equipEveryMin: 10,      // roda o "Equipar melhores" a cada N minutos
    pointsEveryMin: 15,     // checa pontos a cada N minutos (além de quando o nível muda)
    autoTeam: true,         // roda o "Montar melhor time" do Exército
    teamEveryMin: 30,
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
  const armyOpen = () => armyBestBtn() || [...document.querySelectorAll('.slShTeamGrid')].find(visible) || null;

  // Item "Exército" do Menu do Caçador (button.slGmItem com rótulo .slGmItemLabel).
  const armyMenuItem = (needVisible) => [...document.querySelectorAll('button.slGmItem')].find((b) => {
    const lbl = b.querySelector('.slGmItemLabel') || b;
    return /^exercito\b/.test(norm(lbl.innerText || lbl.textContent)) && (!needVisible || visible(b));
  }) || null;

  async function openArmy() {
    if (armyOpen()) return true;
    // 1) Abre o Menu do Caçador: no layout largo é a aba "CAÇADOR"; no estreito
    //    (grade do IdleDeck) é o ícone que sobra dentro de .slHudMenu.
    const opener = findButton((t) => /(^|\s)cacador$/.test(t) || t === 'cacador')
      || buttons(document.querySelector('.slHudMenu') || document.createElement('div'))[0];
    if (opener) {
      click(opener);
      const item = await waitFor(() => armyMenuItem(true), 2500);
      if (item) {
        click(item);
        if (await waitFor(armyOpen, 4000)) return true;
      }
    }
    // 2) Item do menu já existe, mesmo escondido: o clique dispara o mesmo atalho.
    const hidden = armyMenuItem(false);
    if (hidden) {
      hidden.click();
      if (await waitFor(armyOpen, 3000)) return true;
    }
    // 3) Atalho de teclado do jogo.
    pressKey('h', 'KeyH');
    return !!(await waitFor(armyOpen, 3000));
  }

  async function closePanels() {
    for (let i = 0; i < 3; i++) {
      if (!statusOpen() && !invOpen() && !armyOpen() && !armyMenuItem(true)) return;
      pressKey('Escape', 'Escape');
      await sleep(350);
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

    const chosen = builds.find((b) => norm(b.name) === norm(cfg.buildName)) || builds[0];
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
    if (best.disabled) { log('Time já é o melhor.'); await closePanels(); return; }
    click(best);
    log('Montei o melhor time do Exército.');
    await sleep(1200);
    await closePanels();
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  let running = false;
  let lastLevel = null;
  let lastEquip = 0;
  let lastPoints = 0;
  let lastTeam = 0;

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
      if (cfg.autoEquip && (force || levelUp || now - lastEquip > cfg.equipEveryMin * 60000)) {
        lastEquip = now;
        await doEquip();
      }
      if (cfg.autoTeam && (force || now - lastTeam > cfg.teamEveryMin * 60000)) {
        lastTeam = now;
        await doTeam();
      }
    } catch (e) {
      log('Erro: ' + (e && e.message ? e.message : e));
      await closePanels().catch(() => {});
    } finally {
      running = false;
      setStatus(cfg.enabled ? 'ligado' : 'desligado');
    }
  }

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
  let $status, $log, $buildSel;

  function setStatus(s) { if ($status) $status.textContent = s; }
  function renderLog() { if ($log) $log.textContent = (cfg.log || []).join('\n'); }
  function renderBuildSelect() {
    if (!$buildSel) return;
    const opts = ['', ...(cfg.knownBuilds || [])];
    $buildSel.innerHTML = '';
    for (const n of opts) {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n || 'Primeira build da classe';
      if (norm(n) === norm(cfg.buildName)) o.selected = true;
      $buildSel.appendChild(o);
    }
  }

  function buildPanel() {
    const root = document.createElement('div');
    root.id = 'lvlAutoRoot';
    root.innerHTML = `
      <style>
        #lvlAutoRoot{position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px/1.4 system-ui,sans-serif;color:#eee}
        #lvlAutoRoot .fab{background:#7c4dff;color:#fff;border:0;border-radius:6px;padding:6px 10px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px #0008}
        #lvlAutoRoot .fab.on{background:#2ecc71;color:#06210f}
        #lvlAutoRoot .box{display:none;margin-bottom:6px;width:280px;background:#15121f;border:1px solid #4b3a8a;border-radius:8px;padding:10px;box-shadow:0 4px 16px #000a}
        #lvlAutoRoot.open .box{display:block}
        #lvlAutoRoot label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0}
        #lvlAutoRoot select,#lvlAutoRoot input[type=number]{background:#221c33;color:#eee;border:1px solid #4b3a8a;border-radius:4px;padding:2px 4px;max-width:150px}
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
        <label>Build<select data-k="buildName"></select></label>
        <label>Mínimo de pontos<input type="number" min="1" max="500" data-k="minPoints"></label>
        <label>Checar a cada (min)<input type="number" min="2" max="240" data-k="pointsEveryMin"></label>
        <h4>Equipamento</h4>
        <label>Equipar melhores sozinho<input type="checkbox" data-k="autoEquip"></label>
        <label>Critério<select data-k="criterion">${CRITERIA.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select></label>
        <label>A cada (min)<input type="number" min="2" max="240" data-k="equipEveryMin"></label>
        <h4>Exército</h4>
        <label>Montar melhor time sozinho<input type="checkbox" data-k="autoTeam"></label>
        <label>A cada (min)<input type="number" min="5" max="240" data-k="teamEveryMin"></label>
        <div class="row"><button data-act="now">Rodar agora</button><button data-act="clear">Limpar log</button></div>
        <pre></pre>
      </div>
      <button class="fab">AUTO</button>`;
    document.body.appendChild(root);

    $status = root.querySelector('.st');
    $log = root.querySelector('pre');
    $buildSel = root.querySelector('select[data-k="buildName"]');
    const fab = root.querySelector('.fab');

    const paintFab = () => { fab.classList.toggle('on', !!cfg.enabled); fab.textContent = cfg.enabled ? 'AUTO ✓' : 'AUTO'; };

    for (const el of root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.checked = !!cfg[k];
      else if (k !== 'buildName') el.value = cfg[k];
      el.addEventListener('change', () => {
        if (el.type === 'checkbox') cfg[k] = el.checked;
        else if (el.type === 'number' || k === 'criterion') cfg[k] = Number(el.value) || DEFAULTS[k];
        else cfg[k] = el.value;
        saveCfg();
        paintFab();
        setStatus(cfg.enabled ? 'ligado' : 'desligado');
        if (k === 'enabled' && cfg.enabled) { lastEquip = 0; lastPoints = 0; lastTeam = 0; tick(false); }
      });
      // não deixar as teclas do painel virarem atalho do jogo
      el.addEventListener('keydown', (e) => e.stopPropagation());
    }
    root.querySelector('[data-act="now"]').addEventListener('click', () => tick(true));
    root.querySelector('[data-act="clear"]').addEventListener('click', () => { cfg.log = []; saveCfg(); renderLog(); });
    fab.addEventListener('click', () => root.classList.toggle('open'));

    renderBuildSelect();
    renderLog();
    paintFab();
    setStatus(cfg.enabled ? 'ligado' : 'desligado');
  }

  buildPanel();
})();
