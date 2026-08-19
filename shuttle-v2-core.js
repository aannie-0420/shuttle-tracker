(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShuttleV2Core = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TAIPEI_TIME_ZONE = "Asia/Taipei";
  const VALID_DIRECTIONS = new Set(["toA8", "toAdvantech", "unknown"]);

  function taipeiParts(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TAIPEI_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short"
    }).formatToParts(date);
    return Object.fromEntries(parts.map(part => [part.type, part.value]));
  }

  function isPeakTrackingTime(dateInput) {
    const parts = taipeiParts(dateInput);
    const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
    return seconds >= 17 * 3600 && seconds < 19 * 3600;
  }

  function isGoogleEtaTime(dateInput) {
    if (!isPeakTrackingTime(dateInput)) return false;
    const weekday = taipeiParts(dateInput).weekday;
    return weekday !== "Sat" && weekday !== "Sun";
  }

  function calculateScheduledCommute({ now, fixedRideMinutes, schedules }) {
    const parts = taipeiParts(now);
    const nowSeconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
    const candidates = (Array.isArray(schedules) ? schedules : [])
      .filter(item => item && /^\d{2}:\d{2}$/.test(item.time || ""))
      .map(item => {
        const [hour, minute] = item.time.split(":").map(Number);
        return { ...item, departureSeconds: hour * 3600 + minute * 60 };
      })
      .filter(item => item.departureSeconds >= nowSeconds)
      .sort((a, b) => a.departureSeconds - b.departureSeconds);

    if (candidates.length === 0) return { status: "finished" };
    const next = candidates[0];
    const waitMinutes = Math.ceil((next.departureSeconds - nowSeconds) / 60);
    return {
      status: "available",
      type: next.type,
      departure: next.time,
      waitMinutes,
      commuteMinutes: waitMinutes + Number(fixedRideMinutes || 0),
      doesNotStopA8: next.servesA8 === false
    };
  }

  function calculateWalkMinutes({ heavyRain } = {}) {
    return heavyRain === true ? 25 : 20;
  }

  function chooseCommuteRecommendation({ commuteMinutes, walkMinutes }) {
    return Number(commuteMinutes) > Number(walkMinutes) ? "walk" : "bus";
  }

  function calculateVehicleEta(input) {
    const a8ToCampus = Number(input.a8ToCampus);
    const campusToA8 = Number(input.campusToA8);
    if (input.state === "toA8") {
      const arrivalMinutes = Number(input.currentToA8) + a8ToCampus;
      // 車輛已前往 A8，乘客下一次可搭乘時間要等它返回園區再前往 A8。
      return {
        arrivalMinutes,
        commuteMinutes: Number(input.currentToA8) + a8ToCampus + campusToA8
      };
    }
    if (input.state === "toCampus" || input.state === "toAdvantech") {
      const arrivalMinutes = Number(input.currentToCampus);
      return { arrivalMinutes, commuteMinutes: arrivalMinutes + campusToA8 };
    }
    if (input.state === "atA8") {
      return { arrivalMinutes: a8ToCampus, commuteMinutes: a8ToCampus + campusToA8 };
    }
    if (input.state === "atCampus") {
      return { arrivalMinutes: 0, commuteMinutes: campusToA8 };
    }
    if (input.state === "nearCampus") {
      return { arrivalMinutes: 1, commuteMinutes: 1 + campusToA8 };
    }
    return null;
  }

  function projectPointToPolyline(lat, lng, points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const cumulative = [0];
    for (let i = 1; i < points.length; i += 1) {
      cumulative.push(cumulative[i - 1] + distanceMeters(
        { lat: points[i - 1][0], lng: points[i - 1][1] },
        { lat: points[i][0], lng: points[i][1] }
      ));
    }
    let best = null;
    const latitudeScale = 111320;
    const longitudeScale = Math.cos(lat * Math.PI / 180) * 111320;
    for (let i = 0; i < points.length - 1; i += 1) {
      const ax = (points[i][1] - lng) * longitudeScale;
      const ay = (points[i][0] - lat) * latitudeScale;
      const bx = (points[i + 1][1] - lng) * longitudeScale;
      const by = (points[i + 1][0] - lat) * latitudeScale;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared))
        : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const segmentLength = cumulative[i + 1] - cumulative[i];
      const candidate = {
        distance: Math.sqrt(px * px + py * py),
        progress: cumulative[i] + t * segmentLength,
        total: cumulative[cumulative.length - 1]
      };
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    return best;
  }

  function estimateRouteEta(input) {
    const matching = (Array.isArray(input.routes) ? input.routes : [])
      .filter(route => route && route.direction === input.state)
      .map(route => projectPointToPolyline(Number(input.lat), Number(input.lng), route.points))
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);
    const match = matching[0];
    const maxDistance = Number(input.maxRouteDistanceMeters ?? 70);
    if (!match || !Number.isFinite(match.total) || match.total <= 0 ||
        !Number.isFinite(match.distance) || match.distance > maxDistance) return null;

    const remainingRatio = Math.max(0, Math.min(1, (match.total - match.progress) / match.total));
    const campusToA8 = Number(input.campusToA8Minutes);
    const a8ToCampus = Number(input.a8ToCampusMinutes);
    if (!Number.isFinite(campusToA8) || !Number.isFinite(a8ToCampus)) return null;
    const legBaseline = input.state === "toA8" ? campusToA8 : a8ToCampus;
    const currentLegMinutes = Math.max(1, Math.round(legBaseline * remainingRatio));
    const model = input.state === "toA8"
      ? calculateVehicleEta({
          state: "toA8",
          currentToA8: currentLegMinutes,
          a8ToCampus,
          campusToA8
        })
      : calculateVehicleEta({
          state: "toAdvantech",
          currentToCampus: currentLegMinutes,
          a8ToCampus,
          campusToA8
        });
    return model ? { source: "route", currentLegMinutes, ...model } : null;
  }

  function selectFastestVehicle(candidates) {
    const valid = (Array.isArray(candidates) ? candidates : [])
      .filter(candidate =>
        candidate &&
        Number.isFinite(candidate.arrivalMinutes) &&
        Number.isFinite(candidate.commuteMinutes)
      )
      .sort((a, b) =>
        a.commuteMinutes - b.commuteMinutes ||
        a.arrivalMinutes - b.arrivalMinutes ||
        String(a.type).localeCompare(String(b.type))
      );
    return valid.length ? { ...valid[0] } : null;
  }

  function buildEtaCycleId(dateInput) {
    const parts = taipeiParts(dateInput);
    const secondsOfDay =
      Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
    const slotStart = Math.floor(secondsOfDay / 90) * 90;
    const hour = String(Math.floor(slotStart / 3600)).padStart(2, "0");
    const minute = String(Math.floor((slotStart % 3600) / 60)).padStart(2, "0");
    const second = String(slotStart % 60).padStart(2, "0");
    return `${parts.year}${parts.month}${parts.day}-${hour}${minute}${second}`;
  }

  function chooseEtaComparisonSource({ small, medium }) {
    if (
      small && medium &&
      small.status === "success" &&
      medium.status === "success" &&
      small.cycleId &&
      small.cycleId === medium.cycleId
    ) return "google";
    return "coordinate";
  }

  function vehiclesDueForEtaCycle(vehicles) {
    return (Array.isArray(vehicles) ? vehicles : [])
      .filter(vehicle => vehicle && vehicle.online === true && vehicle.gpsFresh === true)
      .map(vehicle => vehicle.type);
  }

  function isEtaCycleDue({ lastAttemptAt, now, intervalMs }) {
    return !Number.isFinite(lastAttemptAt) || Number(now) - Number(lastAttemptAt) >= Number(intervalMs);
  }

  function getEtaDisplaySource({ lastSuccessAt, now, hasCoordinateEstimate }) {
    if (Number.isFinite(lastSuccessAt) && Number(now) - Number(lastSuccessAt) <= 5 * 60 * 1000) {
      return "google-updating";
    }
    return hasCoordinateEstimate ? "coordinate" : "unavailable";
  }

  function getSharedTrafficRetryPlan({ hasCachedSuccess, failedAttempts }) {
    const attempts = Math.max(0, Number(failedAttempts) || 0);
    const shouldRetry = hasCachedSuccess !== true && attempts < 3;
    return {
      shouldRetry,
      useFallback: !shouldRetry
    };
  }

  function estimateMonthlyElements(input) {
    const dynamicPerVehicle = Math.ceil(input.serviceMinutesPerDay * 60 / input.vehicleIntervalSeconds);
    const dynamicPerDay = dynamicPerVehicle * input.vehicleCount;
    const fixedPerDay =
      Math.ceil(input.serviceMinutesPerDay / input.fixedSegmentIntervalMinutes) *
      input.fixedSegmentElementsPerCycle;
    const totalPerDay = dynamicPerDay + fixedPerDay;
    const totalPerMonth = totalPerDay * input.workdays;
    return {
      dynamicPerDay,
      fixedPerDay,
      totalPerDay,
      totalPerMonth,
      freeCapRemaining: 5000 - totalPerMonth
    };
  }

  function buildEtaCyclePath(cycleId, type) {
    return `etaCycles/${cycleId}/${type}`;
  }

  function buildEtaCycleRecord(input) {
    return {
      type: input.type,
      cycleId: input.cycleId,
      sessionId: input.sessionId,
      deviceId: input.deviceId,
      queriedAt: input.queriedAt,
      status: input.status,
      etaToCampus: input.etaToCampus,
      totalCommute: input.totalCommute
    };
  }

  function isLeaseStale({ heartbeatAt, serverNow, staleMs }) {
    return !Number.isFinite(heartbeatAt) || Number(serverNow) - Number(heartbeatAt) >= Number(staleMs);
  }

  function isSameOwner(left, right) {
    return Boolean(
      left && right &&
      left.sessionId === right.sessionId &&
      left.deviceId === right.deviceId &&
      left.tabId === right.tabId
    );
  }

  function evaluateVehicleClaim({ current, claimant, serverNow, staleMs, takeoverConfirmed }) {
    const owner = current && current.owner;
    if (!owner) return { allowed: true, reason: "free", owner: claimant };
    if (isSameOwner(owner, claimant)) return { allowed: true, reason: "same-owner", owner: claimant };
    if (isLeaseStale({ heartbeatAt: current.heartbeatAt, serverNow, staleMs })) {
      return { allowed: true, reason: "stale", owner: claimant };
    }
    if (takeoverConfirmed) return { allowed: true, reason: "takeover", owner: claimant };
    return { allowed: false, reason: "occupied", owner };
  }

  function canMutateLiveVehicle({ actor, currentOwner }) {
    return isSameOwner(actor, currentOwner);
  }

  function buildArchivePath({ date, type, sessionId, batchId }) {
    return `archive/${date}/${type}/${sessionId}/${batchId}`;
  }

  function archiveRetryDelayMs(attempt) {
    return [30000, 60000, 120000][attempt] || 300000;
  }

  function shouldAcceptAsyncResult(input) {
    return Boolean(
      input.trackingActive &&
      input.requestSessionId === input.currentSessionId &&
      input.requestGeneration === input.currentGeneration &&
      isSameOwner(input.actor, input.currentOwner)
    );
  }

  function allowedWriteScopes({ actor, currentOwner, hasPendingArchive }) {
    const scopes = [];
    if (canMutateLiveVehicle({ actor, currentOwner })) scopes.push("live");
    if (hasPendingArchive) scopes.push("archive");
    return scopes;
  }

  function canCommitSelection({ selectionToken, latestSelectionToken, claimSucceeded }) {
    return claimSucceeded === true && selectionToken === latestSelectionToken;
  }

  function isGpsFresh({ gpsUpdatedAt, now, staleMs }) {
    return Number.isFinite(gpsUpdatedAt) && Number(now) - Number(gpsUpdatedAt) < Number(staleMs);
  }

  function distanceMeters(a, b) {
    const radius = 6371000;
    const toRadians = value => value * Math.PI / 180;
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const deltaLat = toRadians(b.lat - a.lat);
    const deltaLng = toRadians(b.lng - a.lng);
    const value =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  // Google ETA 無法取得時的保守座標估算；加入道路繞行係數，避免直線距離過度低估。
  function estimateCoordinateMinutes({ origin, destination, speedKph = 25, roadFactor = 1.35 } = {}) {
    if (!origin || !destination) return null;
    const distance = distanceMeters(origin, destination);
    const speed = Number(speedKph);
    const factor = Number(roadFactor);
    if (!Number.isFinite(distance) || !Number.isFinite(speed) || speed <= 0 ||
        !Number.isFinite(factor) || factor <= 0) return null;
    return Math.max(1, Math.ceil((distance * factor / 1000) / speed * 60));
  }

  function shouldAcceptDirectionSample({ previous, next, minMoveMeters = 2, maxAccuracy = 80 }) {
    if (!next || !Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return false;
    if (Number(next.accuracy) > Number(maxAccuracy)) return false;
    if (!previous) return true;
    if (Number(next.timestamp) <= Number(previous.timestamp)) return false;
    return distanceMeters(previous, next) >= Number(minMoveMeters);
  }

  function normalizeGoogleEtaResult({ status, attemptedAt }) {
    if (status === "OK") return { ok: true, attemptedAt, retryImmediately: false, status };
    return { ok: false, attemptedAt, retryImmediately: false, status };
  }

  function normalizeVehiclePayload(payload) {
    const etaToCampus = Number(payload && payload.etaToCampus);
    const totalCommute = Number(payload && payload.totalCommute);
    const direction = payload && payload.direction;
    if (
      !payload ||
      payload.status !== "online" ||
      !Number.isFinite(etaToCampus) ||
      !Number.isFinite(totalCommute) ||
      !VALID_DIRECTIONS.has(direction)
    ) {
      return {
        status: "updating",
        etaToCampus: null,
        totalCommute: null,
        direction: "unknown"
      };
    }
    return {
      ...payload,
      etaToCampus,
      totalCommute,
      owner: payload.owner || null,
      cycleId: payload.cycleId || null,
      etaStatus: payload.etaStatus || null
    };
  }

  function nextPollAction({ hidden, activeTimerCount, cacheExpired }) {
    if (hidden) return { action: "stop", desiredTimerCount: 0 };
    return {
      action: cacheExpired ? "fetch-once-and-reschedule" : "reschedule",
      desiredTimerCount: 1
    };
  }

  function classifyRouteMatch({ nearestDistanceMeters, maxRouteDistanceMeters }) {
    if (Number(nearestDistanceMeters) > Number(maxRouteDistanceMeters)) {
      return { onRoute: false, direction: "unknown", etaSource: null };
    }
    return { onRoute: true };
  }

  function isPlausibleGpsMovement({ distanceMeters: meters, elapsedMs, maxSpeedKph }) {
    if (Number(elapsedMs) <= 0) return false;
    const speedKph = (Number(meters) / (Number(elapsedMs) / 1000)) * 3.6;
    return speedKph <= Number(maxSpeedKph);
  }

  function updateDirectionInTurnZone(input) {
    if (input.inTurnZone) {
      return {
        direction: input.stableDirection || "unknown",
        collectEvidence: false
      };
    }
    const ready = Number(input.distinctExitPoints) >= 2 && Number(input.exitProgressMeters) >= 20;
    return {
      direction: ready ? (input.candidateDirection || input.stableDirection || "unknown") : (input.stableDirection || "unknown"),
      collectEvidence: ready
    };
  }

  function recoverArchiveQueue({ persistedText, memoryQueue }) {
    try {
      const persisted = JSON.parse(persistedText || "[]");
      return {
        queue: [...(Array.isArray(memoryQueue) ? memoryQueue : []), ...(Array.isArray(persisted) ? persisted : [])],
        storageStatus: "ok",
        dataLossWarning: false
      };
    } catch (error) {
      return {
        queue: Array.isArray(memoryQueue) ? memoryQueue : [],
        storageStatus: "corrupt",
        dataLossWarning: true
      };
    }
  }

  return {
    isPeakTrackingTime,
    isGoogleEtaTime,
    calculateScheduledCommute,
    calculateWalkMinutes,
    chooseCommuteRecommendation,
    calculateVehicleEta,
    estimateRouteEta,
    selectFastestVehicle,
    buildEtaCycleId,
    chooseEtaComparisonSource,
    vehiclesDueForEtaCycle,
    isEtaCycleDue,
    getEtaDisplaySource,
    getSharedTrafficRetryPlan,
    estimateMonthlyElements,
    buildEtaCyclePath,
    buildEtaCycleRecord,
    isLeaseStale,
    isSameOwner,
    evaluateVehicleClaim,
    canMutateLiveVehicle,
    buildArchivePath,
    archiveRetryDelayMs,
    shouldAcceptAsyncResult,
    allowedWriteScopes,
    canCommitSelection,
    isGpsFresh,
    estimateCoordinateMinutes,
    shouldAcceptDirectionSample,
    normalizeGoogleEtaResult,
    normalizeVehiclePayload,
    nextPollAction,
    classifyRouteMatch,
    isPlausibleGpsMovement,
    updateDirectionInTurnZone,
    recoverArchiveQueue,
    distanceMeters
  };
});
