import 'dotenv/config';
import { createServer } from 'node:http';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { loadCommands, registerCommands } from './handlers/loaders/commandLoader.js';
import { initializeMusic } from './services/music/riffySetup.js';
import { shutdownMusic } from './services/music/playerHandler.js';
import { shutdownRecordings } from './services/recording/recordingManager.js';
import { logger, shutdownLog, startupLog } from './utils/logger.js';

class AstrionMusicBot extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.shuttingDown = false;
    this.startupStage = 'configuration';
  }

  async start() {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;

    if (!token || !clientId) {
      throw new Error('DISCORD_TOKEN and CLIENT_ID must be configured.');
    }

    startupLog('Starting ASTRION Discord bot.');
    this.startupStage = 'health-server';
    this.startHealthServer();
    this.startupStage = 'command-loading';
    await loadCommands(this);
    this.startupStage = 'event-loading';
    await this.loadHandlers();
    this.startupStage = 'music-initialization';
    initializeMusic(this);
    this.startupStage = 'discord-login';
    await this.login(token);
    this.startupStage = 'slash-command-registration';
    await registerCommands(this, { clientId });
    this.startupStage = 'ready';
    startupLog('Slash commands registered.');
  }

  startHealthServer() {
    const port = Number(process.env.PORT || 3000);
    const host = process.env.WEB_HOST || '0.0.0.0';

    this.webServer = createServer((request, response) => {
      const pathname = request.url?.split('?')[0];
      const isHealthRoute = pathname === '/' || pathname === '/health';
      const isReadyRoute = pathname === '/ready';

      if (!isHealthRoute && !isReadyRoute) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const ready = this.isReady();
      const statusCode = isReadyRoute && !ready ? 503 : 200;
      response.writeHead(statusCode, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: ready ? 'ready' : 'starting',
        musicConfigured: Boolean(this.riffy),
        commandCount: this.commands.size,
        uptimeSeconds: Math.floor(process.uptime()),
      }));
    });

    this.webServer.on('error', (error) => {
      logger.error('Health server failed.', { code: error?.code || 'UNKNOWN' });
    });
    this.webServer.listen(port, host, () => {
      startupLog(`Health endpoint listening on ${host}:${port}.`);
    });
  }

  async loadHandlers() {
    for (const handlerName of ['events', 'interactions']) {
      const module = await import(`./handlers/loaders/${handlerName}.js`);
      await module.default(this);
    }
  }

  async shutdown(reason = 'UNKNOWN') {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    shutdownLog(`Stopping ASTRION music bot (${reason}).`);

    try {
      await shutdownRecordings(this);
      await shutdownMusic(this);
      if (this.webServer?.listening) {
        await new Promise((resolve) => this.webServer.close(resolve));
      }
      this.destroy();
    } catch (error) {
      logger.error('Error during bot shutdown.', { name: error?.name, code: error?.code });
    }

    process.exit(0);
  }
}

const bot = new AstrionMusicBot();

process.once('SIGINT', () => void bot.shutdown('SIGINT'));
process.once('SIGTERM', () => void bot.shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught process exception.', { name: error?.name, code: error?.code });
  void bot.shutdown('UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection.', {
    name: reason?.name,
    code: reason?.code,
  });
});

bot.start().catch((error) => {
  logger.error('Bot startup failed.', { stage: bot.startupStage, name: error?.name, code: error?.code });
  void bot.shutdown('STARTUP_ERROR');
});

export default AstrionMusicBot;
