import Dispatcher from "@moonlight-mod/wp/discord/Dispatcher";
import spacepack from "@moonlight-mod/wp/spacepack_spacepack";

const logger = moonlight.getLogger("arRPC");

// --- Asset Lookup Utilities ---
let fetchAssetIds: any = null;

async function lookupAsset(applicationId: string, key: string): Promise<string> {
  // Lazy lookup: only find the module when we actually need to look up an asset
  if (!fetchAssetIds) {
    const ApplicationAssetUtils = spacepack.findByCode("getAssetImage: size must === [")[0];
    if (ApplicationAssetUtils) {
      fetchAssetIds = spacepack.findFunctionByStrings(ApplicationAssetUtils.exports, '.startsWith("http:")', ".dispatch({");
    }
  }

  if (!fetchAssetIds) return "";

  try {
    // @ts-expect-error - Internal function call
    const assets = await fetchAssetIds(applicationId, [key]);
    return assets && assets[0] ? assets[0] : "";
  } catch (e) {
    return "";
  }
}

// --- Application Info Lookup ---
let fetchApplicationsRPC: any = null;
const apps: Record<string, any> = {};

async function lookupApp(applicationId: string): Promise<any> {
  // Lazy lookup: only find the module when we need to fetch app details
  if (!fetchApplicationsRPC) {
    const RPCModule = spacepack.findByCode('"Invalid Origin"', ".application")[0];
    if (RPCModule) {
      fetchApplicationsRPC = spacepack.findFunctionByStrings(RPCModule.exports, '"Invalid Origin"', ".application");
    }
  }

  if (!fetchApplicationsRPC) return null;

  const socket: any = {};
  try {
    // This internal function simulates an RPC request and populates the 'socket' object
    // @ts-expect-error - Internal function call
    await fetchApplicationsRPC(socket, applicationId);
    return socket.application;
  } catch (e) {
    logger.warn("Failed to lookup app info", e);
    return null;
  }
}

// --- WebSocket & Event Handling ---
let ws: WebSocket | null = null;
let retryTimeout: any = null;

const handleEvent = async (e: MessageEvent) => {
  try {
    const data = JSON.parse(e.data);
    const { activity } = data;

    if (activity) {
      const assets = activity.assets;
      
      // Resolve asset images (mp:external/...) to real URLs
      if (assets?.large_image) {
        assets.large_image = await lookupAsset(activity.application_id, assets.large_image);
      }
      if (assets?.small_image) {
        assets.small_image = await lookupAsset(activity.application_id, assets.small_image);
      }

      // Resolve application name if missing
      const appId = activity.application_id;
      if (appId) {
        if (!apps[appId]) {
          apps[appId] = await lookupApp(appId);
        }
        const app = apps[appId];
        if (app) {
          activity.name ||= app.name;
        }
      }
    }

    Dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", ...data });
  } catch (err) {
    logger.error("Failed to handle arRPC message", err);
  }
};

const connect = () => {
  if (ws) {
    ws.onclose = null; // Prevent overlapping retry loops
    ws.close();
    ws = null;
  }
  if (retryTimeout) clearTimeout(retryTimeout);

  logger.info("Connecting to arRPC (ws://127.0.0.1:1337)...");
  ws = new WebSocket("ws://127.0.0.1:1337");

  ws.onopen = () => {
    logger.info("Connected to arRPC");
  };

  ws.onmessage = handleEvent;

  ws.onclose = () => {
    logger.info("Disconnected from arRPC, retrying in 5s...");
    ws = null;
    retryTimeout = setTimeout(connect, 5000);
  };
};

const stop = () => {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (retryTimeout) clearTimeout(retryTimeout);
  Dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null });
};

// Subscribe to connection open to start the loop
Dispatcher.subscribe("CONNECTION_OPEN", connect);

// Attempt to connect immediately (handles hot-reloading or if already connected)
connect();
