import musicButtonHandler from '../../../handlers/musicButtons.js';
import { MUSIC_BUTTON_IDS } from '../../../services/music/musicEmbeds.js';

const buttonIds = Object.values(MUSIC_BUTTON_IDS);

export default buttonIds.map((name) => ({
  name,
  execute: musicButtonHandler.execute,
}));
