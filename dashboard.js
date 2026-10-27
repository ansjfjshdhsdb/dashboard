/*
 * СіЯ — панель реєстру.
 *
 * Що робить:
 *   • показує й редагує ролі (players.js) і ліцензії (licenses.js) так само, як СіЯ:
 *     ті самі запити до функції serversideroles, ті самі права;
 *   • показує статистику переглядів головного сайту з лічильника, який веде
 *     script.js сайту (Firebase Realtime Database, гілка views/РРРР-ММ-ДД).
 *
 * Вхід: у Telegram (міні-застосунок) — через initData, як у СіЯ;
 *       у браузері — через Roblox (OAuth 2.0 + PKCE) або Telegram Login Widget
 *       (потрібна оновлена функція: backend/serversideroles-dashboard.ts,
 *       налаштування — у dashboard/README.md).
 */
(() => {
  "use strict";

  const CONFIG = {
    playersUrl: "https://uarpeh.xyz/players.js",
    licensesUrl: "https://uarpeh.xyz/licenses.js",
    editApi: "https://xqcgezcoywcnrmigjdyi.supabase.co/functions/v1/serversideroles",
    supabaseKey: "sb_publishable_S9Mo4BXYYPHHeznPMknN7w_GwEm_fad",
    viewsDb: "https://globalviewcounter-default-rtdb.europe-west1.firebasedatabase.app",
    catalogApi: "https://siya-public-api.priluckijmikita.workers.dev/public/catalog",
    avatarApi: "https://api.uarpeh.xyz/api",
    botUsername: "@siyadashbot",
    // Roblox OAuth: Client ID застосунку з Creator Dashboard. Адреса панелі
    // (https://dashboard.uarpeh.xyz/) має бути серед Redirect URLs.
    robloxClientId: "1724610019184754844",
    robloxAuthUrl: "https://apis.roblox.com/oauth/v1/authorize",
    // Адреса повернення має точно збігатися з однією з Redirect URLs у Roblox.
    // Порожньо — береться адреса цієї сторінки з index.html у кінці,
    // напр. https://dashboard.uarpeh.xyz/index.html
    robloxRedirectUri: "",
    siteUrl: "https://uarpeh.xyz",
    timeZone: "Europe/Kyiv",
    loginMaxAgeDays: 7,
  };

  // ───────────────────────── утиліти ─────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("uk-UA");
  const fmt = (n) => nf.format(Math.round(n));
  const fmt1 = (n) => new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(n);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const initial = (s) => (String(s || "?").trim()[0] || "?").toUpperCase();

  function plural(n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }
  const views_ = (n) => plural(n, ["перегляд", "перегляди", "переглядів"]);

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватний режим */ }
  }
  function removeKey(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  // Дати лічильника — ключі РРРР-ММ-ДД за часом відвідувача (майже всі в Україні).
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const todayKey = () => dayKeyFmt.format(new Date());
  const keyToDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const dateToKey = (d) => d.toISOString().slice(0, 10);
  const addDays = (k, n) => { const d = keyToDate(k); d.setUTCDate(d.getUTCDate() + n); return dateToKey(d); };
  const dayDiff = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / 86400000);
  const fDay = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", timeZone: "UTC" });
  const fDayYear = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const fDayShort = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", timeZone: "UTC" });
  const fWeekday = new Intl.DateTimeFormat("uk-UA", { weekday: "short", timeZone: "UTC" });
  const fMonth = new Intl.DateTimeFormat("uk-UA", { month: "short", timeZone: "UTC" });
  const fMonthYear = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });
  const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  const WEEKDAYS_LONG = ["понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота", "неділя"];
  const dow = (k) => (keyToDate(k).getUTCDay() + 6) % 7; // Пн = 0
  const dayTitle = (k) => `${fWeekday.format(keyToDate(k))}, ${fDayYear.format(keyToDate(k))}`;

  function parseUaDate(s) {
    const m = String(s || "").trim().replace(/,/g, ".").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return isNaN(d) ? null : d;
  }
  function daysUntil(date) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((date - t) / 86400000);
  }

  function tgHref(raw) {
    raw = String(raw || "").trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^t\.me\//i.test(raw)) return "https://" + raw;
    if (/^\d+$/.test(raw)) return "tg://user?id=" + raw;
    return "https://t.me/" + encodeURIComponent(raw.replace(/^@/, ""));
  }
  function tgText(raw) {
    raw = String(raw || "").trim();
    if (!raw) return "";
    if (/^\d+$/.test(raw)) return "ID " + raw;
    return "@" + raw.replace(/^https?:\/\//i, "").replace(/^t\.me\//i, "").replace(/^@/, "");
  }
  const safeImg = (u) => (/^https:\/\//i.test(String(u || "")) ? String(u) : "");

  function getPoliceRank(xp) {
    if (xp === undefined || xp === null || xp === "") return "Невідомо";
    const n = parseInt(String(xp).replace(/\s/g, ""), 10);
    if (isNaN(n)) return String(xp);
    if (n <= 2999) return "Кадет";
    if (n <= 5999) return "Молодший патрульний";
    if (n <= 9999) return "Патрульний";
    if (n <= 12999) return "Старший патрульний";
    if (n <= 15499) return "Молодший сержант";
    if (n <= 18499) return "Сержант";
    if (n <= 21999) return "Старший сержант";
    if (n <= 25999) return "Лейтенант";
    if (n <= 29999) return "Капітан";
    return "Ветеран";
  }
  const isXp = (s) => s != null && /^\d+$/.test(String(s).replace(/[\s ]/g, ""));

  // ───────────────────────── іконки ─────────────────────────
  const svg = (body, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
  const I = {
    overview: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    roles: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.8c2 .7 3.2 2.4 3.6 5.2"/>'),
    licenses: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.5-1.4 1.6-2.2 3-2.2s2.5.8 3 2.2"/><path d="M14 10h4.5M14 13.5h3"/>'),
    views: svg('<path d="M3 20h18"/><path d="M6 16v-5"/><path d="M11 16V6"/><path d="M16 16v-8"/>'),
    edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>'),
    trash: svg('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.6 1.6 0 0 0 8.6 21h6.8a1.6 1.6 0 0 0 1.6-1.5L18 7"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    cross: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
    alert: svg('<path d="M12 8v5"/><path d="M12 16.5v.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
    pause: svg('<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.01"/>'),
    // sun, moon — іконки Lucide (lucide.dev, ліцензія ISC)
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    login: svg('<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M14 17l5-5-5-5M19 12H8"/>'),
    logout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>'),
    tg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.4 4.2 2.9 11.3c-1.3.5-1.2 1.3-.2 1.6l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.8-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.5c.3-1.3-.5-1.9-1.3-1.5zM9.6 14.6l-.4 4 -1.6-5 9.6-6.1c.5-.3.9-.1.5.2z"/></svg>',
    external: svg('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  };

  // ───────────────────────── довідники ─────────────────────────
  const FRACTIONS = ["Адміністрація", "Суд", "Прокуратура", "МВС", "Мерія", "СБС", "ДБР", "ДАРШ", "НПС", "Інше"];
  const COURT = ["Суд", "МВС", "Прокуратура"];
  // Той самий вираз, що й у СіЯ (index.html → checkEditPermissions).
  const HEAD_RE = /директор|начальник|голова|керівник|заступник|мер|суддя|міністр|прокурор|генерал/i;
  const ROBLOX_RE = /^[A-Za-z0-9_]{3,20}$/;

  const F_TG = { k: "telegram", l: "Telegram", ph: "@username, t.me/username або ID" };
  const F_CANS = { k: "cans", l: "Причина скасування (якщо є)", ph: "CANS через…" };
  const F_SUSP = { k: "suspended", l: "Відсторонення (термін або причина)", ph: "Напр. до 01.09.2026" };
  const LIC = {
    weapon: { label: "Зброя", title: "Ліцензія на зброю", fields: [
      { k: "status", l: "Статус", ph: "Дійсна / Скасовано…" },
      { k: "expiry", l: "Кінцевий термін або період", ph: "01.12.2025 або 01.01 to 01.02", col: "Дійсна до" },
      F_TG, F_SUSP] },
    business: { label: "Бізнес", title: "Ліцензія на бізнес", fields: [
      { k: "role", l: "Назва бізнесу", ph: "Назва", col: "Бізнес" },
      { k: "status", l: "ID бізнесу", ph: "ID", col: "ID", id: true },
      F_CANS, F_TG, F_SUSP] },
    police: { label: "Поліція", title: "Посвідчення поліції", fields: [
      { k: "role", l: "Звання або кількість XP", ph: "Звання або XP", col: "Звання", rank: true },
      { k: "status", l: "ID працівника", ph: "xxxxxx (3 Roblox id + 3 TG id)", col: "ID", id: true },
      { k: "expiry", l: "Підрозділ", ph: "Назва підрозділу", col: "Підрозділ" },
      F_TG, F_SUSP] },
    sbs: { label: "СБС", title: "Посвідчення СБС", fields: [
      { k: "role", l: "Звання / посада", ph: "Звання", col: "Звання" },
      { k: "status", l: "ID працівника", ph: "ID", col: "ID", id: true },
      F_TG, F_SUSP] },
    dbr: { label: "ДБР", title: "Посвідчення ДБР", fields: [
      { k: "role", l: "Звання / посада", ph: "Звання", col: "Звання" },
      { k: "status", l: "ID працівника", ph: "ID", col: "ID", id: true },
      F_TG, F_SUSP] },
    taxi: { label: "Таксі", title: "Ліцензія таксиста", fields: [
      { k: "status", l: "ID таксиста", ph: "T0001", col: "ID", id: true },
      F_TG, F_SUSP] },
    advocat: { label: "Адвокати", title: "Адвокатська ліцензія", fields: [
      { k: "status", l: "ID адвоката", ph: "AXXXX", col: "ID", id: true },
      F_CANS, F_TG, F_SUSP] },
    presslicense: { label: "Прес-карти", title: "Прес-карта", fields: [
      { k: "role", l: "Назва ЗМІ", ph: "ЗМІ", col: "ЗМІ" },
      { k: "status", l: "ID журналіста / прес-карти", ph: "4+ символів", col: "ID", id: true },
      F_TG, F_SUSP] },
    press: { label: "ЗМІ", title: "Зареєстроване ЗМІ", fields: [
      { k: "status", l: "Назва ЗМІ", ph: "Назва", col: "Назва ЗМІ" },
      F_TG, F_SUSP] },
    mafia: { label: "ОЗУ", title: "Легалізоване ОЗУ", fields: [
      { k: "role", l: "Тип ОЗУ", ph: "Мафія, банда, клан…", col: "Тип" },
      { k: "status", l: "Назва ОЗУ", ph: "Назва", col: "Назва" },
      F_CANS, F_TG] },
  };
  const LIC_ORDER = ["weapon", "business", "police", "sbs", "dbr", "taxi", "advocat", "presslicense", "press", "mafia"];
  const licMeta = (cat) => LIC[cat] || { label: cat, title: "Ліцензія «" + cat + "»", fields: [
    { k: "role", l: "Роль / назва", ph: "", col: "Роль" },
    { k: "status", l: "Статус / ID", ph: "", col: "Статус" },
    { k: "expiry", l: "Дійсна до", ph: "01.12.2025", col: "Дійсна до" },
    F_CANS, F_TG, F_SUSP] };

  // ───────────────────────── стан ─────────────────────────
  const S = {
    players: {}, licenses: {},
    regVia: "", regError: null, regLoaded: false,
    views: null, viewsError: null,
    catalog: {},
    auth: null, user: null, me: null,
    route: "overview", fraction: "Усі", licCat: null,
    rolesQ: "", licQ: "", licStatus: "all",
    range: 30, showTable: false,
    pages: {}, busy: false,
    drawerNick: null,
    people: new Map(),
  };
  const KEY_LOGIN = "siya-dash-login-v1";
  const KEY_RBX = "siya-dash-roblox-v1";
  const KEY_RBX_FLOW = "siya-dash-roblox-flow";
  const KEY_THEME = "siya-dash-theme";
  const KEY_AVA = "siya-dash-avatars-v1";
  const PAGE = 60;

  // ───────────────────────── завантаження реєстрів ─────────────────────────
  // players.js і licenses.js — це JS-літерали. Розбираємо їх як JSON (з
  // прибиранням коментарів і висячих ком), без eval віддаленого коду —
  // так само, як це робить registry-sync.mjs у воркері.
  function toJson(src, marker) {
    const m = src.match(marker);
    if (!m) throw new Error("не знайдено оголошення");
    const start = src.indexOf("{", m.index + m[0].length - 1);
    const end = src.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("не знайдено обʼєкт");
    const body = src.slice(start, end + 1);
    let out = "", q = false, e = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (q) {
        out += c;
        if (e) e = false; else if (c === "\\") e = true; else if (c === '"') q = false;
        continue;
      }
      if (c === '"') { q = true; out += c; continue; }
      if (c === "/" && body[i + 1] === "/") { const n = body.indexOf("\n", i + 2); if (n < 0) break; i = n - 1; continue; }
      if (c === "/" && body[i + 1] === "*") { const n = body.indexOf("*/", i + 2); if (n < 0) break; i = n + 1; continue; }
      if (c === ",") {
        let j = i + 1;
        while (j < body.length && /\s/.test(body[j])) j++;
        if (body[j] === "/" && (body[j + 1] === "/" || body[j + 1] === "*")) {
          // кома перед коментарем: подивимось, що після коментаря
          let k = j;
          while (k < body.length) {
            if (body[k] === "/" && body[k + 1] === "/") { const n = body.indexOf("\n", k); k = n < 0 ? body.length : n; }
            else if (body[k] === "/" && body[k + 1] === "*") { const n = body.indexOf("*/", k + 2); k = n < 0 ? body.length : n + 2; }
            else if (/\s/.test(body[k])) k++;
            else break;
          }
          if (body[k] === "}" || body[k] === "]") continue;
        } else if (body[j] === "}" || body[j] === "]") continue;
      }
      out += c;
    }
    return JSON.parse(out);
  }

  async function fetchText(url) {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store", credentials: "omit" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("не вдалося завантажити " + src));
      document.head.appendChild(s);
    });
  }

  async function loadRegistries() {
    try {
      const [p, l] = await Promise.all([fetchText(CONFIG.playersUrl), fetchText(CONFIG.licensesUrl)]);
      const players = toJson(p, /(?:const|let|var)\s+players\s*=/);
      const licenses = toJson(l, /window\.licenses\s*=/);
      return { players, licenses, via: "fetch" };
    } catch (err) {
      if (S.regVia === "script") throw err;
      // Запасний шлях (наприклад, якщо сайт не віддає CORS): підключаємо файли
      // як скрипти, як це робить СіЯ.
      console.warn("[панель] fetch реєстрів не вдався, підключаю як скрипти", err);
      const t = Date.now();
      await loadScript(CONFIG.playersUrl + "?t=" + t);
      await loadScript(CONFIG.licensesUrl + "?t=" + t);
      await loadScript("registry-bridge.js?t=" + t);
      const r = window.__siyaRegistry || {};
      if (!r.players || !r.licenses) throw new Error("реєстри порожні");
      return { players: r.players, licenses: r.licenses, via: "script" };
    }
  }

  async function refreshRegistries() {
    try {
      const r = await loadRegistries();
      S.players = structuredClone(r.players);
      S.licenses = structuredClone(r.licenses);
      S.regVia = r.via;
      S.regError = null;
      S.regLoaded = true;
    } catch (err) {
      S.regError = err.message || String(err);
    }
    rebuild();
  }

  async function loadViews() {
    const r = await fetch(CONFIG.viewsDb + "/views.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const raw = (await r.json()) || {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  }
  async function refreshViews() {
    try { S.views = await loadViews(); S.viewsError = null; }
    catch (err) { S.viewsError = err.message || String(err); }
    seriesCache = null;
  }
  async function pollToday() {
    if (!S.views || document.hidden) return;
    try {
      const k = todayKey();
      const r = await fetch(`${CONFIG.viewsDb}/views/${k}.json`, { cache: "no-store" });
      if (!r.ok) return;
      const v = Number(await r.json()) || 0;
      if (S.views[k] !== v) {
        S.views[k] = v;
        seriesCache = null;
        $$('[data-live="today"]').forEach((el) => { el.textContent = fmt(v); });
      }
    } catch { /* мережа — наступна спроба за хвилину */ }
  }

  async function loadCatalog() {
    try {
      const r = await fetch(CONFIG.catalogApi, { credentials: "omit" });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j.avatars && typeof j.avatars === "object") {
        S.catalog = j.avatars;
        refreshAvatarsInDom();
      }
    } catch { /* каталог необовʼязковий */ }
  }

  // ───────────────────────── вхід ─────────────────────────
  function initAuth() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initData) {
      try { tg.ready(); tg.expand(); } catch { /* ignore */ }
      S.auth = { type: "webapp", initData: tg.initData };
      S.user = (tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
      return;
    }
    // Повернення з Telegram Login Widget (режим data-auth-url): дані в query.
    const q = new URLSearchParams(location.search);
    if (q.get("hash") && q.get("id") && q.get("auth_date")) {
      const data = {};
      for (const [k, v] of q.entries()) {
        if (["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"].includes(k)) data[k] = v;
      }
      writeJSON(KEY_LOGIN, data);
      removeKey(KEY_RBX);
      history.replaceState(null, "", location.pathname + location.hash);
    }
    if (applySavedRoblox()) return;
    const saved = readJSON(KEY_LOGIN);
    const maxAge = CONFIG.loginMaxAgeDays * 86400;
    if (saved && saved.hash && saved.id && Date.now() / 1000 - Number(saved.auth_date) < maxAge) {
      S.auth = { type: "widget", data: saved };
      S.user = { id: Number(saved.id), username: saved.username || "", first_name: saved.first_name || "", last_name: saved.last_name || "", photo_url: saved.photo_url || "" };
    } else if (saved) {
      removeKey(KEY_LOGIN);
    }
  }
  // ── Roblox OAuth 2.0 + PKCE ──
  // Панель отримує code і передає його функції serversideroles (action
  // "rbx_login"): та обмінює code на токен, читає профіль і повертає підписану
  // сесію на 7 днів. Токени Roblox у браузері не зберігаються.
  function applySavedRoblox() {
    const r = readJSON(KEY_RBX);
    if (r && r.session && r.user && r.user.username && Number(r.exp) * 1000 > Date.now()) {
      S.auth = { type: "roblox", session: r.session };
      S.user = { id: String(r.user.id || ""), username: String(r.user.username), displayName: String(r.user.displayName || r.user.username), photo_url: safeImg(r.user.picture) };
      return true;
    }
    if (r) removeKey(KEY_RBX);
    return false;
  }
  const rbxRedirect = () => CONFIG.robloxRedirectUri || (location.origin + location.pathname.replace(/\/$/, "/index.html"));
  function randomStr(bytes) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function pkceChallenge(verifier) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function startRobloxLogin() {
    const state = randomStr(24), verifier = randomStr(64);
    try { sessionStorage.setItem(KEY_RBX_FLOW, JSON.stringify({ state, verifier, hash: location.hash })); }
    catch { return toast("Браузер блокує збереження даних сайту. Дозвольте його й спробуйте ще раз.", true); }
    const challenge = await pkceChallenge(verifier);
    location.href = CONFIG.robloxAuthUrl + "?" + new URLSearchParams({
      client_id: CONFIG.robloxClientId,
      redirect_uri: rbxRedirect(),
      response_type: "code",
      scope: "openid profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
  }
  async function finishRobloxLogin() {
    const q = new URLSearchParams(location.search);
    if (!q.has("state") || !(q.has("code") || q.has("error"))) return false;
    let flow = null;
    try { flow = JSON.parse(sessionStorage.getItem(KEY_RBX_FLOW) || "null"); sessionStorage.removeItem(KEY_RBX_FLOW); } catch { /* ignore */ }
    history.replaceState(null, "", location.pathname + ((flow && flow.hash) || location.hash));
    parseRoute();
    render();
    if (!flow || flow.state !== q.get("state")) { toast("Вхід через Roblox не вдався. Спробуйте ще раз.", true); return false; }
    if (q.get("error")) { toast("Вхід через Roblox скасовано.", true); return false; }
    toast("Входимо через Roblox…");
    try {
      const res = await fetch(CONFIG.editApi, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ action: "rbx_login", code: q.get("code"), codeVerifier: flow.verifier, redirectUri: rbxRedirect(), clientId: CONFIG.robloxClientId }),
      });
      const j = await res.json().catch(() => null);
      if (!j || !j.success || !j.session || !j.user) {
        const msg = j && j.error && !/initData/i.test(j.error) ? j.error : "Вхід через Roblox поки недоступний. Спробуйте інший спосіб входу.";
        throw new Error(msg);
      }
      writeJSON(KEY_RBX, { session: j.session, exp: j.exp, user: j.user });
      removeKey(KEY_LOGIN);
      applySavedRoblox();
      rebuild();
      toast(S.me ? `Ви увійшли як ${S.me.username}` : `Ви увійшли як ${j.user.username}, але цього ніка немає у фракціях`);
      return true;
    } catch (err) {
      toast(err.message || "Вхід через Roblox не вдався.", true);
      return false;
    }
  }
  const apiHeaders = () => ({ "Content-Type": "application/json", Authorization: "Bearer " + CONFIG.supabaseKey, apikey: CONFIG.supabaseKey });

  function logout() {
    removeKey(KEY_RBX);
    removeKey(KEY_LOGIN);
    S.auth = null; S.user = null;
    rebuild(); render();
    toast("Ви вийшли. Панель працює в режимі перегляду.");
  }

  // ───────────────────────── права (як у СіЯ) ─────────────────────────
  function fractionOrder() {
    const keys = Object.keys(S.players).filter((f) => Array.isArray(S.players[f]));
    return [...FRACTIONS.filter((f) => keys.includes(f)), ...keys.filter((f) => !FRACTIONS.includes(f))];
  }
  function licOrder() {
    const keys = Object.keys(S.licenses);
    return [...LIC_ORDER.filter((c) => keys.includes(c)), ...keys.filter((c) => !LIC_ORDER.includes(c))];
  }

  function findMe() {
    if (!S.user) return null;
    const id = String(S.user.id || "");
    const un = String(S.user.username || "").toLowerCase();
    // Roblox: шукаємо за ніком; Telegram: за полем telegram, як у СіЯ.
    const match = S.auth && S.auth.type === "roblox"
      ? (p) => !!(p && p.username && String(p.username).toLowerCase() === un)
      : (p) => {
        if (!p || !p.telegram) return false;
        const t = String(p.telegram).toLowerCase();
        return (id && t.includes(id)) || (un && t.includes(un));
      };
    for (const f of fractionOrder()) {
      const arr = S.players[f];
      if (!Array.isArray(arr)) continue;
      const m = arr.find(match);
      if (m) return { fraction: f, role: String(m.role || ""), username: m.username, avatar: safeImg(m.avatar) };
    }
    return null;
  }

  const P = {
    get me() { return S.me; },
    get on() { return !!S.auth && !!S.me; },
    get isAdmin() { return P.on && S.me.fraction === "Адміністрація"; },
    get isHead() { return P.on && HEAD_RE.test(S.me.role); },
    get court() { return P.on && COURT.includes(S.me.fraction); },
    addPlayer: (fr) => P.on && (P.isAdmin || (P.isHead && S.me.fraction === fr)),
    editPlayer: (fr) => P.on && (P.isAdmin || (P.isHead && S.me.fraction === fr) || (P.court && ["НПС", "ДБР", "СБС"].includes(fr))),
    deletePlayer: (fr) => P.editPlayer(fr) && !(P.court && !P.isAdmin),
    editLic: (cat) => P.on && (P.isAdmin
      || (P.court && cat !== "mafia" && cat !== "ozu")
      || (P.isHead && ((cat === "weapon" && ["ДБР", "СБС"].includes(S.me.fraction)) || (cat === "police" && S.me.fraction === "НПС")))),
    deleteLic: (cat) => P.editLic(cat) && !(P.court && !P.isAdmin),
    // фракції та категорії ліцензій додає й видаляє лише адміністрація
    manageGroups: () => P.isAdmin,
  };
  const addableFractions = () => fractionOrder().filter((f) => P.addPlayer(f));
  const editableCats = () => licOrder().filter((c) => P.editLic(c));

  // ───────────────────────── похідні дані ─────────────────────────
  function licEntries(cat) {
    const g = S.licenses[cat];
    if (Array.isArray(g)) {
      return g.map((d, i) => ({ name: String((d && (d.username || d.name)) || ""), index: i, d: d || {} }))
        .filter((e) => e.name && e.name.toLowerCase() !== "roblox username");
    }
    if (g && typeof g === "object") {
      return Object.entries(g).filter(([k]) => k !== "username").map(([k, d], i) => ({ name: k, index: i, d: d || {} }));
    }
    return [];
  }

  function licStatus(cat, d) {
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    if (cat === "weapon") {
      const exp = parseUaDate(d.expiry);
      const zero = String(d.expiry || "").trim() === "00.00.0000";
      const expired = !!(exp && exp < todayMid);
      const bySt = /злочинн|скасов|недійсн/i.test(d.status || "");
      if (d.cans || bySt || zero || expired) {
        if (expired && !zero && !d.cans && !bySt) return { kind: "bad", label: "Прострочена", note: "термін минув " + d.expiry };
        return { kind: "bad", label: "Скасована", note: d.cans || (bySt ? d.status : "") };
      }
      if (d.suspended) return { kind: "warn", label: "Відсторонено", note: d.suspended };
      if (exp) {
        const left = daysUntil(exp);
        if (left <= 14) return { kind: "warn", label: "Спливає", note: left === 0 ? "сьогодні останній день" : `через ${left} ${plural(left, ["день", "дні", "днів"])}`, soon: left };
      }
      return { kind: "ok", label: d.status && !/^дійсн/i.test(d.status) ? d.status : "Дійсна" };
    }
    if (d.cans) return { kind: "bad", label: "Скасована", note: d.cans };
    if (d.suspended) return { kind: "warn", label: "Відсторонено", note: d.suspended };
    return { kind: "ok", label: "Дійсна" };
  }

  function rebuild() {
    S.me = findMe();
    const map = new Map();
    const get = (nick) => {
      const k = nick.toLowerCase();
      if (!map.has(k)) map.set(k, { nick, k, recs: [], tg: new Set(), ids: new Set() });
      return map.get(k);
    };
    for (const f of fractionOrder()) {
      (S.players[f] || []).forEach((p, i) => {
        if (!p || !p.username) return;
        const person = get(String(p.username));
        person.recs.push({ kind: "player", fraction: f, index: i, d: p });
        if (p.telegram) person.tg.add(String(p.telegram));
      });
    }
    for (const cat of licOrder()) {
      licEntries(cat).forEach((e) => {
        const person = get(e.name);
        person.recs.push({ kind: "lic", cat, name: e.name, index: e.index, d: e.d });
        if (e.d.telegram) person.tg.add(String(e.d.telegram));
        if (e.d.status && (licMeta(cat).fields.find((f) => f.k === "status") || {}).id) person.ids.add(String(e.d.status));
      });
    }
    S.people = map;
  }
  const playerCount = () => fractionOrder().reduce((s, f) => s + (Array.isArray(S.players[f]) ? S.players[f].length : 0), 0);
  const licCount = () => licOrder().reduce((s, c) => s + licEntries(c).length, 0);

  // ───────────────────────── аватари ─────────────────────────
  // Спершу: кеш → каталог воркера → поле avatar з players.js. Решту (власники
  // ліцензій) догружаємо ліниво через api.uarpeh.xyz, як головний сайт.
  let avCache = readJSON(KEY_AVA) || {};
  const AV_TTL = 6 * 86400 * 1000;
  let avDisabled = false, avFails = 0, avActive = 0;
  const avQueue = [];
  const avQueued = new Set();
  function freshAvatar(k) {
    const c = avCache[k];
    if (c && c.u && Date.now() - c.t < AV_TTL) return c.u;
    const cat = S.catalog[k];
    if (cat && safeImg(cat.image2d)) return cat.image2d;
    return "";
  }
  function avatarFor(nick) {
    const k = String(nick || "").toLowerCase();
    const f = freshAvatar(k);
    if (f) return f;
    const person = S.people.get(k);
    if (person) for (const r of person.recs) if (r.kind === "player" && safeImg(r.d.avatar)) return r.d.avatar;
    return "";
  }
  function avaHtml(nick, size = "", url = "") {
    const u = freshAvatar(String(nick).toLowerCase()) || safeImg(url) || avatarFor(nick);
    return `<span class="ava ${size}" data-ava="${esc(String(nick).toLowerCase())}">${esc(initial(nick))}${u ? `<img src="${esc(u)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;
  }
  const avObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      avObserver.unobserve(e.target);
      enqueueAvatar(e.target.getAttribute("data-ava"));
    }
  }, { rootMargin: "200px" }) : null;
  function hydrateAvatars(root) {
    if (avDisabled || !avObserver) return;
    $$(".ava[data-ava]", root).forEach((el) => { if (!el.querySelector("img")) avObserver.observe(el); });
  }
  function enqueueAvatar(k) {
    if (!k || avDisabled || avQueued.has(k)) return;
    const c = avCache[k];
    if (c && Date.now() - c.t < AV_TTL) return; // зокрема негативний результат
    avQueued.add(k);
    avQueue.push(k);
    pumpAvatars();
  }
  function pumpAvatars() {
    while (!avDisabled && avActive < 3 && avQueue.length) {
      const k = avQueue.shift();
      avActive++;
      fetchAvatar(k).then((u) => {
        avCache[k] = { u: u || "", t: Date.now() };
        writeJSON(KEY_AVA, avCache);
        if (u) setAvatarInDom(k, u);
      }).catch(() => {
        if (++avFails >= 3) avDisabled = true;
      }).finally(() => { avActive--; pumpAvatars(); });
    }
  }
  async function fetchAvatar(k) {
    let id = Number((S.catalog[k] || {}).id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      const r = await fetch(`${CONFIG.avatarApi}/user?input=${encodeURIComponent(k)}`);
      if (!r.ok) return "";
      const j = await r.json();
      id = Number(j && j.data && j.data[0] && j.data[0].id);
      if (!Number.isSafeInteger(id) || id <= 0) return "";
    }
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${CONFIG.avatarApi}/avatar?userId=${id}&type=headshot`);
      if (!r.ok) return "";
      const j = await r.json();
      const item = (j.data || []).find((x) => Number(x.targetId) === id);
      if (item && item.state === "Completed" && /^https:\/\/tr\.rbxcdn\.com\//.test(item.imageUrl || "")) return item.imageUrl;
      if (!item || item.state !== "Pending") return "";
      await new Promise((res) => setTimeout(res, 1200));
    }
    return "";
  }
  function setAvatarInDom(k, u) {
    $$(`.ava[data-ava="${CSS.escape(k)}"]`).forEach((el) => {
      if (el.querySelector("img")) return;
      const img = new Image();
      img.alt = ""; img.decoding = "async"; img.referrerPolicy = "no-referrer";
      img.src = u;
      el.appendChild(img);
    });
  }
  function refreshAvatarsInDom() {
    $$(".ava[data-ava]").forEach((el) => {
      if (el.querySelector("img")) return;
      const u = avatarFor(el.getAttribute("data-ava"));
      if (u) setAvatarInDom(el.getAttribute("data-ava"), u);
    });
  }
  // Протерміновані посилання rbxcdn (30DAY-…) — прибираємо і догружаємо свіже.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const box = img.closest(".ava[data-ava]");
    if (!box) return;
    const k = box.getAttribute("data-ava");
    const failed = img.getAttribute("src");
    if (avCache[k] && avCache[k].u === failed) delete avCache[k];
    img.remove();
    const f = freshAvatar(k);
    if (f && f !== failed) setAvatarInDom(k, f);
    else enqueueAvatar(k);
  }, true);

  // ───────────────────────── дрібні елементи розмітки ─────────────────────────
  function statusChip(st) {
    const icon = st.kind === "ok" ? I.check : st.kind === "bad" ? I.cross : (st.label === "Відсторонено" ? I.pause : I.alert);
    return `<span class="status ${st.kind}">${icon}${esc(st.label)}</span>${st.note ? `<span class="status-note">${esc(st.note)}</span>` : ""}`;
  }
  function tgLink(raw) {
    const href = tgHref(raw);
    if (!href) return '<span style="color:var(--muted)">—</span>';
    return `<a class="tg-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(tgText(raw))}</a>`;
  }
  const iconBtn = (act, icon, label, attrs = "", cls = "") =>
    `<button type="button" class="icon-btn ${cls}" data-act="${act}" ${attrs} title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
  const dataAttrs = (o) => Object.entries(o).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");

  function notice(html, opts = {}) {
    return `<div class="notice ${opts.error ? "error" : ""}">${opts.icon || I.info}<div>${html}</div>${opts.action || ""}</div>`;
  }

  // ───────────────────────── каркас ─────────────────────────
  const ROUTES = [
    { id: "overview", label: "Огляд", icon: I.overview },
    { id: "roles", label: "Ролі", icon: I.roles },
    { id: "licenses", label: "Ліцензії", icon: I.licenses },
    { id: "views", label: "Перегляди", icon: I.views },
  ];

  function renderNav() {
    const counts = { roles: S.regLoaded ? playerCount() : "", licenses: S.regLoaded ? licCount() : "" };
    syncNav($("#nav"), "nav", counts);
    syncNav($("#tabbar"), "tabbar", null);
  }
  // Пункти меню не перемальовуємо, а лише перемикаємо атрибути — тоді
  // «пігулка» активного пункту і колір тексту змінюються плавно.
  function syncNav(box, key, counts) {
    box.setAttribute("data-slider", key);
    if ($$(":scope > a", box).length !== ROUTES.length) {
      box.innerHTML = ROUTES.map((r) => `<a href="#${r.id}" data-k="${r.id}">${r.icon}<span>${r.label}</span>${counts ? '<span class="count"></span>' : ""}</a>`).join("");
    }
    $$(":scope > a", box).forEach((a) => {
      const id = a.getAttribute("data-k");
      if (S.route === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
      const c = a.querySelector(".count");
      if (c) {
        const v = counts && counts[id];
        c.textContent = v === undefined || v === "" || v === null ? "" : fmt(v);
      }
    });
  }

  // ── плавні перемикачі ──
  // Під активним пунктом кожного [data-slider] лежить «пігулка» .slider,
  // яка переїжджає на новий пункт через CSS transition.
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const itemKey = (el) => el.getAttribute("data-k") ?? el.getAttribute("data-f") ?? el.getAttribute("data-c") ?? el.getAttribute("data-s") ?? el.getAttribute("data-r");
  const sliderItems = (box) => Array.from(box.children).filter((el) => !el.classList.contains("slider"));
  function placeSliders(root = document, instant = false) {
    $$("[data-slider]", root).forEach((box) => {
      let pill = box.querySelector(":scope > .slider");
      const fresh = !pill;
      if (fresh) {
        pill = document.createElement("span");
        pill.className = "slider";
        pill.setAttribute("aria-hidden", "true");
        box.prepend(pill);
      }
      const active = box.querySelector(':scope > [aria-current="page"], :scope > [aria-pressed="true"]');
      if (!active || !active.offsetWidth) { pill.style.opacity = "0"; pill.removeAttribute("data-placed"); box.classList.remove("has-slider"); return; }
      const jump = fresh || instant || !pill.hasAttribute("data-placed") || reduceMotion.matches;
      if (jump) pill.style.transition = "none";
      pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      pill.style.width = active.offsetWidth + "px";
      pill.style.height = active.offsetHeight + "px";
      pill.style.opacity = "1";
      if (jump) { void pill.offsetWidth; pill.style.transition = ""; }
      pill.setAttribute("data-placed", "1");
      box.classList.add("has-slider");
      // у горизонтально прокручуваному ряду тримаємо активний пункт у полі зору
      if (box.scrollWidth > box.clientWidth + 2) {
        const left = active.offsetLeft, right = left + active.offsetWidth;
        if (left < box.scrollLeft || right > box.scrollLeft + box.clientWidth) {
          box.scrollTo({ left: Math.max(0, left - (box.clientWidth - active.offsetWidth) / 2), behavior: reduceMotion.matches || jump ? "auto" : "smooth" });
        }
      }
    });
  }

  function accountInfo() {
    if (!S.auth) return null;
    const u = S.user || {};
    const isRbx = S.auth.type === "roblox";
    const via = isRbx ? "Roblox" : "Telegram";
    const loginName = isRbx ? u.username : (u.username ? "@" + u.username : [u.first_name, u.last_name].filter(Boolean).join(" ") || "Telegram");
    if (S.me) {
      return { name: S.me.username, role: [S.me.role, S.me.fraction].filter(Boolean).join(", "), avatarNick: S.me.username, avatarUrl: S.me.avatar || safeImg(u.photo_url), loginName, via };
    }
    return { name: loginName, role: "Немає у фракціях", avatarNick: loginName.replace(/^@/, ""), avatarUrl: safeImg(u.photo_url), loginName, via };
  }

  function themeIcon() {
    return effectiveTheme() === "dark" ? I.sun : I.moon;
  }

  function renderAccount() {
    const a = accountInfo();
    const themeBtn = iconBtn("theme", themeIcon(), effectiveTheme() === "dark" ? "Світла тема" : "Темна тема");
    let side;
    if (a) {
      side = `<div class="account">${avaHtml(a.avatarNick, "", a.avatarUrl)}<div class="account-text"><div class="account-name">${esc(a.name)}</div><div class="account-role">${esc(a.role)}</div></div>${themeBtn}${S.auth.type !== "webapp" ? iconBtn("logout", I.logout, "Вийти") : ""}</div>`;
    } else {
      side = `<button type="button" class="btn btn-primary" data-act="login">${I.login}Увійти</button><div class="side-actions">${themeBtn}</div>`;
    }
    side += `<div class="legal-links"><a href="terms.html">Умови користування</a><a href="privacy.html">Конфіденційність</a></div>`;
    $("#side-foot").innerHTML = side;
    $("#mobile-account").innerHTML = a
      ? `${themeBtn}<button type="button" class="icon-btn" data-act="account" aria-label="Обліковий запис" style="width:auto;height:auto;padding:0">${avaHtml(a.avatarNick, "sm", a.avatarUrl)}</button>`
      : `${themeBtn}<button type="button" class="btn btn-sm btn-primary" data-act="login">Увійти</button>`;
    hydrateAvatars($("#side-foot"));
    hydrateAvatars($("#mobile-account"));
  }

  // ───────────────────────── маршрутизація ─────────────────────────
  function parseRoute() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    const [r, arg] = h.split("/");
    S.route = ROUTES.some((x) => x.id === r) ? r : "overview";
    if (S.route === "roles") S.fraction = arg || "Усі";
    if (S.route === "licenses" && arg) S.licCat = arg;
  }
  function go(hash) {
    if (location.hash === hash) { parseRoute(); render(); }
    else location.hash = hash;
  }

  const TITLES = { overview: "Огляд", roles: "Ролі", licenses: "Ліцензії", views: "Перегляди сайту" };

  function render() {
    hideTip();
    renderNav();
    renderAccount();
    $("#page-title").textContent = TITLES[S.route];
    document.title = TITLES[S.route] + " — СіЯ Панель";
    const v = $("#view");
    let html;
    if (S.route === "views") html = viewsPage();
    else if (!S.regLoaded && !S.regError) html = `<div class="boot"><span class="spinner"></span>Завантажую реєстр…</div>`;
    else if (!S.regLoaded) html = notice(`<strong>Не вдалося завантажити реєстр.</strong> ${esc(S.regError)}. Перевірте зʼєднання і спробуйте ще раз.`, { error: true, icon: I.alert, action: `<button class="btn btn-sm" data-act="refresh">Спробувати ще раз</button>` });
    else if (S.route === "overview") html = overviewPage();
    else if (S.route === "roles") html = rolesPage();
    else html = licensesPage();

    const same = lastViewRoute === S.route;
    const tpl = document.createElement("div");
    tpl.innerHTML = html;
    const kept = [];
    if (same) {
      $$("[data-slider]", tpl).forEach((nc) => {
        const oc = v.querySelector(`[data-slider="${nc.getAttribute("data-slider")}"]`);
        if (!oc) return;
        const a = sliderItems(oc), b = sliderItems(nc);
        if (a.length !== b.length || a.some((el, i) => itemKey(el) !== itemKey(b[i]))) return;
        kept.push({ oc, nc, scroll: oc.scrollLeft });
        nc.replaceWith(oc);
      });
    }
    v.replaceChildren(...tpl.childNodes);
    if (kept.length) {
      kept.forEach((k) => { k.oc.scrollLeft = k.scroll; });
      void v.offsetWidth; // фіксуємо старий стан, щоб переходи спрацювали
      kept.forEach(({ oc, nc }) => {
        const a = sliderItems(oc), b = sliderItems(nc);
        a.forEach((el, i) => {
          const n = b[i];
          if (el.innerHTML !== n.innerHTML) el.innerHTML = n.innerHTML;
          for (const attr of ["aria-pressed", "aria-current"]) {
            if (n.hasAttribute(attr)) el.setAttribute(attr, n.getAttribute(attr));
            else el.removeAttribute(attr);
          }
        });
      });
    }
    if (!reduceMotion.matches) {
      const cls = !same ? "enter" : S.swap ? "swap" : "";
      if (cls) { v.classList.remove("enter", "swap"); void v.offsetWidth; v.classList.add(cls); }
      // рядки таблиць зʼявляються по черзі згори донизу
      if (cls) revealRows(v, 0);
      else if (S.revealFrom != null) revealRows(v, S.revealFrom);
    }
    S.swap = false;
    S.revealFrom = null;
    lastViewRoute = S.route;
    placeSliders(document);
    afterRender(v);
  }
  let lastViewRoute = null;

  // Поступова поява рядків. Затримка росте з номером рядка, але вся хвиля
  // вкладається приблизно в 0,6 с, хоч би скільки було рядків.
  function revealRows(root, from) {
    const rows = $$(".reg tbody tr", root).slice(from);
    if (!rows.length) return;
    const step = Math.max(8, Math.min(28, 600 / rows.length));
    rows.forEach((tr, i) => {
      tr.style.animationDelay = Math.round(i * step) + "ms";
      tr.classList.add("reveal");
      tr.addEventListener("animationend", () => { tr.classList.remove("reveal"); tr.style.animationDelay = ""; }, { once: true });
    });
  }

  function afterRender(v) {
    hydrateAvatars(v);
    $$("[data-chart]", v).forEach(drawChart);
    const hs = $(".heat-scroll", v);
    if (hs) hs.scrollLeft = hs.scrollWidth;
  }

  // ───────────────────────── сторінка: огляд ─────────────────────────
  function guestNotice() {
    if (S.auth) {
      if (!S.me) {
        const a = accountInfo();
        return notice(`Ви увійшли як <strong>${esc(a.loginName)}</strong>, але ${a.via === "Roblox" ? "цього ніка" : "цього Telegram"} немає у фракціях. Редагувати можуть лише учасники фракцій.`, { icon: I.info });
      }
      return "";
    }
    return notice(`Ви переглядаєте реєстр без входу. <strong>Увійдіть через Roblox або Telegram</strong>, щоб редагувати ролі та ліцензії — права ті самі, що в СіЯ.`, { action: `<button class="btn btn-sm btn-primary" data-act="login">Увійти</button>` });
  }

  function overviewPage() {
    const ser = series();
    const today = todayKey();
    const tv = S.views ? S.views[today] || 0 : null;
    const last30 = ser.slice(-30).reduce((s, p) => s + p.v, 0);
    const prev30 = ser.length >= 60 ? ser.slice(-60, -30).reduce((s, p) => s + p.v, 0) : null;

    const ledger = `<div class="ledger">
      <div><div class="stat-label">Гравців у фракціях</div><div class="stat-value">${fmt(playerCount())}</div><div class="stat-note">${fractionOrder().filter((f) => (S.players[f] || []).length).length} фракцій зі складом</div></div>
      <div><div class="stat-label">Ліцензій</div><div class="stat-value">${fmt(licCount())}</div><div class="stat-note">${licOrder().length} категорій</div></div>
      <div><div class="stat-label">Переглядів сьогодні</div><div class="stat-value" data-live="today">${tv === null ? "—" : fmt(tv)}</div><div class="stat-note">${S.views ? "оновлюється щохвилини" : S.viewsError ? "лічильник недоступний" : "завантаження…"}</div></div>
      <div><div class="stat-label">За 30 днів</div><div class="stat-value">${S.views ? fmt(last30) : "—"}</div><div class="stat-note">${prev30 ? deltaHtml(last30, prev30) + " до попередніх 30" : "&nbsp;"}</div></div>
    </div>`;

    const heat = S.views && ser.length
      ? `<div class="card"><div class="card-head"><h2>Перегляди ${esc(CONFIG.siteUrl.replace(/^https?:\/\//, ""))} за весь час</h2><p>Клітинка - день, з ${fDayYear.format(keyToDate(ser[0].k))}</p><div class="right"><a class="btn btn-sm" href="#views">Детальна статистика</a></div></div><div data-chart="heat"></div></div>`
      : S.viewsError ? `<div class="card">${notice(`Лічильник переглядів недоступний: ${esc(S.viewsError)}.`, { error: true, icon: I.alert })}</div>`
      : `<div class="card"><div class="boot"><span class="spinner"></span>Завантажую перегляди…</div></div>`;

    const fr = fractionOrder().map((f) => ({ f, n: (S.players[f] || []).length }));
    const frMax = Math.max(1, ...fr.map((x) => x.n));
    const frBars = `<div class="hbars">${fr.map((x) => `<button type="button" class="lbl" data-act="goto" data-hash="#roles/${esc(encodeURIComponent(x.f))}">${esc(x.f)}</button><div class="track">${x.n ? `<div class="fill" style="width:${(x.n / frMax) * 100}%"></div>` : ""}</div><div class="val">${fmt(x.n)}</div>`).join("")}</div>`;

    const lc = licOrder().map((c) => ({ c, n: licEntries(c).length }));
    const lcMax = Math.max(1, ...lc.map((x) => x.n));
    const lcBars = `<div class="hbars">${lc.map((x) => `<button type="button" class="lbl" data-act="goto" data-hash="#licenses/${esc(x.c)}">${esc(licMeta(x.c).label)}</button><div class="track">${x.n ? `<div class="fill" style="width:${(x.n / lcMax) * 100}%"></div>` : ""}</div><div class="val">${fmt(x.n)}</div>`).join("")}</div>`;

    return `${guestNotice()}${ledger}${heat}
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h2>Склад фракцій</h2><p>Гравців у кожній фракції</p></div>${frBars}</div>
        <div class="card"><div class="card-head"><h2>Ліцензії за категоріями</h2><p>Ліцензій у кожній категорії</p></div>${lcBars}</div>
      </div>
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h2>Потребує уваги</h2><p>Зброя, що спливає за 14 днів, і відсторонення</p></div>${attentionList()}</div>
        <div class="card"><div class="card-head"><h2>Ваші права</h2><p>${S.me ? esc(S.me.role + ", " + S.me.fraction) : "Залежать від вашої ролі у фракції"}</p></div>${permList()}</div>
      </div>`;
  }

  function deltaHtml(cur, prev) {
    if (!prev) return "";
    const d = ((cur - prev) / prev) * 100;
    const cls = d >= 0 ? "delta-up" : "delta-down";
    return `<span class="${cls}">${d >= 0 ? "+" : "−"}${fmt1(Math.abs(d))}%</span>`;
  }

  function attentionList() {
    const items = [];
    licEntries("weapon").forEach((e) => {
      const st = licStatus("weapon", e.d);
      if (st.soon !== undefined) items.push({ sort: st.soon, nick: e.name, html: `<b>${esc(e.name)}</b><span>Ліцензія на зброю спливає ${esc(st.note)} (${esc(e.d.expiry)})</span>`, cat: "weapon" });
    });
    for (const f of fractionOrder()) (S.players[f] || []).forEach((p) => {
      if (p && p.suspended) items.push({ sort: 100, nick: p.username, html: `<b>${esc(p.username)}</b><span>Відсторонено у фракції ${esc(f)}: ${esc(p.suspended)}</span>` });
    });
    for (const c of licOrder()) licEntries(c).forEach((e) => {
      if (licStatus(c, e.d).label === "Відсторонено") items.push({ sort: 101, nick: e.name, html: `<b>${esc(e.name)}</b><span>${esc(licMeta(c).title)}: відсторонено, ${esc(e.d.suspended)}</span>` });
    });
    if (!items.length) return `<div class="empty"><strong>Усе гаразд</strong>Немає ліцензій, що спливають, і відсторонень.</div>`;
    items.sort((a, b) => a.sort - b.sort);
    const shown = items.slice(0, 8);
    return `<ul class="attn">${shown.map((it) => `<li>${avaHtml(it.nick, "sm")}<div class="t">${it.html}</div>${iconBtn("person", I.external, "Відкрити профіль", dataAttrs({ nick: it.nick }))}</li>`).join("")}</ul>${items.length > shown.length ? `<p class="stat-note" style="margin:10px 0 0">І ще ${items.length - shown.length}.</p>` : ""}`;
  }

  function permList() {
    if (!S.auth) return `<div class="empty"><strong>Ви не увійшли</strong>Увійдіть через Roblox або Telegram, щоб побачити свої права.<div style="margin-top:14px"><button class="btn btn-primary" data-act="login">${I.login}Увійти</button></div></div>`;
    if (!S.me) return `<div class="empty"><strong>Лише перегляд</strong>${S.auth.type === "roblox" ? "Вашого ніка Roblox немає у списках фракцій. Якщо ви змінювали нік, попросіть адміністрацію оновити запис." : "Попросіть адміністрацію додати ваш Telegram до вашої ролі."}</div>`;
    const yes = (t) => `<li class="yes">${I.check}<span>${t}</span></li>`;
    const no = (t) => `<li class="no">${I.cross}<span>${t}</span></li>`;
    const rows = [];
    if (P.isAdmin) rows.push(yes("Редагувати всі фракції та всі ліцензії"), yes("Видаляти записи й змінювати порядок"), yes("Додавати й видаляти фракції та категорії ліцензій"));
    else {
      const fr = fractionOrder().filter((f) => P.editPlayer(f));
      rows.push(fr.length ? yes("Редагувати склад: " + esc(fr.join(", "))) : no("Редагувати склад фракцій"));
      const add = addableFractions();
      rows.push(add.length ? yes("Додавати гравців: " + esc(add.join(", "))) : no("Додавати гравців"));
      const cats = editableCats().map((c) => licMeta(c).label);
      rows.push(cats.length ? yes("Ліцензії: " + esc(cats.join(", "))) : no("Редагувати ліцензії"));
      if (P.court) rows.push(no("Повне видалення — використовуйте відсторонення"));
    }
    return `<ul class="perm-list">${rows.join("")}</ul>`;
  }

  // ───────────────────────── сторінка: ролі ─────────────────────────
  function rolesPage() {
    const order = fractionOrder();
    if (S.fraction !== "Усі" && !order.includes(S.fraction)) S.fraction = "Усі";
    const chips = `<div class="chips" data-slider="roles-fr" role="group" aria-label="Фракція">${["Усі", ...order].map((f) => {
      const n = f === "Усі" ? playerCount() : (S.players[f] || []).length;
      return `<button type="button" class="chip" data-act="fraction" data-f="${esc(f)}" aria-pressed="${S.fraction === f}">${esc(f)} <span class="n">${n}</span></button>`;
    }).join("")}${P.manageGroups() ? `<button type="button" class="chip chip-add" data-act="add-fraction" data-k="__add">${I.plus}Фракція</button>` : ""}</div>`;
    const canDropFraction = (f) => P.manageGroups() && f !== "Усі" && f !== "Адміністрація";
    const canAddHere = S.fraction === "Усі" ? addableFractions().length > 0 : P.addPlayer(S.fraction);
    const toolbar = `<div class="toolbar"><div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="roles-q" value="${esc(S.rolesQ)}" placeholder="Нік, роль або Telegram" aria-label="Фільтр гравців"></div><div class="grow"></div>${canDropFraction(S.fraction) ? `<button type="button" class="btn btn-quiet-danger" data-act="delete-fraction" data-f="${esc(S.fraction)}">${I.trash}Видалити фракцію</button>` : ""}${canAddHere ? `<button type="button" class="btn btn-primary" data-act="add-player" data-f="${esc(S.fraction === "Усі" ? "" : S.fraction)}">${I.plus}Додати гравця</button>` : ""}</div>`;

    const q = S.rolesQ.trim().toLowerCase();
    const match = (p) => !q || [p.username, p.role, p.telegram, p.suspended].some((x) => String(x || "").toLowerCase().includes(q));
    const list = S.fraction === "Усі" ? order : [S.fraction];
    let body = "";
    let total = 0;
    for (const f of list) {
      const arr = (S.players[f] || []).map((p, i) => ({ p, i })).filter((x) => x.p && x.p.username && match(x.p));
      total += arr.length;
      if (S.fraction === "Усі" && q && !arr.length) continue;
      const head = S.fraction === "Усі"
        ? `<div class="section-head"><h3>${esc(f)}</h3><span class="n">${(S.players[f] || []).length}</span><div class="right">${canDropFraction(f) ? iconBtn("delete-fraction", I.trash, "Видалити фракцію", dataAttrs({ f }), "danger") : ""}${P.addPlayer(f) ? `<button type="button" class="btn btn-sm" data-act="add-player" data-f="${esc(f)}">${I.plus}Додати</button>` : ""}</div></div>`
        : "";
      const table = arr.length
        ? `<div class="reg-wrap"><table class="reg reg-roles"><thead><tr><th class="num">№</th><th>Гравець</th><th>${f === "НПС" ? "Звання" : "Роль / звання"}</th><th>Telegram</th><th>Стан</th><th class="acts"><span class="sr-only">Дії</span></th></tr></thead><tbody>${arr.map(({ p, i }) => playerRow(f, p, i, (S.players[f] || []).length)).join("")}</tbody></table></div>`
        : `<p class="empty-line">${q ? "Нічого не знайдено." : "У фракції поки нікого."}${!q && P.addPlayer(f) ? " Додайте першого гравця кнопкою «Додати»." : ""}</p>`;
      body += head + table;
    }
    if (S.fraction === "Усі" && q && !total) body = `<div class="empty"><strong>Нічого не знайдено</strong>Спробуйте інший нік або Telegram.</div>`;
    return `${guestNotice()}<div class="toolbar">${chips}</div>${toolbar}<div class="card">${body}</div>`;
  }

  function playerRow(f, p, i, len) {
    const role = f === "НПС" && isXp(p.role)
      ? `${esc(getPoliceRank(p.role))}<span class="sub">XP ${esc(fmt(Number(String(p.role).replace(/\s/g, ""))))}</span>`
      : esc(p.role || "—");
    const status = p.suspended ? statusChip({ kind: "warn", label: "Відсторонено", note: p.suspended }) : '<span style="color:var(--muted)">—</span>';
    const a = dataAttrs({ f, nick: p.username });
    let acts = "";
    if (P.editPlayer(f)) {
      acts += iconBtn("move-player", I.up, "Підняти вище", `${a} data-dir="moveUp" ${i === 0 ? "disabled" : ""}`);
      acts += iconBtn("move-player", I.down, "Опустити нижче", `${a} data-dir="moveDown" ${i >= len - 1 ? "disabled" : ""}`);
      acts += iconBtn("edit-player", I.edit, "Редагувати", a);
    }
    if (P.deletePlayer(f)) acts += iconBtn("delete-player", I.trash, "Видалити", a, "danger");
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="c-who"><div class="who">${avaHtml(p.username, "", p.avatar)}<button type="button" class="who-btn" data-act="person" data-nick="${esc(p.username)}">${esc(p.username)}</button></div></td>
      <td class="c-extra">${role}</td>
      <td class="c-extra">${p.telegram ? tgLink(p.telegram) : ""}</td>
      <td class="c-extra${p.suspended ? "" : " c-dash"}">${status}</td>
      <td class="acts">${acts ? `<div class="acts-wrap">${acts}</div>` : ""}</td>
    </tr>`;
  }

  // ───────────────────────── сторінка: ліцензії ─────────────────────────
  function licensesPage() {
    const cats = licOrder();
    if (!S.licCat || !cats.includes(S.licCat)) S.licCat = cats[0] || null;
    const addCatChip = P.manageGroups() ? `<button type="button" class="chip chip-add" data-act="add-category" data-k="__add">${I.plus}Категорія</button>` : "";
    if (!S.licCat) {
      return `${guestNotice()}<div class="toolbar"><div class="chips" data-slider="lic-cat" role="group" aria-label="Категорія">${addCatChip}</div></div><div class="card"><div class="empty"><strong>Категорій ліцензій поки немає</strong>${P.manageGroups() ? "Створіть першу кнопкою «Категорія»." : ""}</div></div>`;
    }
    const cat = S.licCat;
    const meta = licMeta(cat);
    const chips = `<div class="chips" data-slider="lic-cat" role="group" aria-label="Категорія">${cats.map((c) => `<button type="button" class="chip" data-act="lic-cat" data-c="${esc(c)}" aria-pressed="${c === cat}">${esc(licMeta(c).label)} <span class="n">${licEntries(c).length}</span></button>`).join("")}${addCatChip}</div>`;

    const all = licEntries(cat).map((e) => ({ ...e, st: licStatus(cat, e.d) }));
    const q = S.licQ.trim().toLowerCase();
    const counts = { all: all.length, ok: 0, bad: 0, warn: 0 };
    all.forEach((e) => { counts[e.st.kind]++; });
    const rows = all.filter((e) => {
      if (S.licStatus !== "all" && e.st.kind !== S.licStatus) return false;
      if (!q) return true;
      return [e.name, e.d.status, e.d.role, e.d.telegram, e.d.expiry, e.d.cans, e.d.suspended].some((x) => String(x || "").toLowerCase().includes(q));
    });
    const seg = `<div class="seg" data-slider="lic-st" role="group" aria-label="Статус">${[["all", "Усі"], ["ok", "Дійсні"], ["warn", "Увага"], ["bad", "Скасовані"]].map(([k, l]) => `<button type="button" data-act="lic-status" data-s="${k}" aria-pressed="${S.licStatus === k}">${l} ${counts[k] ? `<span style="opacity:.6">${counts[k]}</span>` : ""}</button>`).join("")}</div>`;
    const toolbar = `<div class="toolbar"><div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="lic-q" value="${esc(S.licQ)}" placeholder="Нік, ID, назва або Telegram" aria-label="Фільтр ліцензій"></div>${seg}<div class="grow"></div>${P.editLic(cat) ? `<button type="button" class="btn btn-primary" data-act="add-lic" data-c="${esc(cat)}">${I.plus}Додати ліцензію</button>` : ""}</div>`;

    const isList = Array.isArray(S.licenses[cat]);
    const cols = meta.fields.filter((f) => f.col);
    const shownN = S.pages["lic:" + cat] || PAGE;
    const slice = rows.slice(0, shownN);
    const head = `<tr>${isList ? '<th class="num">№</th>' : ""}<th>Власник</th>${cols.map((c) => `<th>${esc(c.col)}</th>`).join("")}<th>Telegram</th><th>Статус</th><th class="acts"><span class="sr-only">Дії</span></th></tr>`;
    const len = (S.licenses[cat] || []).length;
    const body = slice.map((e) => {
      const a = dataAttrs({ c: cat, nick: e.name });
      let acts = "";
      if (P.editLic(cat)) {
        if (isList) {
          acts += iconBtn("move-lic", I.up, "Підняти вище", `${a} data-dir="moveUp" ${e.index === 0 ? "disabled" : ""}`);
          acts += iconBtn("move-lic", I.down, "Опустити нижче", `${a} data-dir="moveDown" ${e.index >= len - 1 ? "disabled" : ""}`);
        }
        acts += iconBtn("edit-lic", I.edit, "Редагувати", a);
      }
      if (P.deleteLic(cat)) acts += iconBtn("delete-lic", I.trash, "Видалити", a, "danger");
      const cells = cols.map((c) => {
        let v = e.d[c.k];
        if (c.rank && isXp(v)) return `<td class="c-extra" data-label="${esc(c.col)}">${esc(getPoliceRank(v))}<span class="sub">XP ${esc(v)}</span></td>`;
        return `<td class="c-extra ${c.id ? "id" : ""}" data-label="${esc(c.col)}">${v ? esc(v) : ""}</td>`;
      }).join("");
      return `<tr>${isList ? `<td class="num">${e.index + 1}</td>` : ""}
        <td class="c-who"><div class="who">${avaHtml(e.name)}<button type="button" class="who-btn" data-act="person" data-nick="${esc(e.name)}">${esc(e.name)}</button></div></td>
        ${cells}
        <td class="c-extra">${e.d.telegram ? tgLink(e.d.telegram) : ""}</td>
        <td class="c-extra">${statusChip(e.st)}</td>
        <td class="acts">${acts ? `<div class="acts-wrap">${acts}</div>` : ""}</td></tr>`;
    }).join("");

    const table = rows.length
      ? `<div class="reg-wrap"><table class="reg"><thead>${head}</thead><tbody>${body}</tbody></table></div>${rows.length > shownN ? `<button type="button" class="more" data-act="more" data-key="lic:${esc(cat)}">Показати ще ${fmt(Math.min(PAGE, rows.length - shownN))} з ${fmt(rows.length - shownN)}</button>` : ""}`
      : `<div class="empty"><strong>${q || S.licStatus !== "all" ? "Нічого не знайдено" : "У категорії поки немає ліцензій"}</strong>${q || S.licStatus !== "all" ? "Змініть пошук або фільтр статусу." : ""}</div>`;

    return `${guestNotice()}<div class="toolbar">${chips}</div>${toolbar}<div class="card"><div class="card-head"><h2>${esc(meta.title)}</h2><p>${fmt(rows.length)} ${plural(rows.length, ["запис", "записи", "записів"])}${isList ? ", порядок як на сайті" : ", за абеткою"}</p>${P.manageGroups() ? `<div class="right"><button type="button" class="btn btn-sm btn-quiet-danger" data-act="delete-category" data-c="${esc(cat)}">${I.trash}Видалити категорію</button></div>` : ""}</div>${table}</div>`;
  }

  // ───────────────────────── сторінка: перегляди ─────────────────────────
  let seriesCache = null;
  function series() {
    if (!S.views) return [];
    if (seriesCache) return seriesCache;
    const keys = Object.keys(S.views).sort();
    if (!keys.length) return (seriesCache = []);
    const t = todayKey();
    const end = keys[keys.length - 1] > t ? keys[keys.length - 1] : t;
    const out = [];
    for (let k = keys[0]; k <= end; k = addDays(k, 1)) out.push({ k, v: S.views[k] || 0, partial: k === t });
    // ковзне середнє за 7 завершених днів (сьогоднішній неповний день не враховуємо)
    for (let i = 0; i < out.length; i++) {
      if (out[i].partial) { out[i].avg = null; continue; }
      const from = Math.max(0, i - 6);
      let s = 0, n = 0;
      for (let j = from; j <= i; j++) { s += out[j].v; n++; }
      out[i].avg = n >= 3 ? s / n : null;
    }
    return (seriesCache = out);
  }

  const RANGES = [[7, "7 днів"], [30, "30 днів"], [90, "90 днів"], [365, "Рік"], [0, "Увесь час"]];
  // [за …, до попередніх …]
  const RANGE_TEXT = { 7: ["7 днів", "попередніх 7 днів"], 30: ["30 днів", "попередніх 30 днів"], 90: ["90 днів", "попередніх 90 днів"], 365: ["рік", "попереднього року"], 0: ["увесь час", ""] };

  function viewsPage() {
    if (S.viewsError && !S.views) return notice(`<strong>Не вдалося завантажити статистику переглядів.</strong> ${esc(S.viewsError)}.`, { error: true, icon: I.alert, action: `<button class="btn btn-sm" data-act="refresh">Спробувати ще раз</button>` });
    if (!S.views) return `<div class="boot"><span class="spinner"></span>Завантажую перегляди…</div>`;
    const ser = series();
    if (!ser.length) return `<div class="empty"><strong>Лічильник порожній</strong>Головний сайт ще не записав жодного перегляду.</div>`;
    const N = S.range || ser.length;
    const slice = ser.slice(-N);
    const prev = S.range && ser.length >= 2 * N ? ser.slice(-2 * N, -N) : null;
    const total = slice.reduce((s, p) => s + p.v, 0);
    const prevTotal = prev ? prev.reduce((s, p) => s + p.v, 0) : null;
    const done = slice.filter((p) => !p.partial);
    const avg = done.length ? done.reduce((s, p) => s + p.v, 0) / done.length : 0;
    const best = slice.reduce((b, p) => (p.v > b.v ? p : b), slice[0]);
    const t = todayKey();
    const tv = S.views[t] || 0, yv = S.views[addDays(t, -1)] || 0;
    const [rangeLabel, prevLabel] = RANGE_TEXT[S.range] || RANGE_TEXT[30];

    const filter = `<div class="toolbar"><div class="seg" data-slider="range" role="group" aria-label="Період">${RANGES.map(([v, l]) => `<button type="button" data-act="range" data-r="${v}" aria-pressed="${S.range === v}">${l}</button>`).join("")}</div><div class="grow"></div><button type="button" class="btn btn-sm" data-act="toggle-table" aria-pressed="${S.showTable}">${S.showTable ? "Сховати таблицю" : "Показати таблицею"}</button></div>`;

    const ledger = `<div class="ledger">
      <div><div class="stat-label">Переглядів за ${rangeLabel}</div><div class="stat-value hero">${fmt(total)}</div><div class="stat-note">${prevTotal ? deltaHtml(total, prevTotal) + ` до ${prevLabel}` : `з ${fDayYear.format(keyToDate(slice[0].k))}`}</div></div>
      <div><div class="stat-label">У середньому за день</div><div class="stat-value">${fmt(avg)}</div><div class="stat-note">без сьогоднішнього неповного дня</div></div>
      <div><div class="stat-label">Найкращий день</div><div class="stat-value">${fmt(best.v)}</div><div class="stat-note">${esc(dayTitle(best.k))}</div></div>
      <div><div class="stat-label">Сьогодні</div><div class="stat-value" data-live="today">${fmt(tv)}</div><div class="stat-note">учора ${fmt(yv)}</div></div>
    </div>`;

    const daily = `<div class="card"><div class="card-head"><h2>Перегляди за днями</h2><p>Один браузер зараховується не частіше ніж раз на 5 хвилин</p></div>
      <div class="legend"><span><i class="k-bar"></i>Перегляди за день</span><span><i class="k-line"></i>Середнє за 7 днів</span><span><i class="k-part"></i>Сьогодні, день триває</span></div>
      <div data-chart="daily"></div>${S.showTable ? viewsTable(slice) : ""}</div>`;

    const wd = `<div class="card"><div class="card-head"><h2>За днями тижня</h2><p>Середнє за ${rangeLabel}, без сьогоднішнього дня</p></div><div data-chart="weekday"></div></div>`;
    const months = `<div class="card"><div class="card-head"><h2>Помісячно</h2><p>За весь час, незалежно від обраного періоду</p></div><div data-chart="months"></div></div>`;

    return `${filter}${ledger}${daily}<div class="grid grid-3-2">${months}${wd}</div>`;
  }

  function viewsTable(slice) {
    const rows = slice.slice().reverse();
    return `<div class="table-scroll" style="margin-top:16px"><table class="data-table"><thead><tr><th>Дата</th><th class="r">Перегляди</th><th class="r">Середнє за 7 днів</th></tr></thead><tbody>${rows.map((p) => `<tr><td>${esc(dayTitle(p.k))}${p.partial ? " (триває)" : ""}</td><td class="r">${fmt(p.v)}</td><td class="r">${p.avg == null ? "—" : fmt(p.avg)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  // ───────────────────────── графіки ─────────────────────────
  function niceScale(max, ticks = 4) {
    if (max <= 0) return { max: 4, step: 1 };
    const raw = max / ticks;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const n = raw / pow;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    return { max: Math.ceil(max / step) * step, step };
  }
  const tickLabel = (v) => (v >= 1000 ? fmt1(v / 1000) + " тис." : fmt(v));
  function barPath(x, yTop, w, yBase, r) {
    const h = yBase - yTop;
    if (h <= 0.5) return "";
    r = Math.min(r, w / 2, h);
    return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
  }
  const tipRow = (key, value, label) => `<div class="row"><i class="${key}"></i><b>${value}</b><span>${label}</span></div>`;

  function drawChart(el) {
    const kind = el.getAttribute("data-chart");
    const ser = series();
    if (!ser.length) return;
    if (kind === "heat") drawHeat(el, ser);
    else if (kind === "daily") drawDaily(el, ser.slice(-(S.range || ser.length)));
    else if (kind === "weekday") drawWeekday(el, ser.slice(-(S.range || ser.length)));
    else if (kind === "months") drawMonths(el, ser);
  }

  function drawDaily(el, pts) {
    const W = Math.max(280, Math.floor(el.clientWidth));
    const H = W < 520 ? 220 : 280;
    const m = { l: 44, r: 8, t: 14, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = pts.length;
    const sc = niceScale(Math.max(1, ...pts.map((p) => Math.max(p.v, p.avg || 0))));
    const y = (v) => m.t + ih - (v / sc.max) * ih;
    const band = iw / n;
    const asBars = band >= 5;
    const cx = (i) => m.l + i * band + band / 2;
    let s = "";
    for (let v = sc.step; v <= sc.max + 1e-9; v += sc.step) {
      s += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${tickLabel(v)}</text>`;
    }
    s += `<text x="${m.l - 8}" y="${y(0) + 4}" text-anchor="end">0</text>`;
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 78))));
    for (let i = n - 1; i >= 0; i -= every) {
      s += `<text x="${clamp(cx(i), m.l + 18, W - m.r - 18)}" y="${H - 8}" text-anchor="middle">${esc(fDayShort.format(keyToDate(pts[i].k)))}</text>`;
    }
    if (asBars) {
      const bw = Math.max(1, Math.min(24, band * 0.72, band - 2));
      pts.forEach((p, i) => {
        const d = barPath(m.l + i * band + (band - bw) / 2, y(p.v), bw, y(0), 4);
        if (d) s += `<path class="bar${p.partial ? " partial" : ""}" data-i="${i}" d="${d}"/>`;
      });
    } else {
      const line = pts.map((p, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
      s += `<path class="series-area" d="${line}L${cx(n - 1).toFixed(1)},${y(0)}L${cx(0).toFixed(1)},${y(0)}Z"/><path class="series-line" d="${line}"/>`;
    }
    let avgD = "", started = false;
    pts.forEach((p, i) => {
      if (p.avg == null) { started = false; return; }
      avgD += `${started ? "L" : "M"}${cx(i).toFixed(1)},${y(p.avg).toFixed(1)}`;
      started = true;
    });
    if (avgD) s += `<path class="avg" d="${avgD}"/>`;
    s += `<line class="base-line" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    s += `<g class="hover" visibility="hidden"><line class="xhair" y1="${m.t}" y2="${y(0)}"/><circle class="dot" r="4"/></g>`;
    s += `<rect class="overlay" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" tabindex="0" role="img" aria-label="Графік переглядів за ${n} ${plural(n, ["день", "дні", "днів"])}. Стрілки вліво і вправо показують значення за днями."/>`;
    el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${s}</svg></div>`;

    const svgEl = $("svg", el), hover = $(".hover", el), overlay = $(".overlay", el);
    let cur = -1;
    const show = (i, clientX, clientY) => {
      i = clamp(i, 0, n - 1);
      const p = pts[i];
      if (cur !== i) {
        if (asBars) {
          svgEl.classList.add("hovering");
          const prevBar = $(`.bar[data-i="${cur}"]`, svgEl);
          if (prevBar) prevBar.classList.remove("on");
          const bar = $(`.bar[data-i="${i}"]`, svgEl);
          if (bar) bar.classList.add("on");
        }
        cur = i;
      }
      hover.setAttribute("visibility", "visible");
      $("line", hover).setAttribute("x1", cx(i)); $("line", hover).setAttribute("x2", cx(i));
      const dot = $("circle", hover);
      dot.setAttribute("cx", cx(i)); dot.setAttribute("cy", y(p.v));
      dot.style.display = asBars ? "none" : "";
      const html = `<div class="tt">${esc(dayTitle(p.k))}${p.partial ? ", день триває" : ""}</div>${tipRow("key-bar", fmt(p.v), views_(p.v))}${p.avg != null ? tipRow("key-line", fmt(p.avg), "середнє за 7 днів") : ""}`;
      const r = svgEl.getBoundingClientRect();
      const px = clientX ?? r.left + (cx(i) / W) * r.width;
      const py = clientY ?? r.top + (y(p.v) / H) * r.height;
      showTip(html, px, py);
    };
    const hide = () => {
      hover.setAttribute("visibility", "hidden");
      svgEl.classList.remove("hovering");
      $$(".bar.on", svgEl).forEach((b) => b.classList.remove("on"));
      cur = -1;
      hideTip();
    };
    const idxAt = (clientX) => {
      const r = svgEl.getBoundingClientRect();
      const xs = (clientX - r.left) * (W / r.width);
      return Math.floor((xs - m.l) / band);
    };
    overlay.addEventListener("pointermove", (e) => show(idxAt(e.clientX), e.clientX, e.clientY));
    overlay.addEventListener("pointerdown", (e) => show(idxAt(e.clientX), e.clientX, e.clientY));
    overlay.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); });
    overlay.addEventListener("focus", () => show(cur < 0 ? n - 1 : cur));
    overlay.addEventListener("blur", hide);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); show((cur < 0 ? n : cur) - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); show((cur < 0 ? -1 : cur) + 1); }
      else if (e.key === "Home") { e.preventDefault(); show(0); }
      else if (e.key === "End") { e.preventDefault(); show(n - 1); }
      else if (e.key === "Escape") hide();
    });
  }

  function columns(el, items, opts = {}) {
    const W = Math.max(260, Math.floor(el.clientWidth));
    const H = opts.height || 220;
    const m = { l: 44, r: 8, t: 22, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = items.length;
    const sc = niceScale(Math.max(1, ...items.map((x) => x.v)));
    const y = (v) => m.t + ih - (v / sc.max) * ih;
    const band = iw / n;
    const bw = Math.max(2, Math.min(24, band * 0.6, band - 2));
    const labels = band >= 28;
    let s = "";
    for (let v = sc.step; v <= sc.max + 1e-9; v += sc.step) {
      s += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${tickLabel(v)}</text>`;
    }
    s += `<text x="${m.l - 8}" y="${y(0) + 4}" text-anchor="end">0</text>`;
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 44))));
    items.forEach((it, i) => {
      const x = m.l + i * band + (band - bw) / 2;
      const d = barPath(x, y(it.v), bw, y(0), 4);
      if (d) s += `<path class="bar${it.partial ? " partial" : ""}" d="${d}"/>`;
      if (labels && (opts.allLabels || it.highlight)) s += `<text class="val-label" x="${x + bw / 2}" y="${y(it.v) - 6}" text-anchor="middle">${esc(opts.short ? tickLabel(it.v) : fmt(it.v))}</text>`;
      if ((n - 1 - i) % every === 0) s += `<text x="${m.l + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
      s += `<rect class="hit" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ih}" tabindex="0" data-tip="${esc(it.tip)}" aria-label="${esc(it.aria || it.label + ": " + fmt(it.v))}"/>`;
    });
    s += `<line class="base-line" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${s}</svg></div>${opts.after || ""}`;
  }

  function drawWeekday(el, pts) {
    const sum = Array(7).fill(0), cnt = Array(7).fill(0);
    pts.forEach((p) => { if (p.partial) return; const d = dow(p.k); sum[d] += p.v; cnt[d]++; });
    const avg = sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
    columns(el, avg.map((v, i) => ({
      v: Math.round(v), label: WEEKDAYS[i], highlight: true,
      tip: `<div class="tt">${WEEKDAYS_LONG[i]}, середнє за ${cnt[i]} ${plural(cnt[i], ["день", "дні", "днів"])}</div>${tipRow("key-bar", fmt(v), views_(Math.round(v)))}`,
      aria: `${WEEKDAYS_LONG[i]}: у середньому ${fmt(v)}`,
    })), { allLabels: true, height: 220 });
  }

  function drawMonths(el, ser) {
    const map = new Map();
    ser.forEach((p) => {
      const mk = p.k.slice(0, 7);
      if (!map.has(mk)) map.set(mk, { v: 0, days: 0 });
      const o = map.get(mk); o.v += p.v; o.days++;
    });
    const cur = todayKey().slice(0, 7);
    const first = ser[0].k.slice(0, 7);
    const items = [...map.entries()].map(([mk, o]) => {
      const d = keyToDate(mk + "-01");
      const partial = mk === cur || mk === first;
      const label = fMonth.format(d).replace(".", "") + (d.getUTCMonth() === 0 || mk === first || mk === cur ? " " + String(d.getUTCFullYear()).slice(2) : "");
      return {
        v: o.v, label, partial, highlight: mk === cur,
        tip: `<div class="tt">${esc(fMonthYear.format(d))}${mk === cur ? ", місяць триває" : mk === first ? ", лічильник запущено " + fDay.format(keyToDate(ser[0].k)) : ""}</div>${tipRow("key-bar", fmt(o.v), views_(o.v))}<div class="row"><span>${fmt(o.v / o.days)} на день у середньому</span></div>`,
        aria: `${fMonthYear.format(d)}: ${fmt(o.v)}`,
      };
    });
    const maxItem = items.reduce((b, x) => (x.v > b.v ? x : b), items[0]);
    maxItem.highlight = true;
    columns(el, items, { height: 220, short: true, after: `<div class="legend" style="margin:10px 0 0"><span><i class="k-bar"></i>Повний місяць</span><span><i class="k-part"></i>Неповний: перший місяць лічильника або поточний</span></div>` });
  }

  function drawHeat(el, ser) {
    const nonZero = ser.filter((p) => p.v > 0 && !p.partial).map((p) => p.v).sort((a, b) => a - b);
    const q = (f) => nonZero.length ? nonZero[Math.min(nonZero.length - 1, Math.floor(f * nonZero.length))] : 0;
    const th = [q(0.2), q(0.4), q(0.6), q(0.8)];
    const level = (v) => (v <= 0 ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : v <= th[3] ? 4 : 5);
    const first = ser[0].k, last = ser[ser.length - 1].k;
    const start = addDays(first, -dow(first));
    const weeks = Math.floor(dayDiff(start, last) / 7) + 1;
    const cell = 13, gap = 3, step = cell + gap, top = 20, left = 30;
    const W = left + weeks * step, H = top + 7 * step;
    let s = "";
    [0, 2, 4, 6].forEach((r) => { s += `<text class="d-label" x="0" y="${top + r * step + cell - 2}">${WEEKDAYS[r]}</text>`; });
    let lastLabelCol = -10;
    const byKey = new Map(ser.map((p) => [p.k, p]));
    for (let k = start, i = 0; k <= last; k = addDays(k, 1), i++) {
      const col = Math.floor(i / 7), row = i % 7;
      if (k.endsWith("-01") || k === first) {
        if (col - lastLabelCol >= 3) {
          const d = keyToDate(k);
          s += `<text class="m-label" x="${left + col * step}" y="12">${esc(fMonth.format(d).replace(".", "") + (d.getUTCMonth() === 0 || k === first ? " " + d.getUTCFullYear() : ""))}</text>`;
          lastLabelCol = col;
        }
      }
      if (k < first) continue;
      const p = byKey.get(k);
      const v = p ? p.v : 0;
      const tip = `<div class="tt">${esc(dayTitle(k))}${p && p.partial ? ", день триває" : ""}</div>${tipRow("key-bar", fmt(v), views_(v))}`;
      s += `<rect class="c" x="${left + col * step}" y="${top + row * step}" width="${cell}" height="${cell}" rx="2" style="fill:var(--heat-${level(v)})" data-tip="${esc(tip)}"/>`;
    }
    const ranges = [
      ["0", 0],
      [`1–${fmt(th[0])}`, 1],
      [`${fmt(th[0] + 1)}–${fmt(th[1])}`, 2],
      [`${fmt(th[1] + 1)}–${fmt(th[2])}`, 3],
      [`${fmt(th[2] + 1)}–${fmt(th[3])}`, 4],
      [`понад ${fmt(th[3])}`, 5],
    ];
    el.innerHTML = `<div class="heat-scroll"><div class="chart heat"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Календар переглядів з ${esc(fDayYear.format(keyToDate(first)))}. Точні значення — у таблиці на сторінці «Перегляди»."><g>${s}</g></svg></div></div>
      <div class="heat-legend"><span>Переглядів за день:</span>${ranges.map(([l, i]) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:8px"><i style="background:var(--heat-${i})"></i>${l}</span>`).join("")}</div>`;
  }

  // ───────────────────────── підказка ─────────────────────────
  const tipEl = $("#tip");
  function showTip(html, x, y) {
    tipEl.innerHTML = html;
    tipEl.classList.add("show");
    const r = tipEl.getBoundingClientRect();
    let left = x + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    let top = y - r.height - 12;
    if (top < 8) top = y + 18;
    tipEl.style.left = Math.max(8, left) + "px";
    tipEl.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { tipEl.classList.remove("show"); }
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (t) showTip(t.getAttribute("data-tip"), e.clientX, e.clientY);
  });
  document.addEventListener("pointermove", (e) => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (t) showTip(t.getAttribute("data-tip"), e.clientX, e.clientY);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (t) { const r = t.getBoundingClientRect(); showTip(t.getAttribute("data-tip"), r.left + r.width / 2, r.top); }
  });
  document.addEventListener("focusout", (e) => { if (e.target.closest && e.target.closest("[data-tip]")) hideTip(); });
  addEventListener("scroll", hideTip, { passive: true });
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest && (e.target.closest("[data-tip]") || e.target.closest(".overlay"))) return;
    hideTip();
  });

  // ───────────────────────── тости ─────────────────────────
  function toast(msg, error = false) {
    const t = document.createElement("div");
    t.className = "toast" + (error ? " error" : "");
    t.innerHTML = (error ? I.alert : I.check) + `<span>${esc(msg)}</span>`;
    $("#toasts").appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, error ? 6000 : 3500);
    setTimeout(() => t.remove(), error ? 6400 : 3900);
  }

  // ───────────────────────── діалоги ─────────────────────────
  const dlg = $("#dlg");
  function openDialog(html, onSubmit) {
    dlg.innerHTML = html;
    dlg._onSubmit = onSubmit;
    if (!dlg.open) dlg.showModal();
    const first = $("input:not([type=hidden]), select", dlg);
    if (first && window.innerWidth > 860) first.focus();
  }
  function closeDialog() { if (dlg.open) dlg.close(); }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(); });
  dlg.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!dlg._onSubmit) return;
    const btn = $('button[type="submit"]', dlg);
    const label = btn ? btn.textContent : "";
    $$(".field", dlg).forEach((f) => { f.classList.remove("invalid"); const er = $(".err", f); if (er) er.remove(); });
    const errBox = $(".form-error", dlg);
    if (errBox) errBox.remove();
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Збереження…"; }
      await dlg._onSubmit(new FormData($("form", dlg)));
    } catch (err) {
      if (err && err.field) {
        const f = $(`[name="${err.field}"]`, dlg);
        const wrap = f && f.closest(".field");
        if (wrap) { wrap.classList.add("invalid"); wrap.insertAdjacentHTML("beforeend", `<span class="err">${esc(err.message)}</span>`); f.focus(); }
      } else {
        const form = $("form", dlg);
        $(".dlg-actions", form).insertAdjacentHTML("beforebegin", `<div class="form-error" role="alert">${esc(err.message || String(err))}</div>`);
      }
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  });
  const fieldErr = (field, message) => Object.assign(new Error(message), { field });

  function inputField(name, label, value, ph, opts = {}) {
    return `<div class="field"><label for="f-${name}">${esc(label)}${opts.required ? " *" : ""}</label><input id="f-${name}" name="${name}" value="${esc(value || "")}" placeholder="${esc(ph || "")}" autocomplete="off" ${opts.required ? "required" : ""} ${opts.maxlength ? `maxlength="${opts.maxlength}"` : ""}>${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ""}</div>`;
  }

  // ── гравець ──
  function playerForm(mode, fraction, nick = "", presetNick = "") {
    const p = mode === "edit" ? (S.players[fraction] || []).find((x) => x && String(x.username).toLowerCase() === nick.toLowerCase()) || {} : {};
    const fractions = mode === "add" ? addableFractions() : [fraction];
    if (mode === "add" && !fractions.length) return toast("У вас немає прав додавати гравців.", true);
    const fr = fraction && fractions.includes(fraction) ? fraction : fractions[0];
    const select = mode === "add" && (!fraction || fractions.length > 1)
      ? `<div class="field"><label for="f-fraction">Фракція *</label><select id="f-fraction" name="fraction">${fractions.map((f) => `<option ${f === fr ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></div>`
      : `<input type="hidden" name="fraction" value="${esc(fr)}">`;
    const html = `<form method="dialog" novalidate>
      <h2>${mode === "add" ? "Додати гравця" : "Редагувати гравця"}</h2>
      <p class="dlg-sub">${mode === "add" ? "Новий гравець у фракції" : "Фракція " + esc(fr)}</p>
      ${select}
      ${inputField("username", "Нікнейм (Roblox)", p.username || presetNick, "Введіть нікнейм", { required: true, maxlength: 20, hint: "3–20 символів: латиниця, цифри, _" })}
      ${inputField("role", fr === "НПС" ? "Звання або кількість XP" : "Роль / звання", p.role, fr === "НПС" ? "Напр. 7500" : "Введіть посаду")}
      ${inputField("telegram", "Telegram", p.telegram, "@username, t.me/username або ID", { hint: "За ним визначаються права гравця" })}
      ${inputField("avatar", "Посилання на аватар", p.avatar, "https://… (необовʼязково)")}
      ${inputField("suspended", "Відсторонення (термін або причина)", p.suspended, "Напр. до 01.09.2026")}
      <div class="dlg-actions"><button type="button" class="btn" data-act="close-dlg">Скасувати</button><button type="submit" class="btn btn-primary">${mode === "add" ? "Додати" : "Зберегти"}</button></div>
    </form>`;
    openDialog(html, async (fd) => {
      const f = String(fd.get("fraction") || fr);
      const data = {
        username: String(fd.get("username") || "").trim(),
        role: String(fd.get("role") || "").trim(),
        telegram: String(fd.get("telegram") || "").trim(),
        avatar: String(fd.get("avatar") || "").trim(),
        suspended: String(fd.get("suspended") || "").trim(),
      };
      if (!data.username) throw fieldErr("username", "Вкажіть нікнейм.");
      if (!ROBLOX_RE.test(data.username)) throw fieldErr("username", "Нікнейм Roblox: 3–20 символів, лише латиниця, цифри та _.");
      if (data.avatar && !/^https:\/\//i.test(data.avatar)) throw fieldErr("avatar", "Посилання має починатися з https://");
      const arr = S.players[f] || [];
      const dup = arr.find((x) => x && String(x.username).toLowerCase() === data.username.toLowerCase());
      if (dup && (mode === "add" || data.username.toLowerCase() !== nick.toLowerCase())) throw fieldErr("username", `${dup.username} уже є у фракції ${f}.`);
      if (mode === "add" && playerCount() >= 100) throw new Error("У фракціях уже 100 гравців — це максимум. Спершу приберіть когось.");
      await runEdit({ targetFile: "players.js", action: mode, fraction: f, username: mode === "edit" ? nick : "", data }, () => applyPlayers(mode, f, mode === "edit" ? nick : "", data));
      closeDialog();
      toast(mode === "add" ? `${data.username} додано до фракції ${f}` : `Зміни для ${data.username} збережено`);
    });
  }

  // ── ліцензія ──
  function licForm(mode, cat, nick = "", presetNick = "") {
    const cats = mode === "add" ? editableCats() : [cat];
    if (!cats.length) return toast("У вас немає прав на ліцензії.", true);
    const c0 = cat && cats.includes(cat) ? cat : cats[0];
    const entry = mode === "edit" ? licEntries(c0).find((e) => e.name.toLowerCase() === nick.toLowerCase()) : null;
    const d = entry ? entry.d : {};
    const fieldsHtml = (c, vals) => licMeta(c).fields.map((f) => inputField(f.k, f.l, vals[f.k], f.ph)).join("");
    const select = mode === "add" && (!cat || cats.length > 1)
      ? `<div class="field"><label for="f-cat">Категорія *</label><select id="f-cat" name="cat" data-act="lic-form-cat">${cats.map((c) => `<option value="${esc(c)}" ${c === c0 ? "selected" : ""}>${esc(licMeta(c).title)}</option>`).join("")}</select></div>`
      : `<input type="hidden" name="cat" value="${esc(c0)}">`;
    const html = `<form method="dialog" novalidate>
      <h2>${mode === "add" ? "Додати ліцензію" : "Редагувати ліцензію"}</h2>
      <p class="dlg-sub">${esc(licMeta(c0).title)}${mode === "edit" ? ", власник " + esc(nick) : ""}</p>
      ${select}
      ${inputField("username", "Нікнейм (Roblox)", entry ? entry.name : presetNick, "Введіть нікнейм", { required: true, maxlength: 60 })}
      <div id="lic-fields">${fieldsHtml(c0, d)}</div>
      <div class="dlg-actions"><button type="button" class="btn" data-act="close-dlg">Скасувати</button><button type="submit" class="btn btn-primary">${mode === "add" ? "Додати" : "Зберегти"}</button></div>
    </form>`;
    openDialog(html, async (fd) => {
      const c = String(fd.get("cat") || c0);
      const u = String(fd.get("username") || "").trim();
      if (!u) throw fieldErr("username", "Вкажіть нікнейм.");
      if (u.length > 60 || /[\/#?]/.test(u)) throw fieldErr("username", "До 60 символів, без / # ?");
      const data = { username: u };
      for (const f of licMeta(c).fields) data[f.k] = String(fd.get(f.k) || "").trim();
      const exists = licEntries(c).find((e) => e.name.toLowerCase() === u.toLowerCase());
      if (exists && (mode === "add" || u.toLowerCase() !== nick.toLowerCase())) throw fieldErr("username", `У ${exists.name} уже є ${licMeta(c).title.toLowerCase()}.`);
      if (mode === "add" && licCount() >= 1000) throw new Error("Уже 1000 ліцензій — це максимум. Спершу приберіть непотрібні.");
      await runEdit({ targetFile: "licenses.js", action: mode, category: c, username: mode === "edit" ? nick : "", data }, () => applyLicense(mode, c, mode === "edit" ? nick : "", data));
      closeDialog();
      toast(mode === "add" ? `${licMeta(c).title}: ${u} додано` : `Ліцензію ${u} збережено`);
    });
    const sel = $("#f-cat", dlg);
    if (sel) sel.addEventListener("change", () => {
      const vals = {};
      $$("#lic-fields input", dlg).forEach((i) => { vals[i.name] = i.value; });
      $("#lic-fields", dlg).innerHTML = fieldsHtml(sel.value, vals);
      $(".dlg-sub", dlg).textContent = licMeta(sel.value).title;
    });
  }

  // ── фракції та категорії ──
  function addFractionDialog() {
    openDialog(`<form method="dialog" novalidate>
      <h2>Нова фракція</h2>
      <p class="dlg-sub">Фракція зʼявиться в ролях. Гравців можна додати одразу після створення.</p>
      ${inputField("name", "Назва фракції", "", "Напр. Пожежна служба", { required: true, maxlength: 40 })}
      <div class="dlg-actions"><button type="button" class="btn" data-act="close-dlg">Скасувати</button><button type="submit" class="btn btn-primary">Додати</button></div>
    </form>`, async (fd) => {
      const name = String(fd.get("name") || "").trim().replace(/\s+/g, " ");
      if (!name) throw fieldErr("name", "Вкажіть назву.");
      if (name.length > 40 || /[<>"'`\\]/.test(name)) throw fieldErr("name", "До 40 символів, без лапок і символів < > ` \\");
      if (name.toLowerCase() === "усі" || Object.keys(S.players).some((k) => k.toLowerCase() === name.toLowerCase())) throw fieldErr("name", "Така фракція вже є.");
      await runEdit({ targetFile: "players.js", action: "addGroup", fraction: name }, () => { S.players[name] = []; });
      closeDialog();
      S.fraction = name;
      history.replaceState(null, "", "#roles/" + encodeURIComponent(name));
      render();
      toast(`Фракцію «${name}» додано`);
    });
  }

  function deleteGroupDialog(kind, key) {
    const isFr = kind === "fraction";
    const count = isFr ? (S.players[key] || []).length : licEntries(key).length;
    const title = isFr ? `Видалити фракцію «${key}»?` : `Видалити категорію «${licMeta(key).label}»?`;
    const what = isFr ? plural(count, ["гравця", "гравців", "гравців"]) : plural(count, ["ліцензію", "ліцензії", "ліцензій"]);
    const text = count
      ? `Разом із ${isFr ? "фракцією" : "категорією"} буде видалено <strong>${count} ${what}</strong>. Цю дію не можна скасувати.`
      : `${isFr ? "Фракція" : "Категорія"} порожня.`;
    openDialog(`<form method="dialog" novalidate>
      <h2>${esc(title)}</h2>
      <p class="dlg-sub">${text}</p>
      ${count ? inputField("confirm", `Щоб підтвердити, введіть «${key}»`, "", key, { required: true }) : ""}
      <div class="dlg-actions"><button type="button" class="btn" data-act="close-dlg">Скасувати</button><button type="submit" class="btn btn-danger">Видалити</button></div>
    </form>`, async (fd) => {
      if (count && String(fd.get("confirm") || "").trim() !== key) throw fieldErr("confirm", "Назва не збігається.");
      if (isFr) {
        await runEdit({ targetFile: "players.js", action: "deleteGroup", fraction: key }, () => { delete S.players[key]; if (S.fraction === key) S.fraction = "Усі"; });
        history.replaceState(null, "", "#roles");
      } else {
        await runEdit({ targetFile: "licenses.js", action: "deleteGroup", category: key }, () => { delete S.licenses[key]; if (S.licCat === key) S.licCat = null; });
        history.replaceState(null, "", "#licenses");
      }
      closeDialog();
      toast(isFr ? `Фракцію «${key}» видалено` : `Категорію «${licMeta(key).label}» видалено`);
    });
  }

  function addCategoryDialog() {
    openDialog(`<form method="dialog" novalidate>
      <h2>Нова категорія ліцензій</h2>
      <p class="dlg-sub">У нової категорії будуть стандартні поля: роль або назва, статус чи ID, термін, причина скасування, Telegram і відсторонення.</p>
      ${inputField("key", "Код категорії", "", "Напр. hunting", { required: true, maxlength: 40, hint: "Латинські літери, цифри, _ або -. Під цим кодом категорія зберігається в реєстрі." })}
      <div class="field"><label for="f-order">Порядок записів</label><select id="f-order" name="order"><option value="abc">За абеткою</option><option value="manual">Вручну, стрілками вгору й униз</option></select></div>
      <div class="dlg-actions"><button type="button" class="btn" data-act="close-dlg">Скасувати</button><button type="submit" class="btn btn-primary">Додати</button></div>
    </form>`, async (fd) => {
      const key = String(fd.get("key") || "").trim();
      const ordered = fd.get("order") === "manual";
      if (!key) throw fieldErr("key", "Вкажіть код.");
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(key)) throw fieldErr("key", "Лише латинські літери, цифри, _ або -, до 40 символів.");
      if (Object.keys(S.licenses).some((k) => k.toLowerCase() === key.toLowerCase())) throw fieldErr("key", "Така категорія вже є.");
      await runEdit({ targetFile: "licenses.js", action: "addGroup", category: key, data: { ordered } }, () => { S.licenses[key] = ordered ? [] : {}; });
      closeDialog();
      S.licCat = key;
      S.licStatus = "all";
      history.replaceState(null, "", "#licenses/" + encodeURIComponent(key));
      render();
      toast(`Категорію «${licMeta(key).label}» додано`);
    });
  }

  function confirmDialog(title, text, actLabel, fn) {
    openDialog(`<form method="dialog"><h2>${esc(title)}</h2><p class="dlg-sub">${text}</p><div class="dlg-actions"><button type="button" class="btn" data-act="close-dlg">Скасувати</button><button type="submit" class="btn btn-danger">${esc(actLabel)}</button></div></form>`, async () => { await fn(); closeDialog(); });
  }

  function loginDialog() {
    const inTg = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
    if (inTg) return;
    const html = `<div class="dlg-body">
      <h2>Вхід у панель</h2>
      <p class="dlg-sub">Права залежать від вашої ролі у фракції.</p>
      <button type="button" class="btn btn-primary btn-block" data-act="login-roblox">Увійти через Roblox</button>
      <div class="or"><span>або</span></div>
      <div class="tg-widget" id="tg-widget"><span class="spinner"></span></div>
      <p class="legal">Входячи, ви погоджуєтеся з <a href="terms.html" target="_blank">умовами користування</a> та <a href="privacy.html" target="_blank">політикою конфіденційності</a>.</p>
      <div class="dlg-actions"><button type="button" class="btn" data-act="close-dlg">Закрити</button></div>
    </div>`;
    openDialog(html, null);
    const box = $("#tg-widget", dlg);
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login", CONFIG.botUsername);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "12");
    s.setAttribute("data-request-access", "write");
    s.setAttribute("data-auth-url", location.origin + location.pathname);
    s.onload = () => { const sp = $(".spinner", box); if (sp) sp.remove(); };
    s.onerror = () => { box.innerHTML = `<span style="color:var(--bad);font-size:14px">Не вдалося завантажити кнопку Telegram. Перевірте зʼєднання.</span>`; };
    box.appendChild(s);
  }

  function accountDialog() {
    const a = accountInfo();
    if (!a) return loginDialog();
    openDialog(`<div class="dlg-body"><div class="who" style="margin-bottom:16px">${avaHtml(a.avatarNick, "lg", a.avatarUrl)}<div><h2 style="margin:0">${esc(a.name)}</h2><p class="dlg-sub" style="margin:2px 0 0">${esc(a.role)}</p></div></div>
      <p class="dlg-sub">Вхід через ${a.via}: ${esc(a.loginName)}${S.auth.type === "webapp" ? " (міні-застосунок)" : ""}</p>
      ${permList()}
      <p class="legal"><a href="terms.html" target="_blank">Умови користування</a> і <a href="privacy.html" target="_blank">політика конфіденційності</a></p>
      <div class="dlg-actions">${S.auth.type !== "webapp" ? `<button type="button" class="btn" data-act="logout">${I.logout}Вийти</button>` : ""}<button type="button" class="btn btn-primary" data-act="close-dlg">Готово</button></div></div>`, null);
    hydrateAvatars(dlg);
  }

  // ───────────────────────── профіль гравця ─────────────────────────
  const drawer = $("#drawer"), veil = $("#drawer-veil");
  function openPerson(nick) {
    S.drawerNick = nick;
    renderDrawer();
    drawer.classList.add("open"); veil.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    // фокус після поточної події клавіатури, інакше Enter «натисне» кнопку закриття
    setTimeout(() => { const close = $('[data-act="close-drawer"]', drawer); if (close) close.focus(); }, 0);
  }
  function closePerson() {
    S.drawerNick = null;
    drawer.classList.remove("open"); veil.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  function renderDrawer() {
    if (!S.drawerNick) return;
    const person = S.people.get(S.drawerNick.toLowerCase());
    const nick = person ? person.nick : S.drawerNick;
    const recs = person ? person.recs : [];
    const roles = recs.filter((r) => r.kind === "player");
    const lics = recs.filter((r) => r.kind === "lic");
    const sub = roles.length ? roles.map((r) => `${r.d.role || "без ролі"}, ${r.fraction}`).join("; ") : `${lics.length} ${plural(lics.length, ["ліцензія", "ліцензії", "ліцензій"])}`;
    const dl = (pairs) => {
      const rows = pairs.filter(([, v]) => v);
      return rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>` : "";
    };
    const recHtml = recs.map((r) => {
      if (r.kind === "player") {
        const a = dataAttrs({ f: r.fraction, nick });
        const acts = (P.editPlayer(r.fraction) ? iconBtn("edit-player", I.edit, "Редагувати", a) : "") + (P.deletePlayer(r.fraction) ? iconBtn("delete-player", I.trash, "Видалити", a, "danger") : "");
        const role = r.fraction === "НПС" && isXp(r.d.role) ? `${getPoliceRank(r.d.role)} (XP ${r.d.role})` : r.d.role;
        return `<div class="rec"><div class="rec-top"><div><div class="rec-kind">Фракція ${esc(r.fraction)}, позиція ${r.index + 1}</div><div class="rec-title">${esc(role || "Без ролі")}</div></div><div class="acts-wrap">${acts}</div></div>
          ${dl([["Telegram", r.d.telegram ? tgLink(r.d.telegram) : ""], ["Відсторонення", r.d.suspended ? esc(r.d.suspended) : ""]])}</div>`;
      }
      const meta = licMeta(r.cat);
      const a = dataAttrs({ c: r.cat, nick: r.name });
      const acts = (P.editLic(r.cat) ? iconBtn("edit-lic", I.edit, "Редагувати", a) : "") + (P.deleteLic(r.cat) ? iconBtn("delete-lic", I.trash, "Видалити", a, "danger") : "");
      const pairs = meta.fields.filter((f) => f.k !== "telegram").map((f) => [f.l.replace(/ \(.*\)$/, ""), r.d[f.k] ? esc(f.rank && isXp(r.d[f.k]) ? `${getPoliceRank(r.d[f.k])} (XP ${r.d[f.k]})` : r.d[f.k]) : ""]);
      pairs.push(["Telegram", r.d.telegram ? tgLink(r.d.telegram) : ""]);
      return `<div class="rec"><div class="rec-top"><div><div class="rec-kind">${esc(meta.title)}</div><div style="margin-top:4px">${statusChip({ ...licStatus(r.cat, r.d), note: "" })}</div></div><div class="acts-wrap">${acts}</div></div>${dl(pairs)}</div>`;
    }).join("");
    const canAddRole = addableFractions().length > 0;
    const canAddLic = editableCats().length > 0;
    drawer.innerHTML = `<div class="drawer-head">${avaHtml(nick, "lg")}<div style="min-width:0"><h2>${esc(nick)}</h2><p>${esc(sub)}</p><p><a class="tg-link" href="https://www.roblox.com/user.aspx?username=${encodeURIComponent(nick)}" target="_blank" rel="noopener noreferrer">Профіль Roblox</a></p></div>${iconBtn("close-drawer", I.close, "Закрити")}</div>
      <div class="drawer-body">${recHtml || `<div class="empty"><strong>Записів немає</strong>Цього гравця більше немає в реєстрі.</div>`}</div>
      ${canAddRole || canAddLic ? `<div class="drawer-foot">${canAddRole ? `<button type="button" class="btn" data-act="add-player" data-preset="${esc(nick)}">${I.plus}Роль</button>` : ""}${canAddLic ? `<button type="button" class="btn" data-act="add-lic" data-preset="${esc(nick)}">${I.plus}Ліцензія</button>` : ""}</div>` : ""}`;
    hydrateAvatars(drawer);
  }
  veil.addEventListener("click", closePerson);

  // ───────────────────────── пошук ─────────────────────────
  const gq = $("#global-q"), gr = $("#global-results");
  let gActive = -1, gItems = [];
  function searchPeople(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const p of S.people.values()) {
      let score = 0;
      if (p.k === q) score = 100;
      else if (p.k.startsWith(q)) score = 60;
      else if (p.k.includes(q)) score = 40;
      else if ([...p.ids].some((x) => x.toLowerCase().includes(q))) score = 30;
      else if ([...p.tg].some((x) => x.toLowerCase().includes(q))) score = 20;
      if (score) out.push({ p, score });
    }
    return out.sort((a, b) => b.score - a.score || a.p.k.localeCompare(b.p.k)).slice(0, 8).map((x) => x.p);
  }
  function renderSearch() {
    const q = gq.value;
    gItems = searchPeople(q);
    if (!q.trim()) { gr.hidden = true; gq.setAttribute("aria-expanded", "false"); return; }
    gr.hidden = false;
    gq.setAttribute("aria-expanded", "true");
    if (!gItems.length) { gr.innerHTML = `<div class="search-empty">Нікого не знайдено за «${esc(q.trim())}»</div>`; return; }
    gr.innerHTML = gItems.map((p, i) => {
      const meta = p.recs.map((r) => (r.kind === "player" ? r.fraction : licMeta(r.cat).label)).join(", ");
      return `<button type="button" role="option" class="${i === gActive ? "active" : ""}" data-act="person" data-nick="${esc(p.nick)}">${avaHtml(p.nick, "sm")}<span style="min-width:0"><span class="sr-name">${esc(p.nick)}</span><span class="sr-meta" style="display:block">${esc(meta)}</span></span></button>`;
    }).join("");
    hydrateAvatars(gr);
  }
  gq.addEventListener("input", () => { gActive = -1; renderSearch(); });
  gq.addEventListener("focus", renderSearch);
  gq.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); gActive = Math.min(gItems.length - 1, gActive + 1); renderSearch(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); gActive = Math.max(0, gActive - 1); renderSearch(); }
    else if (e.key === "Enter") { e.preventDefault(); const p = gItems[gActive < 0 ? 0 : gActive]; if (p) { gr.hidden = true; gq.blur(); openPerson(p.nick); } }
    else if (e.key === "Escape") { gr.hidden = true; gq.blur(); }
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#global-search")) gr.hidden = true; });

  // ───────────────────────── редагування ─────────────────────────
  async function callEdit(payload) {
    if (!S.auth) throw new Error("Увійдіть, щоб редагувати.");
    const body = { ...payload };
    if (S.auth.type === "webapp") body.initData = S.auth.initData;
    else if (S.auth.type === "roblox") body.rbxSession = S.auth.session;
    else body.tgLogin = S.auth.data;
    let res;
    try {
      res = await fetch(CONFIG.editApi, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Сервер редагування недоступний. Перевірте зʼєднання й спробуйте ще раз.");
    }
    let json = null;
    try { json = await res.json(); } catch { /* не JSON */ }
    if (json && json.success) return json;
    let msg = (json && json.error) || `Сервер відповів кодом ${res.status}.`;
    if (S.auth.type !== "webapp" && /initData|авторизац/i.test(msg)) {
      msg = "Вхід із браузера поки недоступний. Відкрийте панель у Telegram.";
    } else if (S.auth.type !== "webapp" && res.status === 401) {
      // вхід протермінувався або недійсний — просимо увійти знову
      removeKey(KEY_LOGIN);
      removeKey(KEY_RBX);
      S.auth = null; S.user = null;
      setTimeout(() => { rebuild(); render(); }, 0);
    }
    throw new Error(msg);
  }

  async function runEdit(payload, applyLocal) {
    if (S.busy) throw new Error("Попередня зміна ще зберігається.");
    S.busy = true;
    document.body.style.cursor = "progress";
    try {
      await callEdit(payload);
      applyLocal();
      rebuild();
      render();
      if (S.drawerNick) renderDrawer();
    } finally {
      S.busy = false;
      document.body.style.cursor = "";
    }
  }

  const cleanEmpty = (o) => { for (const k of Object.keys(o)) if (o[k] === "" || o[k] === null) delete o[k]; return o; };
  const swap = (arr, a, b) => { if (a < 0 || b < 0 || a >= arr.length || b >= arr.length) return; [arr[a], arr[b]] = [arr[b], arr[a]]; };

  // Локальне застосування — дзеркало логіки serversideroles, щоб не чекати
  // перезбирання сайту (~1 хв).
  function applyPlayers(action, fraction, username, data) {
    if (!S.players[fraction]) S.players[fraction] = [];
    const arr = S.players[fraction];
    const target = String(username || (data && data.username) || "").toLowerCase();
    const i = arr.findIndex((p) => p && p.username && p.username.toLowerCase() === target);
    if (action === "add") arr.push(cleanEmpty({ ...data }));
    else if (action === "edit" && i >= 0) arr[i] = cleanEmpty({ ...arr[i], ...data });
    else if (action === "delete" && i >= 0) arr.splice(i, 1);
    else if (action === "moveUp") swap(arr, i, i - 1);
    else if (action === "moveDown") swap(arr, i, i + 1);
  }
  function applyLicense(action, cat, username, data) {
    if (!S.licenses[cat]) S.licenses[cat] = ["business", "ozu", "mafia"].includes(cat) ? [] : {};
    const g = S.licenses[cat];
    const nameStr = String(username || (data && (data.username || data.name)) || "").trim();
    const lower = nameStr.toLowerCase();
    if (Array.isArray(g)) {
      const i = g.findIndex((x) => String((x && (x.username || x.name)) || "").toLowerCase() === lower);
      if (action === "add") g.push(cleanEmpty({ ...data }));
      else if (action === "edit" && i >= 0) g[i] = cleanEmpty({ ...g[i], ...data });
      else if (action === "delete" && i >= 0) g.splice(i, 1);
      else if (action === "moveUp") swap(g, i, i - 1);
      else if (action === "moveDown") swap(g, i, i + 1);
      return;
    }
    const key = Object.keys(g).find((k) => k.toLowerCase() === lower);
    if (action === "add") g[nameStr] = cleanEmpty({ ...data });
    else if (action === "edit" && key) {
      const newName = String(data.username || data.name || key).trim();
      if (newName !== key) { g[newName] = cleanEmpty({ ...g[key], ...data }); delete g[key]; }
      else g[key] = cleanEmpty({ ...g[key], ...data });
      // сервер сортує обʼєктні категорії за абеткою
      const sorted = Object.keys(g).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      const copy = {}; sorted.forEach((k) => { copy[k] = g[k]; });
      S.licenses[cat] = copy;
    } else if (action === "delete" && key) delete g[key];
    if (action === "add") {
      const sorted = Object.keys(S.licenses[cat]).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      const copy = {}; sorted.forEach((k) => { copy[k] = S.licenses[cat][k]; });
      S.licenses[cat] = copy;
    }
  }

  async function quickAction(payload, applyLocal, okMsg) {
    try {
      await runEdit(payload, applyLocal);
      toast(okMsg);
    } catch (err) {
      toast(err.message || String(err), true);
    }
  }

  // ───────────────────────── тема ─────────────────────────
  function effectiveTheme() {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) return t;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme() {
    let t = null;
    try { t = localStorage.getItem(KEY_THEME); } catch { /* ignore */ }
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!t && tg && tg.initData && tg.colorScheme) t = tg.colorScheme;
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  }
  function toggleTheme() {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY_THEME, next); } catch { /* ignore */ }
    render();
  }

  // ───────────────────────── події ─────────────────────────
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    const tg = window.Telegram && window.Telegram.WebApp;
    if (link && tg && tg.initData && link.target === "_blank") {
      const href = link.getAttribute("href");
      try {
        if (/^https:\/\/t\.me\//i.test(href)) { e.preventDefault(); tg.openTelegramLink(href); return; }
        if (/^https?:\/\//i.test(href)) { e.preventDefault(); tg.openLink(href); return; }
      } catch { /* звичайне відкриття */ }
    }
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const act = el.getAttribute("data-act");
    const d = el.dataset;
    switch (act) {
      case "refresh": return refreshAll(true);
      case "login": return loginDialog();
      case "login-roblox": el.disabled = true; return startRobloxLogin();
      case "logout": closeDialog(); return logout();
      case "account": return accountDialog();
      case "theme": return toggleTheme();
      case "close-dlg": return closeDialog();
      case "close-drawer": return closePerson();
      case "goto": return go(d.hash);
      case "person": gr.hidden = true; return openPerson(d.nick);
      case "fraction": S.swap = S.fraction !== d.f; S.fraction = d.f; history.replaceState(null, "", "#roles/" + encodeURIComponent(d.f)); return render();
      case "lic-cat": S.swap = S.licCat !== d.c; S.licCat = d.c; S.licStatus = "all"; history.replaceState(null, "", "#licenses/" + d.c); return render();
      case "lic-status": S.swap = S.licStatus !== d.s; S.licStatus = d.s; return render();
      case "range": S.swap = S.range !== Number(d.r); S.range = Number(d.r); return render();
      case "toggle-table": S.showTable = !S.showTable; return render();
      case "more": S.revealFrom = S.pages[d.key] || PAGE; S.pages[d.key] = S.revealFrom + PAGE; return render();
      case "add-fraction": return addFractionDialog();
      case "delete-fraction": return deleteGroupDialog("fraction", d.f);
      case "add-category": return addCategoryDialog();
      case "delete-category": return deleteGroupDialog("category", d.c);
      case "add-player": return playerForm("add", d.f || (S.route === "roles" && S.fraction !== "Усі" ? S.fraction : ""), "", d.preset || "");
      case "edit-player": return playerForm("edit", d.f, d.nick);
      case "delete-player":
        return confirmDialog("Видалити гравця?", `<strong>${esc(d.nick)}</strong> зникне з фракції ${esc(d.f)}.${P.isAdmin ? "" : " Якщо потрібно тимчасово — краще вкажіть відсторонення."}`, "Видалити", async () => {
          await runEdit({ targetFile: "players.js", action: "delete", fraction: d.f, username: d.nick }, () => applyPlayers("delete", d.f, d.nick));
          toast(`${d.nick} видалено з фракції ${d.f}`);
        });
      case "move-player":
        return quickAction({ targetFile: "players.js", action: d.dir, fraction: d.f, username: d.nick }, () => applyPlayers(d.dir, d.f, d.nick), d.dir === "moveUp" ? "Переміщено вище" : "Переміщено нижче");
      case "add-lic": return licForm("add", d.c || (S.route === "licenses" ? S.licCat : ""), "", d.preset || "");
      case "edit-lic": return licForm("edit", d.c, d.nick);
      case "delete-lic":
        return confirmDialog("Видалити ліцензію?", `${esc(licMeta(d.c).title)} гравця <strong>${esc(d.nick)}</strong> буде видалено. Щоб зберегти історію, можна вказати причину скасування замість видалення.`, "Видалити", async () => {
          await runEdit({ targetFile: "licenses.js", action: "delete", category: d.c, username: d.nick }, () => applyLicense("delete", d.c, d.nick));
          toast(`Ліцензію ${d.nick} видалено`);
        });
      case "move-lic":
        return quickAction({ targetFile: "licenses.js", action: d.dir, category: d.c, username: d.nick }, () => applyLicense(d.dir, d.c, d.nick), d.dir === "moveUp" ? "Переміщено вище" : "Переміщено нижче");
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "roles-q") {
      S.rolesQ = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const inp = $("#roles-q"); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    } else if (e.target.id === "lic-q") {
      S.licQ = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const inp = $("#lic-q"); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.drawerNick && !dlg.open) closePerson();
    if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !dlg.open) { e.preventDefault(); gq.focus(); }
  });

  addEventListener("hashchange", () => { parseRoute(); render(); window.scrollTo(0, 0); });

  let resizeT = null, lastW = innerWidth;
  addEventListener("resize", () => {
    if (Math.abs(innerWidth - lastW) < 4) return;
    lastW = innerWidth;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { $$("[data-chart]", $("#view")).forEach(drawChart); placeSliders(document, true); }, 150);
  });

  async function refreshAll(manual) {
    if (manual && S.regVia === "script") { location.reload(); return; }
    const btn = $('.top-tools [data-act="refresh"]');
    if (btn) btn.disabled = true;
    $$(".chart", $("#view")).forEach((c) => c.classList.add("loading"));
    await Promise.all([refreshRegistries(), refreshViews()]);
    if (btn) btn.disabled = false;
    render();
    if (S.drawerNick) renderDrawer();
    if (manual) toast(S.regError ? "Реєстр не оновився: " + S.regError : "Дані оновлено", !!S.regError);
  }

  // ───────────────────────── старт ─────────────────────────
  function start() {
    applyTheme();
    initAuth();
    parseRoute();
    render();
    finishRobloxLogin().then((ok) => { if (ok) render(); });
    refreshRegistries().then(() => { parseRoute(); S.swap = true; render(); });
    refreshViews().then(() => { if (S.route === "views" || S.route === "overview") render(); });
    loadCatalog();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeSliders(document, true));
    setInterval(pollToday, 60_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pollToday(); });
  }
  start();
})();
