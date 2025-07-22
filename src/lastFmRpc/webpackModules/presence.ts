import Dispatcher from "@moonlight-mod/wp/discord/Dispatcher";
import { SelfPresenceStore } from "@moonlight-mod/wp/common_stores";
import spacepack from "@moonlight-mod/wp/spacepack_spacepack";

const ApplicationAssetUtils = spacepack.findByCode("getAssetImage: size must === [")[0];
const fetchAssetIds = spacepack.findFunctionByStrings(
  ApplicationAssetUtils.exports,
  '.startsWith("http:")',
  ".dispatch({"
);

interface ActivityAssets {
  large_image?: string;
  large_text?: string;
  small_image?: string;
  small_text?: string;
}

interface ActivityButton {
  label: string;
  url: string;
}

interface Activity {
  state: string;
  details?: string;
  timestamps?: {
    start?: number;
  };
  assets?: ActivityAssets;
  buttons?: Array<string>;
  name: string;
  application_id: string;
  metadata?: {
    button_urls?: Array<string>;
  };
  type: number;
  flags: number;
}

interface TrackData {
  name: string;
  album: string;
  artist: string;
  url: string;
  imageUrl?: string;
}

// only relevant enum values
const enum ActivityType {
  PLAYING = 0,
  LISTENING = 2
}

const enum ActivityFlag {
  INSTANCE = 1 << 0
}

const enum NameFormat {
  StatusName = "status-name",
  ArtistFirst = "artist-first",
  SongFirst = "song-first",
  ArtistOnly = "artist",
  SongOnly = "song",
  AlbumName = "album"
}

const applicationId = "1108588077900898414";
const placeholderId = "2a96cbd8b46e442fc41c2b86b821562f";

const logger = moonlight.getLogger("Last.FM Rich Presence");

const getApplicationAsset = async (key: string): Promise<string> => {
  if (!fetchAssetIds) throw "fetchAssetIds not mapped";
  return (await fetchAssetIds(applicationId, [key]))[0];
};

const getOpt = <T>(name: string): T | undefined => {
  return moonlight.getConfigOption<T>("lastFmRpc", name);
};

const setActivity = (activity: Activity | null) => {
  Dispatcher.dispatch({
    type: "LOCAL_ACTIVITY_UPDATE",
    activity,
    socketId: "LastFM"
  });
};

let updateInterval: NodeJS.Timeout;

const start = () => {
  updatePresence();
  updateInterval = setInterval(updatePresence, 1000 * (getOpt<number>("updateInterval") || 10));
};

const stop = () => {
  clearInterval(updateInterval);
};

const fetchTrackData = async (): Promise<TrackData | null> => {
  const username = getOpt<string>("username");
  const apiKey = getOpt<string>("apiKey");
  if (!username || !apiKey) return null;

  try {
    const params = new URLSearchParams({
      method: "user.getrecenttracks",
      api_key: apiKey,
      user: username,
      limit: "1",
      format: "json"
    });

    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    if (!res.ok) throw `${res.status} ${res.statusText}`;

    const json = await res.json();
    if (json.error) {
      logger.error("Error from Last.fm API", `${json.error}: ${json.message}`);
      return null;
    }

    const trackData = json.recenttracks?.track[0];

    if (!trackData?.["@attr"]?.nowplaying) return null;

    // why does the json api have xml structure
    return {
      name: trackData.name || "Unknown",
      album: trackData.album["#text"],
      artist: trackData.artist["#text"] || "Unknown",
      url: trackData.url,
      imageUrl: trackData.image?.find((x: any) => x.size === "large")?.["#text"]
    };
  } catch (e) {
    logger.error("Failed to query Last.fm API", e);
    // will clear the rich presence if API fails
    return null;
  }
};

const updatePresence = async () => {
  const activity = await getActivity();
  logger.debug("updating with presence:", activity);
  setActivity(activity);
};

const getLargeImage = (track: TrackData): string | undefined => {
  if (track.imageUrl && !track.imageUrl.includes(placeholderId)) return track.imageUrl;

  if (getOpt<string>("missingArt") === "placeholder") return "placeholder";
};

const getActivity = async (): Promise<Activity | null> => {
  if (getOpt<boolean>("hideWithActivity")) {
    if (SelfPresenceStore.getActivities().some((a: { application_id: string }) => a.application_id !== applicationId)) {
      return null;
    }
  }

  if (getOpt<boolean>("hideWithSpotify")) {
    if (
      SelfPresenceStore.getActivities().some(
        (a: { type: ActivityType; application_id: string }) =>
          a.type === ActivityType.LISTENING && a.application_id !== applicationId
      )
    ) {
      // there is already music status because of Spotify or richerCider (probably more)
      return null;
    }
  }

  const trackData = await fetchTrackData();
  if (!trackData) return null;

  const largeImage = getLargeImage(trackData);
  const assets: ActivityAssets = largeImage
    ? {
        large_image: await getApplicationAsset(largeImage),
        large_text: trackData.album || undefined,
        ...(getOpt<boolean>("showLastFmLogo") && {
          small_image: await getApplicationAsset("lastfm-small"),
          small_text: "Last.fm"
        })
      }
    : {
        large_image: await getApplicationAsset("lastfm-large"),
        large_text: trackData.album || undefined
      };

  const buttons: ActivityButton[] = [];

  if (getOpt<boolean>("shareUsername"))
    buttons.push({
      label: "Last.fm Profile",
      url: `https://www.last.fm/user/${getOpt<string>("username")}`
    });

  if (getOpt<boolean>("shareSong"))
    buttons.push({
      label: "View Song",
      url: trackData.url
    });

  const statusName = (() => {
    switch (getOpt<string>("nameFormat")) {
      case NameFormat.ArtistFirst:
        return trackData.artist + " - " + trackData.name;
      case NameFormat.SongFirst:
        return trackData.name + " - " + trackData.artist;
      case NameFormat.ArtistOnly:
        return trackData.artist;
      case NameFormat.SongOnly:
        return trackData.name;
      case NameFormat.AlbumName:
        return trackData.album || getOpt<string>("statusName") || "some music";
      default:
        return getOpt<string>("statusName") || "some music";
    }
  })();

  return {
    application_id: applicationId,
    name: statusName,

    details: trackData.name,
    state: trackData.artist,
    assets,

    buttons: buttons.length ? buttons.map((v) => v.label) : undefined,
    metadata: {
      button_urls: buttons.map((v) => v.url)
    },

    type: getOpt<boolean>("useListeningStatus") ? ActivityType.LISTENING : ActivityType.PLAYING,
    flags: ActivityFlag.INSTANCE
  };
};

Dispatcher.unsubscribe("CONNECTION_OPEN", stop);
Dispatcher.subscribe("CONNECTION_OPEN", start);
