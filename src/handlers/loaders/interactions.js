import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '../../utils/logger.js';

const loaderDirectory = fileURLToPath(new URL('.', import.meta.url));

async function collectButtonFiles(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectButtonFiles(entryPath, files);
    } else if (entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }
  return files;
}

export default async function loadInteractions(client) {
  const buttonsDirectory = join(loaderDirectory, '../../interactions/buttons');
  const files = await collectButtonFiles(buttonsDirectory);

  for (const filePath of files) {
    const loaded = await import(pathToFileURL(filePath).href);
    const definitions = Array.isArray(loaded.default) ? loaded.default : [loaded.default];

    for (const button of definitions) {
      if (!button?.name || typeof button.execute !== 'function') {
        logger.warn('Skipped an invalid music button handler.');
        continue;
      }
      client.buttons.set(button.name, button);
    }
  }

  logger.info(`Loaded ${client.buttons.size} music button handler(s).`);
}
