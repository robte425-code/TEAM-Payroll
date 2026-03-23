/**
 * Legacy client-side store (localStorage). The website now uses Neon Postgres via `/api/employees`.
 * Kept for optional offline experiments; prefer the API + `rates.html`.
 */
(function (global) {
  const STORAGE_KEY = "team-payroll-employee-rates-v1";

  function safeParse(json, fallback) {
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? v : fallback;
    } catch {
      return fallback;
    }
  }

  function newId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "id-" + String(Date.now()) + "-" + String(Math.random()).slice(2);
  }

  /**
   * @typedef {{ id: string, providerId: string, name: string, ratePerHour: number }} EmployeeRate
   */

  /** @returns {EmployeeRate[]} */
  function loadAll() {
    const raw = global.localStorage.getItem(STORAGE_KEY);
    const list = safeParse(raw || "[]", []);
    return list.map(normalizeEmployee);
  }

  /** @param {EmployeeRate[]} employees */
  function saveAll(employees) {
    const normalized = employees.map(normalizeEmployee);
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  /** @param {Partial<EmployeeRate> & Record<string, unknown>} e */
  function normalizeEmployee(e) {
    const providerId = String(e.providerId ?? "").trim();
    const name = String(e.name ?? "").trim();
    let id = String(e.id ?? "").trim();
    if (!id) {
      id = providerId || newId();
    }
    const rate = Number(e.ratePerHour);
    return {
      id,
      providerId,
      name,
      ratePerHour: Number.isFinite(rate) ? rate : 0,
    };
  }

  /** @param {Partial<EmployeeRate>} employee */
  function upsert(employee) {
    const next = normalizeEmployee(employee);
    const all = loadAll();
    const idx = all.findIndex((x) => x.id === next.id);
    if (idx === -1) {
      const byPid = next.providerId
        ? all.findIndex((x) => x.providerId === next.providerId)
        : -1;
      if (byPid !== -1) {
        all[byPid] = { ...all[byPid], ...next, id: all[byPid].id };
      } else {
        all.push(next);
      }
    } else {
      all[idx] = { ...all[idx], ...next };
    }
    saveAll(all);
    return loadAll();
  }

  /** @param {string} id */
  function removeById(id) {
    const all = loadAll().filter((x) => x.id !== id);
    saveAll(all);
    return all;
  }

  /** @param {string} providerId */
  function getByProviderId(providerId) {
    const pid = String(providerId || "").trim();
    if (!pid) return null;
    return loadAll().find((x) => x.providerId === pid) || null;
  }

  function exportJson() {
    return JSON.stringify(loadAll(), null, 2);
  }

  /** @param {string} json */
  function importJson(json) {
    const parsed = safeParse(json, []);
    if (!Array.isArray(parsed)) {
      throw new Error("Invalid JSON: expected an array of employees.");
    }
    const normalized = parsed.map((row) => normalizeEmployee(row));
    saveAll(normalized);
    return loadAll();
  }

  global.RatesDb = {
    STORAGE_KEY,
    loadAll,
    saveAll,
    upsert,
    removeById,
    getByProviderId,
    exportJson,
    importJson,
    normalizeEmployee,
    newId,
  };
})(typeof window !== "undefined" ? window : globalThis);
