/**
 * Custom Commands Plugin
 *
 * Features:
 * - Create custom text commands
 * - Variable support: $(user), $(target), $(count), $(random), etc.
 * - Permission levels
 * - Cooldowns
 * - Use count tracking
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission, CommandContext } from '../../types/plugins';
import { getDatabase, DatabaseService, DBCommand } from '../../services/Database';
import { v4 as uuidv4 } from 'uuid';

// Variable parser
interface VariableContext {
  user: string;
  displayName: string;
  target: string;
  args: string[];
  channel: string;
  count: number;
}

export class CustomCommandsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'custom-commands',
    version: '1.0.0',
    description: 'Custom text commands with variables',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private cooldowns: Map<string, Map<string, number>> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Custom Commands...');

    // Register management commands
    this.registerManagementCommands();

    this.log.info('Custom Commands initialized!');
  }

  /**
   * Check if a message matches a custom command
   * Called by the command system
   */
  async handleCustomCommand(ctx: CommandContext): Promise<boolean> {
    const cmd = this.db.getCommand(ctx.command);

    if (!cmd || !cmd.enabled) {
      return false; // Not a custom command
    }

    // Check permission
    if (!this.hasPermission(ctx, cmd.permission)) {
      return false;
    }

    // Check cooldown
    if (!this.checkCooldown(ctx.command, ctx.user.username, cmd.cooldown_user, cmd.cooldown_global)) {
      return false;
    }

    // Parse variables and send response
    const response = this.parseVariables(cmd.response, {
      user: ctx.user.username,
      displayName: ctx.user.displayName,
      target: ctx.args[0]?.replace('@', '') || ctx.user.displayName,
      args: ctx.args,
      channel: ctx.channel,
      count: cmd.use_count + 1,
    });

    ctx.reply(response);

    // Increment use count
    this.db.incrementCommandUsage(ctx.command);

    return true;
  }

  private hasPermission(ctx: CommandContext, permission: string): boolean {
    switch (permission.toLowerCase()) {
      case 'everyone':
        return true;
      case 'subscriber':
        return ctx.user.isSub || ctx.user.isVip || ctx.user.isMod || ctx.user.isBroadcaster;
      case 'vip':
        return ctx.user.isVip || ctx.user.isMod || ctx.user.isBroadcaster;
      case 'moderator':
        return ctx.user.isMod || ctx.user.isBroadcaster;
      case 'broadcaster':
        return ctx.user.isBroadcaster;
      default:
        return true;
    }
  }

  private checkCooldown(command: string, username: string, userCd: number, globalCd: number): boolean {
    const now = Date.now();

    if (!this.cooldowns.has(command)) {
      this.cooldowns.set(command, new Map());
    }

    const cmdCooldowns = this.cooldowns.get(command)!;

    // Check global cooldown
    if (globalCd > 0) {
      const globalLast = cmdCooldowns.get('__global__') || 0;
      if (now - globalLast < globalCd * 1000) {
        return false;
      }
    }

    // Check user cooldown
    if (userCd > 0) {
      const userLast = cmdCooldowns.get(username) || 0;
      if (now - userLast < userCd * 1000) {
        return false;
      }
    }

    // Update cooldowns
    cmdCooldowns.set('__global__', now);
    cmdCooldowns.set(username, now);

    return true;
  }

  /**
   * Parse variables in command response
   */
  private parseVariables(text: string, context: VariableContext): string {
    return text
      // Basic variables
      .replace(/\$\(user\)/gi, context.user)
      .replace(/\$\(displayname\)/gi, context.displayName)
      .replace(/\$\(name\)/gi, context.displayName)
      .replace(/\$\(target\)/gi, context.target)
      .replace(/\$\(touser\)/gi, context.target)
      .replace(/\$\(channel\)/gi, context.channel)
      .replace(/\$\(count\)/gi, context.count.toString())

      // Args
      .replace(/\$\(1\)/g, context.args[0] || '')
      .replace(/\$\(2\)/g, context.args[1] || '')
      .replace(/\$\(3\)/g, context.args[2] || '')
      .replace(/\$\(args\)/gi, context.args.join(' '))

      // Random number
      .replace(/\$\(random(?:\s+(\d+))?(?:-(\d+))?\)/gi, (_, min, max) => {
        const minNum = parseInt(min) || 1;
        const maxNum = parseInt(max) || 100;
        return Math.floor(Math.random() * (maxNum - minNum + 1) + minNum).toString();
      })

      // Random choice
      .replace(/\$\(pick\s+([^)]+)\)/gi, (_, choices) => {
        const options = choices.split('|').map((s: string) => s.trim());
        return options[Math.floor(Math.random() * options.length)];
      })

      // Uppercase/lowercase
      .replace(/\$\(upper\s+([^)]+)\)/gi, (_, text) => text.toUpperCase())
      .replace(/\$\(lower\s+([^)]+)\)/gi, (_, text) => text.toLowerCase())

      // Time
      .replace(/\$\(time\)/gi, new Date().toLocaleTimeString('de-DE'))
      .replace(/\$\(date\)/gi, new Date().toLocaleDateString('de-DE'));
  }

  private registerManagementCommands(): void {
    // !addcmd - Add a custom command
    this.registerCommand({
      name: 'addcmd',
      aliases: ['addcommand', 'newcmd'],
      description: 'Add a custom command',
      usage: '!addcmd <name> <response>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !addcmd <name> <antwort>');
          return;
        }

        const name = ctx.args[0].toLowerCase().replace('!', '');
        const response = ctx.args.slice(1).join(' ');

        // Check if command exists
        if (this.db.getCommand(name)) {
          ctx.reply(`❌ Command !${name} existiert bereits. Benutze !editcmd zum Bearbeiten.`);
          return;
        }

        // Create command
        this.db.createCommand(uuidv4(), name, response);

        ctx.reply(`✅ Command !${name} erstellt!`);
      },
    });

    // !editcmd - Edit a custom command
    this.registerCommand({
      name: 'editcmd',
      aliases: ['editcommand', 'updatecmd'],
      description: 'Edit a custom command',
      usage: '!editcmd <name> <new response>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !editcmd <name> <neue antwort>');
          return;
        }

        const name = ctx.args[0].toLowerCase().replace('!', '');
        const response = ctx.args.slice(1).join(' ');

        if (!this.db.getCommand(name)) {
          ctx.reply(`❌ Command !${name} existiert nicht.`);
          return;
        }

        this.db.updateCommand(name, { response });

        ctx.reply(`✅ Command !${name} aktualisiert!`);
      },
    });

    // !delcmd - Delete a custom command
    this.registerCommand({
      name: 'delcmd',
      aliases: ['delcommand', 'removecmd', 'rmcmd'],
      description: 'Delete a custom command',
      usage: '!delcmd <name>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !delcmd <name>');
          return;
        }

        const name = ctx.args[0].toLowerCase().replace('!', '');

        if (!this.db.getCommand(name)) {
          ctx.reply(`❌ Command !${name} existiert nicht.`);
          return;
        }

        this.db.deleteCommand(name);

        ctx.reply(`✅ Command !${name} gelöscht!`);
      },
    });

    // !cmdinfo - Get info about a command
    this.registerCommand({
      name: 'cmdinfo',
      description: 'Get info about a custom command',
      usage: '!cmdinfo <name>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !cmdinfo <name>');
          return;
        }

        const name = ctx.args[0].toLowerCase().replace('!', '');
        const cmd = this.db.getCommand(name);

        if (!cmd) {
          ctx.reply(`❌ Command !${name} existiert nicht.`);
          return;
        }

        ctx.reply(
          `📋 !${name}: Benutzt ${cmd.use_count}x | ` +
          `CD: ${cmd.cooldown_user}s (user) ${cmd.cooldown_global}s (global) | ` +
          `Perm: ${cmd.permission} | ${cmd.enabled ? '✅ Aktiv' : '❌ Deaktiviert'}`
        );
      },
    });

    // !togglecmd - Enable/disable a command
    this.registerCommand({
      name: 'togglecmd',
      description: 'Enable or disable a custom command',
      usage: '!togglecmd <name>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !togglecmd <name>');
          return;
        }

        const name = ctx.args[0].toLowerCase().replace('!', '');
        const cmd = this.db.getCommand(name);

        if (!cmd) {
          ctx.reply(`❌ Command !${name} existiert nicht.`);
          return;
        }

        this.db.updateCommand(name, { enabled: !cmd.enabled });

        ctx.reply(`✅ Command !${name} ist jetzt ${!cmd.enabled ? 'aktiviert' : 'deaktiviert'}.`);
      },
    });

    // !setcooldown - Set command cooldown
    this.registerCommand({
      name: 'setcooldown',
      aliases: ['setcd'],
      description: 'Set cooldown for a custom command',
      usage: '!setcooldown <name> <user_seconds> [global_seconds]',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !setcooldown <name> <user_sekunden> [global_sekunden]');
          return;
        }

        const name = ctx.args[0].toLowerCase().replace('!', '');
        const userCd = parseInt(ctx.args[1]);
        const globalCd = parseInt(ctx.args[2]) || 0;

        if (!this.db.getCommand(name)) {
          ctx.reply(`❌ Command !${name} existiert nicht.`);
          return;
        }

        if (isNaN(userCd) || userCd < 0) {
          ctx.reply('❌ Ungültiger Cooldown-Wert.');
          return;
        }

        this.db.updateCommand(name, {
          cooldown_user: userCd,
          cooldown_global: globalCd,
        });

        ctx.reply(`✅ Cooldown für !${name}: ${userCd}s (user), ${globalCd}s (global)`);
      },
    });

    // !setperm - Set command permission
    this.registerCommand({
      name: 'setperm',
      aliases: ['setpermission'],
      description: 'Set permission for a custom command',
      usage: '!setperm <name> <everyone|subscriber|vip|moderator|broadcaster>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !setperm <name> <everyone|subscriber|vip|moderator|broadcaster>');
          return;
        }

        const name = ctx.args[0].toLowerCase().replace('!', '');
        const perm = ctx.args[1].toLowerCase();

        if (!this.db.getCommand(name)) {
          ctx.reply(`❌ Command !${name} existiert nicht.`);
          return;
        }

        const validPerms = ['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'];
        if (!validPerms.includes(perm)) {
          ctx.reply('❌ Ungültige Permission. Optionen: everyone, subscriber, vip, moderator, broadcaster');
          return;
        }

        this.db.updateCommand(name, { permission: perm });

        ctx.reply(`✅ Permission für !${name}: ${perm}`);
      },
    });

    // !listcmds - List all custom commands
    this.registerCommand({
      name: 'listcmds',
      aliases: ['listcommands', 'customcmds'],
      description: 'List all custom commands',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const commands = this.db.getAllCommands();

        if (commands.length === 0) {
          ctx.reply('📋 Keine Custom Commands vorhanden.');
          return;
        }

        const list = commands
          .map(c => `!${c.name}${c.enabled ? '' : ' (off)'}`)
          .join(', ');

        ctx.reply(`📋 Custom Commands (${commands.length}): ${list}`);
      },
    });

    // !variables - Show available variables
    this.registerCommand({
      name: 'variables',
      aliases: ['vars'],
      description: 'Show available command variables',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        ctx.reply(
          '📝 Variablen: $(user) $(displayname) $(target) $(channel) $(count) ' +
          '$(1) $(2) $(3) $(args) $(random 1-100) $(pick a|b|c) $(time) $(date)'
        );
      },
    });
  }

  // Public API
  getCustomCommands(): DBCommand[] {
    return this.db.getAllCommands();
  }

  createCommand(name: string, response: string, options?: Partial<DBCommand>): DBCommand {
    return this.db.createCommand(uuidv4(), name, response, options);
  }
}
