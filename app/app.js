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
    "system.upsert": "система",
    "system.archive": "архив",
    "activity.add": "действие"
  };

  const state = loadState();
  let lastLookup = null;
  let pendingImport = [];

  const els = {
    systemForm: document.querySelector("#systemForm"),
    systemName: document.querySelector("#systemName"),
    systemPriority: document.querySelector("#systemPriority"),
    systemStatus: document.querySelector("#systemStatus"),
    systemObjective: document.querySelector("#systemObjective"),
    systemNote: document.querySelector("#systemNote"),
    lookupSystem: document.querySelector("#lookupSystem"),
    lookupResult: document.querySelector("#lookupResult"),
    activityForm: document.querySelector("#activityForm"),
    activitySystem: document.querySelector("#activitySystem"),
    activityAuthor: document.querySelector("#activityAuthor"),
    activityText: document.querySelector("#activityText"),
    activityMissions: document.querySelector("#activityMissions"),
    searchSystems: document.querySelector("#searchSystems"),
    statusFilter: document.querySelector("#statusFilter"),
    summaryLine: document.querySelector("#summaryLine"),
    systemList: document.querySelector("#systemList"),
    activityList: document.querySelector("#activityList"),
    eventCount: document.querySelector("#eventCount"),
    exportReport: document.querySelector("#exportReport"),
    importReport: document.querySelector("#importReport"),
    importDialog: document.querySelector("#importDialog"),
    importSummary: document.querySelector("#importSummary"),
    importPreview: document.querySelector("#importPreview"),
    applyImport: document.querySelector("#applyImport"),
    cancelImport: document.querySelector("#cancelImport"),
    toast: document.querySelector("#toast")
  };

  init();

  function init() {
    els.activityAuthor.value = state.author || "";
    bindEvents();
    render();
  }

  function bindEvents() {
    els.systemForm.addEventListener("submit", handleSystemSubmit);
    els.lookupSystem.addEventListener("click", handleLookup);
    els.activityForm.addEventListener("submit", handleActivitySubmit);
    els.searchSystems.addEventListener("input", renderSystems);
    els.statusFilter.addEventListener("change", renderSystems);
    els.exportReport.addEventListener("click", exportReport);
    els.importReport.addEventListener("change", handleImportFile);
    els.applyImport.addEventListener("click", applyPendingImport);
    els.cancelImport.addEventListener("click", () => {
      pendingImport = [];
    });
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

  function handleSystemSubmit(event) {
    event.preventDefault();
    const name = cleanName(els.systemName.value);
    if (!name) {
      showToast("Введите название системы.");
      return;
    }

    const payload = {
      name,
      priority: els.systemPriority.value,
      status: els.systemStatus.value,
      objective: els.systemObjective.value,
      note: els.systemNote.value.trim(),
      edsm: lastLookup && sameSystem(lastLookup.name, name) ? lastLookup : null,
      updatedAt: nowIso()
    };

    recordEvent("system.upsert", payload);
    els.systemForm.reset();
    els.systemPriority.value = "normal";
    els.systemStatus.value = "planned";
    lastLookup = null;
    els.lookupResult.textContent = "";
    showToast("Система сохранена.");
  }

  async function handleLookup() {
    const name = cleanName(els.systemName.value);
    if (!name) {
      showToast("Введите систему для проверки.");
      return;
    }

    els.lookupSystem.disabled = true;
    els.lookupResult.textContent = "Ищу систему в EDSM...";

    try {
      const result = await lookupEdsmSystem(name);
      if (!result || !result.name) {
        lastLookup = null;
        els.lookupResult.textContent = "EDSM не вернул данные по этой системе. Можно добавить вручную.";
        return;
      }

      lastLookup = result;
      els.systemName.value = result.name;
      els.lookupResult.innerHTML = renderLookup(result);
    } catch (error) {
      console.error(error);
      lastLookup = null;
      els.lookupResult.textContent = "Не удалось обратиться к EDSM. Систему можно добавить вручную.";
    } finally {
      els.lookupSystem.disabled = false;
    }
  }

  async function lookupEdsmSystem(name) {
    const url = new URL("https://www.edsm.net/api-v1/system");
    url.searchParams.set("systemName", name);
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

    return response.json();
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

    return "<strong>" + escapeHtml(result.name) + "</strong><br>" + (bits.join(" · ") || "данные найдены");
  }

  function handleActivitySubmit(event) {
    event.preventDefault();
    const system = els.activitySystem.value;
    const text = els.activityText.value.trim();
    const author = els.activityAuthor.value.trim();
    const missions = Number.parseInt(els.activityMissions.value, 10) || 0;

    if (!system || !text) {
      showToast("Выберите систему и добавьте текст действия.");
      return;
    }

    state.author = author;
    recordEvent("activity.add", {
      system,
      author,
      text,
      missions,
      createdAt: nowIso()
    });

    els.activityText.value = "";
    els.activityMissions.value = "";
    showToast("Запись добавлена.");
  }

  function archiveSystem(name) {
    const reason = window.prompt("Почему отправляем систему в архив?", "Не актуально");
    if (reason === null) {
      return;
    }

    recordEvent("system.archive", {
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
    els.systemObjective.value = system.objective || els.systemObjective.options[0].value;
    els.systemNote.value = system.note || "";
    lastLookup = system.edsm || null;
    els.lookupResult.textContent = system.edsm ? "EDSM-данные уже сохранены для этой системы." : "";
    els.systemName.focus();
  }

  function pickActivitySystem(name) {
    els.activitySystem.value = name;
    els.activityText.focus();
  }

  function recordEvent(type, payload) {
    const event = {
      schema: SCHEMA,
      id: makeEventId(),
      source: state.nodeId,
      author: state.author || "",
      createdAt: nowIso(),
      type,
      payload
    };
    applyEvent(event);
    state.events.push(event);
    state.appliedEventIds[event.id] = true;
    saveState();
    render();
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
        createdAt: event.createdAt
      };
      state.systems[key] = {
        ...current,
        name: cleanName(payload.name) || current.name,
        priority: payload.priority || current.priority || "normal",
        status: payload.status || current.status || "planned",
        objective: payload.objective || current.objective || "",
        note: payload.note || "",
        edsm: payload.edsm || current.edsm || null,
        updatedAt: payload.updatedAt || event.createdAt
      };
      return true;
    }

    if (event.type === "system.archive") {
      const key = systemKey(event.payload.system);
      const current = state.systems[key];
      if (!current) {
        state.systems[key] = {
          id: key,
          name: cleanName(event.payload.system),
          priority: "normal",
          status: "archived",
          objective: "",
          note: event.payload.reason || "",
          createdAt: event.createdAt,
          updatedAt: event.payload.archivedAt || event.createdAt
        };
      } else {
        current.status = "archived";
        current.archiveReason = event.payload.reason || "";
        current.updatedAt = event.payload.archivedAt || event.createdAt;
      }
      return true;
    }

    if (event.type === "activity.add") {
      const payload = event.payload;
      const system = cleanName(payload.system);
      if (!system || !payload.text) {
        return false;
      }
      state.activities.push({
        id: event.id,
        system,
        author: payload.author || event.author || "",
        text: payload.text,
        missions: Number(payload.missions) || 0,
        createdAt: payload.createdAt || event.createdAt
      });
      return true;
    }

    return false;
  }

  function render() {
    renderActivitySystems();
    renderSystems();
    renderActivities();
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
      ? `${activeCount} активных систем, ${urgentCount} срочных, ${state.activities.length} записей.`
      : "Пока нет систем.";

    els.systemList.innerHTML = "";
    if (!systems.length) {
      els.systemList.innerHTML = `<div class="empty-state">Нет систем под выбранный фильтр.</div>`;
      return;
    }

    systems.forEach((system) => {
      const latest = latestActivityFor(system.name);
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
        <p><strong>Задача:</strong> ${escapeHtml(system.objective || "Не задано")}</p>
        <p>${escapeHtml(system.note || "Комментариев пока нет.")}</p>
        <p class="meta"><strong>Последнее:</strong> ${latest ? escapeHtml(latest.text) : "действий еще нет"}</p>
        <div class="card-actions">
          <button class="button" data-action="activity" data-system="${escapeAttr(system.name)}">Записать действие</button>
          <button class="button" data-action="edit" data-system="${escapeAttr(system.name)}">Править</button>
          ${system.status !== "archived" ? `<button class="button danger" data-action="archive" data-system="${escapeAttr(system.name)}">В архив</button>` : ""}
        </div>
      `;
      els.systemList.appendChild(card);
    });

    els.systemList.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const system = button.dataset.system;
        if (button.dataset.action === "activity") {
          pickActivitySystem(system);
        } else if (button.dataset.action === "edit") {
          editSystem(system);
        } else if (button.dataset.action === "archive") {
          archiveSystem(system);
        }
      });
    });
  }

  function renderActivities() {
    els.eventCount.textContent = `${state.events.length} операций в журнале`;
    els.activityList.innerHTML = "";

    const activities = [...state.activities]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12);

    if (!activities.length) {
      els.activityList.innerHTML = `<div class="empty-state">Пока нет записей действий.</div>`;
      return;
    }

    activities.forEach((activity) => {
      const item = document.createElement("div");
      item.className = "activity-item";
      const missions = activity.missions ? ` · миссий: ${activity.missions}` : "";
      item.innerHTML = `
        <strong>${escapeHtml(activity.system)} <span class="meta">${formatDate(activity.createdAt)}${missions}</span></strong>
        <p>${escapeHtml(activity.text)}</p>
        ${activity.author ? `<p class="meta">Автор: ${escapeHtml(activity.author)}</p>` : ""}
      `;
      els.activityList.appendChild(item);
    });
  }

  function exportReport() {
    if (!state.events.length) {
      showToast("Пока нечего экспортировать.");
      return;
    }

    const text = [
      REPORT_HEADER,
      "# exportedAt=" + nowIso(),
      "# source=" + state.nodeId,
      ...state.events.map((event) => JSON.stringify(event))
    ].join("\n") + "\n";

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "LeadDangerous-" + fileDate() + ".txt";
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
    text.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
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

    return { events, errors };
  }

  function normalizeEvent(event) {
    return {
      schema: event.schema || SCHEMA,
      id: String(event.id),
      source: event.source || "unknown",
      author: event.author || "",
      createdAt: event.createdAt || nowIso(),
      type: event.type,
      payload: event.payload
    };
  }

  function showImportPreview(errors) {
    const duplicateCount = pendingImport.length;
    const byType = pendingImport.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});

    els.importSummary.textContent = duplicateCount
      ? `Будет применено ${duplicateCount} новых операций. Ошибок: ${errors.length}.`
      : `Новых операций нет. Ошибок: ${errors.length}.`;

    els.importPreview.innerHTML = "";
    Object.entries(byType).forEach(([type, count]) => {
      const row = document.createElement("div");
      row.className = "activity-item";
      row.textContent = `${eventLabels[type] || type}: ${count}`;
      els.importPreview.appendChild(row);
    });

    pendingImport.slice(0, 10).forEach((event) => {
      const row = document.createElement("div");
      row.className = "activity-item";
      row.innerHTML = `<strong>${escapeHtml(eventLabels[event.type] || event.type)}</strong><p>${escapeHtml(importLine(event))}</p>`;
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

    pendingImport = [];
    saveState();
    render();
    if (els.importDialog.open) {
      els.importDialog.close();
    }
    showToast(`Импортировано операций: ${applied}.`);
  }

  function importLine(event) {
    if (event.type === "system.upsert") {
      return event.payload.name || "без названия";
    }
    if (event.type === "system.archive") {
      return event.payload.system || "без названия";
    }
    if (event.type === "activity.add") {
      return `${event.payload.system || "без системы"}: ${event.payload.text || ""}`;
    }
    return event.id;
  }

  function getSystems() {
    return Object.values(state.systems);
  }

  function latestActivityFor(systemName) {
    const key = systemKey(systemName);
    return [...state.activities]
      .filter((activity) => systemKey(activity.system) === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
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

  function systemMeta(edsm) {
    const parts = [];
    if (edsm.coords) {
      parts.push(formatCoords(edsm.coords));
    }
    if (edsm.information && edsm.information.faction) {
      parts.push(edsm.information.faction);
    }
    return parts.join(" · ") || "EDSM";
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

  function fileDate() {
    return nowIso().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value || "";
    }
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
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
