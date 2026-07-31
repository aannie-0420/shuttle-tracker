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

  function candidate(type, data, source) {
    const arrival = finiteMinutes(
      source === "google" ? data.etaToCampus : data.routeEtaToCampus,
      true
    );
    const commute = finiteMinutes(
      source === "google" ? data.totalCommute : data.routeTotalCommute,
      true
    );
    if (arrival === null || commute === null) return null;
    return {
      type,
      arrivalMinutes: arrival,
      commuteMinutes: commute,
      state: data.stopStatus || data.etaStatus || data.direction || "unknown",
      source
    };
  }

  function selectIndexVehicle({ small, medium, now = Date.now() }) {
    const online = [
      { type: "small", data: small },
      { type: "medium", data: medium }
    ].filter(item => isOnline(item.data, now));
    if (online.length === 0) return { source: "none", best: null, candidates: [] };

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
      .map(item => candidate(item.type, item.data, source))
      .filter(Boolean);
    if (candidates.length === 0 && source === "google") {
      source = "route";
      candidates = online
        .map(item => candidate(item.type, item.data, source))
        .filter(Boolean);
    }
    return {
      source,
      best: core.selectFastestVehicle(candidates),
      candidates
    };
  }

  return { selectIndexVehicle, readScheduleEntries, isOnline, GPS_STALE_MS };
});
