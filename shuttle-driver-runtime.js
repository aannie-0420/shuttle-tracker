(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./shuttle-v2-core.js")
    : root.ShuttleV2Core;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShuttleDriverRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  const STORAGE_KEY = "shuttle_archive_queue_v2";
  const LEASE_STALE_MS = 60 * 1000;

  function sameOwner(left, right) {
    return core.isSameOwner(left, right);
  }

  function taipeiDateKey(timestamp) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function readPending(storage) {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      return value && Array.isArray(value.pendingPoints) ? value.pendingPoints : [];
    } catch (error) {
      return [];
    }
  }

  function createDriverRuntime(options) {
    const adapter = options.adapter;
    const storage = options.storage;
    const identity = { ...options.identity };
    const now = options.now || Date.now;
    let selectedType = null;
    let currentOwner = null;
    let generation = 0;
    let pendingPoints = readPending(storage);
    let lastBatch = null;

    function persistPending() {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ pendingPoints }));
        return true;
      } catch (error) {
        return false;
      }
    }

    async function claimVehicle(type, { takeoverConfirmed = false } = {}) {
      const claimedAt = now();
      let decision = null;
      const transaction = await adapter.transactVehicle(type, current => {
        decision = core.evaluateVehicleClaim({
          current,
          claimant: identity,
          serverNow: claimedAt,
          staleMs: LEASE_STALE_MS,
          takeoverConfirmed
        });
        if (!decision.allowed) return undefined;
        return {
          ...(current || {}),
          owner: { ...identity },
          ownerSessionId: identity.sessionId,
          ownerDeviceId: identity.deviceId,
          ownerTabId: identity.tabId,
          heartbeatAt: claimedAt,
          status: "online"
        };
      });

      if (!transaction.committed) {
        const value = transaction.value || {};
        const owner = value.owner || (decision && decision.owner) || null;
        return {
          ok: false,
          reason: "occupied",
          owner,
          heartbeatAgeMs: Math.max(0, claimedAt - Number(value.heartbeatAt || 0))
        };
      }

      selectedType = type;
      currentOwner = transaction.value.owner || { ...identity };
      generation += 1;
      return { ok: true, reason: decision ? decision.reason : "claimed", type };
    }

    function handleVehicleSnapshot(type, value) {
      if (type !== selectedType) return;
      currentOwner = value && value.owner ? { ...value.owner } : null;
      if (!sameOwner(currentOwner, identity)) generation += 1;
    }

    function canWriteLive(type) {
      return type === selectedType && sameOwner(currentOwner, identity);
    }

    async function releaseOwnedVehicle(reason) {
      if (!selectedType) return { released: false, reason: "not-selected" };
      const type = selectedType;
      const releasedAt = now();
      const transaction = await adapter.transactVehicle(type, current => {
        if (!sameOwner(current && current.owner, identity)) return undefined;
        return {
          ...(current || {}),
          owner: null,
          ownerSessionId: null,
          ownerDeviceId: null,
          ownerTabId: null,
          heartbeatAt: releasedAt,
          status: "offline",
          stopStatus: null,
          etaStatus: null,
          releaseReason: reason
        };
      });

      generation += 1;
      selectedType = null;
      currentOwner = null;
      if (!transaction.committed) return { released: false, reason: "ownership-lost" };
      return { released: true, reason };
    }

    async function heartbeat() {
      if (!selectedType || !canWriteLive(selectedType)) {
        return { updated: false, reason: "not-owner" };
      }
      await adapter.updateVehicle(selectedType, {
        owner: { ...identity },
        heartbeatAt: now(),
        status: "online"
      });
      return { updated: true };
    }

    function queueArchivePoint(point) {
      pendingPoints.push({ ...point });
      persistPending();
      return pendingPoints.length;
    }

    async function flushArchive(batchId) {
      const type = selectedType || (lastBatch && lastBatch.type);
      if (!type) return { uploaded: false, reason: "missing-type" };
      if (lastBatch && lastBatch.batchId === batchId && pendingPoints.length === 0) {
        return { uploaded: true, path: lastBatch.path, count: 0, reused: true };
      }
      const timestamp = now();
      const path = core.buildArchivePath({
        date: taipeiDateKey(timestamp),
        type,
        sessionId: identity.sessionId,
        batchId
      });
      const payload = {
        batchId,
        type,
        sessionId: identity.sessionId,
        deviceId: identity.deviceId,
        uploadedAt: timestamp,
        points: pendingPoints.map(point => ({ ...point }))
      };
      await adapter.writeArchive(path, payload);
      lastBatch = { batchId, type, path };
      pendingPoints = [];
      persistPending();
      return { uploaded: true, path, count: payload.points.length };
    }

    function createAsyncToken() {
      return {
        type: selectedType,
        sessionId: identity.sessionId,
        generation
      };
    }

    function acceptAsyncToken(token) {
      return Boolean(
        token &&
        token.type === selectedType &&
        token.sessionId === identity.sessionId &&
        token.generation === generation &&
        canWriteLive(token.type)
      );
    }

    function getState() {
      return {
        selectedType,
        currentOwner: currentOwner ? { ...currentOwner } : null,
        generation,
        pendingPoints: pendingPoints.map(point => ({ ...point }))
      };
    }

    return {
      claimVehicle,
      handleVehicleSnapshot,
      canWriteLive,
      releaseOwnedVehicle,
      heartbeat,
      queueArchivePoint,
      flushArchive,
      createAsyncToken,
      acceptAsyncToken,
      getState
    };
  }

  return { createDriverRuntime, STORAGE_KEY, LEASE_STALE_MS };
});
