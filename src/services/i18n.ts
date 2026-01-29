/**
 * Internationalization (i18n) Service
 *
 * Features:
 * - Multi-language support
 * - Dynamic language switching
 * - Fallback to default language
 * - Interpolation support
 */

import { Logger } from '../utils/logger';
import { getDatabase } from './Database';

// Language definitions
interface TranslationSet {
  [key: string]: string | TranslationSet;
}

interface LanguagePack {
  name: string;
  nativeName: string;
  translations: TranslationSet;
}

// German (default)
const de: LanguagePack = {
  name: 'German',
  nativeName: 'Deutsch',
  translations: {
    common: {
      yes: 'Ja',
      no: 'Nein',
      on: 'An',
      off: 'Aus',
      enabled: 'aktiviert',
      disabled: 'deaktiviert',
      success: 'Erfolg',
      error: 'Fehler',
      notFound: 'Nicht gefunden',
      noPermission: 'Keine Berechtigung',
      cooldown: 'Bitte warte {time}',
      invalidInput: 'Ungültige Eingabe',
    },
    points: {
      balance: '{user} hat {amount} {currency}!',
      notEnough: 'Du hast nicht genug {currency}!',
      transferred: '{user} hat {amount} {currency} an {target} gegeben!',
      won: 'GEWONNEN! {user} hat {amount} {currency} gewonnen!',
      lost: 'Verloren! {user} hat {amount} {currency} verloren.',
    },
    games: {
      duel: {
        challenge: '{user} fordert {target} zu einem Duell um {amount} Punkte heraus! !accept zum Annehmen',
        accepted: 'Duell angenommen! {user} vs {target}',
        won: '{winner} gewinnt das Duell gegen {loser} und erhält {amount} Punkte!',
        declined: '{user} hat das Duell abgelehnt',
      },
      heist: {
        started: 'ÜBERFALL! {user} plant einen Überfall! !heist <punkte> zum Mitmachen ({time}s)',
        joined: '{user} macht beim Überfall mit! ({count} Teilnehmer)',
        success: 'Der Überfall war erfolgreich! {winners} Gewinner teilen sich {amount} Punkte!',
        failed: 'Der Überfall ist fehlgeschlagen! Alle Punkte verloren!',
      },
      slots: {
        spinning: '{user} dreht die Slots...',
        won: 'JACKPOT! {user} gewinnt {amount} Punkte! {symbols}',
        lost: 'Keine Übereinstimmung. {user} verliert {amount} Punkte. {symbols}',
      },
    },
    moderation: {
      timeout: '{user} wurde für {duration} Sekunden getimeoutet',
      banned: '{user} wurde gebannt',
      warning: 'Warnung: {reason}',
    },
    welcome: {
      newChatter: 'Willkommen im Stream, {user}! Viel Spaß!',
      returning: 'Willkommen zurück, {user}!',
      vip: 'VIP {user} ist da! Willkommen!',
      sub: 'Sub {user} ist da! Willkommen zurück!',
    },
    lurk: {
      started: '{user} ist jetzt im Lurk-Modus! Bis später!',
      ended: 'Willkommen zurück, {user}! Du hast {time} gelurkt!',
    },
    shop: {
      purchased: '{user} hat {item} für {cost} Punkte gekauft!',
      notEnoughPoints: 'Nicht genug Punkte! ({have}/{need})',
      outOfStock: 'Dieses Item ist ausverkauft!',
    },
  },
};

// English
const en: LanguagePack = {
  name: 'English',
  nativeName: 'English',
  translations: {
    common: {
      yes: 'Yes',
      no: 'No',
      on: 'On',
      off: 'Off',
      enabled: 'enabled',
      disabled: 'disabled',
      success: 'Success',
      error: 'Error',
      notFound: 'Not found',
      noPermission: 'No permission',
      cooldown: 'Please wait {time}',
      invalidInput: 'Invalid input',
    },
    points: {
      balance: '{user} has {amount} {currency}!',
      notEnough: "You don't have enough {currency}!",
      transferred: '{user} gave {amount} {currency} to {target}!',
      won: 'WON! {user} won {amount} {currency}!',
      lost: 'Lost! {user} lost {amount} {currency}.',
    },
    games: {
      duel: {
        challenge: '{user} challenges {target} to a duel for {amount} points! !accept to join',
        accepted: 'Duel accepted! {user} vs {target}',
        won: '{winner} wins the duel against {loser} and gets {amount} points!',
        declined: '{user} declined the duel',
      },
      heist: {
        started: 'HEIST! {user} is planning a heist! !heist <points> to join ({time}s)',
        joined: '{user} joined the heist! ({count} participants)',
        success: 'The heist was successful! {winners} winners share {amount} points!',
        failed: 'The heist failed! All points lost!',
      },
      slots: {
        spinning: '{user} is spinning the slots...',
        won: 'JACKPOT! {user} wins {amount} points! {symbols}',
        lost: 'No match. {user} loses {amount} points. {symbols}',
      },
    },
    moderation: {
      timeout: '{user} has been timed out for {duration} seconds',
      banned: '{user} has been banned',
      warning: 'Warning: {reason}',
    },
    welcome: {
      newChatter: 'Welcome to the stream, {user}! Have fun!',
      returning: 'Welcome back, {user}!',
      vip: 'VIP {user} is here! Welcome!',
      sub: 'Sub {user} is here! Welcome back!',
    },
    lurk: {
      started: '{user} is now lurking! See you later!',
      ended: 'Welcome back, {user}! You lurked for {time}!',
    },
    shop: {
      purchased: '{user} purchased {item} for {cost} points!',
      notEnoughPoints: 'Not enough points! ({have}/{need})',
      outOfStock: 'This item is out of stock!',
    },
  },
};

