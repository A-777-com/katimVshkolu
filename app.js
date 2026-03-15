(function () {
  'use strict';

  /* ═══════════ CONSTANTS ═══════════ */
  var MARKER_TYPES = {
    busy_road: { emoji: '🚗', label: 'Оживлённая дорога', danger: true, voice: 'Впереди оживлённая дорога, будьте осторожны!' },
    pothole: { emoji: '🕳️', label: 'Ямы', danger: true, voice: 'Осторожно, ямы на дороге!' },
    construction: { emoji: '🚧', label: 'Ремонт', danger: true, voice: 'Впереди ремонтные работы!' },
    dogs: { emoji: '🐺', label: 'Злые собаки', danger: true, voice: 'Впереди могут быть собаки, будьте внимательны!' },
    poor_visibility: { emoji: '🌫️', label: 'Плохая видимость', danger: true, voice: 'Участок с плохой видимостью!' },
    steep: { emoji: '⛰️', label: 'Крутой спуск', danger: true, voice: 'Впереди крутой спуск, сбавьте скорость!' },
    crossing: { emoji: '🚶', label: 'Переход', danger: false, voice: 'Впереди пешеходный переход.' },
    good_surface: { emoji: '✅', label: 'Хорошее покрытие', danger: false, voice: '' },
    traffic_light: { emoji: '🚦', label: 'Светофор', danger: false, voice: 'Впереди светофор.' }
  };

  var MANEUVER_ICONS = {
    'depart': '🚀', 'arrive': '🏁',
    'turn-left': '⬅️', 'turn-right': '➡️', 'turn-straight': '⬆️',
    'turn-slight left': '↖️', 'turn-slight right': '↗️',
    'turn-sharp left': '↩️', 'turn-sharp right': '↪️',
    'turn-uturn': '🔄',
    'roundabout': '🔄', 'rotary': '🔄',
    'fork-left': '↖️', 'fork-right': '↗️', 'fork-straight': '⬆️',
    'merge-left': '🔀', 'merge-right': '🔀', 'merge-straight': '🔀',
    'new name-straight': '⬆️', 'new name-left': '⬅️', 'new name-right': '➡️',
    'continue-straight': '⬆️', 'continue-left': '⬅️', 'continue-right': '➡️',
    'end of road-left': '⬅️', 'end of road-right': '➡️',
    'notification': '⬆️',
    'default': '⬆️'
  };

  var WARN_RADIUS = 80;
  var OFF_ROUTE = 50;
  var STEP_ANNOUNCE = 80;

  var PLACE_ICONS = ['🏠', '🏫', '🏪', '🏥', '🏛️', '⛪', '🎮', '🏟️'];

  /* ═══════════ STATE ═══════════ */
  var S = {
    map: null, userPos: null, userMarker: null, accuracyCircle: null, watchId: null,
    route: null, routeLine: null, routeCoords: null, destMarker: null, destination: null,
    navigating: false, navStepIdx: 0, navStartTime: 0, navDistance: 0, navTotalDist: 0,
    lastWarnedMarkers: {}, lastSpokenStep: -1,
    placingMarker: null, markers: [], mapMarkers: [],
    places: [], trips: [],
    settings: { voice: true, vibration: true, profile: 'foot' },
    activeTab: 'map', searchTimer: null, installPrompt: null,
    _pickingPlaceOnMap: false, _placeEditId: null, _placeIcon: '🏠',
    _placeLat: null, _placeLng: null, _voicesLoaded: false
  };

  /* ═══════════ HELPERS ═══════════ */
  function $(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return document.querySelectorAll(sel); }

  function uuid() {
    return 'xxxx-xxxx'.replace(/x/g, function () {
      return (Math.random() * 16 | 0).toString(16);
    });
  }

  function haversine(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDist(m) {
    if (m >= 1000) return (m / 1000).toFixed(1) + ' км';
    return Math.round(m) + ' м';
  }

  function formatTime(sec) {
    var m = Math.round(sec / 60);
    if (m < 60) return m + ' мин';
    var h = Math.floor(m / 60);
    return h + ' ч ' + (m % 60) + ' мин';
  }

  function formatDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) +
      ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  /* ═══════════ STORAGE ═══════════ */
  function saveData() {
    try {
      localStorage.setItem('katim_markers', JSON.stringify(S.markers));
      localStorage.setItem('katim_places', JSON.stringify(S.places));
      localStorage.setItem('katim_trips', JSON.stringify(S.trips));
      localStorage.setItem('katim_settings', JSON.stringify(S.settings));
    } catch (e) { /* quota exceeded */ }
  }

  function loadData() {
    try {
      var mk = localStorage.getItem('katim_markers');
      var pl = localStorage.getItem('katim_places');
      var tr = localStorage.getItem('katim_trips');
      var st = localStorage.getItem('katim_settings');
      if (mk) S.markers = JSON.parse(mk);
      if (pl) S.places = JSON.parse(pl);
      if (tr) S.trips = JSON.parse(tr);
      if (st) S.settings = Object.assign(S.settings, JSON.parse(st));
    } catch (e) { /* parse error */ }
  }

  /* ═══════════ TOAST ═══════════ */
  var _toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.classList.add('hidden'); }, 350);
    }, 3000);
  }

  /* ═══════════ SPEECH ═══════════ */
  function speak(text) {
    if (!S.settings.voice || !text) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      u.rate = 0.95;
      u.pitch = 1.1;
      var voices = window.speechSynthesis.getVoices();
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].lang && voices[i].lang.indexOf('ru') === 0) {
          u.voice = voices[i];
          break;
        }
      }
      window.speechSynthesis.speak(u);
    } catch (e) { /* no speech */ }
  }

  function vibrate(pattern) {
    if (!S.settings.vibration) return;
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { }
    }
  }

  /* ═══════════ MAP INIT ═══════════ */
  function initMap() {
    S.map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      maxZoom: 19
    }).setView([55.75, 37.62], 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: ''
    }).addTo(S.map);

    S.map.on('click', onMapClick);
    renderMapMarkers();
  }

  /* ═══════════ GEOLOCATION ═══════════ */
  function initGeolocation() {
    if (!('geolocation' in navigator)) {
      toast('Геолокация недоступна');
      return;
    }
    S.watchId = navigator.geolocation.watchPosition(onPosition, function (err) {
      if (err.code === 1) toast('Разрешите доступ к геолокации');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  }

  function onPosition(pos) {
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    var acc = pos.coords.accuracy;
    S.userPos = { lat: lat, lng: lng, acc: acc };

    if (!S.userMarker) {
      S.userMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: 'user-marker', iconSize: [20, 20], iconAnchor: [10, 10] }),
        zIndexOffset: 1000
      }).addTo(S.map);
      S.map.setView([lat, lng], 16);
    } else {
      S.userMarker.setLatLng([lat, lng]);
    }

    if (acc < 500) {
      if (!S.accuracyCircle) {
        S.accuracyCircle = L.circle([lat, lng], {
          radius: acc,
          className: 'accuracy-circle',
          weight: 1,
          interactive: false
        }).addTo(S.map);
      } else {
        S.accuracyCircle.setLatLng([lat, lng]).setRadius(acc);
      }
    }

    if (S.navigating) {
      updateNavigation();
    }
  }

  /* ═══════════ SEARCH ═══════════ */
  function searchAddress(query) {
    if (!query || query.length < 2) {
      $('searchResults').classList.add('hidden');
      return;
    }
    clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(function () {
      var url = 'https://nominatim.openstreetmap.org/search?format=json&accept-language=ru&countrycodes=ru&limit=5&q=' + encodeURIComponent(query);
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) { showSearchResults(data); })
        .catch(function () { });
    }, 500);
  }

  function showSearchResults(items) {
    var el = $('searchResults');
    var html = '';

    // Show matching saved places first
    var q = $('searchInput').value.toLowerCase();
    S.places.forEach(function (p) {
      if (p.lat && p.name.toLowerCase().indexOf(q) !== -1) {
        html += '<div class="search-result-item" onclick="window._selectPlace(\'' + p.id + '\')">' +
          '<span class="search-result-icon">' + p.icon + '</span>' +
          '<span class="search-result-text">' + p.name + '<span class="search-result-label">Сохранённое место</span></span></div>';
      }
    });

    if (items && items.length) {
      items.forEach(function (it) {
        html += '<div class="search-result-item" onclick="window._selectSearchResult(' + it.lat + ',' + it.lon + ',\'' +
          it.display_name.replace(/'/g, "\\'").substring(0, 80) + '\')">' +
          '<span class="search-result-icon">📌</span>' +
          '<span class="search-result-text">' + it.display_name + '</span></div>';
      });
    }

    if (!html) {
      html = '<div class="search-result-item"><span class="search-result-text">Ничего не найдено</span></div>';
    }

    el.innerHTML = html;
    el.classList.remove('hidden');
  }

  window._selectPlace = function (id) {
    var p = S.places.find(function (x) { return x.id === id; });
    if (p && p.lat) {
      selectDestination(p.lat, p.lng, p.name);
    }
    $('searchResults').classList.add('hidden');
    $('searchInput').value = '';
    $('searchClear').classList.add('hidden');
  };

  window._selectSearchResult = function (lat, lng, name) {
    selectDestination(lat, lng, name);
    $('searchResults').classList.add('hidden');
    $('searchInput').value = '';
    $('searchClear').classList.add('hidden');
  };

  function selectDestination(lat, lng, name) {
    S.destination = { lat: lat, lng: lng, name: name };

    if (S.destMarker) S.map.removeLayer(S.destMarker);
    S.destMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div style="font-size:32px;text-align:center;">🏫</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        className: ''
      })
    }).addTo(S.map);

    switchTab('map');
    S.map.setView([lat, lng], 15);

    if (S.userPos) {
      buildRoute(S.userPos.lat, S.userPos.lng, lat, lng);
    } else {
      toast('Ожидаем геолокацию...');
      var waitGeo = setInterval(function () {
        if (S.userPos) {
          clearInterval(waitGeo);
          buildRoute(S.userPos.lat, S.userPos.lng, lat, lng);
        }
      }, 1000);
      setTimeout(function () { clearInterval(waitGeo); }, 15000);
    }
  }

  /* ═══════════ ROUTING ═══════════ */
  function buildRoute(lat1, lng1, lat2, lng2) {
    toast('Строим маршрут...');
    if (S.routeLine) {
      S.map.removeLayer(S.routeLine);
      S.routeLine = null;
    }

    tryValhalla(lat1, lng1, lat2, lng2)
      .catch(function () { return tryOsrmDe(lat1, lng1, lat2, lng2); })
      .catch(function () { return tryOsrmOrg(lat1, lng1, lat2, lng2); })
      .then(function (result) {
        if (!result) { toast('Маршрут не найден'); return; }
        S.route = result;
        S.routeCoords = result.coords;
        S.routeLine = L.polyline(result.coords, {
          color: '#1976D2', weight: 5, opacity: 0.8
        }).addTo(S.map);
        S.map.fitBounds(S.routeLine.getBounds(), { padding: [50, 50] });
        showRouteSheet();
      })
      .catch(function () { toast('Маршрут не найден'); });
  }

  /* ── Valhalla ── */
  function tryValhalla(lat1, lng1, lat2, lng2) {
    var costing = S.settings.profile === 'bicycle' ? 'bicycle' : 'pedestrian';
    var body = {
      locations: [{ lat: lat1, lon: lng1 }, { lat: lat2, lon: lng2 }],
      costing: costing,
      directions_options: { units: 'km', language: 'ru-RU' }
    };

    if (costing === 'pedestrian') {
      body.costing_options = {
        pedestrian: {
          use_sidewalks: 1.0,
          walking_speed: 5.0,
          walkway_factor: 0.5,
          sidewalk_factor: 0.5,
          driveway_factor: 5.0,
          max_grade: 15
        }
      };
    }

    return fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
    })
      .then(function (r) {
        if (!r.ok) throw new Error('Valhalla error');
        return r.json();
      })
      .then(function (data) {
        return convertValhallaToOsrm(data);
      });
  }

  function convertValhallaToOsrm(data) {
    if (!data.trip || !data.trip.legs || !data.trip.legs.length) throw new Error('No trip');
    var leg = data.trip.legs[0];
    var coords = decodePolyline(leg.shape, 6);
    var dist = data.trip.summary.length * 1000; // km -> m
    var dur = data.trip.summary.time;

    var VALHALLA_TYPE_MAP = {
      0: 'depart', 1: 'depart', 2: 'turn', 3: 'turn', 4: 'arrive',
      5: 'turn', 6: 'continue', 7: 'continue', 8: 'turn', 9: 'turn',
      10: 'turn', 11: 'turn', 12: 'turn', 13: 'turn', 14: 'turn', 15: 'turn',
      16: 'turn', 17: 'merge', 18: 'roundabout', 19: 'roundabout',
      20: 'merge', 21: 'fork', 22: 'fork', 23: 'fork', 24: 'turn',
      25: 'continue', 26: 'roundabout', 27: 'roundabout', 28: 'turn', 29: 'turn'
    };

    var VALHALLA_MOD_MAP = {
      0: 'straight', 1: 'slight right', 2: 'right', 3: 'sharp right',
      4: 'uturn', 5: 'sharp left', 6: 'left', 7: 'slight left'
    };

    var steps = [];
    if (leg.maneuvers) {
      leg.maneuvers.forEach(function (m, i) {
        var type = VALHALLA_TYPE_MAP[m.type] || 'turn';
        if (m.type === 4 || m.type === 5 || m.type === 6) type = 'arrive';
        if (i === 0) type = 'depart';
        if (i === leg.maneuvers.length - 1) type = 'arrive';

        var modifier = 'straight';
        if (m.type === 15 || m.type === 2 || m.type === 10) modifier = 'right';
        else if (m.type === 16 || m.type === 3 || m.type === 11) modifier = 'left';
        else if (m.type === 12) modifier = 'slight right';
        else if (m.type === 13) modifier = 'slight left';
        else if (m.type === 14) modifier = 'sharp right';
        else if (m.type === 7) modifier = 'sharp left';
        else if (m.type === 8 || m.type === 9) modifier = 'uturn';

        var begIdx = m.begin_shape_index || 0;
        var loc = coords[begIdx] || coords[0];

        steps.push({
          maneuver: { type: type, modifier: modifier, location: [loc[1], loc[0]] },
          name: m.street_names ? m.street_names.join(', ') : '',
          distance: (m.length || 0) * 1000,
          duration: m.time || 0,
          _instruction: m.instruction || ''
        });
      });
    }

    return { steps: steps, coords: coords, distance: dist, duration: dur };
  }

  function decodePolyline(encoded, precision) {
    precision = precision || 5;
    var factor = Math.pow(10, precision);
    var len = encoded.length;
    var index = 0;
    var lat = 0, lng = 0;
    var coords = [];

    while (index < len) {
      var shift = 0, result = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);

      shift = 0; result = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);

      coords.push([lat / factor, lng / factor]);
    }
    return coords;
  }

  /* ── OSRM OpenStreetMap.de ── */
  function tryOsrmDe(lat1, lng1, lat2, lng2) {
    var profile = S.settings.profile === 'bicycle' ? 'routed-bike/route/v1/bike' : 'routed-foot/route/v1/foot';
    var url = 'https://routing.openstreetmap.de/' + profile + '/' +
      lng1 + ',' + lat1 + ';' + lng2 + ',' + lat2 +
      '?overview=full&geometries=geojson&steps=true';

    return fetch(url, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
    })
      .then(function (r) {
        if (!r.ok) throw new Error('OSRM-DE error');
        return r.json();
      })
      .then(function (data) { return parseOsrmResult(data); });
  }

  /* ── OSRM.org fallback ── */
  function tryOsrmOrg(lat1, lng1, lat2, lng2) {
    var url = 'https://router.project-osrm.org/route/v1/foot/' +
      lng1 + ',' + lat1 + ';' + lng2 + ',' + lat2 +
      '?overview=full&geometries=geojson&steps=true';

    return fetch(url, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
    })
      .then(function (r) {
        if (!r.ok) throw new Error('OSRM-org error');
        return r.json();
      })
      .then(function (data) {
        toast('Маршрут может проходить по дорогам');
        return parseOsrmResult(data);
      });
  }

  function parseOsrmResult(data) {
    if (!data.routes || !data.routes.length) throw new Error('No routes');
    var route = data.routes[0];
    var coords = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
    var steps = [];

    if (route.legs && route.legs[0] && route.legs[0].steps) {
      route.legs[0].steps.forEach(function (s) {
        steps.push({
          maneuver: s.maneuver || { type: 'turn', modifier: 'straight', location: [0, 0] },
          name: s.name || '',
          distance: s.distance || 0,
          duration: s.duration || 0,
          _instruction: ''
        });
      });
    }

    return { steps: steps, coords: coords, distance: route.distance, duration: route.duration };
  }

  /* ═══════════ ROUTE SHEET ═══════════ */
  function showRouteSheet() {
    if (!S.route) return;
    var dist = S.route.distance;
    var dur = S.route.duration;

    // Count dangerous markers near route
    var dangerCount = 0;
    S.markers.forEach(function (m) {
      var mt = MARKER_TYPES[m.type];
      if (!mt || !mt.danger) return;
      for (var i = 0; i < S.routeCoords.length; i += 5) {
        var d = haversine(m.lat, m.lng, S.routeCoords[i][0], S.routeCoords[i][1]);
        if (d < 100) { dangerCount++; break; }
      }
    });

    $('routeSummary').innerHTML =
      '<div class="route-stat"><span class="route-stat-value">' + formatDist(dist) + '</span><span class="route-stat-label">Расстояние</span></div>' +
      '<div class="route-stat"><span class="route-stat-value">' + formatTime(dur) + '</span><span class="route-stat-label">Время</span></div>' +
      '<div class="route-stat"><span class="route-stat-value">' + dangerCount + '</span><span class="route-stat-label">Опасности</span></div>';

    var stepsHtml = '';
    S.route.steps.forEach(function (step) {
      var icon = getManeuverIcon(step.maneuver);
      var text = step._instruction || translateManeuver(step);
      stepsHtml += '<div class="route-step"><span class="step-icon">' + icon + '</span>' +
        '<span class="step-text">' + text + '</span>' +
        '<span class="step-dist">' + formatDist(step.distance) + '</span></div>';
    });
    $('routeSteps').innerHTML = stepsHtml;

    var profileIcon = S.settings.profile === 'bicycle' ? '🚲' : '🛴';
    $('btnGo').textContent = profileIcon + ' Поехали!';

    toggleSheet('routeSheet', true);
  }

  function getManeuverIcon(maneuver) {
    if (!maneuver) return '⬆️';
    var key = maneuver.type + '-' + (maneuver.modifier || '');
    if (MANEUVER_ICONS[key]) return MANEUVER_ICONS[key];
    if (MANEUVER_ICONS[maneuver.type]) return MANEUVER_ICONS[maneuver.type];
    return MANEUVER_ICONS['default'];
  }

  function translateManeuver(step) {
    if (!step || !step.maneuver) return 'Следуйте по маршруту';
    var m = step.maneuver;
    var name = step.name ? (' на ' + step.name) : '';
    var t = m.type || '';
    var mod = m.modifier || '';

    if (t === 'depart') return 'Начните движение' + name;
    if (t === 'arrive') return 'Вы прибыли!' + name;

    var dirMap = {
      'left': 'налево',
      'right': 'направо',
      'slight left': 'немного левее',
      'slight right': 'немного правее',
      'sharp left': 'резко налево',
      'sharp right': 'резко направо',
      'straight': 'прямо',
      'uturn': 'разворот'
    };

    var dir = dirMap[mod] || 'прямо';

    if (t === 'turn') return 'Поверните ' + dir + name;
    if (t === 'continue' || t === 'new name') return 'Продолжайте ' + dir + name;
    if (t === 'merge') return 'Примкните ' + dir + name;
    if (t === 'fork') return 'На развилке ' + dir + name;
    if (t === 'roundabout' || t === 'rotary') return 'На кольце ' + dir + name;
    if (t === 'end of road') return 'В конце дороги ' + dir + name;

    return 'Следуйте ' + dir + name;
  }

  /* ═══════════ NAVIGATION ═══════════ */
  function startNavigation() {
    if (!S.route || !S.route.steps.length) return;
    S.navigating = true;
    S.navStepIdx = 0;
    S.navStartTime = Date.now();
    S.navDistance = 0;
    S.navTotalDist = S.route.distance;
    S.lastSpokenStep = -1;
    S.lastWarnedMarkers = {};

    toggleSheet('routeSheet', false);
    $('navPanel').classList.remove('hidden');

    speak('Маршрут начат! Следуйте по указателям.');
    vibrate([100, 50, 100]);
    updateNavUI();
  }

  function stopNavigation(completed) {
    S.navigating = false;
    $('navPanel').classList.add('hidden');

    if (completed && S.destination) {
      var elapsed = (Date.now() - S.navStartTime) / 1000;
      var trip = {
        id: uuid(),
        from: 'Моё место',
        to: S.destination.name || 'Точка',
        date: Date.now(),
        distance: S.navTotalDist,
        duration: elapsed,
        profile: S.settings.profile
      };
      S.trips.push(trip);
      saveData();
      speak('Поздравляю! Вы прибыли! Проехали ' + formatDist(S.navTotalDist));
      vibrate([100, 50, 100, 50, 200]);
      toast('Вы прибыли! ' + formatDist(S.navTotalDist));
    } else {
      speak('Навигация остановлена');
      toast('Навигация остановлена');
    }

    // Clear route from map
    if (S.routeLine) { S.map.removeLayer(S.routeLine); S.routeLine = null; }
    if (S.destMarker) { S.map.removeLayer(S.destMarker); S.destMarker = null; }
    S.route = null;
    S.routeCoords = null;
    S.destination = null;
  }

  function updateNavigation() {
    if (!S.navigating || !S.route || !S.userPos) return;
    var pos = S.userPos;

    // Center map
    S.map.setView([pos.lat, pos.lng], Math.max(S.map.getZoom(), 17));

    // Check arrival
    if (S.destination) {
      var distToDest = haversine(pos.lat, pos.lng, S.destination.lat, S.destination.lng);
      if (distToDest < 30) {
        stopNavigation(true);
        return;
      }
    }

    // Find closest step
    var steps = S.route.steps;
    var minDist = Infinity;
    var closestIdx = S.navStepIdx;

    for (var i = S.navStepIdx; i < steps.length; i++) {
      var loc = steps[i].maneuver ? steps[i].maneuver.location : null;
      if (!loc) continue;
      var d = haversine(pos.lat, pos.lng, loc[1], loc[0]);
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }

    // Progress step
    if (closestIdx > S.navStepIdx && minDist < 30) {
      S.navStepIdx = closestIdx;
    }

    var currentStep = steps[S.navStepIdx] || steps[steps.length - 1];

    // Distance to current maneuver
    var distToStep = Infinity;
    if (currentStep.maneuver && currentStep.maneuver.location) {
      distToStep = haversine(pos.lat, pos.lng,
        currentStep.maneuver.location[1], currentStep.maneuver.location[0]);
    }

    // Announce step
    if (distToStep < STEP_ANNOUNCE && S.navStepIdx !== S.lastSpokenStep) {
      S.lastSpokenStep = S.navStepIdx;
      var text = currentStep._instruction || translateManeuver(currentStep);
      speak(text);
      vibrate([100]);
    }

    // Check off route
    var minRouteDist = Infinity;
    for (var j = 0; j < S.routeCoords.length; j += 3) {
      var rd = haversine(pos.lat, pos.lng, S.routeCoords[j][0], S.routeCoords[j][1]);
      if (rd < minRouteDist) minRouteDist = rd;
    }

    if (minRouteDist > OFF_ROUTE) {
      speak('Вы отклонились от маршрута. Перестраиваю.');
      toast('Перестраиваем маршрут...');
      S.navStepIdx = 0;
      S.lastSpokenStep = -1;
      buildRoute(pos.lat, pos.lng, S.destination.lat, S.destination.lng);
    }

    // Check nearby dangers
    checkNearbyDangers(pos);

    // Remaining distance
    var remaining = 0;
    for (var k = S.navStepIdx; k < steps.length; k++) {
      remaining += steps[k].distance || 0;
    }

    // ETA
    var speed = S.settings.profile === 'bicycle' ? 4.0 : 1.4; // m/s
    var etaSec = remaining / speed;

    updateNavUI(currentStep, distToStep, remaining, etaSec);
  }

  function updateNavUI(step, distToStep, remaining, etaSec) {
    if (!step) {
      if (S.route && S.route.steps.length) step = S.route.steps[0];
      else return;
    }
    $('navIcon').textContent = getManeuverIcon(step ? step.maneuver : null);
    $('navInstruction').textContent = step._instruction || translateManeuver(step);
    $('navDistance').textContent = distToStep !== undefined ? 'Через ' + formatDist(distToStep) : '';
    $('navRemaining').textContent = remaining !== undefined ? '📏 ' + formatDist(remaining) : '';
    $('navEta').textContent = etaSec !== undefined ? '⏱️ ' + formatTime(etaSec) : '';
  }

  function checkNearbyDangers(pos) {
    var now = Date.now();
    S.markers.forEach(function (m) {
      var mt = MARKER_TYPES[m.type];
      if (!mt || !mt.danger) return;
      var d = haversine(pos.lat, pos.lng, m.lat, m.lng);
      if (d < WARN_RADIUS) {
        var last = S.lastWarnedMarkers[m.id];
        if (!last || (now - last) > 60000) {
          S.lastWarnedMarkers[m.id] = now;
          speak(mt.voice);
          vibrate([200, 100, 200, 100, 300]);
          toast(mt.emoji + ' ' + mt.label + '!');
        }
      }
    });
  }

  /* ═══════════ MARKERS ═══════════ */
  function startPlacingMarker(type) {
    S.placingMarker = type;
    toggleSheet('markerSheet', false);
    toast('Нажмите на карту для размещения метки');
    document.body.classList.add('picking-cursor');
  }

  function onMapClick(e) {
    if (S.placingMarker) {
      addMarker(S.placingMarker, e.latlng.lat, e.latlng.lng);
      S.placingMarker = null;
      document.body.classList.remove('picking-cursor');
      return;
    }
    if (S._pickingPlaceOnMap) {
      S._placeLat = e.latlng.lat;
      S._placeLng = e.latlng.lng;
      $('placeCoords').textContent = '📍 ' + e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
      S._pickingPlaceOnMap = false;
      document.body.classList.remove('picking-cursor');
      $('placeModal').classList.remove('hidden');
      switchTab('places');
      toast('Координаты выбраны');
      return;
    }
  }

  function addMarker(type, lat, lng) {
    var m = { id: uuid(), type: type, lat: lat, lng: lng, ts: Date.now() };
    S.markers.push(m);
    saveData();
    addMarkerToMap(m);
    var mt = MARKER_TYPES[type];
    toast(mt.emoji + ' ' + mt.label + ' добавлено');
  }

  function addMarkerToMap(m) {
    var mt = MARKER_TYPES[m.type];
    if (!mt) return;
    var marker = L.marker([m.lat, m.lng], {
      icon: L.divIcon({
        html: '<div style="font-size:24px;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));">' + mt.emoji + '</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        className: ''
      })
    });
    marker.bindPopup(
      '<b>' + mt.emoji + ' ' + mt.label + '</b><br>' +
      '<small>' + new Date(m.ts).toLocaleDateString('ru-RU') + '</small><br>' +
      '<button class="popup-delete-btn" onclick="window._deleteMarker(\'' + m.id + '\')">🗑️ Удалить</button>'
    );
    marker.addTo(S.map);
    S.mapMarkers.push({ id: m.id, marker: marker });
  }

  function renderMapMarkers() {
    S.mapMarkers.forEach(function (mm) { S.map.removeLayer(mm.marker); });
    S.mapMarkers = [];
    S.markers.forEach(function (m) { addMarkerToMap(m); });
  }

  window._deleteMarker = function (id) {
    S.markers = S.markers.filter(function (m) { return m.id !== id; });
    saveData();
    var idx = S.mapMarkers.findIndex(function (mm) { return mm.id === id; });
    if (idx !== -1) {
      S.map.removeLayer(S.mapMarkers[idx].marker);
      S.mapMarkers.splice(idx, 1);
    }
    S.map.closePopup();
    toast('Метка удалена');
  };

  /* ═══════════ PLACES ═══════════ */
  function renderPlaces() {
    if (!S.places.length) {
      S.places = [
        { id: uuid(), name: 'Дом', icon: '🏠', lat: null, lng: null },
        { id: uuid(), name: 'Школа', icon: '🏫', lat: null, lng: null }
      ];
      saveData();
    }

    var html = '';
    S.places.forEach(function (p) {
      var coordsText = p.lat ? (p.lat.toFixed(4) + ', ' + p.lng.toFixed(4)) : '<span class="place-no-coords">Координаты не заданы</span>';
      html += '<div class="place-card">' +
        '<span class="place-icon">' + p.icon + '</span>' +
        '<div class="place-info"><div class="place-name">' + p.name + '</div>' +
        '<div class="place-coords-text">' + coordsText + '</div></div>' +
        '<div class="place-actions">' +
        (p.lat ? '<button class="place-action-btn" onclick="window._routeToPlace(\'' + p.id + '\')" title="Маршрут">🛴</button>' : '') +
        '<button class="place-action-btn" onclick="window._editPlace(\'' + p.id + '\')" title="Редактировать">✏️</button>' +
        '<button class="place-action-btn" onclick="window._deletePlace(\'' + p.id + '\')" title="Удалить">🗑️</button>' +
        '</div></div>';
    });
    $('placesList').innerHTML = html;
  }

  function openPlaceModal(existing) {
    S._placeEditId = existing ? existing.id : null;
    $('placeModalTitle').textContent = existing ? 'Редактировать место' : 'Новое место';
    $('placeNameInput').value = existing ? existing.name : '';
    S._placeIcon = existing ? existing.icon : '🏠';
    S._placeLat = existing ? existing.lat : null;
    S._placeLng = existing ? existing.lng : null;
    $('placeCoords').textContent = S._placeLat ? ('📍 ' + S._placeLat.toFixed(5) + ', ' + S._placeLng.toFixed(5)) : 'Координаты не выбраны';

    var iconsHtml = '';
    PLACE_ICONS.forEach(function (ic) {
      iconsHtml += '<button class="icon-pick-btn' + (ic === S._placeIcon ? ' selected' : '') + '" data-icon="' + ic + '">' + ic + '</button>';
    });
    $('iconPicker').innerHTML = iconsHtml;

    qsa('#iconPicker .icon-pick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        S._placeIcon = this.getAttribute('data-icon');
        qsa('#iconPicker .icon-pick-btn').forEach(function (b) { b.classList.remove('selected'); });
        this.classList.add('selected');
      });
    });

    $('placeModal').classList.remove('hidden');
  }

  function savePlaceFromModal() {
    var name = $('placeNameInput').value.trim();
    if (!name) { toast('Введите название'); return; }

    if (S._placeEditId) {
      var p = S.places.find(function (x) { return x.id === S._placeEditId; });
      if (p) {
        p.name = name;
        p.icon = S._placeIcon;
        if (S._placeLat) { p.lat = S._placeLat; p.lng = S._placeLng; }
      }
    } else {
      S.places.push({
        id: uuid(),
        name: name,
        icon: S._placeIcon,
        lat: S._placeLat,
        lng: S._placeLng
      });
    }
    saveData();
    renderPlaces();
    $('placeModal').classList.add('hidden');
    toast('Место сохранено');
  }

  window._routeToPlace = function (id) {
    var p = S.places.find(function (x) { return x.id === id; });
    if (p && p.lat) {
      selectDestination(p.lat, p.lng, p.name);
    } else {
      toast('Сначала задайте координаты');
    }
  };

  window._editPlace = function (id) {
    var p = S.places.find(function (x) { return x.id === id; });
    if (p) openPlaceModal(p);
  };

  window._deletePlace = function (id) {
    if (!confirm('Удалить место?')) return;
    S.places = S.places.filter(function (p) { return p.id !== id; });
    saveData();
    renderPlaces();
    toast('Место удалено');
  };

  /* ═══════════ STATS ═══════════ */
  function renderStats() {
    var totalTrips = S.trips.length;
    var totalDist = 0, totalTime = 0;
    S.trips.forEach(function (t) {
      totalDist += t.distance || 0;
      totalTime += t.duration || 0;
    });
    var avgSpeed = totalTime > 0 ? (totalDist / totalTime * 3.6) : 0;

    $('statsCards').innerHTML =
      '<div class="stat-card"><div class="stat-value">' + totalTrips + '</div><div class="stat-label">Поездок</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (totalDist / 1000).toFixed(1) + '</div><div class="stat-label">Всего км</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + Math.round(totalTime / 60) + '</div><div class="stat-label">Минут в пути</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + avgSpeed.toFixed(1) + '</div><div class="stat-label">Ср. км/ч</div></div>';

    var tripsHtml = '';
    if (!S.trips.length) {
      tripsHtml = '<div class="no-data">Пока нет поездок 🛴<br>Постройте маршрут и нажмите «Поехали!»</div>';
    } else {
      var sorted = S.trips.slice().reverse().slice(0, 50);
      sorted.forEach(function (t) {
        var icon = t.profile === 'bicycle' ? '🚲' : '🛴';
        tripsHtml += '<div class="trip-item">' +
          '<span class="trip-icon">' + icon + '</span>' +
          '<div class="trip-info"><div class="trip-route">' + (t.from || '?') + ' → ' + (t.to || '?') + '</div>' +
          '<div class="trip-meta">' + formatDate(t.date) + '</div></div>' +
          '<div class="trip-stats"><div class="trip-dist">' + formatDist(t.distance) + '</div>' +
          '<div class="trip-time">' + formatTime(t.duration) + '</div></div></div>';
      });
    }
    $('tripsList').innerHTML = tripsHtml;
  }

  /* ═══════════ SETTINGS ═══════════ */
  function applySettings() {
    $('setVoice').checked = S.settings.voice;
    $('setVibration').checked = S.settings.vibration;
    $('setProfile').value = S.settings.profile;
    $('profileBtn').textContent = S.settings.profile === 'bicycle' ? '🚲' : '🛴';
  }

  function exportData() {
    var data = {
      markers: S.markers,
      places: S.places,
      trips: S.trips,
      settings: S.settings,
      exportDate: new Date().toISOString()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'katim-data-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Данные экспортированы');
  }

  function importData(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (data.markers) S.markers = data.markers;
        if (data.places) S.places = data.places;
        if (data.trips) S.trips = data.trips;
        if (data.settings) S.settings = Object.assign(S.settings, data.settings);
        saveData();
        renderMapMarkers();
        renderPlaces();
        renderStats();
        applySettings();
        toast('Данные импортированы');
      } catch (err) {
        toast('Ошибка чтения файла');
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    if (!confirm('Удалить все данные? Это действие нельзя отменить.')) return;
    S.markers = [];
    S.places = [];
    S.trips = [];
    S.settings = { voice: true, vibration: true, profile: 'foot' };
    saveData();
    renderMapMarkers();
    renderPlaces();
    renderStats();
    applySettings();
    toast('Данные очищены');
  }

  /* ═══════════ UI ═══════════ */
  function switchTab(tab) {
    S.activeTab = tab;
    ['map', 'places', 'stats', 'settings'].forEach(function (t) {
      var panel = $(t + 'Panel');
      if (panel) {
        if (t === tab) panel.classList.remove('hidden');
        else panel.classList.add('hidden');
      }
    });

    // Map-specific elements
    var mapEls = ['searchBar', 'searchResults', 'map'];
    var fabEl = qs('.fab-container');
    mapEls.forEach(function (id) {
      $(id).style.display = tab === 'map' ? '' : 'none';
    });
    if (fabEl) fabEl.style.display = tab === 'map' ? '' : 'none';

    // Nav tabs
    qsa('.nav-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });

    if (tab === 'map') {
      setTimeout(function () { S.map.invalidateSize(); }, 100);
    }
    if (tab === 'places') renderPlaces();
    if (tab === 'stats') renderStats();
  }

  function toggleSheet(id, show) {
    var el = $(id);
    if (!el) return;
    if (show) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function buildMarkerGrid() {
    var html = '';
    Object.keys(MARKER_TYPES).forEach(function (key) {
      var mt = MARKER_TYPES[key];
      html += '<button class="marker-type-btn" data-type="' + key + '">' +
        '<span class="mt-emoji">' + mt.emoji + '</span>' +
        '<span>' + mt.label + '</span></button>';
    });
    $('markerGrid').innerHTML = html;
  }

  function bindUI() {
    // Search
    $('searchInput').addEventListener('input', function () {
      var v = this.value.trim();
      $('searchClear').classList.toggle('hidden', !v);
      searchAddress(v);
    });

    $('searchInput').addEventListener('focus', function () {
      if (this.value.trim()) searchAddress(this.value.trim());
    });

    $('searchClear').addEventListener('click', function () {
      $('searchInput').value = '';
      $('searchResults').classList.add('hidden');
      $('searchClear').classList.add('hidden');
    });

    // Close search on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.search-bar') && !e.target.closest('.search-results')) {
        $('searchResults').classList.add('hidden');
      }
    });

    // Profile toggle
    $('profileBtn').addEventListener('click', function () {
      S.settings.profile = S.settings.profile === 'foot' ? 'bicycle' : 'foot';
      this.textContent = S.settings.profile === 'bicycle' ? '🚲' : '🛴';
      $('setProfile').value = S.settings.profile;
      saveData();
      toast(S.settings.profile === 'bicycle' ? 'Велосипед 🚲' : 'Самокат 🛴');
    });

    // FAB locate
    $('fabLocate').addEventListener('click', function () {
      if (S.userPos) {
        S.map.setView([S.userPos.lat, S.userPos.lng], 17);
      } else {
        toast('Ожидаем геолокацию...');
      }
    });

    // FAB danger
    $('fabDanger').addEventListener('click', function () {
      toggleSheet('markerSheet', true);
    });

    // Marker type selection
    $('markerGrid').addEventListener('click', function (e) {
      var btn = e.target.closest('.marker-type-btn');
      if (btn) startPlacingMarker(btn.getAttribute('data-type'));
    });

    $('markerCancel').addEventListener('click', function () {
      toggleSheet('markerSheet', false);
    });

    // Route sheet
    $('routeClose').addEventListener('click', function () {
      toggleSheet('routeSheet', false);
    });

    $('btnGo').addEventListener('click', function () {
      startNavigation();
    });

    // Nav stop
    $('btnStop').addEventListener('click', function () {
      stopNavigation(false);
    });

    // Tabs
    qsa('.nav-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(this.getAttribute('data-tab'));
      });
    });

    // Places
    $('btnAddPlace').addEventListener('click', function () {
      openPlaceModal(null);
    });

    $('placeHere').addEventListener('click', function () {
      if (S.userPos) {
        S._placeLat = S.userPos.lat;
        S._placeLng = S.userPos.lng;
        $('placeCoords').textContent = '📍 ' + S._placeLat.toFixed(5) + ', ' + S._placeLng.toFixed(5);
        toast('Координаты установлены');
      } else {
        toast('Геолокация недоступна');
      }
    });

    $('placeOnMap').addEventListener('click', function () {
      S._pickingPlaceOnMap = true;
      $('placeModal').classList.add('hidden');
      switchTab('map');
      document.body.classList.add('picking-cursor');
      toast('Нажмите на карту для выбора места');
    });

    $('placeModalSave').addEventListener('click', function () {
      savePlaceFromModal();
    });

    $('placeModalCancel').addEventListener('click', function () {
      $('placeModal').classList.add('hidden');
    });

    // Settings
    $('setVoice').addEventListener('change', function () {
      S.settings.voice = this.checked;
      saveData();
    });

    $('setVibration').addEventListener('change', function () {
      S.settings.vibration = this.checked;
      saveData();
    });

    $('setProfile').addEventListener('change', function () {
      S.settings.profile = this.value;
      $('profileBtn').textContent = S.settings.profile === 'bicycle' ? '🚲' : '🛴';
      saveData();
    });

    $('btnExport').addEventListener('click', exportData);

    $('btnImport').addEventListener('click', function () {
      $('importFile').click();
    });

    $('importFile').addEventListener('change', function () {
      if (this.files.length) {
        importData(this.files[0]);
        this.value = '';
      }
    });

    $('btnClear').addEventListener('click', clearData);

    // PWA install
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      S.installPrompt = e;
      $('installBanner').classList.remove('hidden');
    });

    $('installBtn').addEventListener('click', function () {
      if (S.installPrompt) {
        S.installPrompt.prompt();
        S.installPrompt.userChoice.then(function () {
          S.installPrompt = null;
          $('installBanner').classList.add('hidden');
        });
      }
    });

    $('installDismiss').addEventListener('click', function () {
      $('installBanner').classList.add('hidden');
    });
  }

  /* ═══════════ APP ICONS ═══════════ */
  function generateAppIcons() {
    try {
      var sizes = [192, 512];
      var icons = [];

      sizes.forEach(function (size) {
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Emoji
        ctx.font = (size * 0.5) + 'px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🛴', size / 2, size / 2);

        var dataUrl = canvas.toDataURL('image/png');
        icons.push({ src: dataUrl, sizes: size + 'x' + size, type: 'image/png' });

        if (size === 192) {
          $('appIconLink').href = dataUrl;
          $('appleTouchIcon').href = dataUrl;
        }
      });

      // Create manifest
      var manifest = {
        name: 'Катим в школу',
        short_name: 'Катим!',
        start_url: '.',
        display: 'standalone',
        background_color: '#E8F5E9',
        theme_color: '#2E7D32',
        icons: icons
      };

      var blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
      $('manifestLink').href = URL.createObjectURL(blob);
    } catch (e) { /* canvas not supported */ }
  }

  /* ═══════════ SERVICE WORKER ═══════════ */
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () { });
    }
  }

  /* ═══════════ INIT ═══════════ */
  function init() {
    loadData();
    generateAppIcons();
    initMap();
    initGeolocation();
    buildMarkerGrid();
    bindUI();
    renderPlaces();
    renderStats();
    applySettings();
    registerSW();

    // Load voices
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = function () {
        S._voicesLoaded = true;
      };
      // Trigger voices load
      window.speechSynthesis.getVoices();
    }

    // Welcome
    if (!localStorage.getItem('katim_launched')) {
      localStorage.setItem('katim_launched', '1');
      setTimeout(function () {
        toast('Добро пожаловать в «Катим в школу»! 🛴');
        speak('Добро пожаловать в приложение Катим в школу!');
      }, 1000);
    }

    // Show map elements by default
    switchTab('map');
  }

  // Start app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
