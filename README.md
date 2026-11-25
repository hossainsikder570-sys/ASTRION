# ASTRION Discord Bot

ASTRION is a Discord.js v14 bot with Riffy/Lavalink music playback and consent-based voice recording. Playback state and recording metadata use local storage; no database is required.

## Music features

- Search and play tracks and playlists from sources enabled by the connected Lavalink node
- YouTube and Spotify links when the node has compatible source plugins configured
- Play, pause, resume, skip, stop, previous track, and now playing
- Queue display, loop modes, shuffle, autoplay, volume, track removal, and queue clearing
- Voice-channel permission checks and player controls
- Application-emoji player controls, using only emojis fetched from this bot application

The player message has two rows of gray secondary buttons. If the application has no matching custom emojis, controls remain available with text labels only.

## Voice recording

The top-level `/record`, `/pause`, `/resume`, `/cancel`, `/save`, `/history`, and `/delete` commands manage recordings. Command replies are ephemeral. Starting a recording requires Manage Server or Manage Channels permission, and ASTRION posts a visible notice before asking every current participant for private consent. Audio is not subscribed until a participant accepts; later arrivals must consent separately, and a participant can withdraw at any time. Participants whose DMs are closed are excluded.

Recording uses separate consented-speaker tracks and a mixed MP3 at 48 kHz / 128 kbps. The maximum duration is 60 minutes; bitrate, sample rate, retention, upload threshold, and storage limits are set in the recording configuration. Reports display Bangladesh Time (Asia/Dhaka). Completed files and metadata are kept in `data/recordings` with restrictive local permissions and a second local copy; Docker Compose mounts a persistent local volume. Retention is 90 days.

This is local storage only, not encrypted off-host backup. No external file-storage integration is configured. Files over the conservative Discord upload threshold remain local and are not shared through public links. Discord voice receive support is not an officially supported high-level Discord API, so test carefully in your deployment before relying on recordings.

## Configuration

Copy `.env.example` to `.env`, then set `DISCORD_TOKEN` and `CLIENT_ID`. Set the four Lavalink values to the connection details you provide:

```env
LAVALINK_HOST=
LAVALINK_PORT=
LAVALINK_PASSWORD=
LAVALINK_SECURE=
```

`LAVALINK_SECURE` accepts `true` or `false`. The bot does not contain a fallback host, port, password, public node list, or Lavalink server credentials. Playback stays unavailable until valid Lavalink settings are provided. Credentials are never included in logs or Discord responses.

The Lavalink node determines the available audio sources and formats. YouTube and Spotify playback therefore depend on the plugins and source configuration of that node.

## Run

Use Node.js 26 or later. Install the project dependencies with your package manager and start the bot with `npm start`. In Docker, configure `.env` and start the bot service with Docker Compose. The small HTTP health endpoint is operational only; it is not a user-facing bot feature.
