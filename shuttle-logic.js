(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShuttleLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function finiteMinutes(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function calculateEtaModel(input) {
    const state = input && input.state;
    const currentToA8 = finiteMinutes(input && input.currentToA8);
    const currentToCampus = finiteMinutes(input && input.currentToCampus);
    const a8ToCampus = finiteMinutes(input && input.a8ToCampus);
    const campusToA8 = finiteMinutes(input && input.campusToA8);

    if (state === 'toA8' && currentToA8 !== null && a8ToCampus !== null && campusToA8 !== null) {
      return {
        etaToCampus: currentToA8 + a8ToCampus,
        // 車輛已前往 A8，乘客下一次可搭乘時間要等它返回園區再前往 A8。
        totalCommute: currentToA8 + a8ToCampus + campusToA8
      };
    }
    if (state === 'toAdvantech' && currentToCampus !== null && campusToA8 !== null) {
      return {
        etaToCampus: currentToCampus,
        totalCommute: currentToCampus + campusToA8
      };
    }
    if (state === 'atA8' && a8ToCampus !== null && campusToA8 !== null) {
      return {
        etaToCampus: a8ToCampus,
        totalCommute: a8ToCampus + campusToA8
      };
    }
    if (state === 'atCampus' && campusToA8 !== null) {
      return { etaToCampus: 0, totalCommute: campusToA8 };
    }
    return null;
  }

  function isNewGpsFix(previousTimestamp, fix) {
    const timestamp = Number(fix && fix.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
    if (previousTimestamp === null || previousTimestamp === undefined) return true;
    return timestamp > Number(previousTimestamp);
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    const radius = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function prepareRoute(route) {
    const cumulative = [0];
    for (let i = 1; i < route.points.length; i++) {
      cumulative.push(cumulative[i - 1] + distanceMeters(
        route.points[i - 1][0], route.points[i - 1][1],
        route.points[i][0], route.points[i][1]
      ));
    }
    return { ...route, cumulative };
  }

  function projectToRoute(lat, lng, route) {
    const latScale = 111320;
    const lngScale = 111320 * Math.cos(lat * Math.PI / 180);
    let best = { distance: Infinity, progress: 0 };

    for (let i = 0; i < route.points.length - 1; i++) {
      const a = route.points[i];
      const b = route.points[i + 1];
      const ax = (a[1] - lng) * lngScale;
      const ay = (a[0] - lat) * latScale;
      const dx = (b[1] - a[1]) * lngScale;
      const dy = (b[0] - a[0]) * latScale;
      const squared = dx * dx + dy * dy;
      const t = squared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / squared)) : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const distance = Math.hypot(px, py);
      if (distance < best.distance) {
        const segmentLength = route.cumulative[i + 1] - route.cumulative[i];
        best = { distance, progress: route.cumulative[i] + t * segmentLength };
      }
    }
    return best;
  }

  class DirectionTracker {
    constructor(options) {
      const settings = options || {};
      this.routes = (settings.routes || []).map(prepareRoute);
      this.minMoveMeters = settings.minMoveMeters || 4;
      this.maxAccuracy = settings.maxAccuracy || 50;
      this.maxRouteDistance = settings.maxRouteDistance || 70;
      this.initialEvidenceCount = settings.initialEvidenceCount || 3;
      this.reverseEvidenceCount = settings.reverseEvidenceCount || 4;
      this.minProgressMeters = settings.minProgressMeters || 12;
      this.turnZones = settings.turnZones || [];
      this.turnExitMinPoints = settings.turnExitMinPoints || 2;
      this.turnExitMinProgress = settings.turnExitMinProgress || 20;
      this.direction = 'unknown';
      this.lastFix = null;
      this.lastProjections = null;
      this.candidateDirection = null;
      this.candidateCount = 0;
      this.candidateProgress = 0;
      this.wasInTurnZone = false;
      this.turnExitPoints = 0;
      this.turnExitProgress = 0;
    }

    force(direction) {
      this.direction = direction;
      this.candidateDirection = null;
      this.candidateCount = 0;
      this.candidateProgress = 0;
      return this.direction;
    }

    addFix(fix) {
      if (!fix || Number(fix.accuracy) > this.maxAccuracy) return this.direction;
      if (this.lastFix && distanceMeters(this.lastFix.lat, this.lastFix.lng, fix.lat, fix.lng) < this.minMoveMeters) {
        return this.direction;
      }

      const projections = {};
      for (const route of this.routes) projections[route.name] = projectToRoute(fix.lat, fix.lng, route);
      const inTurnZone = this.turnZones.some(zone =>
        distanceMeters(fix.lat, fix.lng, zone.lat, zone.lng) <= Number(zone.radiusMeters || 0)
      );
      const movedMeters = this.lastFix
        ? distanceMeters(this.lastFix.lat, this.lastFix.lng, fix.lat, fix.lng)
        : 0;

      if (inTurnZone) {
        this.wasInTurnZone = true;
        this.turnExitPoints = 0;
        this.turnExitProgress = 0;
        this.candidateDirection = null;
        this.candidateCount = 0;
        this.candidateProgress = 0;
        this.lastFix = { lat: fix.lat, lng: fix.lng, timestamp: fix.timestamp };
        this.lastProjections = projections;
        return this.direction;
      }

      if (this.wasInTurnZone) {
        this.turnExitPoints += 1;
        this.turnExitProgress += movedMeters;
        this.lastFix = { lat: fix.lat, lng: fix.lng, timestamp: fix.timestamp };
        this.lastProjections = projections;
        if (this.turnExitPoints >= this.turnExitMinPoints &&
            this.turnExitProgress >= this.turnExitMinProgress) {
          this.wasInTurnZone = false;
          this.turnExitPoints = 0;
          this.turnExitProgress = 0;
        }
        return this.direction;
      }

      if (this.lastProjections) {
        const evidence = [];
        for (const route of this.routes) {
          const previous = this.lastProjections[route.name];
          const current = projections[route.name];
          const progress = current.progress - previous.progress;
          if (previous.distance <= this.maxRouteDistance && current.distance <= this.maxRouteDistance &&
              progress >= 2 && progress <= 150) {
            evidence.push({ direction: route.direction, progress, score: progress - current.distance * 0.08 });
          }
        }
        evidence.sort((a, b) => b.score - a.score);
        if (evidence.length && evidence[0].score > 0) this.acceptEvidence(evidence[0]);
      }

      this.lastFix = { lat: fix.lat, lng: fix.lng, timestamp: fix.timestamp };
      this.lastProjections = projections;
      return this.direction;
    }

    acceptEvidence(evidence) {
      if (evidence.direction === this.direction) {
        this.candidateDirection = null;
        this.candidateCount = 0;
        this.candidateProgress = 0;
        return;
      }
      if (evidence.direction !== this.candidateDirection) {
        this.candidateDirection = evidence.direction;
        this.candidateCount = 0;
        this.candidateProgress = 0;
      }
      this.candidateCount += 1;
      this.candidateProgress += evidence.progress;
      const required = this.direction === 'unknown' ? this.initialEvidenceCount : this.reverseEvidenceCount;
      if (this.candidateCount >= required && this.candidateProgress >= this.minProgressMeters) {
        this.force(this.candidateDirection);
      }
    }
  }

  return { calculateEtaModel, isNewGpsFix, DirectionTracker, distanceMeters };
});