// Spanish
const es: LanguagePack = {
  name: 'Spanish',
  nativeName: 'Español',
  translations: {
    common: {
      yes: 'Sí',
      no: 'No',
      on: 'Encendido',
      off: 'Apagado',
      enabled: 'activado',
      disabled: 'desactivado',
      success: 'Éxito',
      error: 'Error',
      notFound: 'No encontrado',
      noPermission: 'Sin permiso',
      cooldown: 'Por favor espera {time}',
      invalidInput: 'Entrada inválida',
    },
    points: {
      balance: '¡{user} tiene {amount} {currency}!',
      notEnough: '¡No tienes suficientes {currency}!',
      transferred: '¡{user} dio {amount} {currency} a {target}!',
      won: '¡GANASTE! ¡{user} ganó {amount} {currency}!',
      lost: '¡Perdiste! {user} perdió {amount} {currency}.',
    },
    welcome: {
      newChatter: '¡Bienvenido al stream, {user}! ¡Diviértete!',
      returning: '¡Bienvenido de nuevo, {user}!',
    },
  },
};

// Available languages
const languages: Map<string, LanguagePack> = new Map([
  ['de', de],
  ['en', en],
  ['es', es],
]);

class I18nService {
  private currentLanguage: string = 'de';
  private logger = new Logger('i18n');

  constructor() {
    this.loadLanguage();
  }

  private loadLanguage(): void {
    try {
      const db = getDatabase();
      const saved = db.getSetting<string>('language', 'de');
      if (languages.has(saved)) {
        this.currentLanguage = saved;
      }
    } catch {
      // Database not ready yet
    }
  }

  /**
   * Get a translation by key path (e.g., 'points.balance')
   */
  t(key: string, vars?: Record<string, string | number>): string {
    const lang = languages.get(this.currentLanguage) || languages.get('de')!;
    let result = this.getNestedValue(lang.translations, key);

    // Fallback to German if not found
    if (!result && this.currentLanguage !== 'de') {
      result = this.getNestedValue(languages.get('de')!.translations, key);
    }

    // Fallback to key if still not found
    if (!result) {
      this.logger.warn(`Missing translation: ${key}`);
      return key;
    }

    // Interpolate variables
    if (vars) {
      for (const [varKey, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{${varKey}\\}`, 'g'), String(value));
      }
    }

    return result;
  }

  private getNestedValue(obj: TranslationSet, path: string): string | null {
    const keys = path.split('.');
    let current: any = obj;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }

    return typeof current === 'string' ? current : null;
  }

  /**
   * Set the current language
   */
  setLanguage(code: string): boolean {
    if (!languages.has(code)) {
      return false;
    }

    this.currentLanguage = code;

    try {
      const db = getDatabase();
      db.setSetting('language', code);
    } catch {
      // Database not ready
    }

    this.logger.info(`Language set to: ${code}`);
    return true;
  }

  /**
   * Get current language code
   */
  getLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * Get all available languages
   */
  getAvailableLanguages(): { code: string; name: string; nativeName: string }[] {
    return Array.from(languages.entries()).map(([code, pack]) => ({
      code,
      name: pack.name,
      nativeName: pack.nativeName,
    }));
  }

  /**
   * Add a custom language pack
   */
  addLanguage(code: string, pack: LanguagePack): void {
    languages.set(code, pack);
    this.logger.info(`Added language: ${code}`);
  }

  /**
   * Add translations to existing language
   */
  extendLanguage(code: string, translations: TranslationSet): void {
    const existing = languages.get(code);
    if (existing) {
      existing.translations = this.deepMerge(existing.translations, translations);
    }
  }

  private deepMerge(target: TranslationSet, source: TranslationSet): TranslationSet {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(
          (target[key] as TranslationSet) || {},
          source[key] as TranslationSet
        );
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}

// Singleton instance
let i18nInstance: I18nService | null = null;

export function getI18n(): I18nService {
  if (!i18nInstance) {
    i18nInstance = new I18nService();
  }
  return i18nInstance;
}

// Shorthand for translation
export function t(key: string, vars?: Record<string, string | number>): string {
  return getI18n().t(key, vars);
}

export { I18nService };
