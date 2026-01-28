import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Twitch Bot
  twitch: {
    botUsername: process.env.TWITCH_BOT_USERNAME || '',
    oauthToken: process.env.TWITCH_OAUTH_TOKEN || '',
    channel: process.env.TWITCH_CHANNEL || '',
    clientId: process.env.TWITCH_CLIENT_ID || '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
  },

  // Web Dashboard
  web: {
    port: parseInt(process.env.WEB_PORT || '3000', 10),
    secret: process.env.WEB_SECRET || 'change-me-in-production',
  },

  // Text-to-Speech
  tts: {
    enabled: process.env.TTS_ENABLED === 'true',
    language: process.env.TTS_LANGUAGE || 'de',
    speed: parseFloat(process.env.TTS_SPEED || '1.0'),
    volume: parseFloat(process.env.TTS_VOLUME || '0.8'),
  },

  // Song Request
  songRequest: {
    enabled: process.env.SONGREQUEST_ENABLED === 'true',
    maxDuration: parseInt(process.env.SONGREQUEST_MAX_DURATION || '600', 10),
    maxQueue: parseInt(process.env.SONGREQUEST_MAX_QUEUE || '50', 10),
  },

  // Bot
  commandPrefix: process.env.COMMAND_PREFIX || '!',
};

export function validateConfig(): boolean {
  const errors: string[] = [];

  if (!config.twitch.botUsername) {
    errors.push('TWITCH_BOT_USERNAME is required');
  }
  if (!config.twitch.oauthToken) {
    errors.push('TWITCH_OAUTH_TOKEN is required');
  }
  if (!config.twitch.channel) {
    errors.push('TWITCH_CHANNEL is required');
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  return true;
}
