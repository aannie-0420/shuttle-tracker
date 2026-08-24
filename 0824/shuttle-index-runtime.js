(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./shuttle-v2-core.js")
    : root.ShuttleV2Core;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShuttleIndexRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  const GPS_STALE_MS = 60 * 1000;

  function isOnline(data, now) {
    return Boolean(
      data &&
      data.status === "online" &&
      core.isGpsFresh({
        gpsUpdatedAt: Number(data.gpsUpdatedAt),
        now: Number(now),
        staleMs: GPS_STALE_MS
      })
    );
  }

  function finiteMinutes(value, allowZero = false) {
    const number = Number(value);
    if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) return null;
    return Math.round(number);
  }

  function readScheduleEntries(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    const groups = [
      { type: "small", selector: "#schedule-small-col .schedule-item" },
      { type: "medium", selector: "#schedule-medium-col .schedule-item" }
    ];
    return groups.flatMap(group =>
      Array.from(root.querySelectorAll(group.selector))
        .map(item => {
          const time = item.getAttribute("data-time");
          const notes = typeof item.querySelectorAll === "function"
            ? Array.from(item.querySelectorAll(".bus-note"))
            : [];
          const doesNotStopA8 = notes.some(note =>
            String(note.textContent || "").trim() === "不停A8"
          );
          return {
            type: group.type,
            time,
            servesA8: !doesNotStopA8
          };
        })
        .filter(item => /^\d{2}:\d{2}$/.test(item.time || ""))
    );
  }

  function nextScheduleForType(type, schedules, now) {
    const result = core.calculateScheduledCommute({
      now,
      fixedRideMinutes: 0,
      schedules: (Array.isArray(schedules) ? schedules : [])
        .filter(item => item && item.type === type)
    });
    return result.status === "available" ? result : null;
  }

  function scheduledCandidate(type, schedules, now) {
    const next = nextScheduleForType(type, schedules, now);
    if (!next) return null;
    const commute = next.waitMinutes + 7;
    return {
      type,
      arrivalMinutes: commute,
      commuteMinutes: commute,
      state: "scheduled",
      source: "schedule",
      doesNotStopA8: Boolean(next.doesNotStopA8)
    };
  }

  const GOOGLE_STALE_MS = 5 * 60 * 1000;
  // Driver 每 90 秒完成一輪 Google ETA；GPS 每 2 秒更新，不應因這段落差立即捨棄成功 ETA。
  const GOOGLE_GPS_ALIGNMENT_MS = 90 * 1000;

  function hasFreshGoogleEta(data, now) {
    if (!data || data.googleCycleStatus !== "success") return false;
    const updatedAt = Number(data.googleUpdatedAt);
    // 舊資料沒有 googleUpdatedAt 時維持相容；新資料則必須檢查有效期限。
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return true;
    if (Number(now) - updatedAt > GOOGLE_STALE_MS) return false;
    const googleGpsAt = Number(data.googleGpsUpdatedAt);
    const gpsAt = Number(data.gpsUpdatedAt);
    return !Number.isFinite(googleGpsAt) || !Number.isFinite(gpsAt) ||
      Math.abs(gpsAt - googleGpsAt) <= GOOGLE_GPS_ALIGNMENT_MS;
  }

  function hasFreshCoordinateEstimate(data) {
    if (!data) return false;
    const coordinateAt = Number(data.coordinateUpdatedAt);
    const gpsAt = Number(data.gpsUpdatedAt);
    return Number.isFinite(coordinateAt) && Number.isFinite(gpsAt) && coordinateAt >= gpsAt &&
      finiteMinutes(data.coordinateEtaToCampus, true) !== null &&
      finiteMinutes(data.coordinateTotalCommute, true) !== null;
  }

  function calculateLiveCommute(data, source) {
    if (source === "coordinate") {
      return finiteMinutes(data.coordinateTotalCommute, true);
    }
    const fallback = finiteMinutes(data.totalCommute, true);
    const state = data.stopStatus || data.terminalStatus || data.direction || data.etaStatus;
    const currentToA8 = finiteMinutes(data.currentToA8, true);
    const currentToCampus = finiteMinutes(data.currentToCampus, true);
    const a8ToCampus = finiteMinutes(data.a8ToCampus, true);
    const campusToA8 = finiteMinutes(data.campusToA8, true);

    if (state === "toA8" && currentToA8 !== null &&
        a8ToCampus !== null && campusToA8 !== null) {
      return currentToA8 + a8ToCampus + campusToA8;
    }
    if ((state === "toAdvantech" || state === "toCampus") &&
        currentToCampus !== null && campusToA8 !== null) {
      return currentToCampus + campusToA8;
    }
    if (state === "atA8" && a8ToCampus !== null && campusToA8 !== null) {
      return a8ToCampus + campusToA8;
    }
    if ((state === "atCampus" || state === "campus" || state === "campusReady") &&
        campusToA8 !== null) {
      return campusToA8;
    }
    return fallback;
  }

  function candidate(type, data, source, { now, schedules } = {}) {
    const effectiveSource = source === "google" && data.routeStatus !== "offRoute" && hasFreshGoogleEta(data, now)
      ? "google"
      : "coordinate";
    const stopStatus = data.stopStatus || data.terminalStatus || null;
    if ((stopStatus === "atCampus" || stopStatus === "campus" || stopStatus === "campusReady") &&
        effectiveSource === "coordinate" && !hasFreshCoordinateEstimate(data)) {
      return scheduledCandidate(type, schedules, now || Date.now());
    }
    if (effectiveSource === "coordinate" && !hasFreshCoordinateEstimate(data)) return null;
    const arrival = finiteMinutes(
      effectiveSource === "google" ? data.etaToCampus : data.coordinateEtaToCampus,
      true
    );
    let commute = calculateLiveCommute(data, effectiveSource);
    if (arrival === null || commute === null) return null;

    let nextSchedule = null;
    if (stopStatus === "atCampus" || stopStatus === "campus" || stopStatus === "campusReady") {
      nextSchedule = nextScheduleForType(type, schedules, now || Date.now());
      // 園區待發必須有仍可搭乘的下一班，否則不把已結束班次的車列入比較。
      if (!nextSchedule) return null;
      const campusToA8 = finiteMinutes(
        effectiveSource === "coordinate" ? data.coordinateTotalCommute : data.campusToA8,
        true
      );
      const rideMinutes = campusToA8 === null ? commute : campusToA8;
      commute = nextSchedule.waitMinutes + rideMinutes;
    }

    return {
      type,
      arrivalMinutes: arrival,
      commuteMinutes: commute,
      state: stopStatus || data.etaStatus || data.direction || "unknown",
      source: effectiveSource,
      doesNotStopA8: Boolean(nextSchedule && nextSchedule.doesNotStopA8)
    };
  }

  function selectIndexVehicle({ small, medium, now = Date.now(), schedules = [] }) {
    const all = [
      { type: "small", data: small },
      { type: "medium", data: medium }
    ];
    const online = all.filter(item => isOnline(item.data, now));
    const offline = all.filter(item => !isOnline(item.data, now));
    if (online.length === 0) {
      const candidates = offline
        .map(item => scheduledCandidate(item.type, schedules, now))
        .filter(Boolean);
      return {
        source: "schedule",
        best: core.selectFastestVehicle(candidates),
        candidates
      };
    }

    let source = "coordinate";
    if (online.length === 1) {
      source = online[0].data.routeStatus !== "offRoute" && hasFreshGoogleEta(online[0].data, now)
        ? "google"
        : "coordinate";
    } else {
      const bothFreshGoogle = online.every(item =>
        item.data.routeStatus !== "offRoute" && hasFreshGoogleEta(item.data, now)
      );
      source = bothFreshGoogle
        ? core.chooseEtaComparisonSource({
            small: { status: small.googleCycleStatus, cycleId: small.googleCycleId },
            medium: { status: medium.googleCycleStatus, cycleId: medium.googleCycleId }
          })
        : "coordinate";
    }

    let candidates = online
      .map(item => candidate(item.type, item.data, source, { now, schedules }))
      .filter(Boolean);
    if (candidates.length === 0 && source === "google") {
      source = "coordinate";
      candidates = online
        .map(item => candidate(item.type, item.data, source, { now, schedules }))
        .filter(Boolean);
    }

    // 即時車雖在線但缺少對應目前GPS的座標估算時，安全退回該車班表。
    if (candidates.length === 0) {
      candidates = online
        .map(item => scheduledCandidate(item.type, schedules, now))
        .filter(Boolean);
    }

    // 一台即時在線、另一台離線時，離線車仍以其下一班班表估算，讓兩者可公平比較。
    candidates = candidates.concat(
      offline
        .map(item => scheduledCandidate(item.type, schedules, now))
        .filter(Boolean)
    );
    return {
      source,
      best: core.selectFastestVehicle(candidates),
      candidates
    };
  }

  return {
    selectIndexVehicle,
    readScheduleEntries,
    isOnline,
    hasFreshGoogleEta,
    hasFreshCoordinateEstimate,
    GPS_STALE_MS,
    GOOGLE_GPS_ALIGNMENT_MS
  };
});
