(function () {
  "use strict";

  const STORAGE_KEY = "leadDangerous.state.v1";
  const NODE_KEY = "leadDangerous.nodeId.v1";
  const REPORT_HEADER = "# LEADDANGEROUS REPORT v1";
  const SCHEMA = "LeadDangerous.Event/v1";

  const priorityLabels = {
    low: "Низкая",
    normal: "Обычная",
    high: "Высокая",
    urgent: "Срочно"
  };

  const statusLabels = {
    planned: "План",
    active: "В работе",
    paused: "Пауза",
    done: "Готово",
    archived: "Архив"
  };

  const eventLabels = {
    "system.upsert": "Система",
    "system.archive": "Архив",
    "activity.add": "Действие",
    "influence.snapshot": "Влияние",
    "report.export": "Экспорт",
    "report.import": "Импорт"
  };

  const state = loadState();
  let selectedSystem = null;
  let selectedFactions = [];
  let searchTimer = 0;
  let searchRequest = 0;
  let influenceSystemName = "";
  let pendingImport = [];
  let pendingImportMeta = {};

  const els = {
    authorName: document.querySelector("#authorName"),
    systemForm: document.querySelector("#systemForm"),
    systemName: document.querySelector("#systemName"),
    systemSuggestions: document.querySelector("#systemSuggestions"),
    systemPriority: document.querySelector("#systemPriority"),
    systemStatus: document.querySelector("#systemStatus"),
    systemProblem: document.querySelector("#systemProblem"),
    factionHint: document.querySelector("#factionHint"),
    factionList: document.querySelector("#factionList"),
    lookupResult: document.querySelector("#lookupResult"),
    activityForm: document.querySelector("#activityForm"),
    activitySystem: document.querySelector("#activitySystem"),
    activityText: document.querySelector("#activityText"),
    influenceForm: document.querySelector("#influenceForm"),
    influenceDialog: document.querySelector("#influenceDialog"),
    influenceTitle: document.querySelector("#influenceTitle"),
    influenceHint: document.querySelector("#influenceHint"),
    influenceRows: document.querySelector("#influenceRows"),
    influenceTotal: document.querySelector("#influenceTotal"),
    normalizeInfluence: document.querySelector("#normalizeInfluence"),
    searchSystems: document.querySelector("#searchSystems"),
    statusFilter: document.querySelector("#statusFilter"),
    summaryLine: document.querySelector("#summaryLine"),
    systemList: document.querySelector("#systemList"),
    timelineList: document.querySelector("#timelineList"),
    syncLine: document.querySelector("#syncLine"),
    eventCount: document.querySelector("#eventCount"),
    exportReport: document.querySelector("#exportReport"),
    importReport: document.querySelector("#importReport"),
    openSyncJournal: document.querySelector("#openSyncJournal"),
    clearAllData: document.querySelector("#clearAllData"),
    syncDialog: document.querySelector("#syncDialog"),
    importDialog: document.querySelector("#importDialog"),
    importSummary: document.querySelector("#importSummary"),
    importPreview: document.querySelector("#importPreview"),
    applyImport: document.querySelector("#applyImport"),
    cancelImport: document.querySelector("#cancelImport"),
    appTitle: document.querySelector("#appTitle"),
    debugDialog: document.querySelector("#debugDialog"),
    debugOutput: document.querySelector("#debugOutput"),
    toast: document.querySelector("#toast")
  };

  init();

  function init() {
    els.authorName.value = state.author || "";
    bindEvents();
    render();
  }

  function bindEvents() {
    els.authorName.addEventListener("input", handleAuthorInput);
    els.systemName.addEventListener("input", handleSystemNameInput);
    els.systemForm.addEventListener("submit", handleSystemSubmit);
    els.activityForm.addEventListener("submit", handleActivitySubmit);
    els.influenceForm.addEventListener("submit", handleInfluenceSubmit);
    els.normalizeInfluence.addEventListener("click", normalizeInfluenceRows);
    els.influenceForm.querySelector("[data-close-influence]").addEventListener("click", closeInfluenceDialog);
    els.searchSystems.addEventListener("input", renderSystems);
    els.statusFilter.addEventListener("change", renderSystems);
    els.exportReport.addEventListener("click", exportReport);
    els.importReport.addEventListener("change", handleImportFile);
    els.openSyncJournal.addEventListener("click", openSyncJournal);
    els.clearAllData.addEventListener("click", clearAllData);
    els.applyImport.addEventListener("click", applyPendingImport);
    els.cancelImport.addEventListener("click", () => {
      pendingImport = [];
      pendingImportMeta = {};
    });
    els.appTitle.addEventListener("dblclick", openDebugPanel);
  }

  function loadState() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return {
          version: 1,
          nodeId: parsed.nodeId || getNodeId(),
          author: parsed.author || "",
          systems: parsed.systems || {},
          activities: parsed.activities || [],
          events: parsed.events || [],
          appliedEventIds: parsed.appliedEventIds || {}
        };
      } catch (error) {
        console.warn("Cannot parse saved state", error);
      }
    }

    return {
      version: 1,
      nodeId: getNodeId(),
      author: "",
      systems: {},
      activities: [],
      events: [],
      appliedEventIds: {}
    };
  }

  function getNodeId() {
    let nodeId = localStorage.getItem(NODE_KEY);
    if (!nodeId) {
      nodeId = "node-" + randomToken();
      localStorage.setItem(NODE_KEY, nodeId);
    }
    return nodeId;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function handleAuthorInput() {
    state.author = els.authorName.value.trim();
    saveState();
    renderTimeline();
  }

  function handleSystemNameInput() {
    selectedSystem = null;
    selectedFactions = [];
    els.lookupResult.textContent = "";
    els.factionHint.textContent = "Выберите систему из списка EDSM, чтобы загрузить фракции.";
    els.factionList.innerHTML = "";
    els.systemProblem.disabled = false;
    window.clearTimeout(searchTimer);

    const query = cleanName(els.systemName.value);
    if (query.length < 2) {
      els.systemSuggestions.innerHTML = "";
      return;
    }

    const requestId = ++searchRequest;
    els.systemSuggestions.innerHTML = `<div class="suggestion-note">Ищу варианты в EDSM...</div>`;
    searchTimer = window.setTimeout(async () => {
      try {
        const systems = await searchEdsmSystems(query);
        if (requestId !== searchRequest) {
          return;
        }
        renderSystemSuggestions(systems, query);
      } catch (error) {
        console.error(error);
        if (requestId === searchRequest) {
          els.systemSuggestions.innerHTML = `<div class="suggestion-note">EDSM сейчас не ответил. Можно добавить вручную.</div>`;
        }
      }
    }, 450);
  }

  async function searchEdsmSystems(query) {
    const url = new URL("https://www.edsm.net/api-v1/systems");
    url.searchParams.set("systemName", query);
    url.searchParams.set("showId", "1");
    url.searchParams.set("showCoordinates", "1");
    url.searchParams.set("showInformation", "1");
    url.searchParams.set("showPermit", "1");
    url.searchParams.set("showPrimaryStar", "1");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error("EDSM request failed: " + response.status);
    }

    const data = await response.json();
    const systems = Array.isArray(data) ? data : data && data.name ? [data] : [];
    const normalizedQuery = query.toLowerCase();
    return systems
      .filter((system) => system && system.name)
      .sort((a, b) => {
        const exactA = a.name.toLowerCase() === normalizedQuery ? 0 : 1;
        const exactB = b.name.toLowerCase() === normalizedQuery ? 0 : 1;
        return exactA - exactB || a.name.localeCompare(b.name, "ru");
      })
      .slice(0, 8);
  }

  function renderSystemSuggestions(systems, query) {
    els.systemSuggestions.innerHTML = "";
    if (!systems.length) {
      els.systemSuggestions.innerHTML = `<div class="suggestion-note">По "${escapeHtml(query)}" EDSM ничего не нашел. Можно добавить вручную.</div>`;
      return;
    }

    systems.forEach((system) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-item";
      button.innerHTML = `
        <strong>${escapeHtml(system.name)}</strong>
        <span>${escapeHtml(systemMeta(system) || "данные EDSM")}</span>
      `;
      button.addEventListener("click", () => selectSystem(system));
      els.systemSuggestions.appendChild(button);
    });
  }

  function selectSystem(system) {
    selectedSystem = system;
    selectedFactions = [];
    els.systemName.value = system.name;
    els.systemSuggestions.innerHTML = "";
    els.lookupResult.innerHTML = renderLookup(system);
    els.factionHint.textContent = "Загружаю фракции EDSM...";
    els.factionList.innerHTML = "";
    els.systemProblem.disabled = true;
    loadSystemFactions(system);
  }

  async function loadSystemFactions(system) {
    try {
      const result = await fetchEdsmFactions(system);
      if (!selectedSystem || !sameSystem(selectedSystem.name, system.name)) {
        return;
      }
      selectedSystem.factions = activeFactions(result.factions);
      selectedSystem.controllingFaction = result.controllingFaction;
      selectedFactions = activeFactions(result.factions);
      renderFactionPicker(selectedFactions, result.controllingFaction);
    } catch (error) {
      console.error(error);
      selectedFactions = activeFactions(fallbackFactionsFromSystem(system));
      selectedSystem.factions = selectedFactions;
      renderFactionPicker(selectedFactions, null, "EDSM не вернул список фракций. Можно продолжить вручную.");
    }
  }

  async function fetchEdsmFactions(system) {
    const url = new URL("https://www.edsm.net/api-system-v1/factions");
    url.searchParams.set("systemName", system.name);
    if (system.id) {
      url.searchParams.set("systemId", String(system.id));
    }
    url.searchParams.set("showHistory", "1");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error("EDSM factions request failed: " + response.status);
    }

    const data = await response.json();
    return {
      controllingFaction: data.controllingFaction || null,
      factions: (data.factions || [])
        .map(normalizeFaction)
        .filter((faction) => faction.name)
    };
  }

  function fallbackFactionsFromSystem(system) {
    const factionName = system.information && system.information.faction;
    if (!factionName) {
      return [];
    }
    return [{
      id: systemKey(factionName),
      name: factionName,
      allegiance: system.information.allegiance || "",
      government: system.information.government || "",
      influence: 0,
      state: system.information.factionState || "",
      isPlayer: false,
      influenceHistory: {}
    }];
  }

  function normalizeFaction(faction) {
    return {
      id: String(faction.id || systemKey(faction.name)),
      name: faction.name || "",
      allegiance: faction.allegiance || "",
      government: faction.government || "",
      influence: Number(faction.influence) || 0,
      state: faction.state || "",
      isPlayer: Boolean(faction.isPlayer),
      pendingStates: faction.pendingStates || [],
      recoveringStates: faction.recoveringStates || [],
      influenceHistory: faction.influenceHistory || {}
    };
  }

  function renderFactionPicker(factions, controllingFaction, note) {
    factions = activeFactions(factions);
    els.factionList.innerHTML = "";
    if (note) {
      els.factionHint.textContent = note;
    } else if (!factions.length) {
      els.factionHint.textContent = "Фракции не найдены. План можно описать вручную.";
    } else {
      els.factionHint.textContent = "Отметьте фракции, для которых нужен план влияния.";
    }

    els.systemProblem.disabled = factions.length > 0;
    factions.forEach((faction) => {
      const row = document.createElement("label");
      row.className = "faction-choice";
      const isController = controllingFaction && controllingFaction.name === faction.name;
      row.innerHTML = `
        <input type="checkbox" value="${escapeAttr(faction.id)}">
        <span>
          <strong>${escapeHtml(faction.name)}${isController ? " · контролирует" : ""}</strong>
          <small>${formatPercent(faction.influence)}${faction.state ? " · " + escapeHtml(faction.state) : ""}${faction.isPlayer ? " · player" : ""}</small>
        </span>
      `;
      row.querySelector("input").addEventListener("change", updateFactionPlanGate);
      els.factionList.appendChild(row);
    });
    updateFactionPlanGate();
  }

  function updateFactionPlanGate() {
    const hasFactions = Boolean(selectedFactions.length);
    const selectedIds = getSelectedFactionIds();
    els.systemProblem.disabled = hasFactions && !selectedIds.length;
    if (els.systemProblem.disabled) {
      els.systemProblem.placeholder = "Сначала отметьте одну или несколько фракций выше";
    } else {
      els.systemProblem.placeholder = "Например: держим влияние выше 60%, после тика проверить состояние войны";
    }
  }

  function getSelectedFactionIds() {
    return Array.from(els.factionList.querySelectorAll("input[type='checkbox']:checked"))
      .map((input) => input.value);
  }

  function renderLookup(result) {
    const bits = [];
    if (result.coords) {
      bits.push("координаты: " + formatCoords(result.coords));
    }
    if (result.information && result.information.faction) {
      bits.push("фракция: " + escapeHtml(result.information.faction));
    }
    if (result.primaryStar && result.primaryStar.type) {
      bits.push("звезда: " + escapeHtml(result.primaryStar.type));
    }
    if (result.requirePermit) {
      bits.push("нужен permit" + (result.permitName ? ": " + escapeHtml(result.permitName) : ""));
    }

    return "<strong>Выбрано: " + escapeHtml(result.name) + "</strong><br>" + (bits.join(" · ") || "данные найдены");
  }

  function handleSystemSubmit(event) {
    event.preventDefault();
    const name = cleanName(els.systemName.value);
    if (!name) {
      showToast("Введите название системы.");
      return;
    }
    if (els.systemProblem.disabled) {
      showToast("Дождитесь списка фракций и выберите нужные.");
      return;
    }

    const edsm = selectedSystem && sameSystem(selectedSystem.name, name) ? selectedSystem : null;
    const selectedFactionIds = getSelectedFactionIds();
    if (selectedFactions.length && !selectedFactionIds.length) {
      showToast("Выберите хотя бы одну фракцию для плана.");
      return;
    }

    recordLocalEvent("system.upsert", {
      name,
      priority: els.systemPriority.value,
      status: els.systemStatus.value,
      problem: els.systemProblem.value.trim(),
      edsm,
      factions: selectedFactions,
      selectedFactionIds,
      controllingFaction: selectedSystem && selectedSystem.controllingFaction ? selectedSystem.controllingFaction : null,
      updatedAt: nowIso()
    });

    els.systemForm.reset();
    els.systemPriority.value = "normal";
    els.systemStatus.value = "planned";
    selectedSystem = null;
    selectedFactions = [];
    els.systemSuggestions.innerHTML = "";
    els.factionHint.textContent = "Выберите систему из списка EDSM, чтобы загрузить фракции.";
    els.factionList.innerHTML = "";
    els.systemProblem.disabled = false;
    els.lookupResult.textContent = "";
    showToast("Система сохранена.");
  }

  function handleActivitySubmit(event) {
    event.preventDefault();
    const system = els.activitySystem.value;
    const text = els.activityText.value.trim();

    if (!system || !text) {
      showToast("Выберите систему и добавьте текст действия.");
      return;
    }

    recordLocalEvent("activity.add", {
      system,
      author: state.author,
      text,
      createdAt: nowIso()
    });

    els.activityText.value = "";
    showToast("Запись добавлена.");
  }

  function archiveSystem(name) {
    const reason = window.prompt("Почему отправляем систему в архив?", "Не актуально");
    if (reason === null) {
      return;
    }

    recordLocalEvent("system.archive", {
      system: name,
      reason: reason.trim(),
      archivedAt: nowIso()
    });
    showToast("Система отправлена в архив.");
  }

  function editSystem(name) {
    const system = state.systems[systemKey(name)];
    if (!system) {
      return;
    }

    els.systemName.value = system.name;
    els.systemPriority.value = system.priority || "normal";
    els.systemStatus.value = system.status === "archived" ? "paused" : system.status || "planned";
    els.systemProblem.value = system.problem || system.note || "";
    selectedSystem = system.edsm || { name: system.name, factions: activeFactions(system.factions || []) };
    selectedFactions = activeFactions(system.factions || []);
    els.systemSuggestions.innerHTML = "";
    els.lookupResult.textContent = system.edsm ? "EDSM-данные уже сохранены для этой системы." : "";
    renderFactionPicker(selectedFactions, system.controllingFaction || null);
    (system.selectedFactionIds || []).forEach((id) => {
      const input = els.factionList.querySelector(`input[value="${cssEscape(id)}"]`);
      if (input) {
        input.checked = true;
      }
    });
    updateFactionPlanGate();
    els.systemName.focus();
  }

  function recordLocalEvent(type, payload) {
    const event = createEvent(type, payload);
    addEvent(event);
    return event;
  }

  function createEvent(type, payload) {
    return {
      schema: SCHEMA,
      id: makeEventId(),
      source: state.nodeId,
      author: state.author || "",
      createdAt: nowIso(),
      type,
      payload
    };
  }

  function addEvent(event) {
    if (!applyEvent(event)) {
      return false;
    }
    state.events.push(event);
    state.appliedEventIds[event.id] = true;
    saveState();
    render();
    return true;
  }

  function applyEvent(event) {
    if (!event || !event.type || !event.payload) {
      return false;
    }

    if (event.type === "system.upsert") {
      const payload = event.payload;
      const key = systemKey(payload.name);
      if (!key) {
        return false;
      }
      const current = state.systems[key] || {
        id: key,
        name: cleanName(payload.name),
        createdAt: event.createdAt,
        createdBy: event.author || ""
      };
      const problem = payload.problem ?? payload.note ?? payload.objective ?? current.problem ?? current.note ?? "";
      const factions = mergeFactions(current.factions || [], payload.factions || []);
      const activeFactionIds = new Set(factions.map((faction) => String(faction.id || systemKey(faction.name))));
      state.systems[key] = {
        ...current,
        name: cleanName(payload.name) || current.name,
        priority: payload.priority || current.priority || "normal",
        status: payload.status || current.status || "planned",
        problem,
        note: problem,
        edsm: payload.edsm || current.edsm || null,
        factions,
        selectedFactionIds: (payload.selectedFactionIds || current.selectedFactionIds || []).filter((id) => activeFactionIds.has(String(id))),
        controllingFaction: payload.controllingFaction || current.controllingFaction || payload.edsm?.controllingFaction || null,
        influenceSnapshots: current.influenceSnapshots || [],
        updatedAt: payload.updatedAt || event.createdAt,
        updatedBy: event.author || current.updatedBy || ""
      };
      return true;
    }

    if (event.type === "system.archive") {
      const key = systemKey(event.payload.system);
      if (!key) {
        return false;
      }
      const current = state.systems[key];
      if (!current) {
        state.systems[key] = {
          id: key,
          name: cleanName(event.payload.system),
          priority: "normal",
          status: "archived",
          problem: event.payload.reason || "",
          note: event.payload.reason || "",
          factions: [],
          selectedFactionIds: [],
          influenceSnapshots: [],
          createdAt: event.createdAt,
          createdBy: event.author || "",
          updatedAt: event.payload.archivedAt || event.createdAt,
          updatedBy: event.author || ""
        };
      } else {
        current.status = "archived";
        current.archiveReason = event.payload.reason || "";
        current.updatedAt = event.payload.archivedAt || event.createdAt;
        current.updatedBy = event.author || current.updatedBy || "";
      }
      return true;
    }

    if (event.type === "activity.add") {
      const payload = event.payload;
      const system = cleanName(payload.system);
      if (!system || !payload.text || state.activities.some((item) => item.id === event.id)) {
        return false;
      }
      state.activities.push({
        id: event.id,
        system,
        author: payload.author || event.author || "",
        text: payload.text,
        createdAt: payload.createdAt || event.createdAt
      });
      return true;
    }

    if (event.type === "influence.snapshot") {
      const payload = event.payload;
      const key = systemKey(payload.system);
      if (!key || !Array.isArray(payload.factions)) {
        return false;
      }
      const current = state.systems[key] || {
        id: key,
        name: cleanName(payload.system),
        priority: "normal",
        status: "planned",
        problem: "",
        note: "",
        factions: [],
        selectedFactionIds: [],
        influenceSnapshots: [],
        createdAt: event.createdAt,
        createdBy: event.author || ""
      };
      const snapshot = {
        id: event.id,
        author: event.author || "",
        createdAt: payload.createdAt || event.createdAt,
        factions: payload.factions.map((faction) => ({
          id: String(faction.id || systemKey(faction.name)),
          name: faction.name || "",
          influence: clampPercent(Number(faction.influence) || 0),
          locked: Boolean(faction.locked)
        })).filter((faction) => faction.influence > 0)
      };
      const snapshots = (current.influenceSnapshots || []).filter((item) => item.id !== snapshot.id);
      snapshots.push(snapshot);
      state.systems[key] = {
        ...current,
        factions: mergeFactions(current.factions || [], snapshot.factions.map((faction) => ({
          id: faction.id,
          name: faction.name,
          influence: faction.influence / 100
        }))),
        influenceSnapshots: snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        updatedAt: snapshot.createdAt,
        updatedBy: event.author || current.updatedBy || ""
      };
      return true;
    }

    if (event.type === "report.export" || event.type === "report.import") {
      return true;
    }

    return false;
  }

  function render() {
    renderActivitySystems();
    renderSystems();
    renderTimeline();
  }

  function renderActivitySystems() {
    const activeSystems = getSystems()
      .filter((system) => system.status !== "archived")
      .sort(sortSystems);

    els.activitySystem.innerHTML = "";
    if (!activeSystems.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Сначала добавьте систему";
      els.activitySystem.appendChild(option);
      return;
    }

    activeSystems.forEach((system) => {
      const option = document.createElement("option");
      option.value = system.name;
      option.textContent = system.name;
      els.activitySystem.appendChild(option);
    });
  }

  function openInfluenceDialog(systemName) {
    const system = state.systems[systemKey(systemName)];
    if (!system) {
      showToast("Система не найдена.");
      return;
    }

    influenceSystemName = system.name;
    els.influenceTitle.textContent = `Влияние: ${system.name}`;
    els.influenceHint.textContent = edsmInfluenceMeta(system);
    renderInfluenceEditor();
    if (typeof els.influenceDialog.showModal === "function") {
      els.influenceDialog.showModal();
    } else {
      els.influenceDialog.setAttribute("open", "open");
    }
  }

  function closeInfluenceDialog() {
    if (els.influenceDialog.open && typeof els.influenceDialog.close === "function") {
      els.influenceDialog.close();
    } else {
      els.influenceDialog.removeAttribute("open");
    }
  }

  async function refreshSystemEdsm(systemName, button) {
    const system = state.systems[systemKey(systemName)];
    if (!system) {
      showToast("Система не найдена.");
      return;
    }

    const oldText = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Обновляю...";
    }

    try {
      const systems = await searchEdsmSystems(system.name);
      const edsm = systems.find((item) => sameSystem(item.name, system.name)) || systems[0] || system.edsm || { name: system.name };
      const result = await fetchEdsmFactions(edsm);
      const factions = activeFactions(result.factions);
      if (!factions.length) {
        showToast("EDSM не вернул активных фракций с влиянием выше 0%.");
        return;
      }

      const activeIds = new Set(factions.map((faction) => String(faction.id || systemKey(faction.name))));
      recordLocalEvent("system.upsert", {
        name: system.name,
        priority: system.priority || "normal",
        status: system.status || "planned",
        problem: system.problem || system.note || "",
        edsm,
        factions: result.factions,
        selectedFactionIds: (system.selectedFactionIds || []).filter((id) => activeIds.has(String(id))),
        controllingFaction: result.controllingFaction || system.controllingFaction || null,
        updatedAt: nowIso()
      });
      showToast("EDSM-данные обновлены.");
    } catch (error) {
      console.error(error);
      showToast("Не удалось обновить EDSM-данные.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  function renderInfluenceEditor() {
    const system = state.systems[systemKey(influenceSystemName)];
    els.influenceRows.innerHTML = "";
    if (!system) {
      els.influenceRows.innerHTML = `<div class="empty-state">Нет системы для замера влияния.</div>`;
      updateInfluenceTotal();
      return;
    }

    const rows = latestInfluenceRows(system);
    if (!rows.length) {
      els.influenceRows.innerHTML = `<div class="empty-state">У этой системы пока нет фракций. Выберите систему из EDSM или добавьте фракции через импорт.</div>`;
      updateInfluenceTotal();
      return;
    }

    rows.forEach((faction) => {
      const row = document.createElement("div");
      row.className = "influence-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(faction.name)}</strong>
          <small>${escapeHtml(faction.state || "")}</small>
        </div>
        <input data-influence-id="${escapeAttr(faction.id)}" data-name="${escapeAttr(faction.name)}" type="number" min="0" max="100" step="0.01" value="${formatNumber(faction.influence)}" aria-label="Влияние ${escapeAttr(faction.name)}">
        <label class="lock-control">
          <input data-lock-id="${escapeAttr(faction.id)}" type="checkbox" ${faction.locked ? "checked" : ""}>
          Замок
        </label>
      `;
      els.influenceRows.appendChild(row);
    });

    els.influenceRows.querySelectorAll("input[data-influence-id]").forEach((input) => {
      input.addEventListener("input", () => {
        const lock = els.influenceRows.querySelector(`input[data-lock-id="${cssEscape(input.dataset.influenceId)}"]`);
        if (lock) {
          lock.checked = true;
        }
        rebalanceInfluenceRows(input.dataset.influenceId);
      });
    });
    els.influenceRows.querySelectorAll("input[data-lock-id]").forEach((input) => {
      input.addEventListener("change", updateInfluenceTotal);
    });
    updateInfluenceTotal();
  }

  function latestInfluenceRows(system) {
    const latest = latestInfluenceSnapshot(system);
    if (latest) {
      return latest.factions.map((faction) => ({
        ...faction,
        influence: clampPercent(Number(faction.influence) || 0)
      })).filter((faction) => faction.influence > 0);
    }

    return activeFactions(system.factions || []).map((faction) => ({
      id: String(faction.id || systemKey(faction.name)),
      name: faction.name,
      influence: clampPercent((Number(faction.influence) || 0) * 100),
      state: faction.state || "",
      locked: false
    }));
  }

  function latestInfluenceSnapshot(system) {
    const snapshots = system.influenceSnapshots || [];
    return snapshots.length ? snapshots[snapshots.length - 1] : null;
  }

  function handleInfluenceSubmit(event) {
    event.preventDefault();
    const systemName = influenceSystemName;
    const rows = readInfluenceRows();
    if (!systemName || !rows.length) {
      showToast("Нет фракций для замера влияния.");
      return;
    }

    const total = sumInfluence(rows);
    if (Math.abs(total - 100) > 0.05) {
      showToast("Сумма влияния должна быть 100%.");
      return;
    }

    recordLocalEvent("influence.snapshot", {
      system: systemName,
      factions: rows.filter((row) => row.influence > 0),
      createdAt: nowIso()
    });
    closeInfluenceDialog();
    showToast("Замер влияния сохранен.");
  }

  function normalizeInfluenceRows() {
    rebalanceInfluenceRows(null);
  }

  function rebalanceInfluenceRows(changedId) {
    const rows = readInfluenceRows();
    if (!rows.length) {
      return;
    }

    const locked = rows.filter((row) => row.locked || row.id === changedId);
    const unlocked = rows.filter((row) => !locked.some((lockedRow) => lockedRow.id === row.id));
    const lockedSum = sumInfluence(locked);
    const remaining = 100 - lockedSum;

    if (remaining < 0 || !unlocked.length) {
      writeInfluenceRows(rows);
      updateInfluenceTotal();
      return;
    }

    const unlockedSum = sumInfluence(unlocked);
    let running = 0;
    unlocked.forEach((row, index) => {
      const nextValue = index === unlocked.length - 1
        ? remaining - running
        : remaining * (unlockedSum > 0 ? row.influence / unlockedSum : 1 / unlocked.length);
      row.influence = clampPercent(round2(nextValue));
      running += row.influence;
    });

    writeInfluenceRows([...locked, ...unlocked]);
    updateInfluenceTotal();
  }

  function readInfluenceRows() {
    return Array.from(els.influenceRows.querySelectorAll("input[data-influence-id]")).map((input) => {
      const id = input.dataset.influenceId;
      const lock = els.influenceRows.querySelector(`input[data-lock-id="${cssEscape(id)}"]`);
      return {
        id,
        name: input.dataset.name || id,
        influence: clampPercent(Number(input.value) || 0),
        locked: Boolean(lock && lock.checked)
      };
    });
  }

  function writeInfluenceRows(rows) {
    rows.forEach((row) => {
      const input = els.influenceRows.querySelector(`input[data-influence-id="${cssEscape(row.id)}"]`);
      if (input) {
        input.value = formatNumber(row.influence);
      }
    });
  }

  function updateInfluenceTotal() {
    const total = sumInfluence(readInfluenceRows());
    els.influenceTotal.textContent = `Итого: ${formatNumber(total)}%`;
    els.influenceTotal.classList.toggle("priority-urgent", Math.abs(total - 100) > 0.05);
    els.influenceTotal.classList.toggle("status-active", Math.abs(total - 100) <= 0.05);
  }

  function renderSystems() {
    const query = els.searchSystems.value.trim().toLowerCase();
    const filter = els.statusFilter.value;
    const systems = getSystems()
      .filter((system) => {
        if (filter === "active" && system.status === "archived") {
          return false;
        }
        if (filter === "archived" && system.status !== "archived") {
          return false;
        }
        return !query || system.name.toLowerCase().includes(query);
      })
      .sort(sortSystems);

    const allSystems = getSystems();
    const activeCount = allSystems.filter((system) => system.status !== "archived").length;
    const urgentCount = allSystems.filter((system) => system.priority === "urgent" && system.status !== "archived").length;
    els.summaryLine.textContent = allSystems.length
      ? `${activeCount} активных систем, ${urgentCount} срочных, ${state.activities.length} записей действий.`
      : "Пока нет систем.";

    els.systemList.innerHTML = "";
    if (!systems.length) {
      els.systemList.innerHTML = `<div class="empty-state">Нет систем под выбранный фильтр.</div>`;
      return;
    }

    systems.forEach((system) => {
      const activities = activitiesFor(system.name);
      const edsmInfluence = edsmInfluenceMeta(system);
      const card = document.createElement("article");
      card.className = "system-card" + (system.status === "archived" ? " archived" : "");
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h3>${escapeHtml(system.name)}</h3>
            <p class="meta">${system.edsm ? escapeHtml(systemMeta(system.edsm)) : "EDSM-данные не сохранены"}</p>
          </div>
          <div class="badges">
            <span class="badge priority-${escapeAttr(system.priority || "normal")}">${priorityLabels[system.priority] || "Обычная"}</span>
            <span class="badge status-${escapeAttr(system.status || "planned")}">${statusLabels[system.status] || "План"}</span>
          </div>
        </div>
        <p><strong>Проблема / план:</strong> ${escapeHtml(system.problem || system.note || "Не задано")}</p>
        <p class="meta"><strong>Фракции плана:</strong> ${escapeHtml(selectedFactionNames(system).join(", ") || "не выбраны")}</p>
        <p class="meta"><strong>Действия:</strong> ${activities.length ? `${activities.length} записей, последняя ${formatDate(activities[0].createdAt)}` : "действий еще нет"}</p>
        <p class="meta"><strong>Обновлено:</strong> ${formatDate(system.updatedAt || system.createdAt)}${system.updatedBy ? " · " + escapeHtml(system.updatedBy) : ""}</p>
        <details class="foldout compact-foldout system-details">
          <summary>Открыть систему</summary>
          <section class="system-section">
            <div class="section-head">
              <div>
                <h4>График влияния</h4>
                <p class="meta">${escapeHtml(edsmInfluence)}</p>
              </div>
              <button class="button" data-action="refresh-edsm" data-system="${escapeAttr(system.name)}">Обновить EDSM</button>
            </div>
            ${renderInfluenceChart(system)}
          </section>
          <section class="system-section">
            <h4>Текущие задачи</h4>
            <p>${escapeHtml(system.problem || system.note || "План пока не задан.")}</p>
            <p class="meta"><strong>Фракции плана:</strong> ${escapeHtml(selectedFactionNames(system).join(", ") || "не выбраны")}</p>
            <p class="meta"><strong>Статус:</strong> ${escapeHtml(statusLabels[system.status] || "План")} · <strong>Срочность:</strong> ${escapeHtml(priorityLabels[system.priority] || "Обычная")}</p>
          </section>
          <section class="system-section">
            <h4>Список действий</h4>
            ${renderSystemActivities(system.name)}
          </section>
        </details>
        <div class="card-actions">
          <button class="button primary" data-action="influence" data-system="${escapeAttr(system.name)}">Добавить влияние</button>
          <button class="button" data-action="edit" data-system="${escapeAttr(system.name)}">Править</button>
          ${system.status !== "archived" ? `<button class="button danger" data-action="archive" data-system="${escapeAttr(system.name)}">В архив</button>` : ""}
        </div>
      `;
      els.systemList.appendChild(card);
    });

    els.systemList.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const system = button.dataset.system;
        if (button.dataset.action === "influence") {
          openInfluenceDialog(system);
        } else if (button.dataset.action === "refresh-edsm") {
          await refreshSystemEdsm(system, button);
        } else if (button.dataset.action === "edit") {
          editSystem(system);
        } else if (button.dataset.action === "archive") {
          archiveSystem(system);
        }
      });
    });
  }

  function renderSystemActivities(systemName) {
    const activities = activitiesFor(systemName);
    if (!activities.length) {
      return `<div class="empty-state">Действий по этой системе пока нет.</div>`;
    }

    return `
      <div class="activity-list system-activity-list">
        ${activities.map((activity) => `
          <div class="activity-item">
            <strong>${escapeHtml(formatDate(activity.createdAt))}${activity.author ? " · " + escapeHtml(activity.author) : ""}</strong>
            <p>${escapeHtml(activity.text)}</p>
          </div>
        `).join("")}
      </div>
    `;
  }

  function selectedFactionNames(system) {
    const ids = new Set(system.selectedFactionIds || []);
    return activeFactions(system.factions || [])
      .filter((faction) => !ids.size || ids.has(String(faction.id || systemKey(faction.name))))
      .map((faction) => faction.name)
      .filter(Boolean);
  }

  function renderInfluenceChart(system) {
    const series = buildInfluenceSeries(system);
    if (!series.length) {
      return `<div class="empty-state">Нет данных влияния. Сохраните ручной замер или выберите систему с историей EDSM.</div>`;
    }

    const allPoints = series.flatMap((item) => item.points);
    const minTime = Math.min(...allPoints.map((point) => point.t));
    const maxTime = Math.max(...allPoints.map((point) => point.t));
    const span = Math.max(1, maxTime - minTime);
    const colors = ["#0f766e", "#b42318", "#256b8f", "#a15c00", "#6f42c1"];
    const width = 320;
    const height = 130;
    const padX = 28;
    const padY = 14;
    const graphW = width - padX * 2;
    const graphH = height - padY * 2;

    const grid = [100, 75, 50, 25, 0].map((value) => {
      const y = padY + (1 - value / 100) * graphH;
      const labelX = value === 100 ? 2 : 8;
      return `
        <line x1="${padX}" y1="${round2(y)}" x2="${width - padX}" y2="${round2(y)}" stroke="#d8e2df" stroke-dasharray="${value === 0 ? "0" : "3 4"}"></line>
        <text x="${labelX}" y="${round2(y + 4)}" font-size="10" fill="#65726f">${value}</text>
      `;
    }).join("");

    const lines = series.map((item, index) => {
      const color = colors[index % colors.length];
      const points = item.points
        .sort((a, b) => a.t - b.t)
        .map((point) => {
          const x = padX + ((point.t - minTime) / span) * graphW;
          const y = padY + (1 - clampPercent(point.v) / 100) * graphH;
          return `${round2(x)},${round2(y)}`;
        });
      const marker = points.length === 1
        ? `<circle cx="${points[0].split(",")[0]}" cy="${points[0].split(",")[1]}" r="3" fill="${color}"></circle>`
        : "";
      return `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="2"></polyline>${marker}`;
    }).join("");

    const legend = series.map((item, index) => {
      const color = colors[index % colors.length];
      const latest = item.points[item.points.length - 1];
      return `<span><i style="background:${color}"></i>${escapeHtml(item.name)} ${formatNumber(latest.v)}%</span>`;
    }).join("");

    return `
      <div class="influence-chart">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="График влияния">
          <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}" stroke="#d8e2df"></line>
          <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="#d8e2df"></line>
          ${grid}
          ${lines}
        </svg>
        <div class="chart-legend">${legend}</div>
      </div>
    `;
  }

  function buildInfluenceSeries(system) {
    const factions = activeFactions(system.factions || [])
      .sort((a, b) => Number(b.influence || 0) - Number(a.influence || 0));

    return factions.map((faction) => {
      const id = String(faction.id || systemKey(faction.name));
      const points = [];
      Object.entries(faction.influenceHistory || {}).forEach(([time, value]) => {
        const unix = Number(time);
        const influence = Number(value);
        if (Number.isFinite(unix) && Number.isFinite(influence)) {
          points.push({ t: unix * 1000, v: clampPercent(influence * 100) });
        }
      });
      (system.influenceSnapshots || []).forEach((snapshot) => {
        const match = (snapshot.factions || []).find((item) => String(item.id) === id || item.name === faction.name);
        if (match) {
          points.push({ t: Date.parse(snapshot.createdAt), v: clampPercent(Number(match.influence) || 0) });
        }
      });
      if (!points.length && Number.isFinite(Number(faction.influence))) {
        points.push({ t: Date.parse(system.updatedAt || system.createdAt || nowIso()), v: clampPercent(Number(faction.influence) * 100) });
      }
      return {
        id,
        name: faction.name,
        points: points.filter((point) => Number.isFinite(point.t)).sort((a, b) => a.t - b.t)
      };
    }).filter((item) => item.points.length);
  }

  function renderTimeline() {
    els.eventCount.textContent = `${state.events.length} операций`;
    const importedCount = state.events.filter((event) => event.source && event.source !== state.nodeId).length;
    els.syncLine.textContent = state.events.length
      ? `Локальных и импортированных операций: ${state.events.length}. Получено из отчетов: ${importedCount}.`
      : "Каждая операция имеет ID, автора и время.";

    els.timelineList.innerHTML = "";
    const events = [...state.events]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 80);

    if (!events.length) {
      els.timelineList.innerHTML = `<div class="empty-state">Пока нет операций синхронизации.</div>`;
      return;
    }

    events.forEach((event) => {
      const item = document.createElement("div");
      item.className = "activity-item timeline-item";
      item.innerHTML = `
        <div class="timeline-head">
          <strong>${escapeHtml(eventTitle(event))}</strong>
          <span class="badge">${escapeHtml(eventLabels[event.type] || event.type)}</span>
        </div>
        <p>${escapeHtml(eventText(event))}</p>
        <p class="meta">${formatDate(event.createdAt)}${event.author ? " · " + escapeHtml(event.author) : " · без автора"} · ${escapeHtml(shortId(event.id))}</p>
      `;
      els.timelineList.appendChild(item);
    });
  }

  function openSyncJournal() {
    renderTimeline();
    if (typeof els.syncDialog.showModal === "function") {
      els.syncDialog.showModal();
    } else {
      window.alert(els.syncLine.textContent);
    }
  }

  function clearAllData() {
    const first = window.confirm("Очистить все локальные данные LeadDangerous на этом компьютере?");
    if (!first) {
      return;
    }

    const second = window.confirm("Это удалит системы, действия, замеры влияния и журнал синхронизации. Продолжить?");
    if (!second) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(NODE_KEY);
    const freshNodeId = getNodeId();

    state.version = 1;
    state.nodeId = freshNodeId;
    state.author = "";
    state.systems = {};
    state.activities = [];
    state.events = [];
    state.appliedEventIds = {};

    selectedSystem = null;
    selectedFactions = [];
    influenceSystemName = "";
    pendingImport = [];
    pendingImportMeta = {};
    searchRequest += 1;
    window.clearTimeout(searchTimer);

    els.authorName.value = "";
    els.systemForm.reset();
    els.activityForm.reset();
    els.influenceForm.reset();
    els.systemSuggestions.innerHTML = "";
    els.lookupResult.textContent = "";
    els.factionHint.textContent = "Выберите систему из списка EDSM, чтобы загрузить фракции.";
    els.factionList.innerHTML = "";
    els.systemProblem.disabled = false;
    els.importReport.value = "";
    closeInfluenceDialog();
    saveState();
    render();
    showToast("Все локальные данные очищены.");
  }

  function exportReport() {
    if (!state.events.length) {
      showToast("Пока нечего экспортировать.");
      return;
    }

    const reportId = makeReportId();
    const exportedAt = nowIso();
    recordLocalEvent("report.export", {
      reportId,
      exportedAt,
      eventCount: state.events.length + 1
    });

    const text = [
      REPORT_HEADER,
      "# reportId=" + reportId,
      "# exportedAt=" + exportedAt,
      "# source=" + state.nodeId,
      "# author=" + (state.author || ""),
      "# events=" + state.events.length,
      ...state.events.map((event) => JSON.stringify(event))
    ].join("\n") + "\n";

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "LeadDangerous-" + reportId + ".txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("TXT-отчет сформирован.");
  }

  function handleImportFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseReport(String(reader.result || ""));
        pendingImport = parsed.events.filter((item) => !state.appliedEventIds[item.id]);
        pendingImportMeta = {
          ...parsed.meta,
          fileName: file.name,
          totalEvents: parsed.events.length,
          duplicateEvents: parsed.events.length - pendingImport.length
        };
        showImportPreview(parsed.errors);
      } catch (error) {
        console.error(error);
        showToast("Не удалось прочитать отчет.");
      }
    };
    reader.onerror = () => showToast("Не удалось открыть файл.");
    reader.readAsText(file, "utf-8");
  }

  function parseReport(text) {
    const events = [];
    const errors = [];
    const meta = {};
    text.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      if (trimmed.startsWith("#")) {
        const match = trimmed.match(/^#\s*([A-Za-z0-9_-]+)=(.*)$/);
        if (match) {
          meta[match[1]] = match[2];
        }
        return;
      }

      try {
        const event = JSON.parse(trimmed);
        if (!event.id || !event.type || !event.payload) {
          errors.push(`Строка ${index + 1}: нет id, type или payload.`);
          return;
        }
        events.push(normalizeEvent(event));
      } catch (error) {
        errors.push(`Строка ${index + 1}: не JSON.`);
      }
    });

    return { events, errors, meta };
  }

  function normalizeEvent(event) {
    return {
      schema: event.schema || SCHEMA,
      id: String(event.id),
      source: event.source || "unknown",
      author: event.author || "",
      createdAt: event.createdAt || nowIso(),
      type: event.type,
      payload: event.payload || {}
    };
  }

  function showImportPreview(errors) {
    const byType = pendingImport.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});

    els.importSummary.textContent = pendingImport.length
      ? `Будет применено ${pendingImport.length} новых операций. Уже были у вас: ${pendingImportMeta.duplicateEvents || 0}. Ошибок: ${errors.length}.`
      : `Новых операций нет. Уже были у вас: ${pendingImportMeta.duplicateEvents || 0}. Ошибок: ${errors.length}.`;

    els.importPreview.innerHTML = "";
    if (pendingImportMeta.reportId || pendingImportMeta.fileName) {
      const row = document.createElement("div");
      row.className = "activity-item";
      row.innerHTML = `<strong>${escapeHtml(pendingImportMeta.reportId || pendingImportMeta.fileName)}</strong><p>${escapeHtml(pendingImportMeta.author || "автор не указан")} · всего операций: ${pendingImportMeta.totalEvents || 0}</p>`;
      els.importPreview.appendChild(row);
    }

    Object.entries(byType).forEach(([type, count]) => {
      const row = document.createElement("div");
      row.className = "activity-item";
      row.textContent = `${eventLabels[type] || type}: ${count}`;
      els.importPreview.appendChild(row);
    });

    pendingImport.slice(0, 10).forEach((item) => {
      const row = document.createElement("div");
      row.className = "activity-item";
      row.innerHTML = `<strong>${escapeHtml(eventLabels[item.type] || item.type)}</strong><p>${escapeHtml(eventText(item))}</p>`;
      els.importPreview.appendChild(row);
    });

    errors.slice(0, 5).forEach((error) => {
      const row = document.createElement("div");
      row.className = "activity-item";
      row.textContent = error;
      els.importPreview.appendChild(row);
    });

    els.applyImport.disabled = !pendingImport.length;
    if (typeof els.importDialog.showModal === "function") {
      els.importDialog.showModal();
    } else {
      const apply = window.confirm(els.importSummary.textContent + "\nПрименить импорт?");
      if (apply) {
        applyPendingImport();
      }
    }
  }

  function applyPendingImport(event) {
    if (event) {
      event.preventDefault();
    }

    let applied = 0;
    pendingImport.forEach((item) => {
      if (state.appliedEventIds[item.id]) {
        return;
      }
      if (applyEvent(item)) {
        state.events.push(item);
        state.appliedEventIds[item.id] = true;
        applied += 1;
      }
    });

    const importEvent = createEvent("report.import", {
      reportId: pendingImportMeta.reportId || pendingImportMeta.fileName || "unknown-report",
      fileName: pendingImportMeta.fileName || "",
      source: pendingImportMeta.source || "",
      totalEvents: pendingImportMeta.totalEvents || 0,
      duplicateEvents: pendingImportMeta.duplicateEvents || 0,
      appliedEvents: applied,
      importedAt: nowIso()
    });
    applyEvent(importEvent);
    state.events.push(importEvent);
    state.appliedEventIds[importEvent.id] = true;

    pendingImport = [];
    pendingImportMeta = {};
    saveState();
    render();
    if (els.importDialog.open) {
      els.importDialog.close();
    }
    showToast(`Импортировано операций: ${applied}.`);
  }

  function eventTitle(event) {
    if (event.type === "system.upsert") {
      return `Система: ${event.payload.name || "без названия"}`;
    }
    if (event.type === "system.archive") {
      return `Архив: ${event.payload.system || "без названия"}`;
    }
    if (event.type === "activity.add") {
      return `Действие: ${event.payload.system || "без системы"}`;
    }
    if (event.type === "influence.snapshot") {
      return `Замер влияния: ${event.payload.system || "без системы"}`;
    }
    if (event.type === "report.export") {
      return `Выгрузка отчета: ${event.payload.reportId || shortId(event.id)}`;
    }
    if (event.type === "report.import") {
      return `Загрузка отчета: ${event.payload.reportId || event.payload.fileName || shortId(event.id)}`;
    }
    return event.type;
  }

  function eventText(event) {
    if (event.type === "system.upsert") {
      return event.payload.problem || event.payload.note || event.payload.objective || "Система добавлена или обновлена.";
    }
    if (event.type === "system.archive") {
      return event.payload.reason || "Система отправлена в архив.";
    }
    if (event.type === "activity.add") {
      return event.payload.text || "Действие добавлено.";
    }
    if (event.type === "influence.snapshot") {
      const total = sumInfluence(event.payload.factions || []);
      return `Сохранен ручной замер по ${event.payload.factions?.length || 0} фракциям. Сумма: ${formatNumber(total)}%.`;
    }
    if (event.type === "report.export") {
      return `Создан TXT-отчет, операций в файле: ${event.payload.eventCount || 0}.`;
    }
    if (event.type === "report.import") {
      return `Применено новых операций: ${event.payload.appliedEvents || 0}. Уже было: ${event.payload.duplicateEvents || 0}.`;
    }
    return event.id;
  }

  function getSystems() {
    return Object.values(state.systems);
  }

  function activitiesFor(systemName) {
    const key = systemKey(systemName);
    return [...state.activities]
      .filter((activity) => systemKey(activity.system) === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function sortSystems(a, b) {
    const priorityScore = { urgent: 0, high: 1, normal: 2, low: 3 };
    const priorityDiff = (priorityScore[a.priority] ?? 2) - (priorityScore[b.priority] ?? 2);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return a.name.localeCompare(b.name, "ru");
  }

  function cleanName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function systemKey(value) {
    return cleanName(value).toLowerCase();
  }

  function sameSystem(a, b) {
    return systemKey(a) === systemKey(b);
  }

  function activeFactions(factions) {
    return (factions || []).filter(factionHasInfluence);
  }

  function factionHasInfluence(faction) {
    return Number(faction && faction.influence) > 0;
  }

  function latestEdsmInfluenceTime(system) {
    const times = [];
    activeFactions(system.factions || []).forEach((faction) => {
      Object.keys(faction.influenceHistory || {}).forEach((value) => {
        const unix = Number(value);
        if (Number.isFinite(unix) && unix > 0) {
          times.push(unix * 1000);
        }
      });
    });
    return times.length ? Math.max(...times) : null;
  }

  function edsmInfluenceMeta(system) {
    const latest = latestEdsmInfluenceTime(system);
    if (!latest) {
      return "EDSM-история влияния не сохранена.";
    }

    const ageDays = Math.floor((Date.now() - latest) / 86400000);
    return `Последняя запись влияния EDSM: ${formatDate(new Date(latest).toISOString())}${ageDays >= 3 ? ` · данные старше ${ageDays} дн.` : ""}`;
  }

  function mergeFactions(current, incoming) {
    const map = new Map();
    current.forEach((faction) => {
      const id = String(faction.id || systemKey(faction.name));
      map.set(id, { ...faction, id });
    });
    incoming.forEach((faction) => {
      const id = String(faction.id || systemKey(faction.name));
      const existing = map.get(id) || {};
      map.set(id, {
        ...existing,
        ...faction,
        id,
        name: faction.name || existing.name || id
      });
    });
    return activeFactions(Array.from(map.values()));
  }

  function sumInfluence(rows) {
    return rows.reduce((sum, row) => sum + (Number(row.influence) || 0), 0);
  }

  function clampPercent(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(100, value));
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function formatNumber(value) {
    return round2(value).toLocaleString("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  function formatPercent(value) {
    return formatNumber((Number(value) || 0) * 100) + "%";
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function systemMeta(edsm) {
    const parts = [];
    if (edsm.coords) {
      parts.push(formatCoords(edsm.coords));
    }
    if (edsm.information && edsm.information.faction) {
      parts.push(edsm.information.faction);
    }
    if (edsm.requirePermit) {
      parts.push("permit" + (edsm.permitName ? ": " + edsm.permitName : ""));
    }
    return parts.join(" · ");
  }

  function formatCoords(coords) {
    return [coords.x, coords.y, coords.z]
      .filter((value) => value !== undefined && value !== null)
      .map((value) => Number(value).toFixed(2))
      .join(", ");
  }

  function makeEventId() {
    return [compactDate(), state.nodeId, randomToken()].join("-");
  }

  function makeReportId() {
    return compactDate() + "-" + randomToken().slice(0, 6);
  }

  function randomToken() {
    if (window.crypto && window.crypto.getRandomValues) {
      const values = new Uint32Array(2);
      window.crypto.getRandomValues(values);
      return Array.from(values, (value) => value.toString(36)).join("");
    }
    return Math.random().toString(36).slice(2, 12);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function compactDate() {
    return nowIso().replace(/[-:.TZ]/g, "").slice(0, 14);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value || "";
    }
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function shortId(value) {
    const text = String(value || "");
    return text.length > 18 ? text.slice(0, 18) + "..." : text;
  }

  function openDebugPanel() {
    const first = window.confirm("Открыть скрытую сервисную панель?");
    if (!first) {
      return;
    }
    const second = window.confirm("Точно открыть диагностику локальных данных?");
    if (!second) {
      return;
    }

    const systems = getSystems();
    const influenceTotals = systems.map((system) => {
      const latest = latestInfluenceSnapshot(system);
      return {
        system: system.name,
        factions: (system.factions || []).length,
        selectedFactions: (system.selectedFactionIds || []).length,
        latestInfluenceTotal: latest ? round2(sumInfluence(latest.factions)) : null,
        snapshots: (system.influenceSnapshots || []).length
      };
    });

    els.debugOutput.textContent = JSON.stringify({
      nodeId: state.nodeId,
      author: state.author || "",
      systems: systems.length,
      activities: state.activities.length,
      events: state.events.length,
      appliedEventIds: Object.keys(state.appliedEventIds || {}).length,
      influenceTotals
    }, null, 2);

    if (typeof els.debugDialog.showModal === "function") {
      els.debugDialog.showModal();
    } else {
      window.alert(els.debugOutput.textContent);
    }
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      els.toast.classList.remove("visible");
    }, 2600);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
})();
