/*
 * My Anime TizenBrew - On-TV Frontend UI (Strictly ES5 / Tizen 3.0 Chromium 47 compatible)
 * Connects to the local on-TV Node.js service via WebSocket (ws://127.0.0.1:8092)
 * and streams HLS (.m3u8 / .ts) + WebVTT (.vtt) subtitles via http://127.0.0.1:8092/proxy & /sub.
 */
(function () {
  "use strict";

  /* ==========================================================================
   * 1. ES5 / CHROMIUM 47 POLYFILLS (Injected at the very top)
   * ========================================================================== */
  if (!Object.values) {
    Object.values = function (obj) {
      if (obj == null) throw new TypeError("Cannot convert undefined or null to object");
      var o = Object(obj), keys = Object.keys(o), res = new Array(keys.length);
      for (var i = 0; i < keys.length; i++) res[i] = o[keys[i]];
      return res;
    };
  }
  if (!Object.entries) {
    Object.entries = function (obj) {
      if (obj == null) throw new TypeError("Cannot convert undefined or null to object");
      var o = Object(obj), keys = Object.keys(o), res = new Array(keys.length);
      for (var i = 0; i < keys.length; i++) res[i] = [keys[i], o[keys[i]]];
      return res;
    };
  }
  if (!Object.assign) {
    Object.assign = function (target) {
      if (target == null) throw new TypeError("Cannot convert undefined or null to object");
      var to = Object(target);
      for (var index = 1; index < arguments.length; index++) {
        var nextSource = arguments[index];
        if (nextSource != null) {
          for (var nextKey in nextSource) {
            if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
              to[nextKey] = nextSource[nextKey];
            }
          }
        }
      }
      return to;
    };
  }
  if (!Array.prototype.includes) {
    Array.prototype.includes = function (searchElement, fromIndex) {
      if (this == null) throw new TypeError('"this" is null or not defined');
      var o = Object(this), len = o.length >>> 0;
      if (len === 0) return false;
      var n = fromIndex | 0;
      var k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
      while (k < len) {
        if (o[k] === searchElement || (typeof o[k] === "number" && typeof searchElement === "number" && isNaN(o[k]) && isNaN(searchElement))) return true;
        k++;
      }
      return false;
    };
  }
  if (!Array.prototype.find) {
    Array.prototype.find = function (predicate) {
      if (this == null) throw new TypeError('"this" is null or not defined');
      var o = Object(this), len = o.length >>> 0;
      var thisArg = arguments[1];
      for (var i = 0; i < len; i++) {
        if (predicate.call(thisArg, o[i], i, o)) return o[i];
      }
      return undefined;
    };
  }
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (predicate) {
      if (this == null) throw new TypeError('"this" is null or not defined');
      var o = Object(this), len = o.length >>> 0;
      var thisArg = arguments[1];
      for (var i = 0; i < len; i++) {
        if (predicate.call(thisArg, o[i], i, o)) return i;
      }
      return -1;
    };
  }
  if (!String.prototype.padStart) {
    String.prototype.padStart = function (targetLength, padString) {
      var str = String(this);
      targetLength = targetLength >> 0;
      padString = String(typeof padString !== "undefined" ? padString : " ");
      if (str.length >= targetLength) return str;
      targetLength = targetLength - str.length;
      while (padString.length < targetLength) padString += padString;
      return padString.slice(0, targetLength) + str;
    };
  }
  if (!String.prototype.padEnd) {
    String.prototype.padEnd = function (targetLength, padString) {
      var str = String(this);
      targetLength = targetLength >> 0;
      padString = String(typeof padString !== "undefined" ? padString : " ");
      if (str.length >= targetLength) return str;
      targetLength = targetLength - str.length;
      while (padString.length < targetLength) padString += padString;
      return str + padString.slice(0, targetLength);
    };
  }
  if (!String.prototype.includes) {
    String.prototype.includes = function (search, start) {
      if (typeof start !== "number") start = 0;
      if (start + search.length > this.length) return false;
      return this.indexOf(search, start) !== -1;
    };
  }
  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (search, pos) {
      pos = !pos || pos < 0 ? 0 : +pos;
      return this.substring(pos, pos + search.length) === search;
    };
  }
  if (!String.prototype.endsWith) {
    String.prototype.endsWith = function (search, thisLen) {
      if (thisLen === undefined || thisLen > this.length) thisLen = this.length;
      return this.substring(thisLen - search.length, thisLen) === search;
    };
  }
  if (typeof NodeList !== "undefined" && NodeList.prototype && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
  if (typeof Promise !== "undefined" && Promise.prototype && !Promise.prototype.finally) {
    Promise.prototype.finally = function (cb) {
      var P = this.constructor;
      return this.then(
        function (v) { return P.resolve(cb()).then(function () { return v; }); },
        function (r) { return P.resolve(cb()).then(function () { throw r; }); }
      );
    };
  }

  /* Prevent duplicate initialization */
  if (window.__MY_ANIME_TV_APP__) return;
  window.__MY_ANIME_TV_APP__ = true;

  /* Register Tizen remote media keys */
  try {
    if (window.tizen && window.tizen.tvinputdevice) {
      var mediaKeys = [
        "MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop",
        "MediaFastForward", "MediaRewind", "MediaTrackNext", "MediaTrackPrevious"
      ];
      for (var mk = 0; mk < mediaKeys.length; mk++) {
        try { window.tizen.tvinputdevice.registerKey(mediaKeys[mk]); } catch (e) {}
      }
    }
  } catch (e) {}

  /* ==========================================================================
   * 2. CONSTANTS & APPLICATION STATE
   * ========================================================================== */
  var SERVICE_HOST = "127.0.0.1";
  var SERVICE_PORT = 8093;
  var WS_URL = "ws://" + SERVICE_HOST + ":" + SERVICE_PORT;
  var HTTP_BASE = "http://" + SERVICE_HOST + ":" + SERVICE_PORT;
  var HLS_CDN_URL = "https://cdn.jsdelivr.net/npm/hls.js@0.14.17/dist/hls.min.js";
  var HLS_PROXY_URL = HTTP_BASE + "/proxy?url=" + encodeURIComponent(HLS_CDN_URL);
  var LOCAL_HISTORY_KEY = "my_anime_tizen_history_v1";

  var state = {
    view: "home",            /* "home" | "details" | "player" */
    wsConnected: false,
    loading: true,
    error: "",
    toast: "",
    toastTimer: null,

    /* Home & Search state */
    searchQuery: "",
    searchDraft: "",
    keyboardOpen: false,
    isSearching: false,
    searchResults: null,
    featured: [],
    recentEpisodes: [],
    history: loadLocalHistoryBackup(),
    homeRetryCount: 0,
    pageScrollY: 0,

    /* Anime Details state */
    currentAnime: null,
    detailsLoading: false,
    audioMode: "sub",        /* "sub" | "dub" */
    epSortAsc: true,
    epChunkIndex: 0,         /* 50 episodes per chunk */

    /* Player state */
    player: {
      animeId: "",
      animeTitle: "",
      poster: "",
      totalEpisodes: 0,
      episodes: [],
      episodeNumber: 1,
      episodeSlug: "1",
      episodeTitle: "",
      streamUrl: "",
      subtitles: [],
      activeSubIndex: 0,     /* -1 = Off, 0..N = subtitle index */
      vttCues: [],
      currentCueText: "",
      hasSub: true,
      hasDub: false,
      activeAudio: "sub",
      resumeTime: 0,
      currentTime: 0,
      duration: 0,
      paused: false,
      buffering: true,
      controlsVisible: true,
      controlsTimer: null,
      saveTimer: null,
      hlsInstance: null,
      videoEl: null
    }
  };

  function loadLocalHistoryBackup() {
    try {
      var raw = localStorage.getItem(LOCAL_HISTORY_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  }

  function saveLocalHistoryBackup(items) {
    try {
      if (Array.isArray(items)) {
        localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(items));
      }
    } catch (e) {}
  }

  /* ==========================================================================
   * 3. WEBSOCKET BRIDGE TO ON-TV SERVICE (with HTTP /rpc fallback)
   * ========================================================================== */
  var ws = null;
  var wsCallbacks = {};
  var wsReqCounter = 0;
  var wsReconnectTimer = null;

  function connectWebSocket() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      state.wsConnected = true;
      updateStatusBadge();
      /* Load home & history as soon as connected */
      if (state.view === "home" && state.featured.length === 0) {
        fetchHomeData();
      }
    };

    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.type === "ready") {
        state.wsConnected = true;
        updateStatusBadge();
        return;
      }
      if (msg.id && wsCallbacks[msg.id]) {
        var cb = wsCallbacks[msg.id];
        delete wsCallbacks[msg.id];
        if (msg.ok) {
          cb(null, msg.data);
        } else {
          cb(new Error(msg.error || "Service error"));
        }
      }
    };

    ws.onerror = function () {};

    ws.onclose = function () {
      state.wsConnected = false;
      updateStatusBadge();
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(function () {
      connectWebSocket();
    }, 600);
  }

  var nudgedTizenBrewService = false;
  function nudgeTizenBrewToStartService() {
    if (nudgedTizenBrewService) return;
    nudgedTizenBrewService = true;
    try {
      var tbWs = new WebSocket("ws://127.0.0.1:8081");
      tbWs.onopen = function () {
        try {
          tbWs.send(JSON.stringify({
            type: 6,
            payload: {
              fullName: "gh/AllanCFE/my-anime-tizenbrew@1.0.1",
              name: "AllanCFE/my-anime-tizenbrew",
              serviceFile: "dist/service.js"
            }
          }));
        } catch (e) {}
        setTimeout(function () {
          try { tbWs.close(); } catch (e2) {}
        }, 1000);
      };
    } catch (e) {}
  }

  function callService(action, payload, callback) {
    var reqId = "req_" + (++wsReqCounter) + "_" + Date.now();
    var done = false;

    function finish(err, data) {
      if (done) return;
      done = true;
      delete wsCallbacks[reqId];
      callback(err, data);
    }

    /* If WebSocket is open, send over WebSocket */
    if (ws && ws.readyState === 1) {
      wsCallbacks[reqId] = finish;
      try {
        ws.send(JSON.stringify({
          id: reqId,
          action: action,
          payload: payload || {}
        }));
      } catch (e) {
        delete wsCallbacks[reqId];
        callHttpRpcFallback(reqId, action, payload, finish, 0);
        return;
      }

      /* Timeout fallback to HTTP RPC if WS doesn't respond in 14s */
      setTimeout(function () {
        if (!done) {
          callHttpRpcFallback(reqId, action, payload, finish, 0);
        }
      }, 14000);
      return;
    }

    /* Fallback to HTTP /rpc with automatic startup retries while service.js boots */
    callHttpRpcFallback(reqId, action, payload, finish, 0);
  }

  function callHttpRpcFallback(reqId, action, payload, callback, attempt) {
    var curAttempt = attempt || 0;
    var maxAttempts = 12;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", HTTP_BASE + "/rpc", true);
      xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
      xhr.timeout = 15000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              var res = JSON.parse(xhr.responseText);
              state.wsConnected = true;
              updateStatusBadge();
              connectWebSocket();
              if (res.ok) callback(null, res.data);
              else callback(new Error(res.error || "RPC error"));
            } catch (e) {
              callback(e);
            }
          } else if (xhr.status === 0 && curAttempt < maxAttempts) {
            if (curAttempt === 1) {
              nudgeTizenBrewToStartService();
            }
            setTimeout(function () {
              callHttpRpcFallback(reqId, action, payload, callback, curAttempt + 1);
            }, 500);
          } else {
            callback(new Error("Service unavailable on 127.0.0.1:" + SERVICE_PORT));
          }
        }
      };
      xhr.ontimeout = function () {
        callback(new Error("Request timed out"));
      };
      xhr.send(JSON.stringify({ id: reqId, action: action, payload: payload || {} }));
    } catch (e) {
      if (curAttempt < maxAttempts) {
        setTimeout(function () {
          callHttpRpcFallback(reqId, action, payload, callback, curAttempt + 1);
        }, 500);
      } else {
        callback(e);
      }
    }
  }

  /* ==========================================================================
   * 4. HLS.JS (0.14.17) LOADER FOR CHROMIUM 47
   * ========================================================================== */
  var hlsLoadingPromise = null;

  function ensureHlsLoaded(callback) {
    if (window.Hls) return callback(null, window.Hls);
    if (hlsLoadingPromise) {
      hlsLoadingPromise.push(callback);
      return;
    }
    hlsLoadingPromise = [callback];

    function notifyAll(err, HlsObj) {
      var list = hlsLoadingPromise || [];
      hlsLoadingPromise = null;
      for (var i = 0; i < list.length; i++) {
        list[i](err, HlsObj);
      }
    }

    function loadScript(srcUrl, onFail) {
      var s = document.createElement("script");
      s.type = "text/javascript";
      s.src = srcUrl;
      s.onload = function () {
        if (window.Hls) notifyAll(null, window.Hls);
        else onFail();
      };
      s.onerror = function () {
        onFail();
      };
      (document.head || document.documentElement).appendChild(s);
    }

    loadScript(HLS_CDN_URL, function () {
      loadScript(HLS_PROXY_URL, function () {
        notifyAll(new Error("Failed to load hls.js"));
      });
    });
  }

  /* ==========================================================================
   * 5. DOM & CSS INITIALIZATION (1920x1080 Scaled TV Canvas)
   * ========================================================================== */
  var rootEl = null;
  var mainViewEl = null;
  var toastEl = null;

  var TV_CSS = [
    "html, body { position: fixed; left: 0; top: 0; margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #08090c; color: #f3f4f6; font-family: 'SamsungOne', 'Samsung Sans', 'Roboto', 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; -webkit-user-select: none; user-select: none; -webkit-text-size-adjust: 100%; }",
    "#my-anime-root { position: fixed; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; background: #08090c; -webkit-transform-origin: 0 0; transform-origin: 0 0; }",
    "#my-anime-root * { box-sizing: border-box; }",
    "/* Header */",
    ".ma-header { position: absolute; left: 0; top: 0; right: 0; height: 108px; padding: 0 72px; display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; background: -webkit-linear-gradient(top, rgba(8,9,12,0.98), rgba(8,9,12,0.85)); background: linear-gradient(to bottom, rgba(8,9,12,0.98), rgba(8,9,12,0.85)); border-bottom: 1px solid rgba(255,255,255,0.07); z-index: 20; }",
    ".ma-brand { display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; margin-right: 42px; }",
    ".ma-logo-dot { width: 18px; height: 18px; border-radius: 50%; background: #ff5a36; margin-right: 14px; box-shadow: 0 0 16px rgba(255,90,54,0.7); }",
    ".ma-brand-title { font-size: 34px; font-weight: 800; letter-spacing: -0.6px; color: #ffffff; }",
    ".ma-brand-sub { font-size: 18px; font-weight: 600; color: #9ca3af; margin-left: 12px; padding: 4px 10px; border-radius: 6px; background: rgba(255,255,255,0.08); }",
    ".ma-search-box { display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; width: 620px; height: 62px; padding: 0 22px; border-radius: 14px; background: #141720; border: 3px solid rgba(255,255,255,0.1); margin-right: 16px; -webkit-transition: all 0.15s ease; transition: all 0.15s ease; cursor: pointer; }",
    ".ma-search-box.focused { border-color: #ffffff; background: #1c202c; -webkit-transform: scale(1.02); transform: scale(1.02); box-shadow: 0 8px 24px rgba(0,0,0,0.5); }",
    ".ma-search-text { width: 100%; font-size: 24px; font-weight: 600; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".ma-search-text.placeholder { color: #6b7280; font-weight: 500; }",
    ".ma-btn { display: -webkit-inline-flex; display: inline-flex; -webkit-align-items: center; align-items: center; -webkit-justify-content: center; justify-content: center; height: 62px; padding: 0 28px; margin-right: 16px; border-radius: 14px; background: rgba(255,255,255,0.12); color: #ffffff; font-size: 23px; font-weight: 700; white-space: nowrap; border: 3px solid transparent; -webkit-transition: -webkit-transform 0.15s ease, background-color 0.15s ease, color 0.15s ease; transition: transform 0.15s ease, background-color 0.15s ease, color 0.15s ease; }",
    ".ma-btn.primary { background: #ff5a36; color: #ffffff; }",
    ".ma-btn.accent { background: #2563eb; color: #ffffff; }",
    ".ma-btn.focused { background: #ffffff !important; color: #08090c !important; -webkit-transform: scale(1.06); transform: scale(1.06); box-shadow: 0 10px 28px rgba(0,0,0,0.6); z-index: 5; }",
    ".ma-status { margin-left: auto; display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; font-size: 19px; font-weight: 600; color: #9ca3af; background: rgba(255,255,255,0.06); padding: 10px 18px; border-radius: 24px; }",
    ".ma-status-dot { width: 11px; height: 11px; border-radius: 50%; margin-right: 10px; background: #f59e0b; }",
    ".ma-status-dot.online { background: #10b981; box-shadow: 0 0 10px rgba(16,185,129,0.7); }",
    "/* On-Screen TV Keyboard Modal */",
    ".ma-kb-modal { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; background: rgba(6,7,10,0.88); z-index: 150; display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; -webkit-justify-content: center; justify-content: center; }",
    ".ma-kb-panel { width: 1260px; padding: 38px 46px; border-radius: 24px; background: #12151f; border: 2px solid rgba(255,255,255,0.14); box-shadow: 0 24px 64px rgba(0,0,0,0.85); }",
    ".ma-kb-header { display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; -webkit-justify-content: space-between; justify-content: space-between; margin-bottom: 20px; }",
    ".ma-kb-title { font-size: 30px; font-weight: 800; color: #ffffff; }",
    ".ma-kb-hint { font-size: 20px; font-weight: 600; color: #9ca3af; }",
    ".ma-kb-display { width: 100%; height: 74px; padding: 0 26px; margin-bottom: 22px; border-radius: 16px; background: #090b10; border: 3px solid #ff5a36; display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; font-size: 32px; font-weight: 700; color: #ffffff; }",
    ".ma-kb-chips { display: -webkit-flex; display: flex; -webkit-flex-wrap: wrap; flex-wrap: wrap; margin-bottom: 22px; }",
    ".ma-kb-chip { height: 48px; line-height: 44px; padding: 0 20px; margin-right: 12px; margin-bottom: 8px; border-radius: 24px; background: rgba(255,255,255,0.08); color: #d1d5db; font-size: 20px; font-weight: 600; border: 2px solid transparent; }",
    ".ma-kb-chip.focused { background: #ffffff !important; color: #08090c !important; -webkit-transform: scale(1.06); transform: scale(1.06); }",
    ".ma-kb-grid-row { display: -webkit-flex; display: flex; -webkit-justify-content: space-between; justify-content: space-between; margin-bottom: 12px; }",
    ".ma-kb-key { width: 106px; height: 68px; border-radius: 12px; background: #1b2030; color: #ffffff; font-size: 28px; font-weight: 800; display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; -webkit-justify-content: center; justify-content: center; border: 3px solid rgba(255,255,255,0.06); -webkit-transition: transform 0.12s ease, background-color 0.12s ease; transition: transform 0.12s ease, background-color 0.12s ease; }",
    ".ma-kb-key.wide { width: 222px; font-size: 23px; }",
    ".ma-kb-key.primary { background: #ff5a36; }",
    ".ma-kb-key.focused { background: #ffffff !important; color: #08090c !important; border-color: #ffffff !important; -webkit-transform: scale(1.08); transform: scale(1.08); box-shadow: 0 8px 24px rgba(0,0,0,0.6); z-index: 4; }",
    "/* Scrollable Content Area */",
    ".ma-content { position: absolute; left: 0; top: 108px; right: 0; bottom: 0; overflow: hidden; }",
    ".ma-scroll-page { position: absolute; left: 0; top: 0; width: 1920px; padding: 28px 0 180px 0; -webkit-transition: -webkit-transform 0.26s cubic-bezier(0.2, 0.7, 0.2, 1); transition: transform 0.26s cubic-bezier(0.2, 0.7, 0.2, 1); }",
    "/* Sections & Horizontal Rails */",
    ".ma-section { position: relative; margin-bottom: 42px; }",
    ".ma-section-header { padding: 0 72px; margin-bottom: 18px; display: -webkit-flex; display: flex; -webkit-align-items: baseline; align-items: baseline; }",
    ".ma-section-title { font-size: 30px; font-weight: 800; color: #ffffff; letter-spacing: -0.4px; }",
    ".ma-section-sub { font-size: 20px; font-weight: 600; color: #9ca3af; margin-left: 16px; }",
    ".ma-rail-viewport { position: relative; width: 1920px; overflow: hidden; padding: 14px 0 20px 0; margin: -14px 0 -20px 0; }",
    ".ma-rail-track { display: -webkit-flex; display: flex; padding-left: 72px; -webkit-transition: -webkit-transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1); transition: transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1); }",
    "/* Cards */",
    ".ma-card { position: relative; width: 248px; margin-right: 26px; -webkit-flex-shrink: 0; flex-shrink: 0; -webkit-transition: -webkit-transform 0.16s ease; transition: transform 0.16s ease; }",
    ".ma-card.wide { width: 370px; }",
    ".ma-card-art { position: relative; width: 100%; height: 356px; border-radius: 14px; overflow: hidden; background: #161923; border: 4px solid transparent; -webkit-transition: border-color 0.16s ease, box-shadow 0.16s ease; transition: border-color 0.16s ease, box-shadow 0.16s ease; }",
    ".ma-card.wide .ma-card-art { height: 208px; }",
    ".ma-card-art img { width: 100%; height: 100%; object-fit: cover; display: block; }",
    ".ma-card.focused { -webkit-transform: scale(1.06); transform: scale(1.06); z-index: 4; }",
    ".ma-card.focused .ma-card-art { border-color: #ffffff; box-shadow: 0 16px 36px rgba(0,0,0,0.75); }",
    ".ma-card-badge { position: absolute; top: 12px; left: 12px; padding: 5px 11px; border-radius: 8px; background: rgba(8,9,12,0.85); color: #ffffff; font-size: 16px; font-weight: 800; }",
    ".ma-card-badge.right { left: auto; right: 12px; background: rgba(255,90,54,0.92); }",
    ".ma-card-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 7px; background: rgba(255,255,255,0.22); }",
    ".ma-card-progress-fill { height: 100%; background: #ff5a36; }",
    ".ma-card-title { margin-top: 12px; font-size: 22px; font-weight: 700; color: #e5e7eb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".ma-card.focused .ma-card-title { color: #ffffff; }",
    ".ma-card-meta { margin-top: 4px; font-size: 18px; font-weight: 500; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    "/* Grid rows (6 cards per row) */",
    ".ma-grid-row { position: relative; display: -webkit-flex; display: flex; padding: 0 72px; margin-bottom: 34px; }",
    "/* Details View */",
    ".ma-details-hero { position: relative; padding: 36px 72px 32px 72px; display: -webkit-flex; display: flex; -webkit-align-items: flex-start; align-items: flex-start; }",
    ".ma-details-poster { width: 290px; height: 420px; border-radius: 16px; overflow: hidden; background: #161923; -webkit-flex-shrink: 0; flex-shrink: 0; margin-right: 44px; box-shadow: 0 18px 40px rgba(0,0,0,0.7); border: 2px solid rgba(255,255,255,0.1); }",
    ".ma-details-poster img { width: 100%; height: 100%; object-fit: cover; }",
    ".ma-details-info { -webkit-flex: 1; flex: 1; min-width: 0; }",
    ".ma-details-title { font-size: 50px; line-height: 58px; font-weight: 800; color: #ffffff; letter-spacing: -0.8px; margin: 0 0 12px 0; }",
    ".ma-details-pills { display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; -webkit-flex-wrap: wrap; flex-wrap: wrap; margin-bottom: 16px; }",
    ".ma-pill { padding: 6px 14px; border-radius: 8px; background: rgba(255,255,255,0.1); color: #e5e7eb; font-size: 19px; font-weight: 700; margin-right: 12px; margin-bottom: 8px; }",
    ".ma-pill.highlight { background: rgba(255,90,54,0.22); color: #ff7a5c; border: 1px solid rgba(255,90,54,0.4); }",
    ".ma-details-synopsis { font-size: 23px; line-height: 34px; color: #d1d5db; max-height: 136px; overflow: hidden; margin-bottom: 26px; max-width: 1280px; }",
    ".ma-details-actions { display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; }",
    "/* Episode Chunks & List */",
    ".ma-chunks-row { position: relative; display: -webkit-flex; display: flex; -webkit-flex-wrap: wrap; flex-wrap: wrap; padding: 0 72px; margin-bottom: 22px; }",
    ".ma-chunk-btn { height: 50px; line-height: 46px; padding: 0 22px; margin-right: 12px; margin-bottom: 10px; border-radius: 25px; background: #161923; color: #9ca3af; font-size: 20px; font-weight: 700; border: 2px solid rgba(255,255,255,0.08); }",
    ".ma-chunk-btn.active { background: rgba(255,90,54,0.25); color: #ffffff; border-color: #ff5a36; }",
    ".ma-chunk-btn.focused { background: #ffffff !important; color: #08090c !important; border-color: #ffffff !important; -webkit-transform: scale(1.06); transform: scale(1.06); }",
    ".ma-ep-list { position: relative; padding: 0 72px; }",
    ".ma-ep-row { position: relative; display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; padding: 16px 22px; margin-bottom: 14px; border-radius: 16px; background: #12151e; border: 3px solid transparent; -webkit-transition: all 0.15s ease; transition: all 0.15s ease; }",
    ".ma-ep-row.focused { background: #1d2230; border-color: #ffffff; -webkit-transform: scale(1.015); transform: scale(1.015); box-shadow: 0 12px 30px rgba(0,0,0,0.6); }",
    ".ma-ep-thumb { position: relative; width: 224px; height: 126px; border-radius: 10px; overflow: hidden; background: #1c202c; -webkit-flex-shrink: 0; flex-shrink: 0; margin-right: 26px; }",
    ".ma-ep-thumb img { width: 100%; height: 100%; object-fit: cover; }",
    ".ma-ep-body { -webkit-flex: 1; flex: 1; min-width: 0; }",
    ".ma-ep-num { font-size: 19px; font-weight: 800; color: #ff5a36; text-transform: uppercase; letter-spacing: 1px; }",
    ".ma-ep-title { font-size: 26px; font-weight: 700; color: #ffffff; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".ma-ep-desc { font-size: 20px; color: #9ca3af; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    "/* Fullscreen Video Player */",
    ".ma-player-screen { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; background: #000000; z-index: 100; overflow: hidden; }",
    ".ma-video { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; background: #000000; }",
    ".ma-sub-overlay { position: absolute; left: 160px; right: 160px; bottom: 110px; text-align: center; pointer-events: none; z-index: 105; -webkit-transition: bottom 0.2s ease; transition: bottom 0.2s ease; }",
    ".ma-sub-overlay.raised { bottom: 290px; }",
    ".ma-sub-box { display: inline-block; max-width: 1400px; padding: 10px 24px; border-radius: 10px; background: rgba(0,0,0,0.78); color: #ffffff; font-size: 40px; line-height: 52px; font-weight: 700; text-shadow: 0 2px 6px rgba(0,0,0,0.95); white-space: pre-wrap; }",
    ".ma-player-hud { position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 84px 48px 84px; background: -webkit-linear-gradient(top, rgba(0,0,0,0), rgba(0,0,0,0.75) 35%, rgba(0,0,0,0.95)); background: linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.75) 35%, rgba(0,0,0,0.95)); z-index: 110; -webkit-transition: opacity 0.25s ease; transition: opacity 0.25s ease; }",
    ".ma-player-hud.hidden { opacity: 0; pointer-events: none; }",
    ".ma-player-top { position: absolute; left: 0; right: 0; top: 0; padding: 40px 84px; background: -webkit-linear-gradient(bottom, rgba(0,0,0,0), rgba(0,0,0,0.85)); background: linear-gradient(to top, rgba(0,0,0,0), rgba(0,0,0,0.85)); z-index: 110; display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; -webkit-justify-content: space-between; justify-content: space-between; -webkit-transition: opacity 0.25s ease; transition: opacity 0.25s ease; }",
    ".ma-player-top.hidden { opacity: 0; pointer-events: none; }",
    ".ma-seek-bar { position: relative; width: 100%; height: 14px; border-radius: 7px; background: rgba(255,255,255,0.25); margin-bottom: 22px; cursor: pointer; }",
    ".ma-seek-bar.focused { height: 18px; box-shadow: 0 0 0 4px #ffffff; }",
    ".ma-seek-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 7px; background: #ff5a36; }",
    ".ma-seek-knob { position: absolute; top: -7px; width: 28px; height: 28px; margin-left: -14px; border-radius: 50%; background: #ffffff; box-shadow: 0 2px 10px rgba(0,0,0,0.7); }",
    ".ma-player-controls { display: -webkit-flex; display: flex; -webkit-align-items: center; align-items: center; }",
    ".ma-player-time { margin-left: auto; font-size: 26px; font-weight: 700; color: #e5e7eb; }",
    ".ma-buffer-overlay { position: absolute; left: 0; top: 0; right: 0; bottom: 0; display: -webkit-flex; display: flex; -webkit-flex-direction: column; flex-direction: column; -webkit-align-items: center; align-items: center; -webkit-justify-content: center; justify-content: center; background: rgba(0,0,0,0.45); z-index: 108; pointer-events: none; }",
    ".ma-spinner { width: 72px; height: 72px; border-radius: 50%; border: 6px solid rgba(255,255,255,0.2); border-top-color: #ff5a36; -webkit-animation: ma-spin 0.85s linear infinite; animation: ma-spin 0.85s linear infinite; }",
    "@-webkit-keyframes ma-spin { to { -webkit-transform: rotate(360deg); } }",
    "@keyframes ma-spin { to { transform: rotate(360deg); } }",
    ".ma-toast { position: absolute; left: 50%; bottom: 48px; -webkit-transform: translateX(-50%); transform: translateX(-50%); padding: 16px 34px; border-radius: 30px; background: rgba(20,24,36,0.96); border: 2px solid rgba(255,255,255,0.18); color: #ffffff; font-size: 24px; font-weight: 700; z-index: 200; box-shadow: 0 12px 32px rgba(0,0,0,0.7); pointer-events: none; -webkit-transition: opacity 0.2s ease; transition: opacity 0.2s ease; }"
  ].join("\n");

  function initDom() {
    /* Wipe host page clean and build our standalone 1920x1080 TV UI */
    var docEl = document.documentElement;
    while (docEl.firstChild) {
      docEl.removeChild(docEl.firstChild);
    }
    var head = document.createElement("head");
    var body = document.createElement("body");
    docEl.appendChild(head);
    docEl.appendChild(body);

    var meta = document.createElement("meta");
    meta.setAttribute("charset", "utf-8");
    head.appendChild(meta);

    /* Lock viewport scale so Tizen 3.0 never zooms out */
    var vp = document.createElement("meta");
    vp.setAttribute("name", "viewport");
    vp.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no");
    head.appendChild(vp);

    var titleEl = document.createElement("title");
    titleEl.textContent = "My Anime - TizenBrew";
    head.appendChild(titleEl);

    var styleEl = document.createElement("style");
    styleEl.type = "text/css";
    styleEl.textContent = TV_CSS;
    head.appendChild(styleEl);

    rootEl = document.createElement("div");
    rootEl.id = "my-anime-root";
    body.appendChild(rootEl);

    mainViewEl = document.createElement("div");
    mainViewEl.style.cssText = "position:absolute;left:0;top:0;width:1920px;height:1080px;";
    rootEl.appendChild(mainViewEl);

    toastEl = document.createElement("div");
    toastEl.className = "ma-toast";
    toastEl.style.opacity = "0";
    rootEl.appendChild(toastEl);

    var initialW = window.innerWidth || document.documentElement.clientWidth || 1920;
    var initialH = window.innerHeight || document.documentElement.clientHeight || 1080;

    function updateScale() {
      var w = window.innerWidth || initialW || 1920;
      var h = window.innerHeight || initialH || 1080;
      var sx = w / 1920;
      var sy = h / 1080;
      var s = Math.min(sx, sy) || 1;
      var tr = Math.abs(s - 1) < 0.005 ? "" : ("scale(" + s + ")");
      rootEl.style.webkitTransform = tr;
      rootEl.style.transform = tr;
    }
    updateScale();
    window.addEventListener("resize", updateScale, false);
  }

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      if (toastEl) toastEl.style.opacity = "0";
    }, 3000);
  }

  function updateStatusBadge() {
    var dot = document.getElementById("ma-status-dot");
    var txt = document.getElementById("ma-status-text");
    if (dot) {
      dot.className = "ma-status-dot" + (state.wsConnected ? " online" : "");
    }
    if (txt) {
      txt.textContent = state.wsConnected ? "On-TV Service Ready" : "Connecting Service...";
    }
  }

  /* ==========================================================================
   * 6. SPATIAL D-PAD FOCUS ENGINE
   * ========================================================================== */
  var currentFocusedEl = null;
  var lastFocusedIdByRow = {};
  var lastFocusedIdByView = {};

  function getFocusableElements() {
    if (!mainViewEl) return [];
    var scope = mainViewEl;
    if (state.keyboardOpen) {
      var kbModal = document.getElementById("ma-keyboard-modal");
      if (kbModal) scope = kbModal;
    }
    var list = scope.querySelectorAll("[data-focusable='true']");
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        out.push(el);
      }
    }
    return out;
  }

  function setFocusedElement(el, skipScroll) {
    if (!el) return;
    if (currentFocusedEl && currentFocusedEl !== el) {
      currentFocusedEl.classList.remove("focused");
    }
    currentFocusedEl = el;
    el.classList.add("focused");

    var fid = el.getAttribute("data-focus-id");
    var rowId = el.getAttribute("data-row-id");
    if (fid && !state.keyboardOpen) {
      lastFocusedIdByView[state.view] = fid;
      if (rowId) lastFocusedIdByRow[rowId] = fid;
    }

    if (!skipScroll && !state.keyboardOpen) {
      scrollFocusedIntoView(el);
    }
  }

  function restoreFocus(defaultId) {
    var focusables = getFocusableElements();
    if (focusables.length === 0) return;

    var targetId = defaultId || (!state.keyboardOpen ? lastFocusedIdByView[state.view] : null);
    if (targetId) {
      for (var i = 0; i < focusables.length; i++) {
        if (focusables[i].getAttribute("data-focus-id") === targetId) {
          setFocusedElement(focusables[i]);
          return;
        }
      }
    }
    setFocusedElement(focusables[0]);
  }

  function getOffsetRelativeTo(el, ancestor) {
    var top = 0, left = 0, cur = el;
    while (cur && cur !== ancestor && cur !== document.body) {
      top += cur.offsetTop || 0;
      left += cur.offsetLeft || 0;
      cur = cur.offsetParent;
    }
    return { top: top, left: left };
  }

  function scrollFocusedIntoView(el) {
    /* 1. Horizontal rail scrolling */
    var track = findAncestor(el, "ma-rail-track");
    if (track && track.parentElement) {
      var card = findAncestor(el, "ma-card") || el;
      var viewportW = track.parentElement.clientWidth || 1920;
      var cardLeft = card.offsetLeft || 0;
      var cardW = card.offsetWidth || 250;
      var targetX = Math.max(0, cardLeft - 72);
      var maxScrollX = Math.max(0, track.scrollWidth - viewportW + 72);
      if (cardLeft + cardW < viewportW - 120) {
        targetX = 0;
      } else {
        targetX = Math.min(targetX, maxScrollX);
      }
      var tx = "translate3d(" + (-Math.round(targetX)) + "px, 0, 0)";
      track.style.webkitTransform = tx;
      track.style.transform = tx;
    }

    /* 2. Vertical page scrolling (uses specific row anchor, NOT outer section!) */
    var page = mainViewEl ? mainViewEl.querySelector(".ma-scroll-page") : null;
    if (page && page.parentElement) {
      if (findAncestor(el, "ma-header")) {
        state.pageScrollY = 0;
        page.style.webkitTransform = "translate3d(0, 0, 0)";
        page.style.transform = "translate3d(0, 0, 0)";
        return;
      }
      var viewH = page.parentElement.clientHeight || 972;
      var anchor =
        findAncestor(el, "ma-grid-row") ||
        findAncestor(el, "ma-ep-row") ||
        findAncestor(el, "ma-chunks-row") ||
        findAncestor(el, "ma-rail-viewport") ||
        findAncestor(el, "ma-details-hero") ||
        el;

      var rel = getOffsetRelativeTo(anchor, page);
      var itemH = anchor.offsetHeight || 220;
      var targetY = 0;

      if (rel.top > 240) {
        targetY = Math.max(0, rel.top - Math.round((viewH - Math.min(itemH, 420)) * 0.35));
      }
      var pageH = Math.max(page.scrollHeight || 0, page.offsetHeight || 0);
      var maxScrollY = Math.max(0, pageH - viewH + 100);
      targetY = Math.min(targetY, maxScrollY);
      state.pageScrollY = targetY;

      var ty = "translate3d(0, " + (-Math.round(targetY)) + "px, 0)";
      page.style.webkitTransform = ty;
      page.style.transform = ty;
    }
  }

  function findAncestor(el, className) {
    var cur = el;
    while (cur && cur !== document.body) {
      if (cur.classList && cur.classList.contains(className)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function moveFocus(direction) {
    var focusables = getFocusableElements();
    if (focusables.length === 0) return false;
    if (!currentFocusedEl || !mainViewEl.contains(currentFocusedEl)) {
      setFocusedElement(focusables[0]);
      return true;
    }

    var curRect = currentFocusedEl.getBoundingClientRect();
    var curCx = (curRect.left + curRect.right) / 2;
    var curCy = (curRect.top + curRect.bottom) / 2;
    var curRow = currentFocusedEl.getAttribute("data-row-id");

    var bestEl = null;
    var bestScore = Infinity;

    for (var i = 0; i < focusables.length; i++) {
      var cand = focusables[i];
      if (cand === currentFocusedEl) continue;
      var r = cand.getBoundingClientRect();
      var cx = (r.left + r.right) / 2;
      var cy = (r.top + r.bottom) / 2;
      var dx = cx - curCx;
      var dy = cy - curCy;
      var candRow = cand.getAttribute("data-row-id");

      if (direction === "left") {
        if (dx >= -8) continue;
        if (curRow && candRow === curRow) {
          var sL = Math.abs(dx) + Math.abs(dy) * 2;
          if (sL < bestScore) { bestScore = sL; bestEl = cand; }
        } else if (Math.abs(dy) < curRect.height * 0.85) {
          var sL2 = Math.abs(dx) + Math.abs(dy) * 4 + 200;
          if (sL2 < bestScore) { bestScore = sL2; bestEl = cand; }
        }
      } else if (direction === "right") {
        if (dx <= 8) continue;
        if (curRow && candRow === curRow) {
          var sR = Math.abs(dx) + Math.abs(dy) * 2;
          if (sR < bestScore) { bestScore = sR; bestEl = cand; }
        } else if (Math.abs(dy) < curRect.height * 0.85) {
          var sR2 = Math.abs(dx) + Math.abs(dy) * 4 + 200;
          if (sR2 < bestScore) { bestScore = sR2; bestEl = cand; }
        }
      } else if (direction === "up") {
        if (dy >= -12) continue;
        if (curRow && candRow === curRow && Math.abs(dy) < 20) continue;
        var sU = Math.abs(dy) * 2.2 + Math.abs(dx);
        if (sU < bestScore) { bestScore = sU; bestEl = cand; }
      } else if (direction === "down") {
        if (dy <= 12) continue;
        if (curRow && candRow === curRow && Math.abs(dy) < 20) continue;
        var sD = Math.abs(dy) * 2.2 + Math.abs(dx);
        if (sD < bestScore) { bestScore = sD; bestEl = cand; }
      }
    }

    if (bestEl) {
      /* If switching rows vertically, check if the target row has a remembered element */
      var targetRow = bestEl.getAttribute("data-row-id");
      if (!state.keyboardOpen && (direction === "up" || direction === "down") && targetRow && targetRow !== curRow && lastFocusedIdByRow[targetRow]) {
        var rememberedId = lastFocusedIdByRow[targetRow];
        for (var j = 0; j < focusables.length; j++) {
          if (focusables[j].getAttribute("data-focus-id") === rememberedId) {
            bestEl = focusables[j];
            break;
          }
        }
      }
      setFocusedElement(bestEl);
      return true;
    }
    return false;
  }

  /* ==========================================================================
   * 7. DATA FETCHING & ACTIONS
   * ========================================================================== */
  var homeFetchInFlight = false;
  function fetchHomeData() {
    if (homeFetchInFlight) return;
    homeFetchInFlight = true;
    state.loading = true;
    state.error = "";
    render();

    callService("getHome", {}, function (err, data) {
      homeFetchInFlight = false;
      if (err || !data) {
        if (state.featured.length === 0 && state.homeRetryCount < 15) {
          state.homeRetryCount++;
          state.loading = true;
          state.error = "";
          setTimeout(function () {
            if (state.featured.length === 0) fetchHomeData();
          }, 900);
          return;
        }
        state.loading = false;
        state.error = (err && err.message) ? err.message : "Could not load catalog from on-TV service.";
        render();
        return;
      }
      state.loading = false;
      state.homeRetryCount = 0;
      state.featured = Array.isArray(data.featured) ? data.featured : [];
      state.recentEpisodes = Array.isArray(data.recentEpisodes) ? data.recentEpisodes : [];
      if (Array.isArray(data.history) && data.history.length > 0) {
        state.history = data.history;
        saveLocalHistoryBackup(state.history);
      }
      render();
    });
  }

  function performSearch(queryText) {
    var q = String(queryText != null ? queryText : state.searchQuery).trim();
    state.searchQuery = q;
    if (!q) {
      state.searchResults = null;
      state.isSearching = false;
      render();
      return;
    }
    state.isSearching = true;
    state.error = "";
    render();

    callService("search", { query: q }, function (err, data) {
      state.isSearching = false;
      if (err || !data) {
        showToast("Search error: " + (err ? err.message : "Failed"));
        render();
        return;
      }
      state.searchResults = Array.isArray(data.results) ? data.results : [];
      render("card-search-0");
    });
  }

  function openAnimeDetails(animeId, fallbackCard) {
    state.view = "details";
    state.detailsLoading = true;
    state.error = "";
    state.epChunkIndex = 0;

    /* Check history for preferred audioMode on this show */
    var histEntry = findHistoryEntry(animeId);
    if (histEntry && histEntry.audioMode) {
      state.audioMode = histEntry.audioMode;
    }

    state.currentAnime = fallbackCard ? {
      id: animeId,
      title: fallbackCard.title || "Loading...",
      poster: fallbackCard.poster || "",
      banner: fallbackCard.poster || "",
      synopsis: "Loading anime details & episodes...",
      type: fallbackCard.type || "TV Series",
      status: fallbackCard.status || "",
      year: fallbackCard.year || "",
      totalEpisodes: fallbackCard.episodeCount || 0,
      genres: fallbackCard.genres || [],
      episodes: []
    } : null;

    render("btn-details-play");

    callService("getDetails", { animeId: animeId }, function (err, data) {
      state.detailsLoading = false;
      if (err || !data || !data.anime) {
        state.error = (err && err.message) ? err.message : "Failed to load anime details.";
        render("btn-details-back");
        return;
      }
      state.currentAnime = data.anime;
      if (data.historyEntry) {
        upsertLocalHistoryState(data.historyEntry);
        if (data.historyEntry.audioMode) state.audioMode = data.historyEntry.audioMode;
      }

      /* Set active chunk to the one containing the user's last watched episode */
      var h = findHistoryEntry(animeId);
      if (h && h.episodeNumber > 0) {
        state.epChunkIndex = Math.floor((h.episodeNumber - 1) / 50);
      }
      render("btn-details-play");
    });
  }

  function findHistoryEntry(animeId) {
    for (var i = 0; i < state.history.length; i++) {
      if (String(state.history[i].animeId) === String(animeId)) {
        return state.history[i];
      }
    }
    return null;
  }

  function upsertLocalHistoryState(entry) {
    if (!entry || !entry.animeId) return;
    var next = [entry];
    for (var i = 0; i < state.history.length; i++) {
      if (String(state.history[i].animeId) !== String(entry.animeId)) {
        next.push(state.history[i]);
      }
    }
    state.history = next;
    saveLocalHistoryBackup(state.history);
  }

  function persistWatchProgress(forceTimestamp) {
    var p = state.player;
    if (!p.animeId) return;
    var curT = typeof forceTimestamp === "number" ? forceTimestamp : (p.videoEl ? p.videoEl.currentTime : p.currentTime);
    var dur = (p.videoEl && p.videoEl.duration && isFinite(p.videoEl.duration)) ? p.videoEl.duration : p.duration;

    var entry = {
      animeId: p.animeId,
      title: p.animeTitle,
      poster: p.poster,
      episodeNumber: p.episodeNumber,
      episodeSlug: p.episodeSlug,
      episodeTitle: p.episodeTitle,
      timestamp: Math.floor(curT || 0),
      duration: Math.floor(dur || 0),
      audioMode: p.activeAudio || state.audioMode,
      totalEpisodes: p.totalEpisodes || 0,
      updatedAt: Date.now()
    };

    upsertLocalHistoryState(entry);
    callService("saveHistory", entry, function (err, data) {
      if (!err && data && Array.isArray(data.items)) {
        state.history = data.items;
        saveLocalHistoryBackup(state.history);
      }
    });
  }

  /* ==========================================================================
   * 8. VIDEO PLAYER & HLS.JS + WEBVTT SUBTITLE ENGINE
   * ========================================================================== */
  function startEpisodePlayback(animeObj, episodeNumber, resumeTimestamp, requestedAudioMode) {
    cleanupPlayer();

    var epNum = Number(episodeNumber) || 1;
    var audioMode = requestedAudioMode || state.audioMode || "sub";
    var epList = (animeObj && Array.isArray(animeObj.episodes)) ? animeObj.episodes : [];
    var epMeta = null;
    for (var i = 0; i < epList.length; i++) {
      if (Number(epList[i].number) === epNum) {
        epMeta = epList[i];
        break;
      }
    }

    state.view = "player";
    state.player.animeId = animeObj.id || animeObj.animeId;
    state.player.animeTitle = animeObj.title || "Anime";
    state.player.poster = animeObj.poster || "";
    state.player.totalEpisodes = Number(animeObj.totalEpisodes || epList.length || 0);
    state.player.episodes = epList;
    state.player.episodeNumber = epNum;
    state.player.episodeSlug = epMeta ? epMeta.slug : String(epNum);
    state.player.episodeTitle = (epMeta && epMeta.title) ? epMeta.title : ("Episode " + epNum);
    state.player.streamUrl = "";
    state.player.subtitles = [];
    state.player.activeSubIndex = 0;
    state.player.vttCues = [];
    state.player.currentCueText = "";
    state.player.activeAudio = audioMode;
    state.player.resumeTime = typeof resumeTimestamp === "number" ? resumeTimestamp : 0;
    state.player.currentTime = state.player.resumeTime;
    state.player.duration = 0;
    state.player.paused = false;
    state.player.buffering = true;
    state.player.controlsVisible = true;

    render("btn-player-playpause");
    showPlayerControlsTemporarily();

    callService("getStream", {
      animeId: state.player.animeId,
      episodeNumber: epNum,
      audioMode: audioMode
    }, function (err, streamData) {
      if (state.view !== "player") return;
      if (err || !streamData || !streamData.streamUrl) {
        state.player.buffering = false;
        showToast("Stream error: " + (err ? err.message : "Unavailable"));
        updatePlayerDomStatus();
        return;
      }

      state.player.streamUrl = streamData.streamUrl;
      state.player.episodeTitle = streamData.episodeTitle || state.player.episodeTitle;
      state.player.subtitles = Array.isArray(streamData.subtitles) ? streamData.subtitles : [];
      state.player.hasSub = streamData.hasSub !== false;
      state.player.hasDub = !!streamData.hasDub;
      state.player.activeAudio = streamData.activeAudio || audioMode;
      state.audioMode = state.player.activeAudio;

      if (requestedAudioMode === "dub" && !state.player.hasDub) {
        showToast("English Dub not available for this episode — playing Japanese Sub");
      }

      /* Choose default subtitle track (on for SUB, off for DUB unless toggled) */
      if (state.player.activeAudio === "dub" || state.player.subtitles.length === 0) {
        state.player.activeSubIndex = -1;
      } else {
        var defIdx = 0;
        for (var s = 0; s < state.player.subtitles.length; s++) {
          if (state.player.subtitles[s].default) { defIdx = s; break; }
        }
        state.player.activeSubIndex = defIdx;
      }

      updatePlayerHeaderAndButtons();
      mountVideoStream(streamData.streamUrl);
      loadActiveSubtitleTrack();
    });
  }

  function mountVideoStream(streamUrl) {
    var video = document.getElementById("ma-video-el");
    if (!video) return;
    state.player.videoEl = video;

    /* Attach native <track> elements for subtitles */
    while (video.firstChild) video.removeChild(video.firstChild);
    for (var i = 0; i < state.player.subtitles.length; i++) {
      var sub = state.player.subtitles[i];
      var trackEl = document.createElement("track");
      trackEl.kind = "subtitles";
      trackEl.label = sub.label || ("Track " + (i + 1));
      trackEl.srclang = sub.lang || "en";
      trackEl.src = sub.url;
      if (i === state.player.activeSubIndex) {
        trackEl.default = true;
      }
      video.appendChild(trackEl);
    }

    var hasSeekedToResume = false;
    function seekToResumeIfNeeded() {
      if (hasSeekedToResume) return;
      if (state.player.resumeTime > 5 && video.duration && state.player.resumeTime < video.duration - 15) {
        hasSeekedToResume = true;
        try { video.currentTime = state.player.resumeTime; } catch (e) {}
      } else if (video.duration) {
        hasSeekedToResume = true;
      }
    }

    video.onloadedmetadata = function () {
      state.player.duration = video.duration || 0;
      seekToResumeIfNeeded();
      /* Hide native browser track rendering so our high-contrast TV WebVTT renderer displays cleanly without double subtitles */
      try {
        if (video.textTracks) {
          for (var t = 0; t < video.textTracks.length; t++) {
            video.textTracks[t].mode = "hidden";
          }
        }
      } catch (e) {}
    };

    video.oncanplay = function () {
      state.player.buffering = false;
      seekToResumeIfNeeded();
      updatePlayerDomStatus();
      var playPromise = video.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {});
      }
    };

    video.onplaying = function () {
      state.player.buffering = false;
      state.player.paused = false;
      updatePlayerDomStatus();
    };

    video.onpause = function () {
      state.player.paused = true;
      updatePlayerDomStatus();
      persistWatchProgress();
    };

    video.onwaiting = function () {
      state.player.buffering = true;
      updatePlayerDomStatus();
    };

    video.ontimeupdate = function () {
      state.player.currentTime = video.currentTime || 0;
      if (video.duration && isFinite(video.duration)) {
        state.player.duration = video.duration;
      }
      updatePlayerTimelineDom();
      updateSubtitleCueOverlay(state.player.currentTime);
    };

    video.onended = function () {
      persistWatchProgress();
      if (hasNextEpisode()) {
        showToast("Playing Next Episode (" + (state.player.episodeNumber + 1) + ")...");
        setTimeout(function () {
          if (state.view === "player") {
            playAdjacentEpisode(1);
          }
        }, 1800);
      } else {
        showToast("Episode finished");
        showPlayerControlsTemporarily();
      }
    };

    /* Automatic progress saving every 10 seconds */
    if (state.player.saveTimer) clearInterval(state.player.saveTimer);
    state.player.saveTimer = setInterval(function () {
      if (state.view === "player" && state.player.videoEl && !state.player.videoEl.paused && state.player.videoEl.currentTime > 2) {
        persistWatchProgress();
      }
    }, 10000);

    ensureHlsLoaded(function (err, HlsObj) {
      if (state.view !== "player") return;
      if (!err && HlsObj && HlsObj.isSupported()) {
        var hls = new HlsObj({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 35 * 1000 * 1000,
          enableWorker: true,
          lowLatencyMode: false
        });
        state.player.hlsInstance = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(HlsObj.Events.MANIFEST_PARSED, function () {
          var p = video.play();
          if (p && p.catch) p.catch(function () {});
        });
        hls.on(HlsObj.Events.ERROR, function (event, data) {
          if (data && data.fatal) {
            if (data.type === HlsObj.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === HlsObj.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              hls.destroy();
            }
          }
        });
      } else {
        /* Fallback to native HLS playback */
        video.src = streamUrl;
        video.load();
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
    });
  }

  /* Fetch & parse WebVTT cues for reliable TV subtitle rendering on Chromium 47 */
  function loadActiveSubtitleTrack() {
    state.player.vttCues = [];
    state.player.currentCueText = "";
    updateSubtitleCueOverlay(state.player.currentTime);

    var idx = state.player.activeSubIndex;
    if (idx < 0 || idx >= state.player.subtitles.length) return;

    var subTrack = state.player.subtitles[idx];
    if (!subTrack || !subTrack.url) return;

    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", subTrack.url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && xhr.status >= 200 && xhr.status < 300) {
          state.player.vttCues = parseWebVttCues(xhr.responseText);
          updateSubtitleCueOverlay(state.player.currentTime);
        }
      };
      xhr.send();
    } catch (e) {}
  }

  function parseWebVttCues(vttText) {
    var lines = String(vttText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var cues = [];
    var i = 0;
    var timeRe = /(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})/;

    while (i < lines.length) {
      var line = lines[i].trim();
      var m = line.match(timeRe);
      if (m) {
        var startSec = parseVttTimestamp(m[1]);
        var endSec = parseVttTimestamp(m[2]);
        i++;
        var textLines = [];
        while (i < lines.length && lines[i].trim() !== "") {
          textLines.push(lines[i].replace(/<[^>]+>/g, "").trim());
          i++;
        }
        if (textLines.length > 0) {
          cues.push({
            start: startSec,
            end: endSec,
            text: textLines.join("\n")
          });
        }
      } else {
        i++;
      }
    }
    return cues;
  }

  function parseVttTimestamp(ts) {
    var parts = String(ts).replace(",", ".").split(":");
    if (parts.length === 3) {
      return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      return Number(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return 0;
  }

  function updateSubtitleCueOverlay(curTime) {
    var subBox = document.getElementById("ma-sub-box");
    if (!subBox) return;
    if (state.player.activeSubIndex < 0 || state.player.vttCues.length === 0) {
      subBox.style.display = "none";
      return;
    }
    var cues = state.player.vttCues;
    var activeText = "";
    for (var i = 0; i < cues.length; i++) {
      if (curTime >= cues[i].start && curTime <= cues[i].end) {
        activeText = cues[i].text;
        break;
      }
    }
    if (activeText) {
      subBox.textContent = activeText;
      subBox.style.display = "inline-block";
    } else {
      subBox.style.display = "none";
    }
  }

  function cleanupPlayer() {
    if (state.player.saveTimer) {
      clearInterval(state.player.saveTimer);
      state.player.saveTimer = null;
    }
    if (state.player.controlsTimer) {
      clearTimeout(state.player.controlsTimer);
      state.player.controlsTimer = null;
    }
    if (state.player.hlsInstance) {
      try { state.player.hlsInstance.destroy(); } catch (e) {}
      state.player.hlsInstance = null;
    }
    if (state.player.videoEl) {
      try {
        state.player.videoEl.pause();
        state.player.videoEl.removeAttribute("src");
        state.player.videoEl.load();
      } catch (e) {}
      state.player.videoEl = null;
    }
  }

  function hasNextEpisode() {
    var p = state.player;
    if (p.totalEpisodes > 0) return p.episodeNumber < p.totalEpisodes;
    return p.episodes && p.episodeNumber < p.episodes.length;
  }

  function hasPrevEpisode() {
    return state.player.episodeNumber > 1;
  }

  function playAdjacentEpisode(delta) {
    var nextNum = state.player.episodeNumber + delta;
    if (nextNum < 1) {
      showToast("Already on Episode 1");
      return;
    }
    if (state.player.totalEpisodes > 0 && nextNum > state.player.totalEpisodes) {
      showToast("No more episodes");
      return;
    }
    persistWatchProgress();
    var animeContext = state.currentAnime || {
      id: state.player.animeId,
      title: state.player.animeTitle,
      poster: state.player.poster,
      totalEpisodes: state.player.totalEpisodes,
      episodes: state.player.episodes
    };
    startEpisodePlayback(animeContext, nextNum, 0, state.player.activeAudio);
  }

  function togglePlayerPlayPause() {
    var v = state.player.videoEl;
    if (!v) return;
    if (v.paused) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      v.pause();
    }
    showPlayerControlsTemporarily();
  }

  function seekPlayerBy(deltaSec) {
    var v = state.player.videoEl;
    if (!v || !v.duration || !isFinite(v.duration)) return;
    var nextT = Math.max(0, Math.min(v.duration - 1, (v.currentTime || 0) + deltaSec));
    try { v.currentTime = nextT; } catch (e) {}
    state.player.currentTime = nextT;
    updatePlayerTimelineDom();
    showPlayerControlsTemporarily();
  }

  function togglePlayerAudioMode() {
    if (!state.player.hasDub) {
      showToast("Only Japanese (SUB) audio is available for this episode");
      return;
    }
    var nextAudio = state.player.activeAudio === "dub" ? "sub" : "dub";
    var curTime = state.player.videoEl ? state.player.videoEl.currentTime : state.player.currentTime;
    showToast("Switching audio to " + (nextAudio === "dub" ? "English (DUB)" : "Japanese (SUB)") + "...");
    var animeContext = state.currentAnime || {
      id: state.player.animeId,
      title: state.player.animeTitle,
      poster: state.player.poster,
      totalEpisodes: state.player.totalEpisodes,
      episodes: state.player.episodes
    };
    startEpisodePlayback(animeContext, state.player.episodeNumber, curTime, nextAudio);
  }

  function cyclePlayerSubtitles() {
    var subs = state.player.subtitles || [];
    if (subs.length === 0) {
      showToast("No subtitle tracks available");
      return;
    }
    var nextIdx = state.player.activeSubIndex + 1;
    if (nextIdx >= subs.length) {
      nextIdx = -1; /* Off */
    }
    state.player.activeSubIndex = nextIdx;
    loadActiveSubtitleTrack();
    updatePlayerHeaderAndButtons();
    showToast("Subtitles: " + (nextIdx === -1 ? "Off" : subs[nextIdx].label));
    showPlayerControlsTemporarily();
  }

  function showPlayerControlsTemporarily() {
    state.player.controlsVisible = true;
    var hud = document.getElementById("ma-player-hud");
    var topBar = document.getElementById("ma-player-top");
    var subOverlay = document.getElementById("ma-sub-overlay");
    if (hud) hud.classList.remove("hidden");
    if (topBar) topBar.classList.remove("hidden");
    if (subOverlay) subOverlay.classList.add("raised");

    if (state.player.controlsTimer) clearTimeout(state.player.controlsTimer);
    state.player.controlsTimer = setTimeout(function () {
      if (state.view === "player" && state.player.videoEl && !state.player.videoEl.paused) {
        state.player.controlsVisible = false;
        var h = document.getElementById("ma-player-hud");
        var t = document.getElementById("ma-player-top");
        var s = document.getElementById("ma-sub-overlay");
        if (h) h.classList.add("hidden");
        if (t) t.classList.add("hidden");
        if (s) s.classList.remove("raised");
      }
    }, 4500);
  }

  function formatTime(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    var hrs = Math.floor(s / 3600);
    var mins = Math.floor((s % 3600) / 60);
    var rem = s % 60;
    if (hrs > 0) {
      return hrs + ":" + String(mins).padStart(2, "0") + ":" + String(rem).padStart(2, "0");
    }
    return String(mins).padStart(2, "0") + ":" + String(rem).padStart(2, "0");
  }

  function updatePlayerTimelineDom() {
    var fill = document.getElementById("ma-seek-fill");
    var knob = document.getElementById("ma-seek-knob");
    var timeEl = document.getElementById("ma-player-time");
    var pct = state.player.duration > 0 ? Math.min(100, (state.player.currentTime / state.player.duration) * 100) : 0;
    if (fill) fill.style.width = pct.toFixed(2) + "%";
    if (knob) knob.style.left = pct.toFixed(2) + "%";
    if (timeEl) timeEl.textContent = formatTime(state.player.currentTime) + " / " + formatTime(state.player.duration);
  }

  function updatePlayerDomStatus() {
    var bufEl = document.getElementById("ma-buffer-overlay");
    if (bufEl) {
      bufEl.style.display = state.player.buffering ? "flex" : "none";
    }
    var ppBtn = document.getElementById("btn-player-playpause");
    if (ppBtn) {
      ppBtn.textContent = state.player.paused ? "▶ Play" : "❚❚ Pause";
    }
  }

  function updatePlayerHeaderAndButtons() {
    var titleEl = document.getElementById("ma-player-title");
    if (titleEl) {
      titleEl.textContent = state.player.animeTitle + " — EP " + state.player.episodeNumber + ": " + state.player.episodeTitle;
    }
    var audioBtn = document.getElementById("btn-player-audio");
    if (audioBtn) {
      audioBtn.textContent = "Audio: " + (state.player.activeAudio === "dub" ? "DUB (EN)" : "SUB (JP)");
    }
    var subBtn = document.getElementById("btn-player-subs");
    if (subBtn) {
      var subLabel = "Off";
      if (state.player.activeSubIndex >= 0 && state.player.subtitles[state.player.activeSubIndex]) {
        subLabel = state.player.subtitles[state.player.activeSubIndex].label;
      }
      subBtn.textContent = "Subs: " + subLabel;
    }
  }

  /* ==========================================================================
   * 9. UI RENDERING (HOME, DETAILS, PLAYER)
   * ========================================================================== */
  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function createImgWithProxyFallback(srcUrl) {
    var img = document.createElement("img");
    if (!srcUrl) return img;
    img.src = srcUrl;
    var triedProxy = false;
    img.onerror = function () {
      if (!triedProxy && srcUrl.indexOf("127.0.0.1") === -1) {
        triedProxy = true;
        img.src = HTTP_BASE + "/proxy?url=" + encodeURIComponent(srcUrl);
      }
    };
    return img;
  }

  function makeFocusable(el, focusId, rowId, onSelect) {
    el.setAttribute("data-focusable", "true");
    el.setAttribute("data-focus-id", focusId);
    if (rowId) el.setAttribute("data-row-id", rowId);
    el.__onSelect = onSelect;
    el.onclick = function (e) {
      e.stopPropagation();
      setFocusedElement(el, true);
      if (onSelect) onSelect();
    };
    return el;
  }

  function render(targetFocusId) {
    if (!mainViewEl) return;
    while (mainViewEl.firstChild) {
      mainViewEl.removeChild(mainViewEl.firstChild);
    }

    if (state.view === "player") {
      renderPlayerScreen();
    } else if (state.view === "details") {
      renderHeader();
      renderDetailsScreen();
    } else {
      renderHeader();
      renderHomeScreen();
    }

    if (state.keyboardOpen) {
      renderKeyboardModal();
    }

    restoreFocus(targetFocusId);
  }

  function openSearchKeyboard() {
    state.searchDraft = state.searchQuery || "";
    state.keyboardOpen = true;
    render("kb-key-A");
  }

  function closeSearchKeyboard(focusTarget) {
    state.keyboardOpen = false;
    render(focusTarget || "nav-search-input");
  }

  function updateKeyboardDraftDom() {
    var disp = document.getElementById("ma-kb-display-text");
    if (disp) {
      disp.textContent = (state.searchDraft || "") + "▌";
    }
  }

  function renderKeyboardModal() {
    var modal = createEl("div", "ma-kb-modal");
    modal.id = "ma-keyboard-modal";

    var panel = createEl("div", "ma-kb-panel");

    var head = createEl("div", "ma-kb-header");
    head.appendChild(createEl("div", "ma-kb-title", "Search Anime"));
    head.appendChild(createEl("div", "ma-kb-hint", "D-Pad Arrows + OK to type  ·  BACK to close"));
    panel.appendChild(head);

    var disp = createEl("div", "ma-kb-display");
    var dispText = createEl("span", "", (state.searchDraft || "") + "▌");
    dispText.id = "ma-kb-display-text";
    disp.appendChild(dispText);
    panel.appendChild(disp);

    /* Quick Popular Search Suggestions */
    var quickList = ["Naruto", "One Piece", "Bleach", "Dragon Ball", "Attack on Titan", "Demon Slayer", "Hunter x Hunter", "Jujutsu Kaisen"];
    var chipsRow = createEl("div", "ma-kb-chips");
    for (var q = 0; q < quickList.length; q++) {
      (function (qName, qIdx) {
        var chip = createEl("div", "ma-kb-chip", qName);
        makeFocusable(chip, "kb-chip-" + qIdx, "kb-row-chips", function () {
          state.keyboardOpen = false;
          if (state.view !== "home") state.view = "home";
          performSearch(qName);
        });
        chipsRow.appendChild(chip);
      })(quickList[q], q);
    }
    panel.appendChild(chipsRow);

    /* Character Grid (4 rows of 10 keys) */
    var rows = [
      ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      ["K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"],
      ["U", "V", "W", "X", "Y", "Z", "0", "1", "2", "3"],
      ["4", "5", "6", "7", "8", "9", "-", ":", "'", "."]
    ];

    for (var r = 0; r < rows.length; r++) {
      var rowEl = createEl("div", "ma-kb-grid-row");
      var rId = "kb-row-" + r;
      for (var c = 0; c < rows[r].length; c++) {
        (function (ch) {
          var keyBtn = createEl("div", "ma-kb-key", ch);
          makeFocusable(keyBtn, "kb-key-" + ch, rId, function () {
            state.searchDraft = (state.searchDraft || "") + ch.toLowerCase();
            updateKeyboardDraftDom();
          });
          rowEl.appendChild(keyBtn);
        })(rows[r][c]);
      }
      panel.appendChild(rowEl);
    }

    /* Action Row */
    var actRow = createEl("div", "ma-kb-grid-row");
    actRow.style.marginTop = "16px";

    var spaceKey = createEl("div", "ma-kb-key wide", "␣ Space");
    makeFocusable(spaceKey, "kb-act-space", "kb-row-actions", function () {
      state.searchDraft = (state.searchDraft || "") + " ";
      updateKeyboardDraftDom();
    });
    actRow.appendChild(spaceKey);

    var bkspKey = createEl("div", "ma-kb-key wide", "⌫ Backspace");
    makeFocusable(bkspKey, "kb-act-bksp", "kb-row-actions", function () {
      if (state.searchDraft && state.searchDraft.length > 0) {
        state.searchDraft = state.searchDraft.slice(0, -1);
        updateKeyboardDraftDom();
      }
    });
    actRow.appendChild(bkspKey);

    var clearKey = createEl("div", "ma-kb-key wide", "Clear");
    makeFocusable(clearKey, "kb-act-clear", "kb-row-actions", function () {
      state.searchDraft = "";
      updateKeyboardDraftDom();
    });
    actRow.appendChild(clearKey);

    var submitKey = createEl("div", "ma-kb-key wide primary", "🔍 Search");
    makeFocusable(submitKey, "kb-act-submit", "kb-row-actions", function () {
      var finalQ = (state.searchDraft || "").trim();
      state.keyboardOpen = false;
      if (state.view !== "home") state.view = "home";
      performSearch(finalQ);
    });
    actRow.appendChild(submitKey);

    var cancelKey = createEl("div", "ma-kb-key wide", "Cancel");
    makeFocusable(cancelKey, "kb-act-cancel", "kb-row-actions", function () {
      closeSearchKeyboard("nav-search-input");
    });
    actRow.appendChild(cancelKey);

    panel.appendChild(actRow);
    modal.appendChild(panel);
    mainViewEl.appendChild(modal);
  }

  function renderHeader() {
    var header = createEl("header", "ma-header");

    var brand = createEl("div", "ma-brand");
    brand.appendChild(createEl("div", "ma-logo-dot"));
    brand.appendChild(createEl("div", "ma-brand-title", "MyAnime"));
    brand.appendChild(createEl("div", "ma-brand-sub", "Tizen 3.0"));
    header.appendChild(brand);

    if (state.view !== "home") {
      var homeBtn = createEl("div", "ma-btn", "← Home");
      makeFocusable(homeBtn, "nav-home", "header", function () {
        state.view = "home";
        render();
      });
      header.appendChild(homeBtn);
    }

    /* Search Bar Button (opens built-in TV On-Screen Keyboard — no native <input> zoom bug) */
    var searchBox = createEl("div", "ma-search-box");
    var hasQ = !!(state.searchQuery && state.searchQuery.trim());
    var searchText = createEl(
      "div",
      "ma-search-text" + (hasQ ? "" : " placeholder"),
      hasQ ? ("🔍 " + state.searchQuery) : "🔍 Search anime titles (e.g. Naruto, One Piece)..."
    );
    searchBox.appendChild(searchText);

    makeFocusable(searchBox, "nav-search-input", "header", function () {
      openSearchKeyboard();
    });
    header.appendChild(searchBox);

    var searchBtn = createEl("div", "ma-btn primary", "Search");
    makeFocusable(searchBtn, "nav-search-btn", "header", function () {
      openSearchKeyboard();
    });
    header.appendChild(searchBtn);

    if (state.searchQuery || state.searchResults) {
      var clearBtn = createEl("div", "ma-btn", "Clear");
      makeFocusable(clearBtn, "nav-clear-btn", "header", function () {
        state.searchQuery = "";
        state.searchResults = null;
        if (state.view !== "home") state.view = "home";
        render("nav-search-input");
      });
      header.appendChild(clearBtn);
    }

    var refreshBtn = createEl("div", "ma-btn", "↻ Refresh");
    makeFocusable(refreshBtn, "nav-refresh-btn", "header", function () {
      if (state.view === "details" && state.currentAnime) {
        openAnimeDetails(state.currentAnime.id, state.currentAnime);
      } else {
        state.view = "home";
        fetchHomeData();
      }
    });
    header.appendChild(refreshBtn);

    var status = createEl("div", "ma-status");
    var dot = createEl("div", "ma-status-dot" + (state.wsConnected ? " online" : ""));
    dot.id = "ma-status-dot";
    var stText = createEl("span", "", state.wsConnected ? "On-TV Service Ready" : "Connecting Service...");
    stText.id = "ma-status-text";
    status.appendChild(dot);
    status.appendChild(stText);
    header.appendChild(status);

    mainViewEl.appendChild(header);
  }

  function renderHomeScreen() {
    var content = createEl("div", "ma-content");
    var page = createEl("div", "ma-scroll-page");
    content.appendChild(page);
    mainViewEl.appendChild(content);

    /* 1. If search results are active, show Search Results grid first */
    if (state.isSearching) {
      var sLoad = createEl("div", "ma-section");
      var sHead = createEl("div", "ma-section-header");
      sHead.appendChild(createEl("div", "ma-section-title", "Searching for \"" + state.searchQuery + "\"..."));
      sLoad.appendChild(sHead);
      page.appendChild(sLoad);
      return;
    }

    if (state.searchResults !== null) {
      var searchSec = createEl("div", "ma-section");
      var sh = createEl("div", "ma-section-header");
      sh.appendChild(createEl("div", "ma-section-title", "Search Results for \"" + state.searchQuery + "\""));
      sh.appendChild(createEl("div", "ma-section-sub", state.searchResults.length + " anime found"));
      searchSec.appendChild(sh);

      if (state.searchResults.length === 0) {
        var empty = createEl("div", "", "No anime matched your query. Try another title.");
        empty.style.cssText = "padding: 20px 72px; font-size: 24px; color: #9ca3af;";
        searchSec.appendChild(empty);
      } else {
        renderAnimeGrid(searchSec, state.searchResults, "search");
      }
      page.appendChild(searchSec);
    }

    /* 2. "Continue Watching" row from local history.json */
    if (state.history && state.history.length > 0) {
      var histSec = createEl("div", "ma-section");
      var hh = createEl("div", "ma-section-header");
      hh.appendChild(createEl("div", "ma-section-title", "Continue Watching"));
      hh.appendChild(createEl("div", "ma-section-sub", "Saved in TV history.json"));
      histSec.appendChild(hh);

      var railView = createEl("div", "ma-rail-viewport");
      var railTrack = createEl("div", "ma-rail-track");

      for (var i = 0; i < state.history.length; i++) {
        (function (hItem, idx) {
          var card = createEl("div", "ma-card wide");
          var art = createEl("div", "ma-card-art");
          art.appendChild(createImgWithProxyFallback(hItem.poster));

          var pct = (hItem.duration > 0 && hItem.timestamp > 0)
            ? Math.min(100, Math.max(4, Math.round((hItem.timestamp / hItem.duration) * 100)))
            : 8;

          var isFinished = pct >= 92 && (!hItem.totalEpisodes || hItem.episodeNumber < hItem.totalEpisodes);
          var targetEp = isFinished ? (hItem.episodeNumber + 1) : hItem.episodeNumber;
          var targetTime = isFinished ? 0 : (hItem.timestamp || 0);

          art.appendChild(createEl("div", "ma-card-badge", isFinished ? ("NEXT: EP " + targetEp) : ("RESUME EP " + hItem.episodeNumber)));
          art.appendChild(createEl("div", "ma-card-badge right", (hItem.audioMode || "sub").toUpperCase()));

          var prog = createEl("div", "ma-card-progress");
          var fill = createEl("div", "ma-card-progress-fill");
          fill.style.width = pct + "%";
          prog.appendChild(fill);
          art.appendChild(prog);

          card.appendChild(art);
          card.appendChild(createEl("div", "ma-card-title", hItem.title));

          var timeInfo = hItem.duration > 0
            ? (formatTime(hItem.timestamp) + " / " + formatTime(hItem.duration))
            : ("Episode " + hItem.episodeNumber);
          card.appendChild(createEl("div", "ma-card-meta", timeInfo + (hItem.episodeTitle ? (" · " + hItem.episodeTitle) : "")));

          makeFocusable(card, "card-history-" + idx, "row-history", function () {
            startEpisodePlayback({
              id: hItem.animeId,
              title: hItem.title,
              poster: hItem.poster,
              totalEpisodes: hItem.totalEpisodes || 0,
              episodes: []
            }, targetEp, targetTime, hItem.audioMode || "sub");
          });
          railTrack.appendChild(card);
        })(state.history[i], i);
      }

      railView.appendChild(railTrack);
      histSec.appendChild(railView);
      page.appendChild(histSec);
    }

    /* 3. Latest Episode Releases Rail */
    if (state.recentEpisodes && state.recentEpisodes.length > 0) {
      var recSec = createEl("div", "ma-section");
      var rh = createEl("div", "ma-section-header");
      rh.appendChild(createEl("div", "ma-section-title", "New Episode Releases"));
      rh.appendChild(createEl("div", "ma-section-sub", "Recently aired"));
      recSec.appendChild(rh);

      var rView = createEl("div", "ma-rail-viewport");
      var rTrack = createEl("div", "ma-rail-track");

      for (var r = 0; r < state.recentEpisodes.length; r++) {
        (function (epItem, idx) {
          var card = createEl("div", "ma-card wide");
          var art = createEl("div", "ma-card-art");
          art.appendChild(createImgWithProxyFallback(epItem.snapshot || epItem.poster));
          art.appendChild(createEl("div", "ma-card-badge", "EP " + epItem.episodeNumber));
          if (epItem.duration) {
            art.appendChild(createEl("div", "ma-card-badge right", epItem.duration));
          }
          card.appendChild(art);
          card.appendChild(createEl("div", "ma-card-title", epItem.title));
          card.appendChild(createEl("div", "ma-card-meta", epItem.episodeTitle + (epItem.airDiff ? (" · " + epItem.airDiff) : "")));

          makeFocusable(card, "card-recent-" + idx, "row-recent", function () {
            openAnimeDetails(epItem.animeId, {
              id: epItem.animeId,
              title: epItem.title,
              poster: epItem.poster
            });
          });
          rTrack.appendChild(card);
        })(state.recentEpisodes[r], r);
      }

      rView.appendChild(rTrack);
      recSec.appendChild(rView);
      page.appendChild(recSec);
    }

    /* 4. Trending & Popular Anime Grid */
    var featSec = createEl("div", "ma-section");
    var fh = createEl("div", "ma-section-header");
    fh.appendChild(createEl("div", "ma-section-title", "Trending & Popular Anime"));
    fh.appendChild(createEl("div", "ma-section-sub", "Ad-free direct streams"));
    featSec.appendChild(fh);

    if (state.loading && state.featured.length === 0) {
      var loadMsg = createEl("div", "", "Loading anime catalog from on-TV service...");
      loadMsg.style.cssText = "padding: 30px 72px; font-size: 26px; color: #9ca3af;";
      featSec.appendChild(loadMsg);
    } else if (state.error && state.featured.length === 0) {
      var errBox = createEl("div", "", state.error);
      errBox.style.cssText = "padding: 30px 72px; font-size: 26px; color: #f87171;";
      featSec.appendChild(errBox);
    } else {
      renderAnimeGrid(featSec, state.featured, "featured");
    }

    page.appendChild(featSec);
  }

  function renderAnimeGrid(containerEl, items, prefix) {
    var perRow = 6;
    for (var i = 0; i < items.length; i += perRow) {
      var rowEl = createEl("div", "ma-grid-row");
      var rowId = "row-" + prefix + "-" + Math.floor(i / perRow);
      var slice = items.slice(i, i + perRow);

      for (var j = 0; j < slice.length; j++) {
        (function (item, globalIdx) {
          var card = createEl("div", "ma-card");
          var art = createEl("div", "ma-card-art");
          art.appendChild(createImgWithProxyFallback(item.poster));
          if (item.type) {
            art.appendChild(createEl("div", "ma-card-badge", item.type));
          }
          if (item.episodeCount) {
            art.appendChild(createEl("div", "ma-card-badge right", item.episodeCount + " EPS"));
          }
          card.appendChild(art);
          card.appendChild(createEl("div", "ma-card-title", item.title));
          var metaParts = [];
          if (item.year) metaParts.push(item.year);
          if (item.status) metaParts.push(item.status);
          card.appendChild(createEl("div", "ma-card-meta", metaParts.join(" · ") || "Anime"));

          makeFocusable(card, "card-" + prefix + "-" + globalIdx, rowId, function () {
            openAnimeDetails(item.id, item);
          });
          rowEl.appendChild(card);
        })(slice[j], i + j);
      }

      containerEl.appendChild(rowEl);
    }
  }

  function renderDetailsScreen() {
    var content = createEl("div", "ma-content");
    var page = createEl("div", "ma-scroll-page");
    content.appendChild(page);
    mainViewEl.appendChild(content);

    var anime = state.currentAnime;
    if (!anime) {
      var msg = createEl("div", "", state.error || "Loading anime details...");
      msg.style.cssText = "padding: 60px 72px; font-size: 28px; color: #9ca3af;";
      page.appendChild(msg);
      return;
    }

    var hero = createEl("div", "ma-details-hero");
    var posterBox = createEl("div", "ma-details-poster");
    posterBox.appendChild(createImgWithProxyFallback(anime.poster || anime.banner));
    hero.appendChild(posterBox);

    var info = createEl("div", "ma-details-info");
    info.appendChild(createEl("h1", "ma-details-title", anime.title));

    var pills = createEl("div", "ma-details-pills");
    if (anime.type) pills.appendChild(createEl("span", "ma-pill", anime.type));
    if (anime.year) pills.appendChild(createEl("span", "ma-pill", String(anime.year)));
    if (anime.status) pills.appendChild(createEl("span", "ma-pill", anime.status));
    if (anime.totalEpisodes) pills.appendChild(createEl("span", "ma-pill highlight", anime.totalEpisodes + " Episodes"));
    pills.appendChild(createEl("span", "ma-pill highlight", "Preferred Audio: " + state.audioMode.toUpperCase()));
    if (Array.isArray(anime.genres)) {
      for (var g = 0; g < Math.min(5, anime.genres.length); g++) {
        pills.appendChild(createEl("span", "ma-pill", anime.genres[g]));
      }
    }
    info.appendChild(pills);

    info.appendChild(createEl("div", "ma-details-synopsis", anime.synopsis || "No synopsis available."));

    var hist = findHistoryEntry(anime.id);
    var resumeEp = 1;
    var resumeTime = 0;
    if (hist) {
      var isDone = hist.duration > 0 && (hist.timestamp / hist.duration) >= 0.92;
      if (isDone && (!anime.totalEpisodes || hist.episodeNumber < anime.totalEpisodes)) {
        resumeEp = hist.episodeNumber + 1;
        resumeTime = 0;
      } else {
        resumeEp = hist.episodeNumber || 1;
        resumeTime = hist.timestamp || 0;
      }
    }

    var actions = createEl("div", "ma-details-actions");

    var playLabel = hist
      ? (resumeTime > 5 ? ("▶ Resume EP " + resumeEp + " (" + formatTime(resumeTime) + ")") : ("▶ Play EP " + resumeEp))
      : "▶ Play Episode 1";
    var playBtn = createEl("div", "ma-btn primary", playLabel);
    makeFocusable(playBtn, "btn-details-play", "row-details-actions", function () {
      startEpisodePlayback(anime, resumeEp, resumeTime, state.audioMode);
    });
    actions.appendChild(playBtn);

    /* Sub / Dub Toggle Button */
    var subDubBtn = createEl("div", "ma-btn accent", "Audio: " + (state.audioMode === "dub" ? "DUB (English)" : "SUB (Japanese)"));
    makeFocusable(subDubBtn, "btn-details-audio", "row-details-actions", function () {
      state.audioMode = state.audioMode === "dub" ? "sub" : "dub";
      showToast("Preferred audio set to " + (state.audioMode === "dub" ? "English (DUB)" : "Japanese (SUB)"));
      render("btn-details-audio");
    });
    actions.appendChild(subDubBtn);

    /* Sort Order Toggle Button */
    var sortBtn = createEl("div", "ma-btn", state.epSortAsc ? "Sort: EP 1 → N" : "Sort: EP N → 1");
    makeFocusable(sortBtn, "btn-details-sort", "row-details-actions", function () {
      state.epSortAsc = !state.epSortAsc;
      render("btn-details-sort");
    });
    actions.appendChild(sortBtn);

    if (hist) {
      var removeHistBtn = createEl("div", "ma-btn", "Remove History");
      makeFocusable(removeHistBtn, "btn-details-rmhist", "row-details-actions", function () {
        callService("removeHistory", { animeId: anime.id }, function (err, data) {
          if (!err && data && Array.isArray(data.items)) {
            state.history = data.items;
            saveLocalHistoryBackup(state.history);
          }
          showToast("Removed from Watch History");
          render("btn-details-play");
        });
      });
      actions.appendChild(removeHistBtn);
    }

    var backBtn = createEl("div", "ma-btn", "← Back");
    makeFocusable(backBtn, "btn-details-back", "row-details-actions", function () {
      state.view = "home";
      render();
    });
    actions.appendChild(backBtn);

    info.appendChild(actions);
    hero.appendChild(info);
    page.appendChild(hero);

    /* Episodes Section */
    var eps = Array.isArray(anime.episodes) ? anime.episodes.slice() : [];
    if (eps.length === 0) {
      var loadingEps = createEl("div", "", state.detailsLoading ? "Loading episodes..." : "No episodes found.");
      loadingEps.style.cssText = "padding: 20px 72px; font-size: 24px; color: #9ca3af;";
      page.appendChild(loadingEps);
      return;
    }

    /* Chunk pagination (50 episodes per chunk) */
    var chunkSize = 50;
    var totalChunks = Math.ceil(eps.length / chunkSize);
    if (state.epChunkIndex >= totalChunks) state.epChunkIndex = 0;

    if (totalChunks > 1) {
      var chunksRow = createEl("div", "ma-chunks-row");
      for (var c = 0; c < totalChunks; c++) {
        (function (cIdx) {
          var startEp = cIdx * chunkSize + 1;
          var endEp = Math.min(eps.length, (cIdx + 1) * chunkSize);
          var cBtn = createEl("div", "ma-chunk-btn" + (cIdx === state.epChunkIndex ? " active" : ""), startEp + " – " + endEp);
          makeFocusable(cBtn, "btn-chunk-" + cIdx, "row-chunks", function () {
            state.epChunkIndex = cIdx;
            render("btn-chunk-" + cIdx);
          });
          chunksRow.appendChild(cBtn);
        })(c);
      }
      page.appendChild(chunksRow);
    }

    var chunkSlice = eps.slice(state.epChunkIndex * chunkSize, (state.epChunkIndex + 1) * chunkSize);
    if (!state.epSortAsc) {
      chunkSlice.reverse();
    }

    var epListEl = createEl("div", "ma-ep-list");
    for (var e = 0; e < chunkSlice.length; e++) {
      (function (ep, idx) {
        var row = createEl("div", "ma-ep-row");
        var thumb = createEl("div", "ma-ep-thumb");
        thumb.appendChild(createImgWithProxyFallback(ep.snapshot || anime.poster));

        var isSavedEp = hist && Number(hist.episodeNumber) === Number(ep.number);
        if (isSavedEp && hist.duration > 0) {
          var epPct = Math.min(100, Math.max(5, Math.round((hist.timestamp / hist.duration) * 100)));
          var prog = createEl("div", "ma-card-progress");
          var fill = createEl("div", "ma-card-progress-fill");
          fill.style.width = epPct + "%";
          prog.appendChild(fill);
          thumb.appendChild(prog);
        }
        row.appendChild(thumb);

        var body = createEl("div", "ma-ep-body");
        var numLabel = "Episode " + ep.number + (ep.duration ? ("  ·  " + ep.duration) : "") + (ep.airDate ? ("  ·  " + ep.airDate) : "");
        if (isSavedEp) numLabel += "  ·  LAST WATCHED (" + formatTime(hist.timestamp) + ")";
        body.appendChild(createEl("div", "ma-ep-num", numLabel));
        body.appendChild(createEl("div", "ma-ep-title", ep.title || ("Episode " + ep.number)));
        if (ep.summary) {
          body.appendChild(createEl("div", "ma-ep-desc", ep.summary));
        }
        row.appendChild(body);

        makeFocusable(row, "ep-row-" + ep.number, "row-ep-" + idx, function () {
          var startT = isSavedEp && hist.timestamp < (hist.duration - 20) ? hist.timestamp : 0;
          startEpisodePlayback(anime, ep.number, startT, state.audioMode);
        });
        epListEl.appendChild(row);
      })(chunkSlice[e], e);
    }

    page.appendChild(epListEl);
  }

  function renderPlayerScreen() {
    var screen = createEl("div", "ma-player-screen");

    var video = document.createElement("video");
    video.id = "ma-video-el";
    video.className = "ma-video";
    video.setAttribute("playsinline", "true");
    video.setAttribute("autoplay", "true");
    screen.appendChild(video);

    /* High-contrast TV WebVTT Subtitle Overlay */
    var subOverlay = createEl("div", "ma-sub-overlay raised");
    subOverlay.id = "ma-sub-overlay";
    var subBox = createEl("div", "ma-sub-box");
    subBox.id = "ma-sub-box";
    subBox.style.display = "none";
    subOverlay.appendChild(subBox);
    screen.appendChild(subOverlay);

    /* Buffering Spinner Overlay */
    var bufOverlay = createEl("div", "ma-buffer-overlay");
    bufOverlay.id = "ma-buffer-overlay";
    bufOverlay.appendChild(createEl("div", "ma-spinner"));
    var bufLabel = createEl("div", "", "Loading HLS stream via on-TV proxy...");
    bufLabel.style.cssText = "margin-top: 20px; font-size: 24px; font-weight: 700; color: #ffffff;";
    bufOverlay.appendChild(bufLabel);
    screen.appendChild(bufOverlay);

    /* Top Bar */
    var topBar = createEl("div", "ma-player-top");
    topBar.id = "ma-player-top";
    var pTitle = createEl("div", "", state.player.animeTitle + " — EP " + state.player.episodeNumber + ": " + state.player.episodeTitle);
    pTitle.id = "ma-player-title";
    pTitle.style.cssText = "font-size: 32px; font-weight: 800; color: #ffffff;";
    topBar.appendChild(pTitle);

    var hint = createEl("div", "", "◀ ▶ Seek 10s  ·  OK Play/Pause  ·  BACK Return");
    hint.style.cssText = "font-size: 20px; font-weight: 600; color: #9ca3af;";
    topBar.appendChild(hint);
    screen.appendChild(topBar);

    /* Bottom HUD & Controls */
    var hud = createEl("div", "ma-player-hud");
    hud.id = "ma-player-hud";

    var seekBar = createEl("div", "ma-seek-bar");
    var seekFill = createEl("div", "ma-seek-fill");
    seekFill.id = "ma-seek-fill";
    seekFill.style.width = "0%";
    var seekKnob = createEl("div", "ma-seek-knob");
    seekKnob.id = "ma-seek-knob";
    seekKnob.style.left = "0%";
    seekBar.appendChild(seekFill);
    seekBar.appendChild(seekKnob);
    makeFocusable(seekBar, "btn-player-seek", "row-player-seek", function () {
      togglePlayerPlayPause();
    });
    hud.appendChild(seekBar);

    var controls = createEl("div", "ma-player-controls");

    var ppBtn = createEl("div", "ma-btn primary", "❚❚ Pause");
    ppBtn.id = "btn-player-playpause";
    makeFocusable(ppBtn, "btn-player-playpause", "row-player-btns", function () {
      togglePlayerPlayPause();
    });
    controls.appendChild(ppBtn);

    var rwBtn = createEl("div", "ma-btn", "⏪ -10s");
    makeFocusable(rwBtn, "btn-player-rw", "row-player-btns", function () {
      seekPlayerBy(-10);
    });
    controls.appendChild(rwBtn);

    var ffBtn = createEl("div", "ma-btn", "+10s ⏩");
    makeFocusable(ffBtn, "btn-player-ff", "row-player-btns", function () {
      seekPlayerBy(10);
    });
    controls.appendChild(ffBtn);

    /* On-Screen "Next Episode" Button */
    var nextBtn = createEl("div", "ma-btn accent", "⏭ Next Episode");
    nextBtn.id = "btn-player-next";
    makeFocusable(nextBtn, "btn-player-next", "row-player-btns", function () {
      playAdjacentEpisode(1);
    });
    controls.appendChild(nextBtn);

    if (hasPrevEpisode()) {
      var prevBtn = createEl("div", "ma-btn", "⏮ Prev");
      makeFocusable(prevBtn, "btn-player-prev", "row-player-btns", function () {
        playAdjacentEpisode(-1);
      });
      controls.appendChild(prevBtn);
    }

    var audioBtn = createEl("div", "ma-btn", "Audio: " + (state.player.activeAudio === "dub" ? "DUB (EN)" : "SUB (JP)"));
    audioBtn.id = "btn-player-audio";
    makeFocusable(audioBtn, "btn-player-audio", "row-player-btns", function () {
      togglePlayerAudioMode();
    });
    controls.appendChild(audioBtn);

    var subBtn = createEl("div", "ma-btn", "Subs: Loading...");
    subBtn.id = "btn-player-subs";
    makeFocusable(subBtn, "btn-player-subs", "row-player-btns", function () {
      cyclePlayerSubtitles();
    });
    controls.appendChild(subBtn);

    var exitBtn = createEl("div", "ma-btn", "✕ Close");
    makeFocusable(exitBtn, "btn-player-close", "row-player-btns", function () {
      exitPlayerToDetails();
    });
    controls.appendChild(exitBtn);

    var timeLabel = createEl("div", "ma-player-time", "00:00 / 00:00");
    timeLabel.id = "ma-player-time";
    controls.appendChild(timeLabel);

    hud.appendChild(controls);
    screen.appendChild(hud);
    mainViewEl.appendChild(screen);
  }

  function exitPlayerToDetails() {
    persistWatchProgress();
    var animeId = state.player.animeId;
    cleanupPlayer();
    if (state.currentAnime && String(state.currentAnime.id) === String(animeId)) {
      state.view = "details";
      render("btn-details-play");
    } else if (animeId) {
      openAnimeDetails(animeId, {
        id: animeId,
        title: state.player.animeTitle,
        poster: state.player.poster
      });
    } else {
      state.view = "home";
      render();
    }
  }

  /* ==========================================================================
   * 10. GLOBAL KEYBOARD / REMOTE D-PAD HANDLER
   * ========================================================================== */
  function handleKeyDown(e) {
    var code = e.keyCode;

    /* On-Screen TV Keyboard Modal Key Handling */
    if (state.keyboardOpen) {
      if (code === 10009 || code === 27 || code === 65385) { /* Return/Back closes keyboard */
        e.preventDefault();
        closeSearchKeyboard("nav-search-input");
        return;
      }
      if (code === 8) { /* Backspace deletes last char */
        e.preventDefault();
        if (state.searchDraft && state.searchDraft.length > 0) {
          state.searchDraft = state.searchDraft.slice(0, -1);
          updateKeyboardDraftDom();
        }
        return;
      }
      if (code === 37) { e.preventDefault(); moveFocus("left"); return; }
      if (code === 39) { e.preventDefault(); moveFocus("right"); return; }
      if (code === 38) { e.preventDefault(); moveFocus("up"); return; }
      if (code === 40) { e.preventDefault(); moveFocus("down"); return; }
      if (code === 13) {
        e.preventDefault();
        if (currentFocusedEl && currentFocusedEl.__onSelect) {
          currentFocusedEl.__onSelect();
        }
        return;
      }
      /* Support physical keyboard letters/digits if connected */
      if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 32) {
        e.preventDefault();
        var ch = String.fromCharCode(code).toLowerCase();
        state.searchDraft = (state.searchDraft || "") + ch;
        updateKeyboardDraftDom();
        return;
      }
      return;
    }

    /* Player View Key Handling */
    if (state.view === "player") {
      showPlayerControlsTemporarily();
      var seekFocused = currentFocusedEl && currentFocusedEl.getAttribute("data-focus-id") === "btn-player-seek";

      if (code === 10009 || code === 27 || code === 8 || code === 413) { /* Return/Back or Stop */
        e.preventDefault();
        exitPlayerToDetails();
        return;
      }
      if (code === 10252 || code === 32) { /* MediaPlayPause / Space */
        e.preventDefault();
        togglePlayerPlayPause();
        return;
      }
      if (code === 415) { /* MediaPlay */
        e.preventDefault();
        if (state.player.videoEl && state.player.videoEl.paused) togglePlayerPlayPause();
        return;
      }
      if (code === 19) { /* MediaPause */
        e.preventDefault();
        if (state.player.videoEl && !state.player.videoEl.paused) togglePlayerPlayPause();
        return;
      }
      if (code === 412) { /* MediaRewind */
        e.preventDefault();
        seekPlayerBy(-15);
        return;
      }
      if (code === 417) { /* MediaFastForward */
        e.preventDefault();
        seekPlayerBy(15);
        return;
      }
      if (code === 10233) { /* MediaTrackNext */
        e.preventDefault();
        playAdjacentEpisode(1);
        return;
      }
      if (code === 10232) { /* MediaTrackPrevious */
        e.preventDefault();
        playAdjacentEpisode(-1);
        return;
      }
      if (code === 37) { /* Left */
        e.preventDefault();
        if (seekFocused) seekPlayerBy(-10);
        else moveFocus("left");
        return;
      }
      if (code === 39) { /* Right */
        e.preventDefault();
        if (seekFocused) seekPlayerBy(10);
        else moveFocus("right");
        return;
      }
      if (code === 38) { /* Up */
        e.preventDefault();
        moveFocus("up");
        return;
      }
      if (code === 40) { /* Down */
        e.preventDefault();
        moveFocus("down");
        return;
      }
      if (code === 13) { /* Enter */
        e.preventDefault();
        if (currentFocusedEl && currentFocusedEl.__onSelect) {
          currentFocusedEl.__onSelect();
        } else {
          togglePlayerPlayPause();
        }
        return;
      }
      return;
    }

    /* Home & Details View Key Handling */
    if (code === 37) { /* ArrowLeft */
      e.preventDefault();
      moveFocus("left");
    } else if (code === 39) { /* ArrowRight */
      e.preventDefault();
      moveFocus("right");
    } else if (code === 38) { /* ArrowUp */
      e.preventDefault();
      moveFocus("up");
    } else if (code === 40) { /* ArrowDown */
      e.preventDefault();
      moveFocus("down");
    } else if (code === 13) { /* Enter / OK */
      e.preventDefault();
      if (currentFocusedEl && currentFocusedEl.__onSelect) {
        currentFocusedEl.__onSelect();
      }
    } else if (code === 10009 || code === 27 || code === 8) { /* Return / Back */
      e.preventDefault();
      if (state.view === "details") {
        state.view = "home";
        render();
      } else if (state.searchResults !== null) {
        state.searchQuery = "";
        state.searchResults = null;
        render();
      } else {
        try {
          if (window.tizen && window.tizen.application) {
            window.tizen.application.getCurrentApplication().exit();
          } else if (window.history && window.history.length > 1) {
            window.history.back();
          }
        } catch (err) {}
      }
    }
  }

  /* ==========================================================================
   * 11. BOOTSTRAP
   * ========================================================================== */
  function startApp() {
    initDom();
    window.addEventListener("keydown", handleKeyDown, true);
    render();
    nudgeTizenBrewToStartService();
    connectWebSocket();
    fetchHomeData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp, false);
  } else {
    startApp();
  }
})();
