/*
 * My Anime TizenBrew - On-TV Background Node.js Service (ES5 / Node.js v4.4.3 compatible)
 * Runs inside TizenBrew's internal Node.js service on the Samsung Tizen 3.0 TV (127.0.0.1:8092).
 * - Connects to anizone.to & *.vid-cdn.xyz (GlobalSign Root CA - trusted by Tizen 3.0 / 2017)
 * - Exposes WebSocket bridge (ws://127.0.0.1:8092) + HTTP RPC fallback (http://127.0.0.1:8092/rpc)
 * - Runs local HTTP HLS/Segment/Key/Image proxy (http://127.0.0.1:8092/proxy)
 * - Runs local Subtitle proxy with automatic SRT/ASS -> WebVTT (.vtt) conversion (http://127.0.0.1:8092/sub)
 * - Persists watch history to local history.json on the TV (/home/owner/share/history.json)
 */
(function () {
  "use strict";

  /* ES5 Polyfills for Node.js v4.4.3 */
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

  if (typeof global !== "undefined" && global.__MY_ANIME_SERVICE_SERVER__) {
    try {
      global.__MY_ANIME_SERVICE_SERVER__.close();
    } catch (e) {}
  }

  var http = require("http");
  var https = require("https");
  var urlModule = require("url");
  var fs = require("fs");
  var path = require("path");
  var crypto = require("crypto");
  var zlib = require("zlib");

  var PORT = 8092;
  var HOST = "127.0.0.1";
  var SOURCE_ORIGIN = "https://anizone.to";
  var SOURCE_REFERER = "https://anizone.to/";
  var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  /* Buffer helpers for Node.js v4.4.3 and modern Node.js */
  function allocBuf(size) {
    if (Buffer.alloc) return Buffer.alloc(size);
    var b = new Buffer(size);
    b.fill(0);
    return b;
  }

  function fromBuf(data, enc) {
    if (Buffer.from) return Buffer.from(data, enc);
    return new Buffer(data, enc);
  }

  /* Determine writable history.json path on Tizen TV or PC */
  function getHistoryFilePath() {
    try {
      if (fs.existsSync("/home/owner/share")) {
        return "/home/owner/share/history.json";
      }
    } catch (e) {}
    var baseDir = ".";
    try {
      if (typeof process !== "undefined" && typeof process.cwd === "function") {
        baseDir = process.cwd();
      }
    } catch (e2) {}
    return path.join(baseDir, "history.json");
  }

  var HISTORY_FILE = getHistoryFilePath();

  function loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        var raw = fs.readFileSync(HISTORY_FILE, "utf8");
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          return parsed;
        }
        if (Array.isArray(parsed)) {
          return { items: parsed };
        }
      }
    } catch (e) {}
    return { items: [] };
  }

  function saveHistoryData(historyObj) {
    try {
      var data = {
        items: Array.isArray(historyObj.items) ? historyObj.items.slice(0, 100) : []
      };
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
      return data;
    } catch (e) {
      return historyObj;
    }
  }

  function upsertHistoryItem(entry) {
    if (!entry || !entry.animeId) return loadHistory();
    var store = loadHistory();
    var list = store.items || [];
    var now = Date.now();
    var existing = null;
    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].animeId) === String(entry.animeId)) {
        existing = list[i];
      } else {
        filtered.push(list[i]);
      }
    }
    var merged = {
      animeId: String(entry.animeId),
      title: entry.title || (existing && existing.title) || "Unknown Anime",
      poster: entry.poster || (existing && existing.poster) || "",
      episodeNumber: Number(entry.episodeNumber || (existing && existing.episodeNumber) || 1),
      episodeSlug: String(entry.episodeSlug || entry.episodeNumber || (existing && existing.episodeSlug) || "1"),
      episodeTitle: entry.episodeTitle || (existing && existing.episodeTitle) || "",
      timestamp: typeof entry.timestamp === "number" && !isNaN(entry.timestamp) ? Math.floor(entry.timestamp) : ((existing && existing.timestamp) || 0),
      duration: typeof entry.duration === "number" && !isNaN(entry.duration) && entry.duration > 0 ? Math.floor(entry.duration) : ((existing && existing.duration) || 0),
      audioMode: entry.audioMode || (existing && existing.audioMode) || "sub",
      totalEpisodes: Number(entry.totalEpisodes || (existing && existing.totalEpisodes) || 0),
      updatedAt: now
    };
    filtered.unshift(merged);
    return saveHistoryData({ items: filtered });
  }

  function removeHistoryItem(animeId) {
    var store = loadHistory();
    var list = store.items || [];
    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].animeId) !== String(animeId)) {
        filtered.push(list[i]);
      }
    }
    return saveHistoryData({ items: filtered });
  }

  /* Small in-memory LRU cache to keep TV RAM footprint tiny */
  var memCache = {};
  var memCacheKeys = [];
  var MAX_CACHE_ITEMS = 25;
  var CACHE_TTL_MS = 4 * 60 * 1000;

  function cacheGet(key) {
    var item = memCache[key];
    if (!item) return null;
    if (Date.now() - item.at > CACHE_TTL_MS) {
      delete memCache[key];
      return null;
    }
    return item.val;
  }

  function cacheSet(key, val) {
    if (!memCache[key]) {
      memCacheKeys.push(key);
      while (memCacheKeys.length > MAX_CACHE_ITEMS) {
        var oldK = memCacheKeys.shift();
        delete memCache[oldK];
      }
    }
    memCache[key] = { at: Date.now(), val: val };
  }

  /* Outbound HTTP/HTTPS helper with redirect + gzip/deflate support */
  function fetchRemoteBuffer(targetUrl, extraHeaders, redirectsLeft, callback) {
    if (typeof redirectsLeft === "function") {
      callback = redirectsLeft;
      redirectsLeft = 5;
    }
    if (redirectsLeft <= 0) {
      return callback(new Error("Too many redirects"));
    }

    var parsed;
    try {
      parsed = urlModule.parse(targetUrl);
    } catch (e) {
      return callback(e);
    }
    if (!parsed || !parsed.hostname) {
      return callback(new Error("Invalid URL: " + targetUrl));
    }

    var isHttps = parsed.protocol === "https:";
    var transport = isHttps ? https : http;
    var headers = {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate",
      "Referer": SOURCE_REFERER,
      "Origin": SOURCE_ORIGIN
    };
    if (extraHeaders) {
      var hKeys = Object.keys(extraHeaders);
      for (var i = 0; i < hKeys.length; i++) {
        headers[hKeys[i]] = extraHeaders[hKeys[i]];
      }
    }

    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80),
      path: parsed.path || "/",
      method: "GET",
      headers: headers,
      servername: parsed.hostname,
      rejectUnauthorized: false
    };

    var done = false;
    function finish(err, resData) {
      if (done) return;
      done = true;
      callback(err, resData);
    }

    var req = transport.request(reqOpts, function (res) {
      var status = res.statusCode || 0;
      if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && res.headers && res.headers.location) {
        res.resume();
        var nextUrl = urlModule.resolve(targetUrl, res.headers.location);
        return fetchRemoteBuffer(nextUrl, extraHeaders, redirectsLeft - 1, finish);
      }

      var stream = res;
      var enc = (res.headers && res.headers["content-encoding"]) ? String(res.headers["content-encoding"]).toLowerCase() : "";
      if (enc.indexOf("gzip") !== -1) {
        stream = res.pipe(zlib.createGunzip());
      } else if (enc.indexOf("deflate") !== -1) {
        stream = res.pipe(zlib.createInflate());
      }

      var chunks = [];
      stream.on("data", function (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : fromBuf(chunk));
      });
      stream.on("end", function () {
        var fullBuf = Buffer.concat(chunks);
        finish(null, {
          status: status,
          headers: res.headers || {},
          buffer: fullBuf,
          finalUrl: targetUrl
        });
      });
      stream.on("error", function (err) {
        finish(err);
      });
    });

    req.setTimeout(15000, function () {
      try { req.abort(); } catch (e) {}
      finish(new Error("Request timed out: " + targetUrl));
    });
    req.on("error", function (err) {
      finish(err);
    });
    req.end();
  }

  function fetchRemoteText(targetUrl, extraHeaders, callback) {
    fetchRemoteBuffer(targetUrl, extraHeaders, 5, function (err, res) {
      if (err) return callback(err);
      if (res.status < 200 || res.status >= 400) {
        return callback(new Error("HTTP " + res.status + " for " + targetUrl));
      }
      callback(null, res.buffer.toString("utf8"), res);
    });
  }

  /* HTML / JSON Parsing Helpers for AniZone */
  function decodeHtmlEntities(str) {
    if (!str) return "";
    return String(str)
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/`/g, "'");
  }

  function stripHtmlTags(str) {
    if (!str) return "";
    return decodeHtmlEntities(String(str).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }

  function extractJsonParseBlocks(html) {
    var re = /JSON\.parse\('((?:\\.|[^'\\])*)'\)/g;
    var out = [];
    var m;
    while ((m = re.exec(html)) !== null) {
      try {
        var raw = m[1];
        var unescaped = JSON.parse('"' + raw.replace(/"/g, '\\"') + '"');
        var parsed = JSON.parse(unescaped);
        out.push(parsed);
      } catch (e) {}
    }
    return out;
  }

  function pickTitle(titleList, mainTitle) {
    if (titleList && typeof titleList === "object" && !Array.isArray(titleList)) {
      if (titleList["1"]) return decodeHtmlEntities(titleList["1"]);
      if (titleList["4"]) return decodeHtmlEntities(titleList["4"]);
      if (titleList["5"]) return decodeHtmlEntities(titleList["5"]);
      var vals = Object.values(titleList);
      if (vals.length > 0 && vals[0]) return decodeHtmlEntities(vals[0]);
    }
    if (mainTitle) return decodeHtmlEntities(mainTitle);
    return "Untitled";
  }

  function normalizeAnimeCard(item) {
    if (!item || !item.slug) return null;
    var title = pickTitle(item.title_list, item.main_title);
    var altTitle = (item.main_title && decodeHtmlEntities(item.main_title) !== title)
      ? decodeHtmlEntities(item.main_title)
      : ((item.title_list && item.title_list["5"]) ? decodeHtmlEntities(item.title_list["5"]) : "");
    var genres = [];
    if (Array.isArray(item.tags)) {
      for (var i = 0; i < item.tags.length; i++) {
        if (item.tags[i] && item.tags[i].name) genres.push(item.tags[i].name);
      }
    }
    return {
      id: String(item.slug),
      title: title,
      altTitle: altTitle,
      poster: item.cover || "",
      type: item.type || "TV Series",
      isOngoing: !!item.is_ongoing,
      status: item.is_ongoing ? "Ongoing" : "Completed",
      year: item.start_year || "",
      episodeCount: Number(item.episode_count || 0),
      genres: genres
    };
  }

  /* 1. getHome: Featured/Popular anime + Recent episodes + Watch History */
  function handleGetHome(payload, callback) {
    var cached = cacheGet("home");
    if (cached) {
      return callback(null, {
        featured: cached.featured,
        recentEpisodes: cached.recentEpisodes,
        genres: cached.genres,
        history: loadHistory().items
      });
    }

    fetchRemoteText(SOURCE_ORIGIN + "/", null, function (err, html) {
      if (err) return callback(err);
      var blocks = extractJsonParseBlocks(html);
      var recentRaw = Array.isArray(blocks[0]) ? blocks[0] : [];
      var genresRaw = Array.isArray(blocks[1]) ? blocks[1] : [];
      var featuredRaw = Array.isArray(blocks[2]) ? blocks[2] : [];

      var recentEpisodes = [];
      for (var i = 0; i < recentRaw.length; i++) {
        var r = recentRaw[i];
        if (!r || !r.anime || !r.anime.slug) continue;
        var aTitle = pickTitle(r.anime.title_list, r.anime.main_title);
        var eTitle = pickTitle(r.title_list, "");
        recentEpisodes.push({
          animeId: String(r.anime.slug),
          title: aTitle,
          episodeNumber: Number(r.slug) || 1,
          episodeSlug: String(r.slug || "1"),
          episodeTitle: eTitle !== "Untitled" ? eTitle : ("Episode " + (r.slug || 1)),
          snapshot: r.snapshot || "",
          poster: r.snapshot || "",
          duration: r.duration || "",
          airDate: r.air_date || "",
          airDiff: r.air_diff || ""
        });
      }

      var featured = [];
      for (var j = 0; j < featuredRaw.length; j++) {
        var card = normalizeAnimeCard(featuredRaw[j]);
        if (card) featured.push(card);
      }

      var genres = [];
      for (var k = 0; k < genresRaw.length; k++) {
        var g = genresRaw[k];
        if (g && g.slug && g.name) {
          genres.push({
            id: String(g.slug),
            name: String(g.name),
            count: Number(g.anime_count || 0)
          });
        }
      }

      var homeData = {
        featured: featured,
        recentEpisodes: recentEpisodes,
        genres: genres
      };
      cacheSet("home", homeData);

      callback(null, {
        featured: featured,
        recentEpisodes: recentEpisodes,
        genres: genres,
        history: loadHistory().items
      });
    });
  }

  /* 2. search: Search anime by query or browse catalog */
  function handleSearch(payload, callback) {
    var query = (payload && payload.query) ? String(payload.query).trim() : "";
    var cacheKey = "search:" + query.toLowerCase();
    var cached = cacheGet(cacheKey);
    if (cached) return callback(null, cached);

    var targetUrl = query
      ? (SOURCE_ORIGIN + "/anime?search=" + encodeURIComponent(query))
      : (SOURCE_ORIGIN + "/anime?sort=release-desc");

    fetchRemoteText(targetUrl, null, function (err, html) {
      if (err) return callback(err);
      var blocks = extractJsonParseBlocks(html);
      var itemsRaw = [];
      for (var i = 0; i < blocks.length; i++) {
        if (Array.isArray(blocks[i])) {
          itemsRaw = blocks[i];
          break;
        }
      }

      var results = [];
      for (var j = 0; j < itemsRaw.length; j++) {
        var card = normalizeAnimeCard(itemsRaw[j]);
        if (card) results.push(card);
      }

      var resData = {
        query: query,
        results: results
      };
      cacheSet(cacheKey, resData);
      callback(null, resData);
    });
  }

  /* 3. getDetails: Fetch anime details & full episode list */
  function handleGetDetails(payload, callback) {
    var animeId = (payload && payload.animeId) ? String(payload.animeId).trim() : "";
    if (!animeId) return callback(new Error("Missing animeId"));

    var cacheKey = "details:" + animeId;
    var cached = cacheGet(cacheKey);
    if (cached) {
      var hist = loadHistory().items;
      var savedEntry = null;
      for (var h = 0; h < hist.length; h++) {
        if (String(hist[h].animeId) === animeId) {
          savedEntry = hist[h];
          break;
        }
      }
      return callback(null, {
        anime: cached,
        historyEntry: savedEntry
      });
    }

    var targetUrl = SOURCE_ORIGIN + "/anime/" + encodeURIComponent(animeId);
    fetchRemoteText(targetUrl, null, function (err, html) {
      if (err) return callback(err);

      var blocks = extractJsonParseBlocks(html);
      var titleMap = (blocks[0] && typeof blocks[0] === "object" && !Array.isArray(blocks[0])) ? blocks[0] : {};
      var epsRaw = Array.isArray(blocks[1]) ? blocks[1] : (Array.isArray(blocks[0]) ? blocks[0] : []);

      var fallbackTitleMatch = html.match(/getTitle\(this\.anmTitles,\s*'([^']+)'\)/);
      var fallbackTitle = fallbackTitleMatch ? fallbackTitleMatch[1] : animeId;
      var title = pickTitle(titleMap, fallbackTitle);
      var altTitle = (titleMap && titleMap["5"] && decodeHtmlEntities(titleMap["5"]) !== title)
        ? decodeHtmlEntities(titleMap["5"])
        : fallbackTitle;

      var imgs = html.match(/https:\/\/anizone\.to\/images\/anime\/[^\s"'\\]+/g) || [];
      var uniqueImgs = [];
      for (var i = 0; i < imgs.length; i++) {
        if (!uniqueImgs.includes(imgs[i])) uniqueImgs.push(imgs[i]);
      }
      var banner = uniqueImgs[0] || "";
      var poster = uniqueImgs[1] || uniqueImgs[0] || "";

      var synMatch = html.match(/<h3[^>]*>\s*Synopsis\s*<\/h3>\s*<div[^>]*>([\s\S]*?)<\/div>/i);
      var synopsis = synMatch ? stripHtmlTags(synMatch[1]) : "";

      var epCountMatch = html.match(/<span[^>]*>\s*(\d+)\s+Episodes?\s*<\/span>/i);
      var totalEpisodes = epCountMatch ? Number(epCountMatch[1]) : epsRaw.length;

      var yearMatch = html.match(/<span[^>]*>\s*((?:19|20)\d{2})\s*<\/span>/i);
      var year = yearMatch ? yearMatch[1] : "";

      var statusMatch = html.match(/<span[^>]*>\s*(Ongoing|Completed|Upcoming)\s*<\/span>/i);
      var status = statusMatch ? statusMatch[1] : "";

      var typeMatch = html.match(/<span[^>]*>\s*(TV Series|Movie|OVA|Web|TV Special|Music Video|Other)\s*<\/span>/i);
      var type = typeMatch ? typeMatch[1] : "TV Series";

      var genreRe = /wire:key="t-[^"]+"[^>]+title="([^"]+)"/g;
      var genres = [];
      var gm;
      while ((gm = genreRe.exec(html)) !== null) {
        var gName = decodeHtmlEntities(gm[1]);
        if (!genres.includes(gName)) genres.push(gName);
      }

      var episodes = [];
      var seenNumbers = {};
      for (var e = 0; e < epsRaw.length; e++) {
        var ep = epsRaw[e];
        if (!ep) continue;
        var num = Number(ep.slug) || (e + 1);
        seenNumbers[num] = true;
        var epTitle = pickTitle(ep.title_list, "");
        episodes.push({
          number: num,
          slug: String(ep.slug || num),
          title: epTitle !== "Untitled" ? epTitle : ("Episode " + num),
          summary: ep.summary ? decodeHtmlEntities(ep.summary) : "",
          duration: ep.duration || "",
          airDate: ep.air_date || "",
          snapshot: ep.snapshot || poster
        });
      }

      if (totalEpisodes > episodes.length) {
        for (var n = 1; n <= totalEpisodes; n++) {
          if (!seenNumbers[n]) {
            episodes.push({
              number: n,
              slug: String(n),
              title: "Episode " + n,
              summary: "",
              duration: "",
              airDate: "",
              snapshot: poster
            });
          }
        }
      }

      episodes.sort(function (a, b) {
        return a.number - b.number;
      });

      var animeObj = {
        id: animeId,
        title: title,
        altTitle: altTitle !== title ? altTitle : "",
        poster: poster,
        banner: banner,
        synopsis: synopsis,
        type: type,
        status: status,
        year: year,
        totalEpisodes: episodes.length,
        genres: genres,
        episodes: episodes,
        supportsSubDub: true
      };

      cacheSet(cacheKey, animeObj);

      var histList = loadHistory().items;
      var saved = null;
      for (var k = 0; k < histList.length; k++) {
        if (String(histList[k].animeId) === animeId) {
          saved = histList[k];
          break;
        }
      }

      callback(null, {
        anime: animeObj,
        historyEntry: saved
      });
    });
  }

  /* Parse #EXT-X-MEDIA:TYPE=AUDIO lines from master.m3u8 */
  function parseM3u8AudioTracks(m3u8Text) {
    var lines = String(m3u8Text || "").split(/\r?\n/);
    var tracks = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXT-X-MEDIA:") === 0 && line.indexOf("TYPE=AUDIO") !== -1) {
        var langMatch = line.match(/LANGUAGE="([^"]+)"/i);
        var nameMatch = line.match(/NAME="([^"]+)"/i);
        var uriMatch = line.match(/URI="([^"]+)"/i);
        var lang = langMatch ? langMatch[1].toLowerCase() : "";
        var name = nameMatch ? nameMatch[1] : lang;
        var isDub = (lang.indexOf("en") === 0 || /english|dub/i.test(name));
        var isSub = (lang.indexOf("ja") === 0 || lang.indexOf("jp") === 0 || /japanese|sub/i.test(name));
        tracks.push({
          lang: lang || (isDub ? "en" : "ja"),
          name: name || (isDub ? "English" : "Japanese"),
          mode: isDub ? "dub" : (isSub ? "sub" : "sub"),
          uri: uriMatch ? uriMatch[1] : ""
        });
      }
    }
    return tracks;
  }

  /* 4. getStream: Extract clean .m3u8 HLS stream + .vtt subtitles for an episode */
  function handleGetStream(payload, callback) {
    var animeId = (payload && payload.animeId) ? String(payload.animeId).trim() : "";
    var episodeNumber = (payload && (payload.episodeNumber || payload.episodeSlug)) ? String(payload.episodeSlug || payload.episodeNumber).trim() : "1";
    var requestedAudio = (payload && payload.audioMode === "dub") ? "dub" : "sub";

    if (!animeId) return callback(new Error("Missing animeId"));

    var epPageUrl = SOURCE_ORIGIN + "/anime/" + encodeURIComponent(animeId) + "/" + encodeURIComponent(episodeNumber);
    fetchRemoteText(epPageUrl, null, function (err, html) {
      if (err) return callback(err);

      var playerMatch = html.match(/vidstackPlayer\(JSON\.parse\('((?:\\.|[^'\\])*)'\)\)/);
      if (!playerMatch) {
        return callback(new Error("Could not find video stream on episode page"));
      }

      var playerData;
      try {
        var unescaped = JSON.parse('"' + playerMatch[1].replace(/"/g, '\\"') + '"');
        playerData = JSON.parse(unescaped);
      } catch (e) {
        return callback(new Error("Failed to parse player configuration: " + e.message));
      }

      if (!playerData || !playerData.src) {
        return callback(new Error("Episode stream URL is empty"));
      }

      var rawM3u8Url = playerData.src;

      /* Extract current episode title if present */
      var blocks = extractJsonParseBlocks(html);
      var epTitle = "Episode " + episodeNumber;
      if (blocks.length >= 2 && typeof blocks[1] === "object" && !Array.isArray(blocks[1])) {
        var picked = pickTitle(blocks[1], "");
        if (picked && picked !== "Untitled") epTitle = picked;
      }

      /* Inspect master.m3u8 to detect available Sub/Dub audio tracks */
      fetchRemoteText(rawM3u8Url, { "Referer": SOURCE_REFERER, "Origin": SOURCE_ORIGIN }, function (mErr, m3u8Text) {
        var audioTracks = (!mErr && m3u8Text) ? parseM3u8AudioTracks(m3u8Text) : [];
        var hasSub = true;
        var hasDub = false;
        for (var i = 0; i < audioTracks.length; i++) {
          if (audioTracks[i].mode === "dub") hasDub = true;
          if (audioTracks[i].mode === "sub") hasSub = true;
        }
        if (audioTracks.length === 0) {
          audioTracks.push({ lang: "ja", name: "Japanese (Original)", mode: "sub" });
        }

        var activeAudio = (requestedAudio === "dub" && hasDub) ? "dub" : "sub";
        var proxiedStreamUrl = "http://" + HOST + ":" + PORT + "/proxy?url=" + encodeURIComponent(rawM3u8Url) + "&audio=" + encodeURIComponent(activeAudio);

        var rawSubs = Array.isArray(playerData.subtitles) ? playerData.subtitles : [];
        var subtitles = [];
        for (var s = 0; s < rawSubs.length; s++) {
          var sub = rawSubs[s];
          if (!sub || !sub.file) continue;
          subtitles.push({
            label: sub.title || ("Subtitle " + (s + 1)),
            lang: sub.language || "en",
            default: !!sub.default,
            url: "http://" + HOST + ":" + PORT + "/sub?url=" + encodeURIComponent(sub.file)
          });
        }

        callback(null, {
          animeId: animeId,
          episodeNumber: Number(episodeNumber) || 1,
          episodeSlug: episodeNumber,
          episodeTitle: epTitle,
          streamUrl: proxiedStreamUrl,
          rawStreamUrl: rawM3u8Url,
          subtitles: subtitles,
          audioTracks: audioTracks,
          hasSub: hasSub,
          hasDub: hasDub,
          activeAudio: activeAudio,
          snapshot: playerData.snapshot || ""
        });
      });
    });
  }

  /* Rewrite .m3u8 playlist so all sub-playlists, keys, and .ts segments route through http://127.0.0.1:8092/proxy */
  function rewriteM3u8Playlist(m3u8Text, baseUrl, audioMode) {
    var lines = String(m3u8Text || "").split(/\r?\n/);
    var hasDubTrack = false;
    var hasSubTrack = false;

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (l.indexOf("#EXT-X-MEDIA:") === 0 && l.indexOf("TYPE=AUDIO") !== -1) {
        if (/LANGUAGE="en"|NAME="English"/i.test(l)) hasDubTrack = true;
        if (/LANGUAGE="ja"|LANGUAGE="jpn"|NAME="Japanese"/i.test(l)) hasSubTrack = true;
      }
    }

    var wantDub = (audioMode === "dub" && hasDubTrack);
    var wantSub = (!wantDub && hasSubTrack);
    var out = [];

    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      var trimmed = line.trim();
      if (!trimmed) {
        out.push(line);
        continue;
      }

      /* Handle #EXT-X-MEDIA:TYPE=AUDIO selection for reliable Sub/Dub switching on Tizen 3.0 */
      if (trimmed.indexOf("#EXT-X-MEDIA:") === 0 && trimmed.indexOf("TYPE=AUDIO") !== -1 && (wantDub || wantSub)) {
        var isEn = /LANGUAGE="en"|NAME="English"/i.test(trimmed);
        var isJa = /LANGUAGE="ja"|LANGUAGE="jpn"|NAME="Japanese"/i.test(trimmed);
        if (wantDub && !isEn && isJa) {
          continue;
        }
        if (wantSub && !isJa && isEn) {
          continue;
        }
        trimmed = trimmed
          .replace(/DEFAULT=(YES|NO)/i, "DEFAULT=YES")
          .replace(/AUTOSELECT=(YES|NO)/i, "AUTOSELECT=YES");
        if (trimmed.indexOf("DEFAULT=") === -1) {
          trimmed += ",DEFAULT=YES,AUTOSELECT=YES";
        }
      }

      if (trimmed.charAt(0) === "#") {
        /* Rewrite any URI="..." inside tags like #EXT-X-MEDIA, #EXT-X-KEY, #EXT-X-MAP */
        var rewrittenTag = trimmed.replace(/URI="([^"]+)"/g, function (full, relUri) {
          var absUri = urlModule.resolve(baseUrl, relUri);
          var proxied = "http://" + HOST + ":" + PORT + "/proxy?url=" + encodeURIComponent(absUri);
          return 'URI="' + proxied + '"';
        });
        out.push(rewrittenTag);
      } else {
        /* Non-comment line is a segment (.ts) or variant playlist (.m3u8) URI */
        var absLineUrl = urlModule.resolve(baseUrl, trimmed);
        var proxiedLine = "http://" + HOST + ":" + PORT + "/proxy?url=" + encodeURIComponent(absLineUrl);
        out.push(proxiedLine);
      }
    }

    return out.join("\n");
  }

  /* Convert SRT or ASS subtitle text to standard WebVTT (.vtt) for Tizen <track> */
  function convertToWebVtt(rawText) {
    if (!rawText) return "WEBVTT\n\n";
    var text = String(rawText).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (text.indexOf("WEBVTT") === 0) {
      return text + "\n";
    }

    /* Check if ASS/SSA format */
    if (text.indexOf("[Script Info]") !== -1 || text.indexOf("\nDialogue:") !== -1) {
      var assLines = text.split("\n");
      var vttOut = ["WEBVTT", ""];
      var cueIdx = 1;
      for (var i = 0; i < assLines.length; i++) {
        var line = assLines[i];
        if (line.indexOf("Dialogue:") === 0) {
          var parts = line.substring(9).split(",");
          if (parts.length >= 10) {
            var start = formatAssTime(parts[1].trim());
            var end = formatAssTime(parts[2].trim());
            var diagText = parts.slice(9).join(",")
              .replace(/\{[^}]*\}/g, "")
              .replace(/\\N/g, "\n")
              .replace(/\\n/g, "\n")
              .replace(/\\h/g, " ")
              .trim();
            if (start && end && diagText) {
              vttOut.push(String(cueIdx++));
              vttOut.push(start + " --> " + end);
              vttOut.push(diagText);
              vttOut.push("");
            }
          }
        }
      }
      return vttOut.join("\n");
    }

    /* Standard SRT -> WebVTT conversion */
    var srtConverted = text.replace(
      /(\d{1,2}:\d{2}:\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{3})/g,
      function (_, s1, ms1, s2, ms2) {
        var p1 = s1.length === 7 ? "0" + s1 : s1;
        var p2 = s2.length === 7 ? "0" + s2 : s2;
        return p1 + "." + ms1 + " --> " + p2 + "." + ms2;
      }
    );
    return "WEBVTT\n\n" + srtConverted + "\n";
  }

  function formatAssTime(assTime) {
    var m = String(assTime).match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
    if (!m) return null;
    var hh = m[1].length === 1 ? "0" + m[1] : m[1];
    return hh + ":" + m[2] + ":" + m[3] + "." + m[4] + "0";
  }

  /* Central Action Dispatcher (shared by WebSocket and HTTP /rpc) */
  function dispatchAction(action, payload, callback) {
    try {
      switch (action) {
        case "ping":
          return callback(null, { pong: true, time: Date.now(), historyFile: HISTORY_FILE });
        case "getHome":
          return handleGetHome(payload, callback);
        case "search":
          return handleSearch(payload, callback);
        case "getDetails":
          return handleGetDetails(payload, callback);
        case "getStream":
          return handleGetStream(payload, callback);
        case "getHistory":
          return callback(null, loadHistory());
        case "saveHistory":
          return callback(null, upsertHistoryItem(payload));
        case "removeHistory":
          return callback(null, removeHistoryItem(payload && payload.animeId));
        default:
          return callback(new Error("Unknown action: " + action));
      }
    } catch (e) {
      return callback(e);
    }
  }

  /* HTTP Server: Handles /proxy, /sub, /rpc, and /status */
  function setCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
  }

  var server = http.createServer(function (req, res) {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    var parsedReq = urlModule.parse(req.url, true);
    var pathname = parsedReq.pathname || "/";
    var query = parsedReq.query || {};

    /* 1. Status check */
    if (pathname === "/status" || pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        service: "my-anime-tizenbrew",
        version: "1.0.0",
        port: PORT,
        historyFile: HISTORY_FILE
      }));
      return;
    }

    /* 2. HTTP JSON-RPC fallback endpoint (/rpc) */
    if (pathname === "/rpc") {
      if (req.method === "POST") {
        var bodyStr = "";
        req.on("data", function (chunk) {
          bodyStr += chunk.toString();
        });
        req.on("end", function () {
          var msg = {};
          try {
            msg = JSON.parse(bodyStr || "{}");
          } catch (e) {}
          dispatchAction(msg.action, msg.payload || {}, function (err, data) {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            if (err) {
              res.end(JSON.stringify({ id: msg.id, action: msg.action, ok: false, error: err.message || String(err) }));
            } else {
              res.end(JSON.stringify({ id: msg.id, action: msg.action, ok: true, data: data }));
            }
          });
        });
        return;
      } else {
        var act = query.action || "ping";
        dispatchAction(act, query, function (err, data) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          if (err) {
            res.end(JSON.stringify({ action: act, ok: false, error: err.message || String(err) }));
          } else {
            res.end(JSON.stringify({ action: act, ok: true, data: data }));
          }
        });
        return;
      }
    }

    /* 3. Subtitle Proxy + SRT/ASS -> WebVTT Converter (/sub?url=...) */
    if (pathname === "/sub") {
      var subUrl = query.url;
      if (!subUrl) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing url parameter");
        return;
      }
      fetchRemoteText(subUrl, { "Referer": SOURCE_REFERER, "Origin": SOURCE_ORIGIN }, function (err, subText) {
        if (err) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Subtitle fetch error: " + err.message);
          return;
        }
        var vtt = convertToWebVtt(subText);
        res.writeHead(200, {
          "Content-Type": "text/vtt; charset=utf-8",
          "Cache-Control": "public, max-age=3600"
        });
        res.end(vtt);
      });
      return;
    }

    /* 4. HLS (.m3u8), Segment (.ts), AES-128 Key (.key), and Image Proxy (/proxy?url=...) */
    if (pathname === "/proxy") {
      var targetUrl = query.url;
      var audioMode = query.audio || "";
      if (!targetUrl) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing url parameter");
        return;
      }

      var isM3u8 = /\.m3u8(\?|$)/i.test(targetUrl);
      if (isM3u8) {
        fetchRemoteText(targetUrl, { "Referer": SOURCE_REFERER, "Origin": SOURCE_ORIGIN }, function (err, m3u8Text, remoteRes) {
          if (err) {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("M3U8 proxy error: " + err.message);
            return;
          }
          var baseUrl = (remoteRes && remoteRes.finalUrl) ? remoteRes.finalUrl : targetUrl;
          var rewritten = rewriteM3u8Playlist(m3u8Text, baseUrl, audioMode);
          res.writeHead(200, {
            "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
            "Cache-Control": "no-cache"
          });
          res.end(rewritten);
        });
        return;
      }

      /* Binary streaming proxy for .ts segments, .key files, and images */
      streamBinaryProxy(targetUrl, req, res, 5);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  function streamBinaryProxy(targetUrl, clientReq, clientRes, redirectsLeft) {
    if (redirectsLeft <= 0) {
      clientRes.writeHead(502, { "Content-Type": "text/plain" });
      clientRes.end("Too many redirects");
      return;
    }

    var parsed;
    try {
      parsed = urlModule.parse(targetUrl);
    } catch (e) {
      clientRes.writeHead(400, { "Content-Type": "text/plain" });
      clientRes.end("Invalid URL");
      return;
    }

    var isHttps = parsed.protocol === "https:";
    var transport = isHttps ? https : http;
    var headers = {
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
      "Referer": SOURCE_REFERER,
      "Origin": SOURCE_ORIGIN
    };
    if (clientReq.headers && clientReq.headers.range) {
      headers["Range"] = clientReq.headers.range;
    }

    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80),
      path: parsed.path || "/",
      method: "GET",
      headers: headers,
      servername: parsed.hostname,
      rejectUnauthorized: false
    };

    var upReq = transport.request(reqOpts, function (upRes) {
      var status = upRes.statusCode || 200;
      if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && upRes.headers && upRes.headers.location) {
        upRes.resume();
        var nextUrl = urlModule.resolve(targetUrl, upRes.headers.location);
        return streamBinaryProxy(nextUrl, clientReq, clientRes, redirectsLeft - 1);
      }

      var outHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      };
      if (upRes.headers["content-type"]) {
        outHeaders["Content-Type"] = upRes.headers["content-type"];
      } else if (/\.ts(\?|$)/i.test(targetUrl)) {
        outHeaders["Content-Type"] = "video/mp2t";
      } else if (/\.key(\?|$)/i.test(targetUrl)) {
        outHeaders["Content-Type"] = "application/octet-stream";
      }
      if (upRes.headers["content-length"]) outHeaders["Content-Length"] = upRes.headers["content-length"];
      if (upRes.headers["content-range"]) outHeaders["Content-Range"] = upRes.headers["content-range"];
      if (upRes.headers["accept-ranges"]) outHeaders["Accept-Ranges"] = upRes.headers["accept-ranges"];
      outHeaders["Cache-Control"] = "public, max-age=3600";

      clientRes.writeHead(status, outHeaders);
      upRes.pipe(clientRes);
    });

    upReq.setTimeout(20000, function () {
      try { upReq.abort(); } catch (e) {}
      if (!clientRes.headersSent) {
        clientRes.writeHead(504, { "Content-Type": "text/plain" });
      }
      try { clientRes.end(); } catch (e2) {}
    });

    upReq.on("error", function (err) {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "text/plain" });
        clientRes.end("Proxy error: " + err.message);
      } else {
        try { clientRes.end(); } catch (e) {}
      }
    });

    clientReq.on("close", function () {
      try { upReq.abort(); } catch (e) {}
    });

    upReq.end();
  }

  /* Zero-Dependency RFC 6455 WebSocket Server on ws://127.0.0.1:8092 */
  function wsSendFrame(socket, obj) {
    if (!socket || socket.destroyed) return;
    try {
      var json = JSON.stringify(obj);
      var payload = fromBuf(json, "utf8");
      var len = payload.length;
      var header;
      if (len < 126) {
        header = allocBuf(2);
        header[0] = 0x81;
        header[1] = len;
      } else if (len < 65536) {
        header = allocBuf(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = allocBuf(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(len, 6);
      }
      socket.write(Buffer.concat([header, payload]));
    } catch (e) {}
  }

  function wsSendControl(socket, opcode, payload) {
    if (!socket || socket.destroyed) return;
    try {
      var data = payload || allocBuf(0);
      var header = allocBuf(2);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = data.length & 0x7f;
      socket.write(Buffer.concat([header, data]));
    } catch (e) {}
  }

  server.on("upgrade", function (req, socket) {
    var key = req.headers && req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    var accept = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", "binary")
      .digest("base64");

    var handshake =
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";

    socket.write(handshake);
    if (socket.setNoDelay) socket.setNoDelay(true);

    var buffer = allocBuf(0);

    socket.on("data", function (chunk) {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        var firstByte = buffer[0];
        var secondByte = buffer[1];
        var opcode = firstByte & 0x0f;
        var isMasked = (secondByte & 0x80) !== 0;
        var payloadLen = secondByte & 0x7f;
        var offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < 4) break;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) break;
          payloadLen = buffer.readUInt32BE(6);
          offset = 10;
        }

        var maskOffset = offset;
        if (isMasked) offset += 4;

        if (buffer.length < offset + payloadLen) break;

        var frameData = allocBuf(payloadLen);
        if (isMasked) {
          for (var i = 0; i < payloadLen; i++) {
            frameData[i] = buffer[offset + i] ^ buffer[maskOffset + (i & 3)];
          }
        } else {
          buffer.copy(frameData, 0, offset, offset + payloadLen);
        }

        buffer = buffer.slice(offset + payloadLen);

        if (opcode === 0x8) {
          /* Close frame */
          wsSendControl(socket, 0x8, allocBuf(0));
          socket.end();
          return;
        } else if (opcode === 0x9) {
          /* Ping -> Pong */
          wsSendControl(socket, 0xA, frameData);
        } else if (opcode === 0x1) {
          /* Text frame (JSON command) */
          var text = frameData.toString("utf8");
          handleWsMessage(socket, text);
        }
      }
    });

    socket.on("error", function () {
      try { socket.destroy(); } catch (e) {}
    });

    /* Send initial ready event over WebSocket */
    wsSendFrame(socket, {
      type: "ready",
      service: "my-anime-tizenbrew",
      port: PORT
    });
  });

  function handleWsMessage(socket, rawText) {
    var msg;
    try {
      msg = JSON.parse(rawText);
    } catch (e) {
      wsSendFrame(socket, { ok: false, error: "Invalid JSON" });
      return;
    }

    var reqId = msg.id;
    var action = msg.action || msg.type;
    var payload = msg.payload || {};

    dispatchAction(action, payload, function (err, data) {
      if (err) {
        wsSendFrame(socket, {
          id: reqId,
          action: action,
          ok: false,
          error: err.message || String(err)
        });
      } else {
        wsSendFrame(socket, {
          id: reqId,
          action: action,
          ok: true,
          data: data
        });
      }
    });
  }

  server.on("error", function (err) {
    if (err && err.code === "EADDRINUSE") {
      console.log("[MyAnimeService] Port " + PORT + " already in use; existing service active.");
    } else {
      console.error("[MyAnimeService] Server error:", err);
    }
  });

  server.listen(PORT, HOST, function () {
    if (typeof global !== "undefined") {
      global.__MY_ANIME_SERVICE_SERVER__ = server;
    }
    console.log("[MyAnimeService] Listening on http://" + HOST + ":" + PORT + " and ws://" + HOST + ":" + PORT);
  });
})();
