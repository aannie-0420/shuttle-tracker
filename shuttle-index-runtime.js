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

  function candidate(type, data, source, { now, schedules } = {}) {
    const arrival = finiteMinutes(
      source === "google" ? data.etaToCampus : data.routeEtaToCampus,
      true
    );
    let commute = finiteMinutes(
      source === "google" ? data.totalCommute : data.routeTotalCommute,
      true
    );
    if (arrival === null || commute === null) return null;

    const stopStatus = data.stopStatus || data.terminalStatus || null;
    let nextSchedule = null;
    if (stopStatus === "atCampus" || stopStatus === "campus" || stopStatus === "campusReady") {
      nextSchedule = nextScheduleForType(type, schedules, now || Date.now());
      // 園區待發必須有仍可搭乘的下一班，否則不把已結束班次的車列入比較。
      if (!nextSchedule) return null;
      const campusToA8 = finiteMinutes(data.campusToA8, true);
      const rideMinutes = campusToA8 === null ? commute : campusToA8;
      commute = nextSchedule.waitMinutes + rideMinutes;
    }

    return {
      type,
      arrivalMinutes: arrival,
      commuteMinutes: commute,
      state: stopStatus || data.etaStatus || data.direction || "unknown",
      source,
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

    let source = "route";
    if (online.length === 1) {
      source = online[0].data.googleCycleStatus === "success" ? "google" : "route";
    } else {
      source = core.chooseEtaComparisonSource({
        small: {
          status: small.googleCycleStatus,
          cycleId: small.googleCycleId
        },
        medium: {
          status: medium.googleCycleStatus,
          cycleId: medium.googleCycleId
        }
      });
    }

    let candidates = online
      .map(item => candidate(item.type, item.data, source, { now, schedules }))
      .filter(Boolean);
    if (candidates.length === 0 && source === "google") {
      source = "route";
      candidates = online
        .map(item => candidate(item.type, item.data, source, { now, schedules }))
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

  return { selectIndexVehicle, readScheduleEntries, isOnline, GPS_STALE_MS };
});
