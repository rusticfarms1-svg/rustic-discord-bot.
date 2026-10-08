// Rustic Bot — standalone Discord.js conversion of the VibeBot export.
// Generated from the provided rustic bot.json export.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  EmbedBuilder, Collection
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '"1557522097276850207"';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '"1557514059514118235"';
if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, 'data.json');
let store = {};
try { if (fs.existsSync(DATA_FILE)) store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.error('Could not read data.json:', e); }
const writeQueue = [];
let writing = false;
async function persist() {
  return new Promise((resolve, reject) => {
    writeQueue.push({resolve,reject});
    if (writing) return;
    writing = true;
    setImmediate(() => {
      try { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }
      catch (e) { while(writeQueue.length) writeQueue.shift().reject(e); writing=false; return; }
      while(writeQueue.length) writeQueue.shift().resolve();
      writing=false;
    });
  });
}
function key(guildId, id, field) { return `${guildId || 'global'}:${field}:${id}`; }
const botData = {
  async get(id, field, guildId) { return store[key(guildId,id,field)] ?? null; },
  async set(id, field, value, guildId) { const k=key(guildId,id,field); if(value===null || value===undefined) delete store[k]; else store[k]=value; await persist(); return value; },
  async update(id, field, updater, guildId) {
    const k=key(guildId,id,field); const cur=store[k] ?? null;
    const next=await updater(cur);
    if(next===null || next===undefined) delete store[k]; else store[k]=next;
    await persist(); return next;
  }
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember, Partials.Reaction]
});

const __setupCommands = [];
const safeTimeout = (fn, ms) => setTimeout(fn, Math.min(Math.max(0, ms), 2147483647));
const safeInterval = (fn, ms) => setInterval(fn, Math.min(Math.max(1, ms), 2147483647));
const VB_COLORS = { ticket: 0x5865F2, success: 0x57F287, danger: 0xED4245, warning: 0xFEE75C, info: 0x5865F2, primary: 0x5865F2 };
const ownerDiscordId = process.env.OWNER_DISCORD_ID || null;
const VB_OWNER_FREE = false;
function vbCard({color='info', title, lines=[], footer}={}) {
  const c = typeof color === 'number' ? color : (VB_COLORS[color] ?? VB_COLORS.info);
  const e = new EmbedBuilder().setColor(c).setTitle(title || '');
  if (lines?.length) e.setDescription(lines.join('\n'));
  if (footer) e.setFooter({text: footer});
  return { embeds:[e] };
}
function _vbLogChannel(guild, channelId) { return channelId ? guild?.channels?.cache?.get(channelId) : null; }

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (CLIENT_ID) {
    try {
      const rest = new REST({ version:'10' }).setToken(TOKEN);
      const commands = __setupCommands.filter(Boolean);
      if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      else await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log(`Registered ${commands.length} slash command(s).`);
    } catch (e) { console.error('Slash-command registration failed:', e); }
  }
});

client.on('error', e => console.error('[Discord]', e));
process.on('unhandledRejection', e => console.error('[Unhandled rejection]', e));


// ===== Ticket System =====
(async () => {
// Ticket System
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');

// Configuration
const TICKET_CONFIG = {
  "enabled": true,
  "supportRoles": [
    "1557519714660393010"
  ],
  "categories": [
    {
      "id": "support",
      "name": "General Support",
      "emoji": "🎫",
      "description": "Get help with general questions",
      "staffRoles": []
    },
    {
      "id": "feedback",
      "name": "Feedback",
      "emoji": "💡",
      "description": "Share your ideas and suggestions",
      "staffRoles": []
    }
  ],
  "settings": {
    "allowClaiming": true,
    "autoClose": true,
    "autoCloseHours": 48,
    "sendTranscript": true,
    "pingStaff": true,
    "ticketLimit": 1,
    "namingScheme": "number"
  },
  "messages": {
    "panelTitle": "🎫 Support Tickets",
    "panelDescription": "Click a button below to create a ticket. Our team will assist you shortly!",
    "welcomeMessage": "Thank you for creating a ticket! Our support team will be with you shortly.",
    "closeMessage": "This ticket has been closed. A transcript has been saved."
  },
  "panelChannel": "1557519777063374928",
  "transcriptChannel": "1557529984246091836"
};

// Effective staff roles for a ticket CATEGORY. Additive by default — the global support
// team PLUS the category's own staffRoles — so honoring a per-category role never REVOKES
// existing global-staff visibility. When the category is marked private, it's EXCLUSIVE:
// only the category's staffRoles (e.g. a "Mental Health" category routed to just the owner,
// hidden from general staff). Falsy/duplicate role ids are dropped. Shared by ticket
// creation (channel visibility + ping) and the claim/close authorization checks so who can
// SEE a ticket and who can MANAGE it stay in sync.
function _effectiveRoles(category) {
  const _global = ["1557519714660393010"];
  const _cat = (category && Array.isArray(category.staffRoles)) ? category.staffRoles.filter(Boolean) : [];
  if (category && category.private && _cat.length > 0) return [...new Set(_cat)];
  return [...new Set([..._global, ..._cat])];
}

// Helper functions for persistent ticket storage using botData API
async function getTicket(channelId, guildId) {
  return await botData.get(channelId, 'ticket', guildId);
}

async function setTicket(channelId, ticketData, guildId) {
  await botData.set(channelId, 'ticket', ticketData, guildId);
}

async function deleteTicket(channelId, guildId) {
  await botData.set(channelId, 'ticket', null, guildId);
}

// Get ticket counter from guild settings
async function getTicketCounter(guildId) {
  const counter = await botData.get(guildId, 'ticket_counter', guildId);
  // Storage now uses { count: N } (atomic-update format); fall back to
  // raw-number format for old data.
  return (typeof counter === 'number' ? counter : (counter?.count ?? 0));
}

async function incrementTicketCounter(guildId) {
  // Atomic increment — two simultaneous ticket creates would otherwise
  // assign the same number via get-then-set.
  const result = await botData.update(guildId, 'ticket_counter', (cur) => {
    const n = (typeof cur === 'number' ? cur : (cur?.count ?? 0)) + 1;
    return { count: n };
  }, guildId);
  return result?.count ?? 1;
}

// Get all active tickets for a user in a guild
async function getUserTicketCount(userId, guildId) {
  const userTicketCount = await botData.get(userId, 'ticket_count', guildId);
  return (typeof userTicketCount === 'number' ? userTicketCount : (userTicketCount?.count ?? 0));
}

async function incrementUserTicketCount(userId, guildId) {
  // Atomic — prevents max-tickets enforcement from leaking via concurrent opens.
  await botData.update(userId, 'ticket_count', (cur) => ({
    count: (typeof cur === 'number' ? cur : (cur?.count ?? 0)) + 1,
  }), guildId);
}

async function decrementUserTicketCount(userId, guildId) {
  await botData.update(userId, 'ticket_count', (cur) => ({
    count: Math.max(0, (typeof cur === 'number' ? cur : (cur?.count ?? 0)) - 1),
  }), guildId);
}

// The SINGLE exit path for a ticket, used by the close button, the auto-close sweep AND the
// channelDelete reconcile below. The per-channel 'ticket' row is the IDEMPOTENCY TOKEN: the
// atomic update clears it and captures the owner in one step, so only the FIRST caller to
// find it present decrements the count. That makes double-decrement impossible even if two
// exit paths race (a close whose deleteTicket failed, then a manual channel delete) — the
// bug a separate decrement+deleteTicket pair would introduce. The two writes are also no
// longer chained: the count decrement can't be skipped by a clear failure or vice-versa.
async function releaseTicketSlot(channelId, guildId) {
  let owner = null;
  await botData.update(channelId, 'ticket', (cur) => {
    if (cur && cur.userId) owner = cur.userId;
    return null;
  }, guildId);
  if (owner) await decrementUserTicketCount(owner, guildId);
  return owner;
}

// When a ticket channel is DELETED out-of-band (an admin right-clicks -> Delete Channel
// instead of using the Close button), the close flow's cleanup never runs, so the owner's
// ticket_count stays maxed and the per-channel 'ticket' row is orphaned — the user is then
// blocked from ever opening another ticket ("You already have the maximum number of open
// tickets!"). Reconcile on channelDelete via the shared idempotent path. guildId falls back
// to channel.guildId when the GuildChannel's guild is uncached (e.g. right after a restart),
// so the slot is still freed. The getTicket read runs for every deleted channel by design:
// a name-prefilter would risk missing custom-named ticket channels and re-open the leak.
client.on('channelDelete', async (channel) => {
  try {
    const guildId = channel?.guildId || channel?.guild?.id;
    if (!guildId || !channel?.id) return;
    const ticket = await getTicket(channel.id, guildId);
    if (!ticket) return; // not a ticket channel — nothing to reconcile
    await releaseTicketSlot(channel.id, guildId);
  } catch (e) {
    console.error('[Tickets] channelDelete reconcile failed:', e?.message || e);
  }
});

// Create ticket panel. Resolves the panel channel by ID or by NAME (real configs
// store either — e.g. panelChannel: "support"), fetching the channel list once if
// it's uncached. Returns the posted message so the caller can persist its id for the
// once-only guard, or null when there is no channel to post to — never throws on a
// missing channel. Do NOT fall back to a literal 'CHANNEL_ID' (a guaranteed miss);
// an empty/unset panelChannel means "no channel configured".
const _ticketPanelRef = "1557519777063374928";
async function _resolvePanelChannel(guild) {
  const _panelRef = _ticketPanelRef;
  if (!_panelRef) return null;
  const _findPanel = () => guild.channels.cache.get(_panelRef)
    || guild.channels.cache.find(c => c.name === _panelRef || c.name === _panelRef.replace(/^#/, ''));
  let panelChannel = _findPanel();
  if (!panelChannel) {
    // Channel may just be uncached — fetch the full list once, then retry by id/name.
    try { await guild.channels.fetch(); panelChannel = _findPanel(); } catch {}
  }
  return panelChannel || null;
}

// The panel's message payload, split out from the send so the startup path can EDIT a
// panel that is already up using exactly the content it would otherwise have posted.
function _ticketPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle("🎫 Support Tickets")
    .setDescription("Click a button below to create a ticket. Our team will assist you shortly!")
    .setColor(VB_COLORS.ticket)
    .setFooter({ text: 'Click a button to create a ticket' });

  const rows = [];
  let currentRow = new ActionRowBuilder();

  // Audit cycle-11 (2026-05-27): cap at 25 (5 action rows × 5 buttons).
  // Discord 400s on the panel send otherwise.
  [{"id":"support","name":"General Support","emoji":"🎫","description":"Get help with general questions","staffRoles":[]},{"id":"feedback","name":"Feedback","emoji":"💡","description":"Share your ideas and suggestions","staffRoles":[]}].forEach((category, index) => {
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_create_${category.id}`)
        .setLabel(category.name)
        .setEmoji(category.emoji)
        .setStyle(ButtonStyle.Secondary)
    );
  });
  if (currentRow.components.length > 0) rows.push(currentRow);

  return { embeds: [embed], components: rows };
}

async function createTicketPanel(guild) {
  const panelChannel = await _resolvePanelChannel(guild);
  if (!panelChannel || typeof panelChannel.send !== 'function') return null;
  return await panelChannel.send(_ticketPanelPayload());
}

// Bring the panel that is ALREADY on Discord up to date with the current config.
//
// Three outcomes, because only one of them justifies posting again:
//   'updated'     — the live message now matches the config.
//   'missing'     — the message is definitely gone (the owner deleted it), so a fresh
//                   post is the right move.
//   'unavailable' — we could not tell. A transient fetch failure, a missing permission
//                   or a message this bot cannot edit all land here, and the caller
//                   leaves the existing panel alone. Treating those as 'missing' would
//                   post a DUPLICATE panel on every flaky boot, which is the exact spam
//                   the stored-id guard exists to prevent.
async function _updateTicketPanel(guild, posted) {
  const channel = (posted.channelId && guild.channels.cache.get(posted.channelId))
    || await _resolvePanelChannel(guild);
  if (!channel || typeof channel.messages?.fetch !== 'function') return 'unavailable';

  let message;
  try {
    message = await channel.messages.fetch(posted.messageId);
  } catch (err) {
    // 10008 is Discord's Unknown Message.
    return err?.code === 10008 ? 'missing' : 'unavailable';
  }
  if (!message) return 'missing';
  // editable is false for a message this bot did not author — e.g. after a token swap.
  if (!message.editable) return 'unavailable';

  try {
    await message.edit(_ticketPanelPayload());
    return 'updated';
  } catch {
    return 'unavailable';
  }
}

// Auto-post the panel on startup — createTicketPanel used to be defined but NEVER
// called, so the panel was never delivered. Post once per guild after the gateway
// READY has hydrated the channel cache (setup runs at module-load when the cache is
// still empty — mirrors the reaction-roles clientReady panel). A per-guild botData
// entry holds the posted message id, so a redeploy re-firing clientReady UPDATES that
// message instead of spamming a duplicate panel — and instead of skipping it, which is
// what used to make panel edits invisible.
client.once('clientReady', async () => {
  for (const guild of client.guilds.cache.values()) {
    try {
      const posted = await botData.get('ticket_panel', 'meta', guild.id);
      if (posted && posted.messageId) {
        // Edit the panel in place rather than skipping. Skipping meant an owner could
        // change panelTitle, panelDescription or the category buttons, redeploy, and
        // see nothing change on Discord — the first panel stayed up forever, and the
        // only way to refresh it was to delete the message by hand.
        //
        // Anything other than a confirmed-deleted message keeps the existing panel, so
        // the no-duplicate guarantee this guard was written for still holds.
        if (await _updateTicketPanel(guild, posted) !== 'missing') continue;
      }
      const message = await createTicketPanel(guild);
      if (message) {
        await botData.set('ticket_panel', 'meta', { messageId: message.id, channelId: message.channelId ?? null, postedAt: Date.now() }, guild.id);
      }
    } catch (panelErr) {
      console.error('[Ticket] Panel auto-post failed for guild', guild.id, panelErr?.message);
    }
  }
});

// Register /ticket so registerCommands() pushes it to Discord. Without this the
// handler below exists but /ticket never appears (only the button panel works);
// __setupCommands is the single registration source for builder-handled commands.
const ticketCmd = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Open a support ticket')
  .addStringOption(o => o.setName('category').setDescription('Ticket category').setRequired(false));
if (typeof __setupCommands !== 'undefined') {
  __setupCommands.push(ticketCmd.toJSON());
}

// Register /ticketpanel — an admin-only force-(re)post of the panel (Manage Server).
// Same __setupCommands path as /ticket.
const ticketPanelCmd = new SlashCommandBuilder()
  .setName('ticketpanel')
  .setDescription('(Re)post the ticket panel to its configured channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
if (typeof __setupCommands !== 'undefined') {
  __setupCommands.push(ticketPanelCmd.toJSON());
}

// Handle /ticketpanel — force-(re)post the panel and refresh the stored message id.
// Separate listener from the ticket-create handler below (which only matches
// commandName === 'ticket', so it never sees 'ticketpanel'). Ack-first: createTicketPanel
// does a channel.send (and maybe a channels.fetch) that can exceed Discord's 3s window.
client.on('interactionCreate', async (interaction) => {
  if (typeof interaction.isChatInputCommand !== 'function' || !interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'ticketpanel') return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  try {
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    if (!_ticketPanelRef) {
      return interaction.editReply({ content: '❌ No panel channel configured — set one in the ticket setup.' });
    }
    const message = await createTicketPanel(interaction.guild);
    if (!message) {
      return interaction.editReply({ content: '❌ Panel channel not found — check the ticket setup.' });
    }
    await botData.set('ticket_panel', 'meta', { messageId: message.id, channelId: message.channelId ?? null, postedAt: Date.now() }, interaction.guild.id);
    return interaction.editReply({ content: `✅ Ticket panel posted in <#${message.channelId}>` });
  } catch (panelCmdErr) {
    console.error('[Ticket] /ticketpanel failed:', panelCmdErr);
    try { await interaction.editReply({ content: '❌ Something went wrong posting the ticket panel.' }); } catch {}
  }
});

// Handle ticket creation (panel buttons OR the /ticket slash command)
client.on('interactionCreate', async (interaction) => {
  const _isTicketCmd = typeof interaction.isChatInputCommand === 'function'
    && interaction.isChatInputCommand() && interaction.commandName === 'ticket';
  if (!interaction.isButton() && !_isTicketCmd) return;
  if (interaction.replied || interaction.deferred) return;
  // Audit cycle-45 (2026-05-27): inGuild guard + outer try/catch around
  // the full button-handler body. channels.create / botData rejections
  // can otherwise bubble while a deferReply has already fired, leaving
  // users stuck on "Bot is thinking…".
  if (!interaction.inGuild()) return;
  // WHICH ack this handler used, because the shared catch below has to respond differently.
  // After deferReply, editReply fills the bot's own deferred reply. After deferUpdate there is
  // no such reply, and editReply edits the SOURCE message instead — the ticket panel/welcome
  // card hosting the buttons. That defaces it, and under VBCARD_V2 (true in prod) that message
  // is a Components-V2 card which rejects a plain content edit, so it throws, the inner catch
  // swallows it, and the user sees nothing at all.
  let _ackKind = null;
  try {

  if (_isTicketCmd || interaction.customId.startsWith('ticket_create_')) {
    // Ack FIRST — a deferred reply guarantees this interaction is never a silent
    // no_response, regardless of how category resolution below turns out. channels.create
    // later also exceeds Discord's 3s deadline, so we would defer here anyway.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    _ackKind = 'reply';

    // Resolve the ticket category. TICKET_CONFIG.categories is the OPTIONAL list of ticket
    // TYPES the user picks (drives the ticket NAME in the 'category' scheme + validates the
    // button customId) — NOT the Discord parent category, which is config.categoryParent.
    let category;
    if (TICKET_CONFIG.categories.length === 0) {
      // No ticket types configured — open with a synthetic default so tickets still work
      // (parent from categoryParent, name from the naming scheme). id 'ticket' matches the
      // generic panel button's ticket_create_ticket customId.
      category = { id: 'ticket', name: 'Support', emoji: '🎫', description: '', staffRoles: [] };
    } else {
      // Command: category from the option (default to the first); button: from the customId.
      const categoryId = _isTicketCmd
        ? (TICKET_CONFIG.categories.find(c => c.id === interaction.options.getString('category'))?.id || TICKET_CONFIG.categories[0]?.id)
        : interaction.customId.replace('ticket_create_', '');
      category = TICKET_CONFIG.categories.find(c => c.id === categoryId);
      if (!category) {
        // Configured types exist but the pick / stale button matches none — reply with an
        // acked error (never a silent no_response).
        return interaction.editReply({ content: '❌ That ticket option is no longer available. Ask an admin to check the ticket setup.' });
      }
    }

    const guildId = interaction.guild.id;

    // Check ticket limit using persistent storage
    const userTicketCount = await getUserTicketCount(interaction.user.id, guildId);
    if (userTicketCount >= 1) {
      return interaction.editReply({
        content: 'You already have the maximum number of open tickets!',
      });
    }

    // Audit cycle-28 (2026-05-27): Discord caps guilds at 500 channels.
    // channels.create() fails with a vague error past the cap — surface it.
    if (interaction.guild.channels.cache.size >= 495) {
      return interaction.editReply({
        content: '⚠️ This server is at the Discord 500-channel limit. Ask an admin to delete unused channels before opening a ticket.',
      });
    }

    const ticketCounter = await incrementTicketCounter(guildId);
    const rawTicketName = `ticket-${ticketCounter.toString().padStart(4, "0")}`;
    // Discord 50035: strip 'clyde'/'discord' + 100-char cap.
    const ticketName = sanitizeChannelName(rawTicketName);

    // Per-category role routing: who can SEE this ticket + who is pinged. Additive to the
    // global support team, or EXCLUSIVE if the category is private (see _effectiveRoles).
    const _catRoles = _effectiveRoles(category);
    const _catPing = _catRoles.map(_r => `<@&${_r}>`).join(' ');

    // Create ticket channel. The bot needs its OWN ViewChannel overwrite: the @everyone deny
    // hides the channel from the bot too unless it has Administrator, and then the welcome
    // post (which carries Close), the transcript read and the delete all fail. ViewChannel
    // is the only bit that deny takes away; SendMessages, EmbedLinks, ReadMessageHistory and
    // ManageChannels still come from the bot's role. Do not grant them here as well: Discord
    // refuses the whole create (50013) when an overwrite grants a bit the bot does not hold.
    // type: 1 (OverwriteType.Member) on every USER overwrite: without a type, discord.js looks
    // the id up in client.users.cache, which this runtime caps at 500 with oldest-out eviction.
    // The bot's own user is the oldest entry, so a busy bot loses it first, and create() then
    // throws InvalidType before it sends anything. Roles stay cached, so they need no type.
    const ticketChannel = await interaction.guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: client.user.id,
          type: 1,
          allow: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          type: 1,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
        ..._catRoles.map(_rid => ({
          id: _rid,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        })),
      ],
    });

    // Store ticket info using persistent storage
    await setTicket(ticketChannel.id, {
      id: ticketCounter,
      channelId: ticketChannel.id,
      userId: interaction.user.id,
      categoryId: category.id,
      createdAt: Date.now(),
      claimed: null,
    }, guildId);

    // Increment user's ticket count
    await incrementUserTicketCount(interaction.user.id, guildId);

    // Send welcome message. Both {category} substitutions below use a FUNCTION replacer, not a
    // string one: a string replace() treats a leading-dollar pattern in the STRING argument as
    // a special replacement token (insert-everything-before-the-match, etc) — so a category
    // NAME (owner-set config text, read here at runtime) packed with repeated such tokens
    // could blow up this string on every ticket that category opens. A function replacer's
    // return value is always inserted literally, with no pattern interpretation (2026-09-26,
    // combined-shape review — the same class the giveaway {emoji} fix closes).
    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`${category.emoji} ${category.name}`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setDescription("Thank you for creating a ticket! Our support team will be with you shortly.".replace('{user}', `<@${interaction.user.id}>`).replace('{category}', () => category.name))
      .setColor(VB_COLORS.ticket)
      .addFields(
        { name: '🎫 Created by', value: `<@${interaction.user.id}>`, inline: true },
        { name: '🏷️ Category', value: category.name, inline: true }
      )
      .setTimestamp();

    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_claim')
          .setLabel('Claim')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('ticket_close')
          .setLabel('Close')
          .setStyle(ButtonStyle.Danger)
      );

    
    // Audit cycle-33 (2026-05-27): explicit allowedMentions to prevent
    // @everyone/@here injection if support-role labels ever templated input.
    await ticketChannel.send({
      content: _catPing || undefined,
      embeds: [welcomeEmbed],
      components: [actionRow],
      allowedMentions: { roles: _catRoles, parse: [] }
    });

    await interaction.editReply({
      content: `Your ticket has been created: <#${ticketChannel.id}>`,
    });
  }

  
  if (interaction.customId === 'ticket_claim') {
    // Ack BEFORE the getTicket round-trip. getTicket is a botData read over the network, so
    // under load it can outrun Discord's 3s interaction deadline and the click dies silently.
    // deferUpdate (not deferReply) is the ack that fits: every path below sends its OWN message
    // via followUp, so the ephemeral paths stay ephemeral and the public one stays public.
    await interaction.deferUpdate().catch(() => {});
    _ackKind = 'update';
    const guildId = interaction.guild.id;
    const ticket = await getTicket(interaction.channel.id, guildId);
    if (!ticket) return;
    // Audit cycle-44 (2026-05-27): only support-role members or ManageChannels
    // can claim. Previously any viewer (including the opener) could self-claim
    // and block real support from taking the ticket.
    const _claimSupport = _effectiveRoles(TICKET_CONFIG.categories.find(c => c.id === ticket.categoryId) || {});
    const _claimIsSupport = interaction.member?.roles?.cache?.some(r => _claimSupport.includes(r.id));
    const _claimHasManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
    if (!_claimIsSupport && !_claimHasManage) {
      return interaction.followUp({ content: '❌ Only support team members can claim tickets.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (ticket.claimed) {
      return interaction.followUp({ content: 'This ticket is already claimed!', flags: MessageFlags.Ephemeral });
    }
    ticket.claimed = interaction.user.id;
    // The ack now happens at the TOP of the branch (see above), which also covers this write.
    await setTicket(interaction.channel.id, ticket, guildId);
    // Public, exactly as the old deferReply+editReply pair was.
    await interaction.followUp({ content: `This ticket has been claimed by <@${interaction.user.id}>` });
  }

  if (interaction.customId === 'ticket_close') {
    // Ack BEFORE the getTicket round-trip. getTicket is a botData read over the network, so
    // under load it can outrun Discord's 3s interaction deadline and the click dies silently.
    // deferUpdate (not deferReply) is the ack that fits: every path below sends its OWN message
    // via followUp, so the ephemeral paths stay ephemeral and the public one stays public.
    await interaction.deferUpdate().catch(() => {});
    _ackKind = 'update';
    const guildId = interaction.guild.id;
    const ticket = await getTicket(interaction.channel.id, guildId);
    if (!ticket) return;

    // Audit cycle-43 (2026-05-27): only the ticket opener, a support-role
    // member, or anyone with ManageChannels may close. Without this, any
    // user added to the ticket can trigger the 5-second channel-delete.
    const _supportRoles = _effectiveRoles(TICKET_CONFIG.categories.find(c => c.id === ticket.categoryId) || {});
    const _isOpener = ticket.userId === interaction.user.id;
    const _isSupport = interaction.member?.roles?.cache?.some(r => _supportRoles.includes(r.id));
    const _hasManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
    if (!_isOpener && !_isSupport && !_hasManage) {
      return interaction.followUp({ content: '❌ Only the ticket opener, a support team member, or staff with Manage Channels can close this ticket.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // The ack now happens at the TOP of the branch (see above); the transcript fetch and
    // transcriptChannel.send below are covered by it.

    
    // Create transcript
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    const transcript = messages.reverse().map(m =>
      `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`
    ).join('\n');

    const transcriptChannel = interaction.guild.channels.cache.get("1557529984246091836");
    if (transcriptChannel && typeof transcriptChannel.send === 'function') {
      const transcriptEmbed = new EmbedBuilder()
        .setTitle(`Ticket #${ticket.id} Transcript`)
        .setDescription(`Closed by <@${interaction.user.id}>`)
        .addFields(
          { name: 'Created by', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Closed at', value: new Date().toISOString(), inline: true }
        )
        .setColor(0xED4245);

      await transcriptChannel.send({
        embeds: [transcriptEmbed],
        files: [{ attachment: Buffer.from(transcript), name: `ticket-${ticket.id}.txt` }]
      });
    }

    await interaction.followUp({ content: "This ticket has been closed. A transcript has been saved." });

    // Decrement user's ticket count and delete ticket from storage
    await releaseTicketSlot(interaction.channel.id, guildId);

    // Audit cycle-11 (2026-05-27): safeTimeout for SIGTERM cleanup.
    // Capture the channel now: interaction.channel is a getter that re-resolves
    // from client.channels.cache on every read, so it can return null by the time
    // this fires 5s later (channel evicted / gateway churn). .catch() only handles
    // a rejected delete() promise, not the synchronous null deref — so hold the
    // resolved reference and optional-chain it.
    const _closeChannel = interaction.channel;
    safeTimeout(() => {
      _closeChannel?.delete().catch(() => {});
    }, 5000);
  }
  } catch (ticketErr) {
    console.error('[Ticket] Button handler error:', ticketErr);
    try {
      if (_ackKind === 'update') {
        // deferUpdate leaves no deferred reply of our own to edit — send a new ephemeral one.
        await interaction.followUp({ content: '❌ Something went wrong handling that ticket action.', flags: MessageFlags.Ephemeral });
      } else if (_ackKind === 'reply' && interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: '❌ Something went wrong handling that ticket action.' });
      } else if (!interaction.replied) {
        await interaction.reply({ content: '❌ Something went wrong handling that ticket action.', flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
});


// Auto-close inactive tickets — use safeInterval so the timer is cleared
// on SIGTERM (raw setInterval orphans across deploys).
safeInterval(async () => {
  const now = Date.now();
  const inactivityLimit = 48 * 60 * 60 * 1000;

  for (const guild of client.guilds.cache.values()) {
    // No category parent configured — scan all channels named "ticket-*"
    const ticketCategory = null;

    const ticketChannels = guild.channels.cache.filter(
      c => c.type === 0 && c.name.startsWith('ticket-')
    );

    for (const [channelId, channel] of ticketChannels) {
      const guildId = guild.id;
      const ticket = await getTicket(channelId, guildId);
      if (!ticket) continue;

      // Audit cycle-3 #5 (2026-05-27): filter out the bot's own messages so
      // the inactivity sweep doesn't reset its clock on every welcome embed
      // or claim notice. Fetch a few messages and find the first non-bot one.
      const messages = await channel.messages.fetch({ limit: 50 });
      const lastUserMessage = messages.find(m => !m.author.bot);
      const lastActivity = lastUserMessage ? lastUserMessage.createdTimestamp : ticket.createdAt;

      if (now - lastActivity > inactivityLimit) {
        await channel.send({ content: 'This ticket has been closed due to inactivity.' });
        await releaseTicketSlot(channelId, guildId);
        safeTimeout(() => channel.delete().catch(() => {}), 5000);
      }
    }
  }
}, 60 * 60 * 1000);

})().catch(e => console.error('[Ticket System] startup error:', e));

// ===== Auto-Delete Rules =====
(async () => {
// Auto-Delete System
client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  if (message.author?.bot) return;

  // Rule 1: links
  if (["1557519769811558583"].includes(message.channel.id)) {
    if (message.member?.permissions.has('ManageMessages')) return false;
    if (/https?:\/\/[^\s]+/.test(message.content)) {
      markMessageHandled(message); // claim so the AI persona doesn't reply to an auto-deleted message
      try { await message.delete(); } catch {}
      return;
    }
  }
});

console.log('Auto-delete system ready!');
})().catch(e => console.error('[Auto-Delete Rules] startup error:', e));

// ===== Auto-Moderation =====
(async () => {
// Advanced Auto-Moderation
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const immuneRoles = new Set([]);
const immuneChannels = new Set([]);
const bannedWords = ["fuck shit dam oh shi shi jerkoff goon mothherfucker foff fag fagget"];
const linksWhitelist = [];

// Spam tracking
const spamTracker = new Map();
const duplicateTracker = new Map();

function isImmune(member, channelId) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (immuneChannels.has(channelId)) return true;
  return member.roles.cache.some(r => immuneRoles.has(r.id));
}

// Per-rule action table, plus the config-wide fallback pair it overrides.
const _ruleActions = {"banned_words":{"action":"timeout","timeoutDuration":1800},"links":{"action":"warn"},"invites":{"action":"timeout","timeoutDuration":600},"mentions":{"action":"warn"},"caps":{"action":"warn"},"spam":{"action":"timeout","timeoutDuration":300},"duplicates":{"action":"warn"}};
const _defaultAction = "delete";
const _defaultTimeoutMs = 60000;

async function takeAction(message, reason, ruleKey) {
  markMessageHandled(message); // claim so the AI persona doesn't reply to a moderated message
  const actions = [];

  // X-Audit-Log-Reason cap 512; 'Auto-mod: ' prefix uses 10, leave 502.
  reason = sanitizeAuditReason(reason, 502);

  // Which action this particular rule takes. An unknown or absent ruleKey falls back
  // to the config-wide pair, which is what every AI-authored config uses.
  const _override = _ruleActions[ruleKey] || {};
  const action = _override.action || _defaultAction;
  const _timeoutMs = typeof _override.timeoutDuration === 'number'
    ? _override.timeoutDuration * 1000
    : _defaultTimeoutMs;

  // Removing the message is its OWN choice now, separate from the penalty applied to the
  // member. Absent means true, so this is the same unconditional delete it always was
  // unless a rule explicitly opts out.
  if (_override.deleteMessage !== false) {
    try { await message.delete(); } catch {}
  }

  // Audit cycle-4 #9 (2026-05-27): 'warn' was silently timing users out for
  // timeoutDuration seconds. Now separate: 'warn' sends a DM/channel warning
  // (no timeout); 'timeout' applies the duration as before.
  if (action === 'timeout' && message.member?.moderatable) {
    try {
      await message.member.timeout(_timeoutMs, reason);
      actions.push('timed out');
    } catch {}
  }

  if (action === 'warn') {
    try {
      await message.member.send({ content: `⚠️ Warning in **${message.guild.name}**: ${reason}` });
      actions.push('warned');
    } catch {
      actions.push('warned');
    }
  }

  if (action === 'kick' && message.member?.kickable) {
    try {
      await message.member.kick(reason);
      actions.push('kicked');
    } catch {}
  }

  if (action === 'ban' && message.member?.bannable) {
    try {
      await message.member.ban({ reason, deleteMessageSeconds: 60 });
      actions.push('banned');
    } catch {}
  }

  
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.member) return;
  if (isImmune(message.member, message.channel.id)) return;

  const content = message.content;

  // Banned words check
  const lowerContent = content.toLowerCase();
  if (bannedWords.some(w => lowerContent.includes(w.toLowerCase()))) {
    return takeAction(message, 'Banned word detected', 'banned_words');
  }

  // Discord invite check
  const inviteRegex = /discord(?:\.gg|app\.com\/invite|(?:\.com)?\/invite)\/[\w-]+/i;
  if (inviteRegex.test(content)) {
    const invites = await message.guild.invites.fetch().catch(() => null);
    const ownInviteCodes = invites ? invites.map(i => i.code) : [];
    const found = content.match(/discord(?:\.gg|app\.com\/invite|(?:\.com)?\/invite)\/([\w-]+)/i);
    if (found && !ownInviteCodes.includes(found[1])) {
      return takeAction(message, 'External invite link', 'invites');
    }
  }

  // External links check
  const linkRegex = /https?:\/\/[^\s]+/gi;
  const links = content.match(linkRegex);
  if (links) {
    const blocked = links.some(link => {
      try {
        const hostname = new URL(link).hostname;
        return !linksWhitelist.some(w => hostname.endsWith(w));
      } catch { return true; }
    });
    if (blocked) return takeAction(message, 'External link detected', 'links');
  }

  // Mass mention check. The builder collects TWO limits — "most people one message may
  // mention" and "most roles one message may ping" — so they are checked separately.
  // Summing them, which is what the single-limit branch below does, meant the role
  // number the owner set was never read at all.
  const userMentions = message.mentions.users.size;
  const roleMentions = message.mentions.roles.size;
  if (userMentions > 5) {
    return takeAction(message, `Mass mentions (${userMentions} users)`, 'mentions');
  }
  if (roleMentions > 2) {
    return takeAction(message, `Mass role mentions (${roleMentions} roles)`, 'mentions');
  }

  // Excessive caps check
  if (content.length >= 10) {
    const upper = content.replace(/[^a-zA-Z]/g, '');
    const caps = upper.replace(/[^A-Z]/g, '');
    if (upper.length > 0 && (caps.length / upper.length) > 0.7) {
      return takeAction(message, 'Excessive caps', 'caps');
    }
  }

  // Spam check (rapid messages)
  const spamKey = message.author.id;
  const spamData = spamTracker.get(spamKey) || [];
  const spamNow = Date.now();
  spamData.push(spamNow);
  const recentSpam = spamData.filter(t => spamNow - t < 5000);
  spamTracker.set(spamKey, recentSpam);
  if (recentSpam.length > 5) {
    spamTracker.delete(spamKey);
    return takeAction(message, 'Message spam detected', 'spam');
  }

  // Duplicate message check
  const dupeKey = message.author.id;
  const dupeData = duplicateTracker.get(dupeKey) || [];
  const dupeNow = Date.now();
  dupeData.push({ content, time: dupeNow });
  const recentDupes = dupeData.filter(d => dupeNow - d.time < 30000);
  duplicateTracker.set(dupeKey, recentDupes);
  const sameCount = recentDupes.filter(d => d.content === content).length;
  if (sameCount >= 3) {
    duplicateTracker.delete(dupeKey);
    return takeAction(message, 'Duplicate message spam', 'duplicates');
  }
});

console.log('Advanced Auto-Moderation ready!');
})().catch(e => console.error('[Auto-Moderation] startup error:', e));

// ===== Auto-Moderation =====
(async () => {
// Raid Protection System
const { EmbedBuilder } = require('discord.js');

const RAID_CONFIG = {
  minAccountAge: 7,
  accountAgeAction: "lockdown",
  joinRateEnabled: true,
  joinRateLimit: 10,
  joinRateInterval: 10000,
  joinRateAction: "lockdown",
  usernameFilterEnabled: false,
  usernameAction: "lockdown",
  quarantineRole: "",
  whitelistRoles: [],
  logChannel: "",
  dmOnAction: false,
  timeoutDuration: 600000,
};

// Join rate tracking (in-memory)
const recentJoins = [];
let raidModeActive = false;
let raidModeTimeout = null;

// Lockdown state. Holds what the server looked like BEFORE the lockdown so it can be
// put back exactly, and null means "not locked down".
let _lockdownPrev = null;
let _lockdownTimer = null;

async function applyLockdown(guild, reason) {
  if (_lockdownPrev) return; // already locked down — don't stack, don't re-capture
  const prev = {
    verificationLevel: guild.verificationLevel,
    invitesWereDisabled: guild.features?.includes('INVITES_DISABLED') === true,
  };
  // Pausing invites is the part that actually stops a raid growing; raising the
  // verification level is the fallback when the bot lacks the invite permission.
  try {
    if (!prev.invitesWereDisabled && typeof guild.disableInvites === 'function') {
      await guild.disableInvites(true);
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Lockdown invites failed:', e?.message);
  }
  try {
    // 3 = HIGH (verified phone). Never LOWER an already-stricter setting.
    if (typeof guild.verificationLevel === 'number' && guild.verificationLevel < 3) {
      await guild.setVerificationLevel(3, `Raid protection: ${reason}`);
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Lockdown verification failed:', e?.message);
  }
  _lockdownPrev = prev;
  console.warn('[raid-protection] SERVER LOCKED DOWN —', reason);

  // ALWAYS self-lifting. A lockdown silently blocks every legitimate join, and the
  // account-age path can trigger one outside raid mode, where nothing else would
  // ever put the server back.
  if (_lockdownTimer) clearTimeout(_lockdownTimer);
  _lockdownTimer = safeTimeout(() => { liftLockdown(guild); }, 300000);
}

async function liftLockdown(guild) {
  if (!_lockdownPrev) return;
  const prev = _lockdownPrev;
  _lockdownPrev = null;
  if (_lockdownTimer) { clearTimeout(_lockdownTimer); _lockdownTimer = null; }
  try {
    if (!prev.invitesWereDisabled && typeof guild.disableInvites === 'function') {
      await guild.disableInvites(false);
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Lockdown lift invites failed:', e?.message);
  }
  try {
    if (typeof prev.verificationLevel === 'number') {
      await guild.setVerificationLevel(prev.verificationLevel, 'Raid protection: lockdown lifted');
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Lockdown lift verification failed:', e?.message);
  }
  console.log('[raid-protection] Server lockdown lifted');
}

async function logRaidAction(guild, member, action, reason) {
  if (!RAID_CONFIG.logChannel) return;
  try {
    const logChannel = guild.channels.cache.get(RAID_CONFIG.logChannel);
    if (!logChannel || typeof logChannel.send !== 'function') return;
    const embed = new EmbedBuilder()
      .setTitle(raidModeActive ? '🚨 Raid Protection — Active' : '🛡️ Raid Protection')
      .setThumbnail(member.user.displayAvatarURL())
      .setColor(VB_COLORS.error)
      .addFields(
        { name: '👤 User', value: `${member.user.tag} (${member.id})`, inline: true },
        { name: '⚙️ Action', value: action, inline: true },
        { name: '🛡️ Reason', value: reason },
        { name: '📅 Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` }
      )
      .setTimestamp();
    await logChannel.send({ embeds: [embed] });
  } catch {}
}

async function executeAction(member, action, reason) {
  // DM before action — skip bot accounts (can't DM bots) and swallow 50007
  // (DMs closed / no mutual guild). During a raid, hundreds of 50007s in
  // a row count toward Cloudflare's 10k-invalid-in-10min IP ban.
  // No DM for 'lockdown' — nothing happened to THIS member, so "you have been ..."
  // would be a lie, and a raid would send it to every joiner.
  if (RAID_CONFIG.dmOnAction && !member.user.bot && action !== 'lockdown') {
    try {
      await member.send(`⚠️ You have been ${action === 'ban' ? 'banned' : action === 'kick' ? 'kicked' : action === 'quarantine' ? 'quarantined' : 'timed out'} from **${member.guild.name}**.\nReason: ${reason}`);
    } catch (e) {
      if (e?.code !== 50007 && e?.code !== 50001) console.error('Raid DM failed:', e?.message);
    }
  }

  try {
    switch (action) {
      case 'ban':
        if (member.bannable) await member.ban({ reason: `Raid protection: ${reason}`, deleteMessageSeconds: 86400 });
        break;
      case 'kick':
        if (member.kickable) await member.kick(`Raid protection: ${reason}`);
        break;
      case 'quarantine':
        if (RAID_CONFIG.quarantineRole) {
          // Check role hierarchy — quarantine role above bot's highest crashes silent 50013
          const me = await member.guild.members.fetchMe();
          const quarantineRole = member.guild.roles.cache.get(RAID_CONFIG.quarantineRole);
          if (quarantineRole && quarantineRole.position < me.roles.highest.position) {
            await member.roles.add(RAID_CONFIG.quarantineRole, `Raid protection: ${reason}`);
          }
        }
        break;
      case 'timeout':
        if (member.moderatable) await member.timeout(RAID_CONFIG.timeoutDuration, `Raid protection: ${reason}`);
        break;
      case 'lockdown':
        // Server-level: the member who tripped it is deliberately left in place.
        await applyLockdown(member.guild, reason);
        break;
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Raid action failed:', e?.message);
  }

  await logRaidAction(member.guild, member, action, reason);
}

function checkUsername(name) {
  // No username filters configured
  return null;
}

client.on('guildMemberAdd', async (member) => {
  if (member.user.bot) return;

  // Skip whitelisted roles (for pre-assigned roles via invite)
  if (RAID_CONFIG.whitelistRoles.length > 0) {
    if (member.roles.cache.some(r => RAID_CONFIG.whitelistRoles.includes(r.id))) return;
  }

  // Join rate tracking
  if (RAID_CONFIG.joinRateEnabled) {
    const now = Date.now();
    recentJoins.push(now);
    // Clean old entries
    while (recentJoins.length > 0 && (now - recentJoins[0]) > RAID_CONFIG.joinRateInterval) {
      recentJoins.shift();
    }

    if (recentJoins.length >= RAID_CONFIG.joinRateLimit) {
      // Raid detected!
      if (!raidModeActive) {
        raidModeActive = true;
        console.warn('[raid-protection] RAID MODE ACTIVATED');

        if (RAID_CONFIG.logChannel) {
          try {
            const logChannel = member.guild.channels.cache.get(RAID_CONFIG.logChannel);
            if (logChannel && typeof logChannel.send === 'function') {
              const raidEmbed = new EmbedBuilder()
                .setTitle('🚨 RAID MODE ACTIVATED')
                .setColor(VB_COLORS.error)
                .setDescription(`${recentJoins.length} joins detected in ${RAID_CONFIG.joinRateInterval / 1000}s. All new joins will be ${RAID_CONFIG.joinRateAction}.`)
                .setTimestamp();
              await logChannel.send({ embeds: [raidEmbed] });
            }
          } catch {}
        }
      }

      // Clear raid mode after 5 minutes of no new joins.
      // Audit cycle-4 #2 (2026-05-27): use safeTimeout/safeClearTimeout so the
      // raid-mode timer is tracked for SIGTERM cleanup and the dead container
      // doesn't keep flipping raidModeActive post-shutdown.
      if (raidModeTimeout) clearTimeout(raidModeTimeout);
      const _raidGuild = member.guild;
      raidModeTimeout = safeTimeout(() => {
        raidModeActive = false;
        recentJoins.length = 0;
        // A join-rate lockdown is tied to the raid, so it ends with it.
        liftLockdown(_raidGuild);
        console.log('[raid-protection] Raid mode deactivated');
      }, 300000);

      await executeAction(member, RAID_CONFIG.joinRateAction, 'Raid detected — join rate exceeded');
      return;
    }
  }

  // During active raid mode, take action on all joins
  if (raidModeActive) {
    await executeAction(member, RAID_CONFIG.joinRateAction, 'Raid mode active');
    return;
  }

  // Account age check
  if (RAID_CONFIG.minAccountAge > 0) {
    const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86400000;
    if (accountAgeDays < RAID_CONFIG.minAccountAge) {
      await executeAction(member, RAID_CONFIG.accountAgeAction, `Account too new (${Math.floor(accountAgeDays)} days, minimum ${RAID_CONFIG.minAccountAge})`);
      return;
    }
  }

  // Username filter
  if (RAID_CONFIG.usernameFilterEnabled) {
    const username = member.user.username;
    const displayName = member.displayName;
    const usernameViolation = checkUsername(username) || checkUsername(displayName);
    if (usernameViolation) {
      await executeAction(member, RAID_CONFIG.usernameAction, usernameViolation);
      return;
    }
  }
});

console.log('Raid protection system ready!');
})().catch(e => console.error('[Auto-Moderation] startup error:', e));

// ===== Form: Application Form =====
(async () => {
// Form: Application Form
const { EmbedBuilder, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const formCooldowns = new Map();
// Audit cycle-20: sweep expired entries so a busy server doesn't retain
// every user's last-submit timestamp forever.
safeInterval(() => {
  const _now = Date.now();
  for (const [_k, _ts] of formCooldowns) {
    if (_now - _ts > 259200000) formCooldowns.delete(_k);
  }
}, Math.max(60000, 259200000));

const EMBED_COLOR = "#57F287";

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle("📝 Application Form Commands")
    .setColor(EMBED_COLOR)
    .setDescription('Here are the available commands:')
    .addFields(
      { name: '\u{1F4DD} /apply', value: "Submit your application", inline: true },
      { name: '\u2753 /apply-help', value: 'Show this help message', inline: true }
    );
}

const formCmd = new SlashCommandBuilder()
  .setName("apply")
  .setDescription("Submit your application");

const formHelpCmd = new SlashCommandBuilder()
  .setName("apply-help")
  .setDescription("Show Application Form help");

// Register the form commands so registerCommands() pushes them to Discord.
// generateUserCommandBuilders skips this builder (its setupCode owns a
// SlashCommandBuilder), so __setupCommands is the only registration path —
// without this /apply (the only entry point) never appears.
if (typeof __setupCommands !== 'undefined') {
  __setupCommands.push(formCmd.toJSON(), formHelpCmd.toJSON());
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.replied || interaction.deferred) return;

  try {
  // Show help
  if (interaction.isChatInputCommand() && interaction.commandName === "apply-help") {
    return interaction.reply({ embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
  }

  // Open form modal
  if (interaction.isChatInputCommand() && interaction.commandName === "apply") {

    if (!interaction.member?.roles?.cache?.has("1557515208501755908")) {
      return interaction.reply({ content: '\u274C You do not have permission to use this form.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
    }
  const now = Date.now();
  const lastSubmit = formCooldowns.get(interaction.user.id);
  if (lastSubmit && (now - lastSubmit) < 259200000) {
    const remaining = Math.ceil((259200000 - (now - lastSubmit)) / 1000);
    return interaction.reply({ content: `⏳ Please wait ${remaining}s before submitting again.`, flags: MessageFlags.Ephemeral });
  }
    const existing = await botData.get(interaction.user.id, "form_apply", interaction.guild.id).catch(() => null);
    if (existing) {
      return interaction.reply({ content: '\u274C You have already submitted this form.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId("form_apply")
      .setTitle("Application Form")
      .addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('form_q0')
        .setLabel("What is your roblox user?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("Enter your name")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('form_q1')
        .setLabel("what is your discord user?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("Tell us about yourself...")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('form_q2')
        .setLabel("Why do you want to apply?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('form_q3')
        .setLabel("What benifets will you bring to the team?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('form_q4')
        .setLabel("What is your age?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        
    )
      );

    await interaction.showModal(modal);
  }

  // Handle form submission
  if (interaction.isModalSubmit() && interaction.customId === "form_apply") {
    const submissionChannel = interaction.guild.channels.cache.get("1557529984246091836");
    if (!submissionChannel || typeof submissionChannel.send !== 'function') {
      return interaction.reply({ content: '\u274C Submission channel not found.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
    }
    // Reply-pattern modal: defer ephemerally (channel.send + botData.set can
    // exceed the 3s ack window → 10062). The sync channel-not-found check above
    // replies directly before the defer.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    formCooldowns.set(interaction.user.id, Date.now());

    const embed = new EmbedBuilder()
      .setTitle("📋 Application Form Submission")
      .setColor(EMBED_COLOR)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields({ name: '👤 Submitted by', value: `${interaction.user.tag} (${interaction.user.id})` })
      .addFields(
      { name: "📝 What is your roblox user?", value: interaction.fields.getTextInputValue('form_q0') || 'N/A' },
      { name: "📝 what is your discord user?", value: interaction.fields.getTextInputValue('form_q1') || 'N/A' },
      { name: "📝 Why do you want to apply?", value: interaction.fields.getTextInputValue('form_q2') || 'N/A' },
      { name: "📝 What benifets will you bring to the team?", value: interaction.fields.getTextInputValue('form_q3') || 'N/A' },
      { name: "📝 What is your age?", value: interaction.fields.getTextInputValue('form_q4') || 'N/A' }
      )
      .setTimestamp();

    await submissionChannel.send({
      content: "<@&1557519713670799420>",
      embeds: [embed],
    });

    // Audit cycle-9 #3 (2026-05-27): mark submitted AFTER successful send.
    // Previously set BEFORE the send, so a permission/channel error during
    // submissionChannel.send locked the user out of resubmitting forever.
    await botData.set(interaction.user.id, "form_apply", { submitted: true, timestamp: Date.now() }, interaction.guild.id);

    try {
      await interaction.user.send("Thank you for your submission! We will review it shortly.");
    } catch {}

    await interaction.editReply({
      content: "Thank you for your submission! We will review it shortly.",
    });
  }
  } catch (error) {
    console.error('[Form] Interaction error:', error);
    try {
      // A deferred-but-unedited reply must be edited, not followed up, or the
      // "thinking" placeholder hangs.
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: '\u274C Something went wrong. Please try again.', embeds: [buildHelpEmbed()] });
      } else if (!interaction.replied) {
        await interaction.reply({ content: '\u274C Something went wrong. Please try again.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.followUp({ content: '\u274C Something went wrong. Please try again.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
});

console.log('Form /' + "apply" + ' ready!');
})().catch(e => console.error('[Form: Application Form] startup error:', e));

// ===== Leveling System =====
(async () => {
// Leveling System - Persistent Storage with botData API

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;


  const userId = message.author.id;
  const guildId = message.guild.id;

  // Atomic read-modify-write — two messages from the same user race; CAS
  // retry inside botData.update prevents lost XP.
  const xpGain = Math.floor(Math.random() * (25 - 15 + 1)) + 15;
  const xpForNextLevel = (level) => 5 * (level * level) + 50 * level + 100;
  // Audit cycle-4 #1 (2026-05-27): reset leveledUpLevels INSIDE the mutator
  // so CAS retries (botData.update can re-run on conflict) don't accumulate
  // duplicate level-up entries from prior failed attempts. Previously the
  // outer-scope let meant: retry → push again → role rewards fire twice,
  // wrong level announced, etc.
  let leveledUpLevels = [];
  const userData = await botData.update(userId, 'leveling', (cur) => {
    leveledUpLevels = [];
    const u = cur || { xp: 0, level: 0, totalXp: 0, lastMessage: 0 };
    if (Date.now() - u.lastMessage < 60000) return u;
    u.xp += xpGain;
    u.totalXp += xpGain;
    u.lastMessage = Date.now();
    // Second guard, independent of the xpGain clamp above: a row's stored xp can already be huge
    // from BEFORE that clamp existed (or from any other future writer), and that value survives a
    // restart. Capping iterations, not xp itself, keeps one message's CPU/announcement work
    // bounded without silently discarding the member's real progress.
    let _levelUpGuard = 0;
    while (u.xp >= xpForNextLevel(u.level) && _levelUpGuard < 1000) {
      u.xp -= xpForNextLevel(u.level);
      u.level++;
      leveledUpLevels.push(u.level);
      _levelUpGuard++;
    }
    return u;
  }, guildId);
  if (!userData || leveledUpLevels.length === 0) return;
  markMessageHandled(message); // level-up announcement incoming — persona shouldn't double up (silent XP does NOT mark)

  if (message.member) {
    client.emit('levelUp', message.member, { newLevel: userData.level });
  }

  // Level up notification
  const channel = message.guild.channels.cache.get("1557519769811558583");
  if (channel) {
    await channel.send({
      content: "Congratulations {user}! You reached level {level}!"
        .replace('{user}', `<@${userId}>`)
        .replace('{level}', userData.level)
        .replace('{xp}', userData.totalXp),
      allowedMentions: { parse: ['users'] },
    });
  }

  // Check role rewards — guard role hierarchy so a role above the bot
  // doesn't crash the handler on every level-up.
  // Audit cycle-39 (2026-05-27): message.member null deref. The L62 gate
  // is single-line; the loop below also derefs message.member and would
  // crash synchronously (before the .catch) when GUILD_MEMBERS intent is
  // off + member uncached.
  if (!message.member) return;
  const me = await message.guild.members.fetchMe();

});


// Register /rank + /leaderboard so registerCommands() pushes them to Discord.
// Without this the handlers below exist but the commands never appear in Discord
// (the /rank registration gap). __setupCommands is the single registration source
// for builder-handled commands; mirrors elo-ranking-code-gen.
const rankCmd = new SlashCommandBuilder().setName('rank').setDescription('Check your level and XP');
const lbCmd = new SlashCommandBuilder().setName('leaderboard').setDescription('View the server XP leaderboard');
if (typeof __setupCommands !== 'undefined') {
  __setupCommands.push(rankCmd.toJSON(), lbCmd.toJSON());
}

// Rank command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.replied || interaction.deferred) return;
  if (!interaction.guild) return;

  // Audit cycle-45 (2026-05-27): wrap the handler body so a botData / Redis
  // transient or a 3s-deadline overrun doesn't bubble up as an unhandled
  // rejection — Discord shows "application did not respond".
  try {
  const guildId = interaction.guild.id;

  if (interaction.commandName === 'rank') {
    // Defer first: botData.get hits the API (Postgres/Redis) and can exceed
    // Discord's 3s initial-response deadline, expiring the token (10062).
    // /rank is personal → ephemeral (no channel spam). Avatar-right thumbnail +
    // stacked stat lines (no inline-field squish next to a thumbnail), aqua
    // accent; footer + timestamp are auto-injected.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;
    const userData = await botData.get(userId, 'leveling', guildId) || { xp: 0, level: 0, totalXp: 0 };
    const xpForNextLevel = (level) => 5 * (level * level) + 50 * level + 100;
    const xpNeeded = xpForNextLevel(userData.level);
    const progress = Math.round((userData.xp / xpNeeded) * 100);

    await interaction.editReply({
      embeds: [{
        author: { name: `${interaction.user.username}'s Rank` },
        thumbnail: { url: interaction.user.displayAvatarURL() },
        description:
          '🎖️ **Level** · ' + vbNum(userData.level) + '\n' +
          '⚡ **XP** · ' + vbNum(userData.xp) + ' / ' + vbNum(xpNeeded) + '\n' +
          vbProgressBar(progress) + ' ' + progress + '%\n' +
          '📊 **Total XP** · ' + vbNum(userData.totalXp || 0),
        color: VB_COLORS.leveling,
        footer: { text: 'Powered by VibeBot.gg' },
        timestamp: new Date().toISOString()
      }]
    });
  }

  if (interaction.commandName === 'leaderboard') {
    // Defer first: the leaderboard aggregation is a heavier read than /rank,
    // so it is at least as exposed to the 3s deadline (10062).
    await interaction.deferReply();
    // Get top 10 users sorted by level (descending), then by totalXp (descending)
    const leaderboard = await botData.leaderboard('leveling', guildId, 'level', 10, 'desc');

    if (!leaderboard || leaderboard.length === 0) {
      await interaction.editReply('No leveling data yet! Start chatting to earn XP.');
      return;
    }

    const lb = leaderboard.map((entry, i) => {
      const medal = vbRankMedal(i);
      // Audit cycle-4 #5 (2026-05-27): leaderboard envelope returns
      // discordUserId, not userId. Previously rendered as <@undefined>.
      return `${medal} <@${entry.discordUserId}> - Level ${entry.data.level} (${vbNum(entry.data.totalXp || 0)} XP)`;
    }).join('\n');

    await interaction.editReply({
      embeds: [{
        title: '🏆 Leaderboard',
        description: lb,
        color: VB_COLORS.leveling,
        footer: { text: 'Powered by VibeBot.gg' },
        timestamp: new Date().toISOString()
      }]
    });
  }
  } catch (error) {
    console.error('[Leveling] Interaction error:', error);
    try {
      // After deferReply() the reply must be edited, not re-sent, or the
      // user is left staring at a perpetual "thinking" state on error.
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ Something went wrong.' });
      } else if (!interaction.replied) {
        await interaction.reply({ content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
});
})().catch(e => console.error('[Leveling System] startup error:', e));

// ===== Mod Queue =====
(async () => {
// Mod Queue System
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');

const EMBED_COLOR = "#57F287";

const immuneRoles = new Set([]);
const flagKeywords = [].map(k => k.toLowerCase());
// Audit cycle-7 #5 (2026-05-27): queueVotes was in-memory only. Bot restart
// between flag and first vote returned "Vote data expired" forever — buttons
// stayed on Discord but the bot had no state to act on. Now: an in-memory
// L1 Map (for hot reads) PLUS botData persistence keyed by message id; the
// L1 hydrates lazily from botData when missing.
const queueVotes = new Map(); // messageId -> { approve: Set, deny: Set, userId, channelId, content }

async function persistVote(messageId, voteData, guildId) {
  const serialized = {
    approve: [...voteData.approve],
    deny: [...voteData.deny],
    userId: voteData.userId,
    channelId: voteData.channelId,
    content: voteData.content,
  };
  await botData.set(messageId, 'modq_vote', serialized, guildId).catch(() => {});
}

async function loadVote(messageId, guildId) {
  let voteData = queueVotes.get(messageId);
  if (voteData) return voteData;
  const persisted = await botData.get(messageId, 'modq_vote', guildId).catch(() => null);
  if (!persisted) return null;
  voteData = {
    approve: new Set(persisted.approve || []),
    deny: new Set(persisted.deny || []),
    userId: persisted.userId,
    channelId: persisted.channelId,
    content: persisted.content,
  };
  queueVotes.set(messageId, voteData);
  return voteData;
}

// Audit cycle-20 (2026-05-27): two mods clicking the same button at the
// same tick both reached the destructive action — kick/ban/timeout ran
// twice. queueVotes.delete is synchronous and returns true exactly once;
// gate every terminal action on its return.
async function claimQueueAction(messageId, guildId) {
  const claimed = queueVotes.delete(messageId);
  if (claimed) {
    await botData.set(messageId, 'modq_vote', null, guildId).catch(() => {});
  }
  return claimed;
}

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('\u{1F6E1}\uFE0F Mod Queue')
    .setColor(EMBED_COLOR)
    .setDescription('Flagged messages appear in the mod queue. Use the buttons on each flagged message to take action.')
    .addFields(
      { name: '\u2705 Approve', value: 'Approve the flagged message (may require 3 vote(s))' },
      { name: '\u{1F5D1}\uFE0F Delete', value: 'Delete the flagged message' }
    );
}

function shouldFlag(message) {
  const content = message.content.toLowerCase();

  // Keyword check
  if (flagKeywords.length && flagKeywords.some(kw => content.includes(kw))) return 'Flagged keyword';

  

  

  

  return null;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.member) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  if (message.member.roles.cache.some(r => immuneRoles.has(r.id))) return;

  const reason = shouldFlag(message);
  if (!reason) return;
  markMessageHandled(message); // flagged for review — persona shouldn't reply over it

  

  const queueChannel = message.guild.channels.cache.get("1557533507293814845");
  if (!queueChannel || typeof queueChannel.send !== 'function') return;

  const embed = new EmbedBuilder()
    .setTitle('🔍 Flagged Message')
    .setThumbnail(message.author.displayAvatarURL())
    .setColor(EMBED_COLOR)
    .addFields(
      { name: '👤 Author', value: `${message.author.tag} (${message.author.id})`, inline: true },
      { name: '🔗 Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: '🛡️ Reason', value: reason },
      { name: '💬 Content', value: message.content.slice(0, 1024) || '[no text]' }
    )
    .setTimestamp();

  if (message.attachments.size > 0) {
    embed.addFields({
      name: '📎 Attachments',
      value: message.attachments.map(a => a.url).join('\n').slice(0, 1024)
    });
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`modq_approve_${message.author.id}`)
      .setLabel('✅ Approve (0/3)')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`modq_delete_${message.author.id}`)
      .setLabel('🗑️ Delete')
      .setStyle(ButtonStyle.Danger),
    
    
    
  );

  const queueMsg = await queueChannel.send({ embeds: [embed], components: [buttons] });
  const initVote = { approve: new Set(), deny: new Set(), userId: message.author.id, channelId: message.channel.id, content: message.content };
  queueVotes.set(queueMsg.id, initVote);
  // Persist so a redeploy between flag and first vote doesn't lose state.
  await persistVote(queueMsg.id, initVote, message.guild.id);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.replied || interaction.deferred) return;
  if (!interaction.customId.startsWith('modq_')) return;

  try {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ content: '\u274C You need Manage Messages permission.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
  }

  // Ack FIRST — loadVote/persistVote/claimQueueAction (botData) + members.fetch
  // below exceed Discord's 3s deadline. deferUpdate leaves the flagged message
  // untouched until we editReply it with the action result.
  await interaction.deferUpdate();

  const [, action, userId] = interaction.customId.split('_');
  // Lazy-hydrate from botData if process-local Map missed (bot restart).
  const voteData = await loadVote(interaction.message.id, interaction.guild.id);

  if (action === 'approve') {
    if (!voteData) {
      return interaction.followUp({ content: '\u26A0\uFE0F Vote data expired.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
    }
    voteData.approve.add(interaction.user.id);
    // Persist every vote — a restart between vote N and N+1 was losing
    // all but the initial empty-Set persisted at queue time.
    await persistVote(interaction.message.id, voteData, interaction.guild.id);

    if (voteData.approve.size >= 3) {
      if (!(await claimQueueAction(interaction.message.id, interaction.guild.id))) {
        return interaction.followUp({ content: '\u26A0\uFE0F Already processed by another moderator.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      const embed = EmbedBuilder.from(interaction.message.embeds[0] || { description: 'Original embed missing' })
        .setColor(VB_COLORS.success)
        .setTitle('\u2705 Approved');
      await interaction.editReply({ embeds: [embed], components: [] });
    } else {
      const approveBtn = ButtonBuilder.from(interaction.message.components[0].components[0])
        .setLabel(`\u2705 Approve (${voteData.approve.size}/3)`);
      const row = ActionRowBuilder.from(interaction.message.components[0]);
      row.components[0] = approveBtn;
      await interaction.editReply({ components: [row] });
    }
    return;
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  if (action === 'delete') {
    if (!(await claimQueueAction(interaction.message.id, interaction.guild.id))) {
      return interaction.followUp({ content: '\u26A0\uFE0F Already processed by another moderator.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const embed = EmbedBuilder.from(interaction.message.embeds[0] || { description: 'Original embed missing' })
      .setColor(VB_COLORS.error)
      .setTitle('\u{1F5D1}\uFE0F Deleted')
      .addFields({ name: '🛡️ Actioned by', value: interaction.user.tag });
    await interaction.editReply({ embeds: [embed], components: [] });
  }

  

  

  

  const logChannel = interaction.guild.channels.cache.get("1557529984246091836");
  if (logChannel && typeof logChannel.send === 'function') {
    const logEmbed = new EmbedBuilder()
      .setTitle('\u{1F4CB} Mod Queue Action')
      .setColor(EMBED_COLOR)
      .addFields(
        { name: '👤 User', value: `<@${userId}>`, inline: true },
        { name: '⚙️ Action', value: action, inline: true },
        { name: '🛡️ Moderator', value: interaction.user.tag, inline: true }
      )
      .setTimestamp();
    logChannel.send({ embeds: [logEmbed] }).catch(() => {});
  }
  } catch (error) {
    console.error('[ModQueue] Interaction error:', error);
    try {
      const errorMessage = { content: '\u274C Something went wrong. Please try again.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch {}
  }
});

console.log('Mod Queue system ready!');
})().catch(e => console.error('[Mod Queue] startup error:', e));

// ===== Raid Protection =====
(async () => {
// Raid Protection System
const { EmbedBuilder } = require('discord.js');

const RAID_CONFIG = {
  minAccountAge: 7,
  accountAgeAction: "quarantine",
  joinRateEnabled: true,
  joinRateLimit: 10,
  joinRateInterval: 10000,
  joinRateAction: "ban",
  usernameFilterEnabled: true,
  usernameAction: "kick",
  quarantineRole: "",
  whitelistRoles: [],
  logChannel: "1557529984246091836",
  dmOnAction: true,
  timeoutDuration: 3600000,
};

// Join rate tracking (in-memory)
const recentJoins = [];
let raidModeActive = false;
let raidModeTimeout = null;

// Lockdown state. Holds what the server looked like BEFORE the lockdown so it can be
// put back exactly, and null means "not locked down".
let _lockdownPrev = null;
let _lockdownTimer = null;

async function applyLockdown(guild, reason) {
  if (_lockdownPrev) return; // already locked down — don't stack, don't re-capture
  const prev = {
    verificationLevel: guild.verificationLevel,
    invitesWereDisabled: guild.features?.includes('INVITES_DISABLED') === true,
  };
  // Pausing invites is the part that actually stops a raid growing; raising the
  // verification level is the fallback when the bot lacks the invite permission.
  try {
    if (!prev.invitesWereDisabled && typeof guild.disableInvites === 'function') {
      await guild.disableInvites(true);
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Lockdown invites failed:', e?.message);
  }
  try {
    // 3 = HIGH (verified phone). Never LOWER an already-stricter setting.
    if (typeof guild.verificationLevel === 'number' && guild.verificationLevel < 3) {
      await guild.setVerificationLevel(3, `Raid protection: ${reason}`);
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Lockdown verification failed:', e?.message);
  }
  _lockdownPrev = prev;
  console.warn('[raid-protection] SERVER LOCKED DOWN —', reason);

  // ALWAYS self-lifting. A lockdown silently blocks every legitimate join, and the
  // account-age path can trigger one outside raid mode, where nothing else would
  // ever put the server back.
  if (_lockdownTimer) clearTimeout(_lockdownTimer);
  _lockdownTimer = safeTimeout(() => { liftLockdown(guild); }, 300000);
}

async function liftLockdown(guild) {
  if (!_lockdownPrev) return;
  const prev = _lockdownPrev;
  _lockdownPrev = null;
  if (_lockdownTimer) { clearTimeout(_lockdownTimer); _lockdownTimer = null; }
  try {
    if (!prev.invitesWereDisabled && typeof guild.disableInvites === 'function') {
      await guild.disableInvites(false);
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Lockdown lift invites failed:', e?.message);
  }
  try {
    if (typeof prev.verificationLevel === 'number') {
      await guild.setVerificationLevel(prev.verificationLevel, 'Raid protection: lockdown lifted');
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Lockdown lift verification failed:', e?.message);
  }
  console.log('[raid-protection] Server lockdown lifted');
}

async function logRaidAction(guild, member, action, reason) {
  if (!RAID_CONFIG.logChannel) return;
  try {
    const logChannel = guild.channels.cache.get(RAID_CONFIG.logChannel);
    if (!logChannel || typeof logChannel.send !== 'function') return;
    const embed = new EmbedBuilder()
      .setTitle(raidModeActive ? '🚨 Raid Protection — Active' : '🛡️ Raid Protection')
      .setThumbnail(member.user.displayAvatarURL())
      .setColor(VB_COLORS.error)
      .addFields(
        { name: '👤 User', value: `${member.user.tag} (${member.id})`, inline: true },
        { name: '⚙️ Action', value: action, inline: true },
        { name: '🛡️ Reason', value: reason },
        { name: '📅 Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` }
      )
      .setTimestamp();
    await logChannel.send({ embeds: [embed] });
  } catch {}
}

async function executeAction(member, action, reason) {
  // DM before action — skip bot accounts (can't DM bots) and swallow 50007
  // (DMs closed / no mutual guild). During a raid, hundreds of 50007s in
  // a row count toward Cloudflare's 10k-invalid-in-10min IP ban.
  // No DM for 'lockdown' — nothing happened to THIS member, so "you have been ..."
  // would be a lie, and a raid would send it to every joiner.
  if (RAID_CONFIG.dmOnAction && !member.user.bot && action !== 'lockdown') {
    try {
      await member.send(`⚠️ You have been ${action === 'ban' ? 'banned' : action === 'kick' ? 'kicked' : action === 'quarantine' ? 'quarantined' : 'timed out'} from **${member.guild.name}**.\nReason: ${reason}`);
    } catch (e) {
      if (e?.code !== 50007 && e?.code !== 50001) console.error('Raid DM failed:', e?.message);
    }
  }

  try {
    switch (action) {
      case 'ban':
        if (member.bannable) await member.ban({ reason: `Raid protection: ${reason}`, deleteMessageSeconds: 86400 });
        break;
      case 'kick':
        if (member.kickable) await member.kick(`Raid protection: ${reason}`);
        break;
      case 'quarantine':
        if (RAID_CONFIG.quarantineRole) {
          // Check role hierarchy — quarantine role above bot's highest crashes silent 50013
          const me = await member.guild.members.fetchMe();
          const quarantineRole = member.guild.roles.cache.get(RAID_CONFIG.quarantineRole);
          if (quarantineRole && quarantineRole.position < me.roles.highest.position) {
            await member.roles.add(RAID_CONFIG.quarantineRole, `Raid protection: ${reason}`);
          }
        }
        break;
      case 'timeout':
        if (member.moderatable) await member.timeout(RAID_CONFIG.timeoutDuration, `Raid protection: ${reason}`);
        break;
      case 'lockdown':
        // Server-level: the member who tripped it is deliberately left in place.
        await applyLockdown(member.guild, reason);
        break;
    }
  } catch (e) {
    if (e?.code !== 50013 && e?.code !== 50001) console.error('Raid action failed:', e?.message);
  }

  await logRaidAction(member.guild, member, action, reason);
}

function checkUsername(name) {
  if (/[\u0300-\u036f\u0489]{3,}/.test(name)) return 'Zalgo text detected';
  if (/(discord\.gg|discord\.com\/invite)/i.test(name)) return 'Invite link in username';
  if (/^[0-9]+$/.test(name)) return 'Numeric-only username';
  return null;
}

client.on('guildMemberAdd', async (member) => {
  if (member.user.bot) return;

  // Skip whitelisted roles (for pre-assigned roles via invite)
  if (RAID_CONFIG.whitelistRoles.length > 0) {
    if (member.roles.cache.some(r => RAID_CONFIG.whitelistRoles.includes(r.id))) return;
  }

  // Join rate tracking
  if (RAID_CONFIG.joinRateEnabled) {
    const now = Date.now();
    recentJoins.push(now);
    // Clean old entries
    while (recentJoins.length > 0 && (now - recentJoins[0]) > RAID_CONFIG.joinRateInterval) {
      recentJoins.shift();
    }

    if (recentJoins.length >= RAID_CONFIG.joinRateLimit) {
      // Raid detected!
      if (!raidModeActive) {
        raidModeActive = true;
        console.warn('[raid-protection] RAID MODE ACTIVATED');

        if (RAID_CONFIG.logChannel) {
          try {
            const logChannel = member.guild.channels.cache.get(RAID_CONFIG.logChannel);
            if (logChannel && typeof logChannel.send === 'function') {
              const raidEmbed = new EmbedBuilder()
                .setTitle('🚨 RAID MODE ACTIVATED')
                .setColor(VB_COLORS.error)
                .setDescription(`${recentJoins.length} joins detected in ${RAID_CONFIG.joinRateInterval / 1000}s. All new joins will be ${RAID_CONFIG.joinRateAction}.`)
                .setTimestamp();
              await logChannel.send({ embeds: [raidEmbed] });
            }
          } catch {}
        }
      }

      // Clear raid mode after 5 minutes of no new joins.
      // Audit cycle-4 #2 (2026-05-27): use safeTimeout/safeClearTimeout so the
      // raid-mode timer is tracked for SIGTERM cleanup and the dead container
      // doesn't keep flipping raidModeActive post-shutdown.
      if (raidModeTimeout) clearTimeout(raidModeTimeout);
      const _raidGuild = member.guild;
      raidModeTimeout = safeTimeout(() => {
        raidModeActive = false;
        recentJoins.length = 0;
        // A join-rate lockdown is tied to the raid, so it ends with it.
        liftLockdown(_raidGuild);
        console.log('[raid-protection] Raid mode deactivated');
      }, 300000);

      await executeAction(member, RAID_CONFIG.joinRateAction, 'Raid detected — join rate exceeded');
      return;
    }
  }

  // During active raid mode, take action on all joins
  if (raidModeActive) {
    await executeAction(member, RAID_CONFIG.joinRateAction, 'Raid mode active');
    return;
  }

  // Account age check
  if (RAID_CONFIG.minAccountAge > 0) {
    const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86400000;
    if (accountAgeDays < RAID_CONFIG.minAccountAge) {
      await executeAction(member, RAID_CONFIG.accountAgeAction, `Account too new (${Math.floor(accountAgeDays)} days, minimum ${RAID_CONFIG.minAccountAge})`);
      return;
    }
  }

  // Username filter
  if (RAID_CONFIG.usernameFilterEnabled) {
    const username = member.user.username;
    const displayName = member.displayName;
    const usernameViolation = checkUsername(username) || checkUsername(displayName);
    if (usernameViolation) {
      await executeAction(member, RAID_CONFIG.usernameAction, usernameViolation);
      return;
    }
  }
});

console.log('Raid protection system ready!');
})().catch(e => console.error('[Raid Protection] startup error:', e));

// ===== Warning System =====
(async () => {
// Warning System with Autopunish
const { EmbedBuilder, SlashCommandBuilder, MessageFlags } = require('discord.js');

const EMBED_COLOR = "#ED4245";

// Configuration
const WARNING_CONFIG = {
  autopunish: [
  {
    "id": "1",
    "warnCount": 3,
    "action": "timeout",
    "duration": 60,
    "reason": "Auto: 3 warnings"
  },
  {
    "id": "2",
    "warnCount": 5,
    "action": "kick",
    "reason": "Auto: 5 warnings"
  },
  {
    "id": "3",
    "warnCount": 7,
    "action": "ban",
    "reason": "Auto: 7 warnings"
  }
],
  warnExpiry: 90, // days, 0 = never
  dmOnWarn: true,
  dmOnAutopunish: true,
  logChannelId: "1557529984246091836",
  showWarnId: true,
  // Audit cycle-9 #1 (2026-05-27): moderatorRoleIds and protectedRoleIds were
  // declared in the config interface but never read by the generated handler.
  // Without these, any guild member could /warn or /clearwarnings anyone,
  // and protected roles offered zero protection from autopunish.
  moderatorRoleIds: [],
  protectedRoleIds: [],
};

// Audit cycle-9 #1: gate moderator commands on configured roles OR the
// Discord ModerateMembers permission as a fallback.
function _isModerator(member) {
  if (!member) return false;
  if (member.permissions?.has?.('ModerateMembers')) return true;
  if (WARNING_CONFIG.moderatorRoleIds.length === 0) return false;
  return WARNING_CONFIG.moderatorRoleIds.some(r => member.roles?.cache?.has?.(r));
}

function _isProtected(member) {
  if (!member) return false;
  return WARNING_CONFIG.protectedRoleIds.some(r => member.roles?.cache?.has?.(r));
}

// Generate warning ID
function generateWarnId() {
  return 'warn-' + Math.random().toString(36).substring(2, 8);
}

// Get user warnings (filtered by expiry)
async function getUserWarnings(guildId, userId) {
  const data = await botData.get(userId, 'warnings', guildId);
  const userWarnings = data?.warnings || [];

  if (WARNING_CONFIG.warnExpiry === 0) {
    return userWarnings;
  }

  const expiryDate = Date.now() - (WARNING_CONFIG.warnExpiry * 24 * 60 * 60 * 1000);
  return userWarnings.filter(w => w.timestamp > expiryDate);
}

// Add warning — atomic so two mods warning the same user simultaneously
// don't drop one of the warnings via get-then-set race.
async function addWarning(guildId, userId, moderatorId, reason) {
  const warning = {
    id: generateWarnId(),
    moderatorId,
    reason,
    timestamp: Date.now(),
  };

  await botData.update(userId, 'warnings', (cur) => ({
    warnings: [...(cur?.warnings || []), warning],
  }), guildId);
  return warning;
}

// Check and execute autopunish
async function checkAutopunish(member, warnCount) {
  const rules = WARNING_CONFIG.autopunish.sort((a, b) => b.warnCount - a.warnCount);

  for (const rule of rules) {
    if (warnCount >= rule.warnCount) {
      try {
        let actionTaken = '';

        // Role/permission prechecks — silent 50013 on higher-role targets would
        // count toward CF's 10k-invalid IP ban over time.
        const me = await member.guild.members.fetchMe();
        // X-Audit-Log-Reason caps at 512; rule.reason is user-config.
        const auditReason = sanitizeAuditReason(rule.reason);
        switch (rule.action) {
          case 'timeout':
            if (member.moderatable) {
              await member.timeout(rule.duration * 60 * 1000, auditReason);
              actionTaken = `timed out for ${rule.duration} minutes`;
            }
            break;

          case 'mute':
            if (rule.roleId) {
              const r = member.guild.roles.cache.get(rule.roleId);
              if (canGrantRole(r, me, member.guild.id)) {
                await member.roles.add(rule.roleId, auditReason);
                actionTaken = 'muted';
              }
            }
            break;

          case 'kick':
            if (member.kickable) {
              await member.kick(auditReason);
              actionTaken = 'kicked';
            }
            break;

          case 'ban':
            if (member.bannable) {
              await member.ban({ reason: auditReason });
              actionTaken = 'banned';
            }
            break;

          case 'addRole':
            if (rule.roleId) {
              const r = member.guild.roles.cache.get(rule.roleId);
              if (canGrantRole(r, me, member.guild.id)) {
                await member.roles.add(rule.roleId, auditReason);
                actionTaken = `given role`;
              }
            }
            break;
        }

        // DM user about autopunish
        if (WARNING_CONFIG.dmOnAutopunish && actionTaken) {
          try {
            await member.send({
              embeds: [new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle('⚠️ Autopunish Triggered')
                .setDescription(`You have been ${actionTaken} in **${member.guild.name}**`)
                .addFields(
                  { name: 'Reason', value: rule.reason || 'Reached warning threshold' },
                  { name: 'Warnings', value: `${warnCount}` }
                )
                .setTimestamp()
              ]
            });
          } catch {}
        }

        return { action: rule.action, actionTaken, rule };
      } catch (error) {
        console.error('Autopunish failed:', error);
      }

      break;
    }
  }

  return null;
}

// Log to channel
async function logWarning(guild, moderator, target, warning, autopunish = null) {
  if (!WARNING_CONFIG.logChannelId) return;

  try {
    const logChannel = await guild.channels.fetch(WARNING_CONFIG.logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(autopunish ? '🔨 Autopunish Triggered' : '⚠️ Warning Issued')
      .addFields(
        { name: 'User', value: `${target} (${target.id})`, inline: true },
        { name: 'Moderator', value: `${moderator}`, inline: true },
        { name: 'Reason', value: warning.reason || 'No reason provided' }
      )
      .setTimestamp();

    if (WARNING_CONFIG.showWarnId) {
      embed.addFields({ name: 'Warning ID', value: warning.id, inline: true });
    }

    if (autopunish) {
      embed.addFields({ name: 'Action', value: autopunish.actionTaken });
    }

    await logChannel.send({ embeds: [embed] });
  } catch {}
}

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('⚠️ Warning System Commands')
    .setColor(EMBED_COLOR)
    .setDescription('Here are all the commands you can use:')
    .addFields(
      { name: '⚠️ /warn <user> [reason]', value: 'Warn a user', inline: true },
      { name: '📋 /warnings <user>', value: 'View warnings for a user', inline: true },
      { name: '🗑️ /clearwarnings <user>', value: 'Clear all warnings for a user', inline: true },
      { name: '❌ /delwarn <user> <id>', value: 'Delete a specific warning by ID', inline: true },
      { name: '❓ /warnhelp', value: 'Show this help message', inline: true },
    );
}

// Slash commands
// Audit cycle-42 (2026-05-27): defense-in-depth — runtime _isModerator
// check exists at handler entry, but Discord-level gate hides these from
// non-mods in the slash-command UI by default.
const warnCommand = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Warn a user')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('User to warn')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reason for warning')
      .setMaxLength(1000)
  );

const warningsCommand = new SlashCommandBuilder()
  .setName('warnings')
  .setDescription('View warnings for a user')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('User to check')
      .setRequired(true)
  );

const clearwarningsCommand = new SlashCommandBuilder()
  .setName('clearwarnings')
  .setDescription('Clear all warnings for a user')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('User to clear warnings for')
      .setRequired(true)
  );

const delwarnCommand = new SlashCommandBuilder()
  .setName('delwarn')
  .setDescription('Delete a specific warning')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('User who has the warning')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('id')
      .setDescription('Warning ID to delete')
      .setRequired(true)
  );

const warnhelpCommand = new SlashCommandBuilder()
  .setName('warnhelp')
  .setDescription('Show warning system commands');

// Register the warning commands so registerCommands() pushes them to Discord.
if (typeof __setupCommands !== 'undefined') {
  __setupCommands.push(
    warnCommand.toJSON(),
    warningsCommand.toJSON(),
    clearwarningsCommand.toJSON(),
    delwarnCommand.toJSON(),
    warnhelpCommand.toJSON(),
  );
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild || !interaction.member) return;
  if (interaction.replied || interaction.deferred) return;
  if (!['warn', 'warnings', 'clearwarnings', 'delwarn', 'warnhelp'].includes(interaction.commandName)) return;

  try {
  if (interaction.commandName === 'warnhelp') {
    return interaction.reply({ embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'warn') {
    // Audit cycle-9 #1 (2026-05-27): gate /warn on moderator check.
    if (!_isModerator(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to warn users.', flags: MessageFlags.Ephemeral });
    }
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (user.bot) {
      return interaction.reply({ content: '❌ Cannot warn bots!', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.editReply({ content: '❌ User not found in this server.', embeds: [buildHelpEmbed()] });

    // Audit cycle-9 #1: skip warning users in protected roles.
    if (_isProtected(member)) {
      return interaction.editReply({ content: '❌ This user has a protected role and cannot be warned.' });
    }

    const warning = await addWarning(
      interaction.guild.id,
      user.id,
      interaction.user.id,
      reason
    );

    const userWarnings = await getUserWarnings(interaction.guild.id, user.id);

    if (WARNING_CONFIG.dmOnWarn) {
      try {
        await user.send({
          embeds: [new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('⚠️ You have been warned')
            .setDescription(`You received a warning in **${interaction.guild.name}**`)
            .addFields(
              { name: 'Reason', value: reason },
              { name: 'Total Warnings', value: `${userWarnings.length}` }
            )
            .setTimestamp()
          ]
        });
      } catch {}
    }

    const autopunish = await checkAutopunish(member, userWarnings.length);

    await logWarning(interaction.guild, interaction.user, user, warning, autopunish);

    const nextRule = WARNING_CONFIG.autopunish
      .filter(r => r.warnCount > userWarnings.length)
      .sort((a, b) => a.warnCount - b.warnCount)[0];

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setThumbnail(user.displayAvatarURL())
      .setTitle(autopunish ? '⚠️ Warning + Autopunish' : '⚠️ Warning Issued')
      .addFields(
        { name: '👤 User', value: `${user}`, inline: true },
        { name: '🛡️ Reason', value: reason },
        { name: '⚠️ Total Warnings', value: vbNum(userWarnings.length), inline: true }
      )
      .setTimestamp();

    if (WARNING_CONFIG.showWarnId) {
      embed.addFields({ name: '🆔 ID', value: warning.id, inline: true });
    }

    if (autopunish) {
      embed.addFields({ name: '🔨 Action Taken', value: autopunish.actionTaken });
    } else if (nextRule) {
      embed.setFooter({ text: `${nextRule.warnCount - userWarnings.length} more warning(s) until ${nextRule.action}` });
    }

    await interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === 'warnings') {
    await interaction.deferReply();
    const user = interaction.options.getUser('user');
    const userWarnings = await getUserWarnings(interaction.guild.id, user.id);

    if (userWarnings.length === 0) {
      return interaction.editReply({
        content: `✅ ${user} has no warnings.`,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setThumbnail(user.displayAvatarURL())
      .setTitle(`⚠️ Warnings for ${user.tag}`)
      .setDescription(
        userWarnings.map((w, i) => {
          const date = new Date(w.timestamp).toLocaleDateString();
          return `**${i + 1}.** ${w.reason}\n   ${WARNING_CONFIG.showWarnId ? `ID: ${w.id} | ` : ''}${date}`;
        }).join('\n\n')
      )
      .setFooter({ text: `Total: ${vbNum(userWarnings.length)} warning(s)` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === 'clearwarnings') {
    // Audit cycle-9 #1: moderator gate (synchronous — keep as a fast reply).
    if (!_isModerator(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to clear warnings.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');

    await botData.set(user.id, 'warnings', { warnings: [] }, interaction.guild.id);

    await interaction.editReply({
      content: `✅ Cleared all warnings for ${user}`,
    });
  }

  if (interaction.commandName === 'delwarn') {
    // Audit cycle-9 #1: moderator gate (synchronous — keep as a fast reply).
    if (!_isModerator(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to delete warnings.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const warnId = interaction.options.getString('id');

    // Audit cycle-9 #2: atomic CAS so two concurrent /delwarn don't drop deletions.
    let deleted = false;
    await botData.update(user.id, 'warnings', (cur) => {
      const list = cur?.warnings || [];
      const idx = list.findIndex(w => w.id === warnId);
      if (idx === -1) return cur;
      deleted = true;
      const next = [...list.slice(0, idx), ...list.slice(idx + 1)];
      return { warnings: next };
    }, interaction.guild.id);

    if (deleted) {
      return interaction.editReply({
        content: `✅ Deleted warning ${warnId} from ${user}`,
      });
    }

    await interaction.editReply({
      content: `❌ Warning not found: ${warnId}`,
      embeds: [buildHelpEmbed()],
    });
  }
  } catch (error) {
    console.error('[Warnings] Error:', error);
    try {
      // A deferred-but-unedited reply must be edited, not followed up, or the
      // "thinking" placeholder hangs.
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ Something went wrong. Here are the available commands:', embeds: [buildHelpEmbed()] });
      } else if (interaction.replied) {
        await interaction.followUp({ content: '❌ Something went wrong. Here are the available commands:', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: '❌ Something went wrong. Here are the available commands:', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      // interaction expired or already handled
    }
  }
});

console.log('Warning system with autopunish ready!');

})().catch(e => console.error('[Warning System] startup error:', e));

// ===== Sticky Roles =====
(async () => {
// Sticky Roles System
const { EmbedBuilder } = require('discord.js');

function shouldStick(roleId, guildId) {
  return roleId !== guildId; // All roles except @everyone
}
async function logStickyRole() {}

const MAX_STORAGE_DAYS = -1;

// Save roles when member leaves
client.on('guildMemberRemove', async (member) => {
  // Audit cycle-12 #4 (2026-05-27): skip bot members so this bot doesn't
  // save its own roles on rejoin / pollute botData with bot IDs.
  if (member.user?.bot) return;
  const stickyRoles = member.roles.cache
    .filter(role => shouldStick(role.id, member.guild.id))
    .map(role => role.id);

  if (stickyRoles.length === 0) return;

  await botData.set(member.id, 'sticky_roles', {
    roles: stickyRoles,
    savedAt: Date.now(),
  }, member.guild.id);

  await logStickyRole(member.guild, member.user, 'Saved', stickyRoles.length);
});

// Restore roles when member rejoins
client.on('guildMemberAdd', async (member) => {
  // Audit cycle-12 #4: skip bot members.
  if (member.user?.bot) return;
  const data = await botData.get(member.id, 'sticky_roles', member.guild.id);
  if (!data?.roles || data.roles.length === 0) return;

  // Check expiry
  if (MAX_STORAGE_DAYS > 0) {
    const ageDays = (Date.now() - data.savedAt) / 86400000;
    if (ageDays > MAX_STORAGE_DAYS) {
      await botData.set(member.id, 'sticky_roles', null, member.guild.id);
      return;
    }
  }

  // Audit cycle-11 (2026-05-27): batch all sticky roles into a single
  // member.roles.add(arr) call. Sequential adds = N REST calls (~200ms
  // each) and the cache becomes stale by the last add; a single PATCH
  // applies all roles in one audit-log entry.
  const restoredRoles = [];
  const restoredIds = [];
  for (const roleId of data.roles) {
    if (!shouldStick(roleId, member.guild.id)) continue;
    const role = member.guild.roles.cache.get(roleId);
    // Audit cycle-34 (2026-05-27): skip managed roles (Nitro booster,
    // integration) — including one in the batch 50028s the WHOLE add and
    // every sticky role is lost in the catch.
    if (!role || !role.editable || role.managed) continue;
    restoredIds.push(roleId);
    restoredRoles.push(role.name);
  }
  if (restoredIds.length > 0) {
    try { await member.roles.add(restoredIds, 'Sticky roles restored'); }
    catch { restoredRoles.length = 0; }
  }

  // Clean up stored data
  await botData.set(member.id, 'sticky_roles', null, member.guild.id);

  if (restoredRoles.length > 0) {
    await logStickyRole(member.guild, member.user, 'Restored', restoredRoles.length);

    try {
      await member.send(`✅ Welcome back to **${member.guild.name}**! Your roles have been restored: ${restoredRoles.join(', ')}`);
    } catch {}
  }
});

console.log('Sticky roles system ready!');
})().catch(e => console.error('[Sticky Roles] startup error:', e));

// ===== Economy System =====
(async () => {
// Economy System - Generated by VibeBot
const { Client, EmbedBuilder, Collection, SlashCommandBuilder } = require('discord.js');

// Economy configuration
const economyConfig = {
  "enabled": true,
  "currencyName": "coins",
  "currencyEmoji": "💰",
  "startingBalance": 100,
  "dailyReward": 500,
  "dailyCooldown": 86400,
  "weeklyReward": 3500,
  "workMinReward": 50,
  "workMaxReward": 200,
  "workCooldown": 3600,
  "crimeMinReward": 100,
  "crimeMaxReward": 500,
  "crimeSuccessRate": 60,
  "crimePenalty": 200,
  "crimeCooldown": 7200,
  "robEnabled": true,
  "robSuccessRate": 40,
  "robMinPercent": 10,
  "robMaxPercent": 30,
  "robCooldown": 14400,
  "gamblingEnabled": true,
  "slotsMinBet": 10,
  "slotsMaxBet": 10000,
  "blackjackEnabled": true,
  "coinflipEnabled": true,
  "shopEnabled": true,
  "shopItems": [],
  "leaderboardSize": 10,
  "taxEnabled": false,
  "taxRate": 5,
  "taxThreshold": 100000
};

// Persistent storage using botData API (survives restarts)
// Helper functions
async function getBalance(userId, guildId) {
  const data = await botData.get(userId, 'economy', guildId);
  return data?.balance ?? economyConfig.startingBalance;
}

async function setBalance(userId, amount, guildId) {
  await botData.set(userId, 'economy', { balance: Math.max(0, amount) }, guildId);
}

// Atomic balance mutations — botData.update wraps a CAS retry so two
// concurrent commands (e.g., /work + /daily fired together) don't clobber
// each other's writes and lose currency.
async function addBalance(userId, amount, guildId) {
  await botData.update(userId, 'economy', (cur) => ({
    balance: Math.max(0, ((cur?.balance ?? economyConfig.startingBalance)) + amount),
  }), guildId);
}

async function removeBalance(userId, amount, guildId) {
  await botData.update(userId, 'economy', (cur) => ({
    balance: Math.max(0, ((cur?.balance ?? economyConfig.startingBalance)) - amount),
  }), guildId);
}

// Audit cycle-6 (2026-05-27): atomic try-debit. Returns the amount actually
// debited (0 if balance < amount). Use this for transfer/bet flows where
// the recipient must only be credited the amount we actually took. Closes
// the TOCTOU window in /give, /coinflip, /slots, /rob: two concurrent
// commands previously both passed the getBalance check, both hit the
// CAS-clamped remove, but each credited the recipient the full amount —
// minting money.
async function tryDebit(userId, amount, guildId) {
  let debited = 0;
  await botData.update(userId, 'economy', (cur) => {
    const bal = (cur?.balance ?? economyConfig.startingBalance);
    if (bal < amount) { debited = 0; return cur; }
    debited = amount;
    return { balance: bal - amount };
  }, guildId);
  return debited;
}

function formatCurrency(amount) {
  return `${economyConfig.currencyEmoji} ${amount.toLocaleString()} ${economyConfig.currencyName}`;
}

async function getCooldown(userId, command, guildId) {
  const data = await botData.get(userId, 'economy_cooldowns', guildId);
  const expiry = data?.[command];
  if (!expiry) return 0;
  const remaining = expiry - Date.now();
  return remaining > 0 ? remaining : 0;
}

async function setCooldown(userId, command, seconds, guildId) {
  const data = await botData.get(userId, 'economy_cooldowns', guildId) || {};
  data[command] = Date.now() + (seconds * 1000);
  await botData.set(userId, 'economy_cooldowns', data, guildId);
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Transport-neutral context. Both the '!' prefix (messageCreate) and the slash
// (interactionCreate) front doors build one of these and call the SAME command
// body — so the money logic never forks.
//   userId/guildId/guild/author/member  — the invoker + scope
//   userOpt()        — the target user (mention for prefix, 'user' option for slash) or null
//   intOpt(name, i)  — an integer arg ('name' option for slash, positional args[i] for prefix)
//   strOpt(name, i)  — a string arg, lowercased
//   respond(payload) — reply (message.reply for prefix; editReply for the deferred interaction)
function _ecoMsgCtx(message, args) {
  return {
    userId: message.author.id,
    guildId: message.guild.id,
    guild: message.guild,
    author: message.author,
    member: message.member,
    userOpt: () => message.mentions.users.first() || null,
    intOpt: (_name, i) => parseInt(args[i]),
    strOpt: (_name, i) => args[i]?.toLowerCase(),
    respond: (payload) => message.reply(payload).catch(() => {}),
  };
}

function _ecoIntCtx(interaction) {
  return {
    userId: interaction.user.id,
    guildId: interaction.guild.id,
    guild: interaction.guild,
    author: interaction.user,
    member: interaction.member,
    userOpt: () => interaction.options.getUser('user'),
    intOpt: (name) => { const v = interaction.options.getInteger(name); return v === null ? NaN : v; },
    strOpt: (name) => interaction.options.getString(name)?.toLowerCase(),
    respond: (payload) => interaction.editReply(payload).catch(() => {}),
  };
}

// Button ctx for the balance card's [Daily]/[Work]/[Top] shortcuts. Those
// commands read no options, so userOpt/intOpt are inert; respond -> editReply
// after the dispatcher defers the button.
function _ecoBtnCtx(interaction) {
  return {
    userId: interaction.user.id,
    guildId: interaction.guild.id,
    guild: interaction.guild,
    author: interaction.user,
    member: interaction.member,
    userOpt: () => null,
    intOpt: () => NaN,
    strOpt: () => undefined,
    respond: (payload) => interaction.editReply(payload).catch(() => {}),
  };
}

// The balance-card action buttons — shared by the /balance render and the button
// handler's in-place refresh. Discord buttons have no selected state, so to show
// which one was last clicked we rebuild them each update with the active id
// styled success (green) and the rest secondary (grey).
function _ecoBalanceButtons(active) {
  return [
    { id: 'eco_balance', label: 'Balance', emoji: '💰' },
    { id: 'eco_daily', label: 'Daily', emoji: '💸' },
    { id: 'eco_work', label: 'Work', emoji: '💼' },
    { id: 'eco_baltop', label: 'Top', emoji: '📊' },
  ].map((b) => ({ ...b, style: b.id === active ? 'success' : 'secondary' }));
}

// Economy commands — operate on a ctx (see above), not a raw message.
const economyCommands = {
  balance: async (ctx) => {
    const guildId = ctx.guildId;
    const target = ctx.userOpt() || ctx.author;
    const balance = await getBalance(target.id, guildId);

    // Stat grid (Dank Memer-style): balance headline + rank + what's claimable.
    // The claim status ties the card to its buttons. cooldowns = one fetch; rank
    // = a best-effort top-100 lookup. The balance card STAYS a classic embed: it
    // carries action buttons and is multi-edited in place by the button handler, so
    // it must not become V2 (a V2 message can't mix with the classic button-refresh
    // edits). One-shot command cards migrate via ctx.card → vbReply (VBCARD_DEFER).
    const _cds = await botData.get(target.id, 'economy_cooldowns', guildId) || {};
    const _ready = (k) => { const _exp = _cds[k]; const _rem = _exp ? _exp - Date.now() : 0; return _rem > 0 ? '⏳ ' + formatTime(_rem) : '✅ Ready'; };
    let _rank = 'Unranked';
    try {
      const _top = await botData.leaderboard('economy', guildId, 'balance', 100);
      const _i = _top.findIndex((e) => e.discordUserId === target.id);
      if (_i >= 0) _rank = (_i < 3 ? vbRankMedal(_i) + ' ' : '') + '#' + (_i + 1);
    } catch (e) {}

    // Clean premium layout: avatar on the RIGHT (thumbnail), bold balance
    // headline, a blank line for breathing room, then the stats as tidy stacked
    // lines in the description — NOT inline fields, which Discord narrows/squishes
    // when a thumbnail is present. Avatar shows once (thumbnail, not also an
    // author icon); the gold accent bar carries the colour identity.
    const embed = new EmbedBuilder()
      .setColor(economyConfig.embedColor || VB_COLORS.economy)
      .setAuthor({ name: target.username + "'s Wallet" })
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        economyConfig.currencyEmoji + ' **' + vbNum(balance) + '** ' + economyConfig.currencyName + '\n\n' +
        '🏆 **Rank** · ' + _rank + '\n' +
        '💸 **Daily** · ' + _ready('daily') + '\n' +
        '💼 **Work** · ' + _ready('work')
      )
      .setFooter({ text: 'Powered by VibeBot.gg' })
      .setTimestamp();

    ctx.respond({ embeds: [embed], components: [vbButtons(_ecoBalanceButtons('eco_balance'))] });
  },

  daily: async (ctx) => {
    const guildId = ctx.guildId;
    const cooldown = await getCooldown(ctx.userId, 'daily', guildId);
    if (cooldown > 0) {
      return ctx.respond(`You can claim your daily reward in ${formatTime(cooldown)}`);
    }

    await addBalance(ctx.userId, economyConfig.dailyReward, guildId);
    await setCooldown(ctx.userId, 'daily', economyConfig.dailyCooldown, guildId);

    if (ctx.member) {
      client.emit('dailyReward', ctx.member, { amount: economyConfig.dailyReward });
    }

    const embed = new EmbedBuilder()
      .setTitle('Daily Reward Claimed!')
      .setColor(0x00FF00)
      .setDescription(`You received ${formatCurrency(economyConfig.dailyReward)}`)
      .addFields({ name: 'New Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });

    ctx.respond({ embeds: [embed] });
  },

  weekly: async (ctx) => {
    const guildId = ctx.guildId;
    const cooldown = await getCooldown(ctx.userId, 'weekly', guildId);
    if (cooldown > 0) {
      return ctx.respond(`You can claim your weekly reward in ${formatTime(cooldown)}`);
    }

    await addBalance(ctx.userId, economyConfig.weeklyReward, guildId);
    await setCooldown(ctx.userId, 'weekly', 604800, guildId);

    const embed = new EmbedBuilder()
      .setTitle('Weekly Reward Claimed!')
      .setColor(0x00FF00)
      .setDescription(`You received ${formatCurrency(economyConfig.weeklyReward)}`)
      .addFields({ name: 'New Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });

    ctx.respond({ embeds: [embed] });
  },

  work: async (ctx) => {
    const guildId = ctx.guildId;
    const cooldown = await getCooldown(ctx.userId, 'work', guildId);
    if (cooldown > 0) {
      return ctx.respond(`You can work again in ${formatTime(cooldown)}`);
    }

    const jobs = [
      'delivered packages', 'wrote code', 'taught a class', 'fixed computers',
      'walked dogs', 'served food', 'cleaned houses', 'drove a taxi'
    ];

    const job = jobs[Math.floor(Math.random() * jobs.length)];
    const reward = getRandomInt(economyConfig.workMinReward, economyConfig.workMaxReward);

    await addBalance(ctx.userId, reward, guildId);
    await setCooldown(ctx.userId, 'work', economyConfig.workCooldown, guildId);

    const embed = new EmbedBuilder()
      .setTitle('Work Complete!')
      .setColor(0x00FF00)
      .setDescription(`You ${job} and earned ${formatCurrency(reward)}`)
      .addFields({ name: 'New Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });

    ctx.respond({ embeds: [embed] });
  },

  crime: async (ctx) => {
    const guildId = ctx.guildId;
    const cooldown = await getCooldown(ctx.userId, 'crime', guildId);
    if (cooldown > 0) {
      return ctx.respond(`You can commit a crime again in ${formatTime(cooldown)}`);
    }

    await setCooldown(ctx.userId, 'crime', economyConfig.crimeCooldown, guildId);

    if (Math.random() * 100 <= economyConfig.crimeSuccessRate) {
      const reward = getRandomInt(economyConfig.crimeMinReward, economyConfig.crimeMaxReward);
      await addBalance(ctx.userId, reward, guildId);

      const crimes = ['robbed a bank', 'stole a car', 'hacked a mainframe', 'sold contraband'];
      const crime = crimes[Math.floor(Math.random() * crimes.length)];

      const embed = new EmbedBuilder()
        .setTitle('Crime Successful!')
        .setColor(0x00FF00)
        .setDescription(`You ${crime} and earned ${formatCurrency(reward)}`)
        .addFields({ name: 'New Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });

      ctx.respond({ embeds: [embed] });
    } else {
      await removeBalance(ctx.userId, economyConfig.crimePenalty, guildId);

      const embed = new EmbedBuilder()
        .setTitle('Crime Failed!')
        .setColor(0xFF0000)
        .setDescription(`You got caught and had to pay ${formatCurrency(economyConfig.crimePenalty)} in fines.`)
        .addFields({ name: 'New Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });

      ctx.respond({ embeds: [embed] });
    }
  },

  
  rob: async (ctx) => {
    const guildId = ctx.guildId;
    const target = ctx.userOpt();
    if (!target || target.bot || target.id === ctx.userId) {
      return ctx.respond('Please mention a valid user to rob.');
    }

    const cooldown = await getCooldown(ctx.userId, 'rob', guildId);
    if (cooldown > 0) {
      return ctx.respond(`You can rob again in ${formatTime(cooldown)}`);
    }

    const targetBalance = await getBalance(target.id, guildId);
    if (targetBalance < 100) {
      return ctx.respond('That user is too poor to rob!');
    }

    await setCooldown(ctx.userId, 'rob', economyConfig.robCooldown, guildId);

    if (Math.random() * 100 <= economyConfig.robSuccessRate) {
      const percent = getRandomInt(economyConfig.robMinPercent, economyConfig.robMaxPercent);
      const stolen = Math.floor(targetBalance * (percent / 100));

      await removeBalance(target.id, stolen, guildId);
      await addBalance(ctx.userId, stolen, guildId);

      const embed = new EmbedBuilder()
        .setTitle('Robbery Successful!')
        .setColor(0x00FF00)
        .setDescription(`You stole ${formatCurrency(stolen)} from ${target.username}!`)
        .addFields({ name: 'Your Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });

      ctx.respond({ embeds: [embed] });
    } else {
      const myBalance = await getBalance(ctx.userId, guildId);
      const penalty = Math.floor(myBalance * 0.1);
      await removeBalance(ctx.userId, penalty, guildId);
      await addBalance(target.id, penalty, guildId);

      const embed = new EmbedBuilder()
        .setTitle('Robbery Failed!')
        .setColor(0xFF0000)
        .setDescription(`You got caught and had to pay ${formatCurrency(penalty)} to ${target.username}.`)
        .addFields({ name: 'Your Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });

      ctx.respond({ embeds: [embed] });
    }
  },
  

  
  slots: async (ctx) => {
    const guildId = ctx.guildId;
    const bet = ctx.intOpt('amount', 0);
    if (isNaN(bet) || bet < economyConfig.slotsMinBet || bet > economyConfig.slotsMaxBet) {
      return ctx.respond(`Bet must be between ${economyConfig.slotsMinBet} and ${economyConfig.slotsMaxBet}.`);
    }

    // Audit cycle-6 #2 (2026-05-27): atomic debit. Slots had TOCTOU on
    // balance vs bet — parallel /slots would mint money via clamped remove
    // + un-clamped add.
    const debited = await tryDebit(ctx.userId, bet, guildId);
    if (debited === 0) {
      return ctx.respond('You don\'t have enough to make that bet!');
    }

    const symbols = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
    const results = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
    ];

    let multiplier = 0;
    if (results[0] === results[1] && results[1] === results[2]) {
      if (results[0] === '7️⃣') multiplier = 10;
      else if (results[0] === '💎') multiplier = 5;
      else multiplier = 3;
    } else if (results[0] === results[1] || results[1] === results[2]) {
      multiplier = 1.5;
    }

    const winnings = Math.floor(bet * multiplier);
    // Bet is already debited; on win, credit full winnings (which includes
    // bet returned for multiplier >= 1). On loss, do nothing — the bet is
    // already gone.
    if (winnings > 0) {
      await addBalance(ctx.userId, winnings, guildId);
    }

    const embed = new EmbedBuilder()
      .setTitle('🎰 Slot Machine')
      .setColor(winnings > 0 ? '#00FF00' : '#FF0000')
      .setDescription(`[ ${results.join(' | ')} ]`)
      .addFields(
        { name: 'Result', value: winnings > 0 ? `Won ${formatCurrency(winnings)}!` : 'No win', inline: true },
        { name: 'Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)), inline: true }
      );

    ctx.respond({ embeds: [embed] });
  },
  

  
  coinflip: async (ctx) => {
    const guildId = ctx.guildId;
    const bet = ctx.intOpt('amount', 0);
    const choice = ctx.strOpt('choice', 1);

    if (isNaN(bet) || bet < 10) {
      return ctx.respond('Minimum bet is 10.');
    }

    if (!['heads', 'tails', 'h', 't'].includes(choice)) {
      return ctx.respond('Choose heads (h) or tails (t).');
    }

    // Audit cycle-6 #2 (2026-05-27): atomic debit. Without this, two parallel
    // /coinflip 100 both pass the check, both run the lose path's
    // CAS-clamped removeBalance, net debit = balance (not 2x bet) — user
    // can over-bet free money on the win path.
    const debited = await tryDebit(ctx.userId, bet, guildId);
    if (debited === 0) {
      return ctx.respond('You don\'t have enough to make that bet!');
    }

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const userChoice = choice === 'h' ? 'heads' : choice === 't' ? 'tails' : choice;
    const won = result === userChoice;

    if (won) {
      // bet returned + bet won = 2*bet credited (we already debited bet above)
      await addBalance(ctx.userId, bet * 2, guildId);
    }

    const embed = new EmbedBuilder()
      .setTitle('🪙 Coinflip')
      .setColor(won ? '#00FF00' : '#FF0000')
      .setDescription(`The coin landed on **${result}**!`)
      .addFields(
        { name: 'Result', value: won ? `Won ${formatCurrency(bet)}!` : `Lost ${formatCurrency(bet)}`, inline: true },
        { name: 'Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)), inline: true }
      );

    ctx.respond({ embeds: [embed] });
  },
  

  give: async (ctx) => {
    const guildId = ctx.guildId;
    const target = ctx.userOpt();
    const amount = ctx.intOpt('amount', 1);

    if (!target || target.bot || target.id === ctx.userId) {
      return ctx.respond('Please mention a valid user to give money to.');
    }

    if (isNaN(amount) || amount < 1) {
      return ctx.respond('Please specify a valid amount.');
    }

    // Audit cycle-6 #2 (2026-05-27): atomic try-debit so two parallel /give
    // commands can't both pass the balance check, both debit (clamped at 0),
    // and both credit the recipient — minting money.
    const debited = await tryDebit(ctx.userId, amount, guildId);
    if (debited === 0) {
      return ctx.respond('You don\'t have enough money!');
    }

    
    // Audit cycle-6 #2: debited already comes from tryDebit above; just credit recipient.
    await addBalance(target.id, amount, guildId);

    if (ctx.member) {
      client.emit('transactionComplete', ctx.member, { transaction: { type: 'transfer', amount, recipientId: target.id } });
    }

    const embed = new EmbedBuilder()
      .setTitle('Transfer Complete')
      .setColor(0x00FF00)
      .setDescription(`You sent ${formatCurrency(amount)} to ${target.username}`)
      .addFields({ name: 'Your Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });
    

    ctx.respond({ embeds: [embed] });
  },

  leaderboard: async (ctx) => {
    const guildId = ctx.guildId;
    const top = await botData.leaderboard('economy', guildId, 'balance', economyConfig.leaderboardSize);

    const leaderboard = await Promise.all(
      top.map(async (entry, index) => {
        try {
          const user = await client.users.fetch(entry.discordUserId);
          return `${vbRankMedal(index)} ${user.username} - ${formatCurrency(entry.data?.balance || 0)}`;
        } catch {
          return `${vbRankMedal(index)} Unknown - ${formatCurrency(entry.data?.balance || 0)}`;
        }
      })
    );

    const embed = new EmbedBuilder()
      .setTitle('💰 Richest Users')
      .setColor(0xFFD700)
      .setDescription(leaderboard.join('\n') || 'No data yet.');

    ctx.respond({ embeds: [embed] });
  },

  
  shop: async (ctx) => {
    const items = economyConfig.shopItems;
    if (items.length === 0) {
      return ctx.respond('The shop is empty!');
    }

    const embed = new EmbedBuilder()
      .setTitle('🛒 Shop')
      .setColor(0x5865F2)
      .setDescription(
        items.map((item, i) =>
          `**${i + 1}.** ${item.name} - ${formatCurrency(item.price)}\n${item.description || ''}`
        ).join('\n\n')
      )
      .setFooter({ text: 'Use /buy <number> (or !buy <number>) to purchase an item' });

    ctx.respond({ embeds: [embed] });
  },

  buy: async (ctx) => {
    const guildId = ctx.guildId;
    const index = ctx.intOpt('item', 0) - 1;
    const items = economyConfig.shopItems;

    if (isNaN(index) || index < 0 || index >= items.length) {
      return ctx.respond('Invalid item number. Use /shop to see available items.');
    }

    const item = items[index];
    const debited = await tryDebit(ctx.userId, item.price, guildId);
    if (!debited) {
      return ctx.respond('You don\'t have enough money!');
    }

    if (item.type === 'role' && item.roleId) {
      try {
        const role = ctx.guild.roles.cache.get(item.roleId);
        // Check hierarchy — shop role above bot's highest = silent 50013,
        // user paid but never got the role.
        const me = await ctx.guild.members.fetchMe();
        // Audit cycle-34 (2026-05-27): also reject @everyone (id === guildId)
        // and managed roles (Nitro booster, integration) — both throw and
        // would leave the user paid-but-no-role in the previous flow.
        if (!role || role.id === ctx.guildId || role.managed) {
          await addBalance(ctx.userId, item.price, guildId);
          return ctx.respond('Shop is misconfigured — that role can\'t be granted, so I refunded your purchase.');
        }
        if (role.position < me.roles.highest.position) {
          const member = await ctx.guild.members.fetch(ctx.userId);
          await member.roles.add(role);
        } else {
          await addBalance(ctx.userId, item.price, guildId);
          return ctx.respond('Shop is misconfigured — that role is above my highest role, so I refunded your purchase.');
        }
      } catch (error) {
        // Audit cycle-34: generic catch previously let the inventory push +
        // success reply run with no role granted. Refund + return so the
        // user isn't charged for a failed role grant.
        console.error('Failed to add role:', error);
        await addBalance(ctx.userId, item.price, guildId);
        return ctx.respond('Something went wrong granting that role — I refunded your purchase.');
      }
    }

    // Add to inventory (persistent)
    const invData = await botData.get(ctx.userId, 'economy_inventory', guildId) || { items: [] };
    invData.items.push(item.id);
    await botData.set(ctx.userId, 'economy_inventory', invData, guildId);

    if (ctx.member) {
      client.emit('transactionComplete', ctx.member, { transaction: { type: 'purchase', itemId: item.id, amount: item.price } });
    }

    const embed = new EmbedBuilder()
      .setTitle('Purchase Complete!')
      .setColor(0x00FF00)
      .setDescription(`You bought **${item.name}** for ${formatCurrency(item.price)}`)
      .addFields({ name: 'Balance', value: formatCurrency(await getBalance(ctx.userId, guildId)) });

    ctx.respond({ embeds: [embed] });
  },

  inventory: async (ctx) => {
    const guildId = ctx.guildId;
    const invData = await botData.get(ctx.userId, 'economy_inventory', guildId) || { items: [] };
    if (invData.items.length === 0) {
      return ctx.respond('Your inventory is empty!');
    }

    const items = invData.items.map(id =>
      economyConfig.shopItems.find(item => item.id === id)?.name || 'Unknown Item'
    );

    const embed = new EmbedBuilder()
      .setTitle(`${ctx.author.username}'s Inventory`)
      .setColor(0x5865F2)
      .setDescription(items.join('\n'));

    ctx.respond({ embeds: [embed] });
  },
  
};

// ─── Slash command registration (MEE6 parity) ──────────────────────────────
// Push full SlashCommandBuilder definitions into __setupCommands; the unified
// bot spreads these into the registration PUT. generateUserCommandBuilders skips
// this builder (its setupCode contains 'SlashCommandBuilder'), so each command
// is registered exactly once — no 50035.
const _ecoSlashDefs = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your balance')
    .addUserOption(o => o.setName('user').setDescription('Whose balance to check').setRequired(false)),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),
  new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward'),
  new SlashCommandBuilder().setName('work').setDescription('Work to earn currency'),
  new SlashCommandBuilder().setName('crime').setDescription('Commit a crime for a risky reward'),
  new SlashCommandBuilder().setName('give').setDescription('Give currency to another user')
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('baltop').setDescription('View the richest users'),
];
_ecoSlashDefs.push(
  new SlashCommandBuilder().setName('rob').setDescription('Attempt to rob another user')
    .addUserOption(o => o.setName('user').setDescription('User to rob').setRequired(true))
);
_ecoSlashDefs.push(
  new SlashCommandBuilder().setName('slots').setDescription('Bet on the slot machine')
    .addIntegerOption(o => o.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(economyConfig.slotsMinBet).setMaxValue(economyConfig.slotsMaxBet))
);
_ecoSlashDefs.push(
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin and bet on the outcome')
    .addIntegerOption(o => o.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(10))
    .addStringOption(o => o.setName('choice').setDescription('heads or tails').setRequired(true)
      .addChoices({ name: 'heads', value: 'heads' }, { name: 'tails', value: 'tails' }))
);
_ecoSlashDefs.push(
  new SlashCommandBuilder().setName('shop').setDescription('Browse the shop'),
  new SlashCommandBuilder().setName('buy').setDescription('Buy an item from the shop')
    .addIntegerOption(o => o.setName('item').setDescription('Item number (see /shop)').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('inventory').setDescription('View your inventory')
);

// Slash command name -> economyCommands key (only where they differ: /baltop is
// the leaderboard, renamed to avoid colliding with the Leveling /leaderboard).
const _ecoSlashToKey = { baltop: 'leaderboard' };
const _ecoSlashNames = _ecoSlashDefs.map(c => c.name);

if (typeof __setupCommands !== 'undefined') {
  __setupCommands.push(..._ecoSlashDefs.map(c => c.toJSON()));
}

// Slash front door. Defer first (ack inside Discord's 3s window), then run the
// shared command body; ctx.respond -> editReply.
client.on('interactionCreate', async (interaction) => {
  // Balance-card button shortcuts: [Daily]/[Work]/[Top] run those commands.
  if (interaction.isButton && interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.indexOf('eco_') === 0) {
    if (interaction.replied || interaction.deferred) return;
    const _bk = interaction.customId.slice(4);
    const _bh = economyCommands[_bk === 'baltop' ? 'leaderboard' : _bk];
    if (!_bh) return;
    try {
      // Update-in-place: deferUpdate acks the click instantly (no loading
      // flicker, no 10062), the command runs its mutation, and we edit the SAME
      // card message with the result + the same buttons — no new message.
      await interaction.deferUpdate();
      let _captured = null;
      const _capCtx = _ecoBtnCtx(interaction);
      _capCtx.respond = (p) => { _captured = p; };
      await _bh(_capCtx);
      const _body = { components: [vbButtons(_ecoBalanceButtons(interaction.customId))] };
      // Show ONLY the clicked tab's result — clear the OTHER kind so a prior view
      // (e.g. the Top leaderboard embed) doesn't linger behind a text result.
      if (typeof _captured === 'string') {
        _body.content = _captured;
        _body.embeds = [];                  // drop any prior embed (e.g. Top's leaderboard)
      } else if (_captured && _captured.embeds) {
        _body.content = '';
        _body.embeds = _captured.embeds;    // show this action's result (incl. new balance)
      }
      await interaction.editReply(_body).catch((e) => console.error('[Economy] Button refresh failed:', (e && e.code) || '', (e && e.message) || e));
    } catch (e) {
      console.error('[Economy] Button error:', e);
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;
  if (interaction.replied || interaction.deferred) return;
  if (!_ecoSlashNames.includes(interaction.commandName)) return;

  const key = _ecoSlashToKey[interaction.commandName] || interaction.commandName;
  const handler = economyCommands[key];
  if (!handler) return;

  try {
    // Spam control at scale: personal commands reply EPHEMERALLY (only the
    // invoker sees them — no channel flood when 1000s run /balance); social
    // commands (leaderboard, give) stay public. privateResponses: false makes
    // everything public. Ephemeral still supports the card's buttons +
    // update-in-place. (Prefix ! commands are always public — messages can't be
    // ephemeral.) MessageFlags is a template-provided global.
    const _public = key === 'leaderboard' || key === 'give';
    if (economyConfig.privateResponses !== false && !_public) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }
    await handler(_ecoIntCtx(interaction));
  } catch (error) {
    console.error('[Economy] Interaction error:', error);
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply('Something went wrong running that command.');
      }
    } catch {}
  }
});

// Prefix front door (back-compat). Same command bodies via a message ctx.
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  // Command aliases
  const aliases = {
    bal: 'balance',
    lb: 'leaderboard',
    baltop: 'leaderboard',
    pay: 'give',
    cf: 'coinflip',
    inv: 'inventory',
  };

  const cmdName = aliases[command] || command;

  if (cmdName && economyCommands[cmdName]) {
    markMessageHandled(message); // claim before the AI persona can reply (sync — wins the race)
    await economyCommands[cmdName](_ecoMsgCtx(message, args));
  }
});

console.log('Economy system loaded successfully!');

})().catch(e => console.error('[Economy System] startup error:', e));

// ===== AFK System =====
(async () => {
// AFK System
const { EmbedBuilder, SlashCommandBuilder, MessageFlags } = require('discord.js');

const EMBED_COLOR = "#57F287";

const AFK_CONFIG = {
  autoRemoveDelay: 120000,
  showInMention: true,
};

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('\u{1F4A4} AFK Commands')
    .setColor(EMBED_COLOR)
    .addFields(
      { name: '/afk set', value: 'Set your AFK status' },
      { name: '/afk clear', value: 'Remove your AFK status' },
      { name: '/afk help', value: 'Show this help message' }
    );
}

// Track users in the process of returning (prevent spam)
const returningUsers = new Set();

const afkCommand = new SlashCommandBuilder()
  .setName('afk')
  .setDescription('Manage AFK status')
  .addSubcommand(sub => sub
    .setName('set')
    .setDescription('Set your AFK status')
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for being AFK'))
  )
  .addSubcommand(sub => sub
    .setName('clear')
    .setDescription('Remove your AFK status')
  )
  .addSubcommand(sub => sub
    .setName('help')
    .setDescription('Show all AFK commands')
  );
if (typeof __setupCommands !== 'undefined') __setupCommands.push(afkCommand.toJSON());

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'afk') return;
  if (interaction.replied || interaction.deferred) return;
  // Audit cycle-1 C2 (2026-05-27): AFK is guild-only (uses interaction.guild.id
  // for botData keys + member.setNickname). With DirectMessages intent now
  // active for user-installed bots, a DM invocation would crash on
  // interaction.guild.id null. Reply with a guild-only hint instead.
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'This command only works in a server.', flags: MessageFlags.Ephemeral });
  }

  try {
    const sub = interaction.options.getSubcommand(false);

    if (sub === 'help') {
      return interaction.reply({ embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'set') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = interaction.options.getString('reason') || 'AFK';
      const member = interaction.member;
      const now = Date.now();

      await botData.set(interaction.user.id, 'afk', {
        reason,
        timestamp: now,
      }, interaction.guild.id);

    // Add AFK prefix to nickname
    try {
      const currentNick = member.nickname || member.user.username;
      const afkPrefix = "[AFK]";
      if (!currentNick.startsWith(afkPrefix)) {
        await member.setNickname(`${afkPrefix} ${currentNick}`.slice(0, 32));
      }
    } catch {}
    // Auto-remove AFK after 2400 hours.
    // Audit cycle-11 (2026-05-27): safeTimeout + int32 clamp so very long
    // maxAfkTime values (>596h) don't overflow setTimeout and fire instantly.
    // ⚠️ CAPTURE IDS, NEVER THE INTERACTION. This callback runs 2400h later, and
    // `interaction.guild` is a GETTER that resolves out of the client's guild cache
    // (`client.guilds.resolve(guildId)`) — hours on it can be null because the bot was removed
    // from the guild or the cache was swept, and `interaction.guild.id` then throws
    // "Cannot read properties of null (reading 'id')" inside Timeout._onTimeout, which no
    // try/catch here covers. Prod 2026-09-05, bot e0cb6755 ("scars bot"). 132 bots ship this
    // template. Primitives captured now cannot go stale; the guild is re-resolved at use.
    const afkUserId = interaction.user.id;
    const afkGuildId = interaction.guild.id;
    safeTimeout(async () => {
      const current = await botData.get(afkUserId, 'afk', afkGuildId);
      if (current && current.timestamp === now) {
        await botData.set(afkUserId, 'afk', null, afkGuildId);
        try {
          const afkPfx = "[AFK]";
          // Re-resolve rather than reaching through the stale interaction. A guild the bot has
          // left resolves undefined and the optional chain simply skips the nickname reset.
          const afkGuild = client.guilds.cache.get(afkGuildId);
          const m = afkGuild ? await afkGuild.members.fetch(afkUserId) : null;
          if (!m) return;
          const nick = m.nickname || '';
          if (nick.startsWith(afkPfx)) {
            await m.setNickname(nick.slice(afkPfx.length).trim() || null);
          }
        } catch {}
      }
    }, 2147483647);

      await interaction.editReply({
        content: `✅ You are now AFK: **${reason}**`,
      });
    }

    if (sub === 'clear') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const afkData = await botData.get(interaction.user.id, 'afk', interaction.guild.id);
      if (!afkData) {
        return interaction.editReply({ content: '\u274C You are not AFK.', embeds: [buildHelpEmbed()] });
      }

      await botData.set(interaction.user.id, 'afk', null, interaction.guild.id);

      const afkMember = interaction.member;

    // Remove AFK prefix from nickname
    try {
      const afkPrefix = "[AFK]";
      const currentNick = afkMember.nickname || '';
      if (currentNick.startsWith(afkPrefix)) {
        const restored = currentNick.slice(afkPrefix.length).trim();
        await afkMember.setNickname(restored || null);
      }
    } catch {}

      await interaction.editReply({ content: '✅ Welcome back! Your AFK status has been removed.' });
    }
  } catch (error) {
    console.error('[AFK] Interaction error:', error);
    try {
      // A deferred-but-unedited reply must be edited, not followed up, or the
      // "thinking" placeholder hangs.
      if (interaction.deferred) {
        await interaction.editReply({ content: '\u274C Something went wrong. Please try again.', embeds: [buildHelpEmbed()] });
      } else if (interaction.replied) {
        await interaction.followUp({ content: '\u274C Something went wrong. Please try again.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: '\u274C Something went wrong. Please try again.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
});

// Message handler — detect AFK mentions and auto-return
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  // System messages (joins, boosts, pins, channel-name-change) can't be replied to —
  // Discord rejects with REPLIES_CANNOT_REPLY_TO_SYSTEM_MESSAGE.
  if (message.system) return;

  // Check if the message author is AFK — auto-remove
  const authorAfk = await botData.get(message.author.id, 'afk', message.guild.id);
  if (authorAfk && !returningUsers.has(message.author.id)) {
    returningUsers.add(message.author.id);
    markMessageHandled(message); // AFK return — afk system will welcome them back; persona shouldn't also reply

    // Audit cycle-1 F1 (2026-05-27): use safeTimeout so a throw inside the
    // callback (botData.set failing mid-shutdown) becomes a logged error
    // instead of crashing the bot via unhandledRejection.
    // ⚠️ SAME CAPTURE RULE AS THE AUTO-REMOVE TIMER ABOVE. `message.guild` is a getter over the
    // client's guild cache, so it is null-able for exactly the same reasons — and
    // `autoRemoveDelay` is owner-configurable, so this window is only "short" by convention.
    // Fixing only the other timer would leave the identical crash behind a smaller delay, which is
    // the half-fix that looks right because the reported bot happened to hit the other one.
    const afkMsgUserId = message.author.id;
    const afkMsgGuildId = message.guild.id;
    const afkMsgUser = message.author;
    const afkMsgChannel = message.channel;
    safeTimeout(async () => {
      // Re-check in case they went AFK again
      const current = await botData.get(afkMsgUserId, 'afk', afkMsgGuildId);
      if (current && current.timestamp === authorAfk.timestamp) {
        await botData.set(afkMsgUserId, 'afk', null, afkMsgGuildId);

        const afkGuildRef = client.guilds.cache.get(afkMsgGuildId);
        const afkMember = afkGuildRef
          ? await afkGuildRef.members.fetch(afkMsgUserId).catch(() => null)
          : null;
        if (afkMember) {
  
      // Remove AFK prefix from nickname
      try {
        const afkPrefix = "[AFK]";
        const currentNick = afkMember.nickname || '';
        if (currentNick.startsWith(afkPrefix)) {
          const restored = currentNick.slice(afkPrefix.length).trim();
          await afkMember.setNickname(restored || null);
        }
      } catch {}
        }

        const duration = Date.now() - authorAfk.timestamp;
        const mins = Math.floor(duration / 60000);
        const timeStr = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

        try {
          await afkMsgChannel.send({
            content: `👋 Welcome back ${afkMsgUser}! You were AFK for ${timeStr}.`,
          });
        } catch {}
      }
      returningUsers.delete(afkMsgUserId);
    }, AFK_CONFIG.autoRemoveDelay);
  }

  // Check if message mentions an AFK user
  if (AFK_CONFIG.showInMention && message.mentions.users.size > 0) {
    for (const [, mentioned] of message.mentions.users) {
      if (mentioned.bot) continue;
      const afkData = await botData.get(mentioned.id, 'afk', message.guild.id);
      if (afkData) {
        markMessageHandled(message); // replying that the mentioned user is AFK; persona shouldn't also reply
        const ago = Date.now() - afkData.timestamp;
        const mins = Math.floor(ago / 60000);
        const timeStr = mins < 60 ? `${mins} minute(s) ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
        const customMsg = "I'm currently AFK: {reason}"
          .replace('{user}', mentioned.tag)
          .replace('{reason}', afkData.reason)
          .replace('{time}', timeStr);

        try {
          await message.reply({ content: customMsg, allowedMentions: { parse: ['users'], repliedUser: false } });
        } catch {}
      }
    }
  }
});

console.log('AFK system ready!');
})().catch(e => console.error('[AFK System] startup error:', e));

// ===== Event Logging =====
(async () => {
// Event Logging System
const { EmbedBuilder } = require('discord.js');

// _vbServerScopedChannel (runtime-stdlib.ts) keeps a configured channel id in the event's
// own server, with the owner's cross-server same-name fallback -- but a full-code-carried
// copy of this block (fullcode-shim.ts's TEMPLATE_CARRYOVER) does not carry the managed
// runtime's helpers, so it would be undefined there. Fall back to the pre-existing lookup:
// guild-scoped when a guild is known -- NEVER falling through to the bot-wide cache on a
// miss there, or a channel id configured for a different server would leak into this one,
// the exact bug this whole feature exists to close. The bot-wide cache is a last resort
// ONLY when there is no guild at all to scope by (matches main's original behavior for the
// handlers that never had a guild-scoped lookup to begin with).
async function _vbLogChannel(id, guild) {
  if (typeof _vbServerScopedChannel === 'function') {
    return (await _vbServerScopedChannel(id, guild, true, 'Event logging')).channel;
  }
  return (guild && guild.channels && guild.channels.cache) ? (guild.channels.cache.get(id) || null) : client.channels.cache.get(id);
}

const logChannelId = "1557529984246091836";

client.on('messageDelete', async (message) => {
  if (message.partial) return;
  if (message.author?.bot) return;
  const logChannel = await _vbLogChannel("1557529984246091836", message.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message Deleted')
    .setColor(VB_COLORS.error)
    .addFields(
      { name: 'Author', value: message.author?.tag || 'Unknown', inline: true },
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Content', value: message.content?.slice(0, 1000) || 'No content' }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.partial || newMessage.partial) return;
  if (oldMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  const logChannel = await _vbLogChannel("1557529984246091836", newMessage.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const embed = new EmbedBuilder()
    .setTitle('✏️ Message Edited')
    .setColor(VB_COLORS.warning)
    .addFields(
      { name: 'Author', value: newMessage.author?.tag || 'Unknown', inline: true },
      { name: 'Channel', value: `<#${newMessage.channel.id}>`, inline: true },
      { name: 'Before', value: oldMessage.content?.slice(0, 500) || 'No content' },
      { name: 'After', value: newMessage.content?.slice(0, 500) || 'No content' }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberAdd', async (member) => {
  const logChannel = await _vbLogChannel("1557529984246091836", member.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const embed = new EmbedBuilder()
    .setTitle('📥 Member Joined')
    .setColor(VB_COLORS.success)
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
      { name: 'Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Member Count', value: `${member.guild.memberCount}`, inline: true }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberRemove', async (member) => {
  const logChannel = await _vbLogChannel("1557529984246091836", member.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  // A leaver is usually NOT in the member cache, and guildMemberRemove ships
  // Partials.GuildMember, so discord.js hands us a member built from the user
  // object alone — roles empty. Printing that as 'None' states the member held no
  // roles, which is a claim we cannot make. The 'Joined' field below already draws
  // this distinction; roles were missed.
  const roles = member.partial
    ? 'Unknown'
    : (member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'None');
  const embed = new EmbedBuilder()
    .setTitle('📤 Member Left')
    .setColor(VB_COLORS.error)
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
      { name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
      { name: 'Roles', value: roles.slice(0, 1000) }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('messageDeleteBulk', async (messages, channel) => {
  const logChannel = await _vbLogChannel("1557529984246091836", channel.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  // MESSAGE_DELETE_BULK carries a list of message IDs and nothing else. Partials.Message is in
  // every bot's baseline, so discord.js hands us one entry per deleted ID — but an entry for a
  // message that was not cached is a PARTIAL, with author AND content null. The old filter was
  // `!m.author?.bot`, which is TRUE for such an entry, so it counted every uncached message as a
  // human message, MISSED every uncached bot message it existed to exclude, and printed each one
  // as "Unknown:" with no text. When it filtered everything out it also threw, because
  // setDescription rejects an empty string — losing the whole log entry.
  //
  // messages.size is the one number we know exactly: the length of Discord's ID list. The preview
  // is built only from messages we can actually read. `m.author` is safe without `?.` ONLY
  // because the `!m.partial` filter above guarantees it — partial is false only when author is set.
  const known = messages.filter(m => !m.partial);
  const readable = known.filter(m => !m.author.bot);
  const shown = readable.first(10);
  const hidden = messages.size - readable.size;
  // ⚠️ TRUNCATION COUNTS FROM `readable`, NOT `known`. Counting from known would add cached BOT
  // messages — which the preview deliberately drops — into "and N more", so a purge of 5 humans
  // and 3 bots would claim 3 truncated humans that do not exist. A PR whose argument is "report
  // only what the payload tells us" must not print a false number.
  const preview = shown.map(m => `**${m.author.tag}:** ${(m.content || '(no text)').slice(0, 80)}`).join('\n');
  const more = readable.size > shown.length ? `\n_…and ${readable.size - shown.length} more._` : '';
  // ⚠️ "MORE" NEEDS SOMETHING TO BE MORE THAN. When nothing is readable — which is what a purge of
  // messages older than the cache ALWAYS produces, and the commonest shape of this event — the note
  // was the entire description, so "3 more were not in the cache" read as though a list came before
  // it. Every number was true; the comparative was not. Mixed input keeps the additive wording,
  // where it is correct and where the counts do add up to the Deleted field.
  const note = hidden === 0
    ? ''
    : preview
      ? `\n_${hidden} more were not in the cache or were sent by a bot, so their text is not available._`
      : `_None of these were still in the cache, or they were all sent by a bot, so no text is available._`;
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Bulk Messages Deleted')
    .setColor(VB_COLORS.error)
    .addFields(
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
      { name: 'Deleted', value: `${messages.size} message(s)`, inline: true }
    )
    // Never empty, so this can no longer throw and swallow the entire log entry.
    .setDescription((preview + more + note).trim() || '_No message text is available for these deletions._')
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const logChannel = await _vbLogChannel("1557529984246091836", newMember.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;

  // oldMember is the state BEFORE the change, and discord.js can only supply it
  // from its member cache. This event ships Partials.GuildMember, so for a member
  // that is not cached it hands us a stand-in built from the user object alone:
  // roles empty, nickname null. Diffing against that reports EVERY role the member
  // holds as newly added, which reads as mass role grants to long-standing members
  // after each restart. We cannot know the previous state, so we report nothing.
  // The event caches the member as a side effect, so the next change to the same
  // member diffs correctly.
  if (oldMember.partial) return;

  // Nickname change
  if (oldMember.nickname !== newMember.nickname) {
    const embed = new EmbedBuilder()
      .setTitle('✏️ Nickname Changed')
      .setColor(VB_COLORS.info)
      .setThumbnail(newMember.user.displayAvatarURL())
      .addFields(
        { name: 'User', value: `${newMember.user.tag}`, inline: true },
        { name: 'Before', value: oldMember.nickname || oldMember.user.username, inline: true },
        { name: 'After', value: newMember.nickname || newMember.user.username, inline: true }
      )
      .setTimestamp();
    await logChannel.send({ embeds: [embed] }).catch(() => {});
  }

  // Role changes
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

  if (addedRoles.size > 0) {
    const embed = new EmbedBuilder()
      .setTitle('➕ Roles Added')
      .setColor(VB_COLORS.success)
      .addFields(
        { name: 'User', value: `${newMember.user.tag}`, inline: true },
        { name: 'Roles', value: addedRoles.map(r => r.name).join(', ').slice(0, 1024), inline: true }
      )
      .setTimestamp();
    await logChannel.send({ embeds: [embed] }).catch(() => {});
  }

  if (removedRoles.size > 0) {
    const embed = new EmbedBuilder()
      .setTitle('➖ Roles Removed')
      .setColor(VB_COLORS.error)
      .addFields(
        { name: 'User', value: `${newMember.user.tag}`, inline: true },
        { name: 'Roles', value: removedRoles.map(r => r.name).join(', ').slice(0, 1024), inline: true }
      )
      .setTimestamp();
    await logChannel.send({ embeds: [embed] }).catch(() => {});
  }
});

client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const logChannel = await _vbLogChannel("1557529984246091836", channel.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const typeNames = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum' };
  const embed = new EmbedBuilder()
    .setTitle('📁 Channel Created')
    .setColor(VB_COLORS.success)
    .addFields(
      { name: 'Channel', value: `${channel.name} (<#${channel.id}>)`, inline: true },
      { name: 'Type', value: typeNames[channel.type] || `Type ${channel.type}`, inline: true },
      { name: 'Category', value: channel.parent?.name || 'None', inline: true }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const logChannel = await _vbLogChannel("1557529984246091836", channel.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const typeNames = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum' };
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Channel Deleted')
    .setColor(VB_COLORS.error)
    .addFields(
      { name: 'Channel', value: channel.name, inline: true },
      { name: 'Type', value: typeNames[channel.type] || `Type ${channel.type}`, inline: true },
      { name: 'Category', value: channel.parent?.name || 'None', inline: true }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('roleCreate', async (role) => {
  const logChannel = await _vbLogChannel("1557529984246091836", role.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const embed = new EmbedBuilder()
    .setTitle('🎭 Role Created')
    .setColor(VB_COLORS.success)
    .addFields(
      { name: 'Role', value: `${role.name} (${role.id})`, inline: true },
      { name: 'Color', value: role.hexColor || 'Default', inline: true },
      { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('roleDelete', async (role) => {
  const logChannel = await _vbLogChannel("1557529984246091836", role.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const embed = new EmbedBuilder()
    .setTitle('🎭 Role Deleted')
    .setColor(VB_COLORS.error)
    .addFields(
      { name: 'Role', value: role.name, inline: true },
      { name: 'Color', value: role.hexColor || 'Default', inline: true },
      { name: 'Members', value: `${role.members?.size || 0} had this role`, inline: true }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildBanAdd', async (ban) => {
  const logChannel = await _vbLogChannel("1557529984246091836", ban.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const embed = new EmbedBuilder()
    .setTitle('🔨 Member Banned')
    .setColor(VB_COLORS.error)
    .setThumbnail(ban.user.displayAvatarURL())
    .addFields(
      { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
      { name: 'Reason', value: ban.reason || 'No reason provided', inline: true }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildBanRemove', async (ban) => {
  const logChannel = await _vbLogChannel("1557529984246091836", ban.guild);
  if (!logChannel || typeof logChannel.send !== 'function') return;
  const embed = new EmbedBuilder()
    .setTitle('♻️ Member Unbanned')
    .setColor(VB_COLORS.success)
    .setThumbnail(ban.user.displayAvatarURL())
    .addFields(
      { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: true }
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
});

console.log('Event logging system ready!');
})().catch(e => console.error('[Event Logging] startup error:', e));

// ===== Ban Appeals (/appeal) =====
(async () => {
// Ban Appeals System
const { EmbedBuilder, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const EMBED_COLOR = "#ED4245";

const APPEAL_CONFIG = {
  channel: "1557533507293814845",
  reviewerRoles: [],
  votingEnabled: true,
  votesRequired: 3,
  autoUnban: true,
  cooldownDays: 30,
  dmOnDecision: true,
};

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('\u{1F4E8} Ban Appeals')
    .setColor(EMBED_COLOR)
    .addFields(
      { name: '/appeal', value: 'Submit a ban appeal via modal form' },
      { name: 'Approve / Deny buttons', value: 'Reviewers can approve or deny appeals from the appeals channel' }
    );
}

// Audit cycle-20 (2026-05-27): appealVotes was in-memory only. A restart
// between vote N and N+1 lost every cast vote — buttons stayed in the
// channel but the count restarted from 0, making the threshold unreachable
// on busy servers. Mirror mod-queue's L1 + botData pattern.
const appealVotes = new Map();

async function persistAppealVote(appealerId, voteData, guildId) {
  await botData.set(appealerId, 'appeal_votes', {
    approve: [...voteData.approve],
    deny: [...voteData.deny],
  }, guildId).catch(() => {});
}

async function loadAppealVote(appealerId, guildId) {
  let voteData = appealVotes.get(appealerId);
  if (voteData) return voteData;
  const persisted = await botData.get(appealerId, 'appeal_votes', guildId).catch(() => null);
  voteData = {
    approve: new Set(persisted?.approve || []),
    deny: new Set(persisted?.deny || []),
  };
  appealVotes.set(appealerId, voteData);
  return voteData;
}

async function claimAppealAction(appealerId, guildId) {
  const claimed = appealVotes.delete(appealerId);
  if (claimed) {
    await botData.set(appealerId, 'appeal_votes', null, guildId).catch(() => {});
  }
  return claimed;
}

const appealCmd = new SlashCommandBuilder()
  .setName("appeal")
  .setDescription('Submit a ban appeal');

const appealHelpCmd = new SlashCommandBuilder()
  .setName("appeal-help")
  .setDescription('Show ban appeals information');

// Register the appeal commands so registerCommands() pushes them to Discord.
// generateUserCommandBuilders skips this builder (its setupCode owns a
// SlashCommandBuilder), so __setupCommands is the only registration path —
// without this /appeal (the only entry point) never appears.
if (typeof __setupCommands !== 'undefined') {
  __setupCommands.push(appealCmd.toJSON(), appealHelpCmd.toJSON());
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.replied || interaction.deferred) return;

  // Show help embed
  if (interaction.isChatInputCommand() && interaction.commandName === "appeal-help") {
    return interaction.reply({ embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
  }

  // Open appeal modal
  if (interaction.isChatInputCommand() && interaction.commandName === "appeal") {
    try {
    // Check cooldown. Single pre-check read before showModal (which can't be
    // deferred) — .catch-guarded so a botData hiccup can't throw before the ack.
    const cooldownData = await botData.get(interaction.user.id, 'appeal_cooldown', interaction.guild?.id || 'global').catch(() => null);
    if (cooldownData) {
      const daysSince = (Date.now() - cooldownData.timestamp) / 86400000;
      if (daysSince < APPEAL_CONFIG.cooldownDays) {
        const remaining = Math.ceil(APPEAL_CONFIG.cooldownDays - daysSince);
        return interaction.reply({ content: `\u23F3 You can submit another appeal in ${remaining} day(s).`, flags: MessageFlags.Ephemeral });
      }
    }

    const modal = new ModalBuilder()
      .setCustomId('appeal_modal')
      .setTitle('Ban Appeal')
      .addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('appeal_q0')
        .setLabel("Why were you banned?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("Explain the reason for your ban...")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('appeal_q1')
        .setLabel("Why should we unban you?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("Tell us why you deserve a second chance...")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('appeal_q2')
        .setLabel("Will you follow the server rules if unbanned?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("yes or no")
    )
      );

    await interaction.showModal(modal);
    } catch (error) {
      console.error('[BanAppeals] Command error:', error);
      try {
        const errorMessage = { content: '\u274C Something went wrong. Please try again.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch {}
    }
  }

  // Handle modal submission
  if (interaction.isModalSubmit() && interaction.customId === 'appeal_modal') {
    try {
    // Ack FIRST — the botData.set + appealsChannel.send below exceed Discord's
    // 3s deadline, so defer before any of that to avoid a silent no_response.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const appealsChannel = interaction.guild?.channels.cache.get(APPEAL_CONFIG.channel);
    if (!appealsChannel || typeof appealsChannel.send !== 'function') {
      return interaction.editReply({ content: '\u274C Appeals channel not found.', embeds: [buildHelpEmbed()] });
    }

    // Set cooldown
    const guildId = interaction.guild?.id || 'global';
    await botData.set(interaction.user.id, 'appeal_cooldown', { timestamp: Date.now() }, guildId);

    const embed = new EmbedBuilder()
      .setTitle('\u{1F4CB} Ban Appeal')
      .setColor(EMBED_COLOR)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: '👤 Applicant', value: `${interaction.user.tag} (${interaction.user.id})` },
      { name: "📝 Why were you banned?", value: (interaction.fields.getTextInputValue('appeal_q0') || 'N/A').slice(0, 1024) },
      { name: "📝 Why should we unban you?", value: (interaction.fields.getTextInputValue('appeal_q1') || 'N/A').slice(0, 1024) },
      { name: "📝 Will you follow the server rules if unbanned?", value: (interaction.fields.getTextInputValue('appeal_q2') || 'N/A').slice(0, 1024) }
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appeal_approve_${interaction.user.id}`).setLabel(`Approve (0/3)`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`appeal_deny_${interaction.user.id}`).setLabel(`Deny (0/3)`).setStyle(ButtonStyle.Danger)
    );

    // Initialize vote tracking (L1 + persist so a redeploy between submit
    // and first reviewer click doesn't lose the appeal state).
    const initVote = { approve: new Set(), deny: new Set() };
    appealVotes.set(interaction.user.id, initVote);
    await persistAppealVote(interaction.user.id, initVote, guildId);

    await appealsChannel.send({
      embeds: [embed],
      components: [row],
    });

    await interaction.editReply({ content: '\u2705 Your appeal has been submitted. You will be notified of the decision.' });
    } catch (error) {
      console.error('[BanAppeals] Modal submit error:', error);
      try {
        const errorMessage = { content: '\u274C Something went wrong submitting your appeal. Please try again.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch {}
    }
  }

  // Handle approve/deny buttons
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (!id.startsWith('appeal_approve_') && !id.startsWith('appeal_deny_')) return;

    try {
    // Audit cycle-4 #12 (2026-05-27): guard against a button click without
    // a guild context — interaction.member.roles.cache crashes if guild
    // is null or member is the raw API object.
    if (!interaction.guild || !interaction.member || !interaction.member.roles?.cache) {
      return interaction.reply({ content: 'Cannot review appeals outside a server context.', flags: MessageFlags.Ephemeral });
    }
    // Check reviewer permissions
    const hasRole = APPEAL_CONFIG.reviewerRoles.some(r => interaction.member.roles.cache.has(r));
    if (!hasRole && !interaction.member.permissions.has('BanMembers')) {
      return interaction.reply({ content: '\u274C You do not have permission to review appeals.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral });
    }

    // Ack FIRST — the vote load/persist + optional bans.remove / users.fetch
    // below exceed Discord's 3s deadline. deferUpdate leaves the source message
    // untouched until we editReply it with the updated vote state.
    await interaction.deferUpdate();

    const appealerId = id.replace(/^appeal_(approve|deny)_/, '');
    const action = id.includes('approve') ? 'approve' : 'deny';

    // Lazy-hydrate from botData if L1 missed (bot restart).
    const votes = await loadAppealVote(appealerId, interaction.guild.id);
    votes[action].add(interaction.user.id);
    // Remove from opposite vote
    const opposite = action === 'approve' ? 'deny' : 'approve';
    votes[opposite].delete(interaction.user.id);
    // Persist every mutation so a restart between vote N and N+1 doesn't drop it.
    await persistAppealVote(appealerId, votes, interaction.guild.id);

    const approveCount = votes.approve.size;
    const denyCount = votes.deny.size;


    // Check if threshold reached
    if (approveCount >= APPEAL_CONFIG.votesRequired) {
      // APPROVED — claim is atomic so a second reviewer crossing the
      // threshold at the same tick doesn't double-DM / double-unban.
      if (!(await claimAppealAction(appealerId, interaction.guild.id))) {
        return interaction.followUp({ content: '\u26A0\uFE0F Already processed by another reviewer.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      if (APPEAL_CONFIG.autoUnban) {
        try {
          await interaction.guild.bans.remove(appealerId, 'Ban appeal approved');
        } catch {}
      }

      if (APPEAL_CONFIG.dmOnDecision) {
        try {
          const user = await client.users.fetch(appealerId);
          if (!user.bot) await user.send("Your ban appeal has been approved! You have been unbanned from the server.");
        } catch (e) { if (e?.code !== 50007) console.error('appeal approve DM failed:', e?.message); }
      }

      const embed = EmbedBuilder.from(interaction.message.embeds[0] || { description: 'Original appeal embed missing' })
        .setColor(VB_COLORS.success)
        .setTitle('\u2705 Ban Appeal \u2014 Approved');
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    if (denyCount >= APPEAL_CONFIG.votesRequired) {
      // DENIED — atomic claim prevents double-DM on concurrent denies.
      if (!(await claimAppealAction(appealerId, interaction.guild.id))) {
        return interaction.followUp({ content: '\u26A0\uFE0F Already processed by another reviewer.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      if (APPEAL_CONFIG.dmOnDecision) {
        try {
          const user = await client.users.fetch(appealerId);
          if (!user.bot) await user.send("Your ban appeal has been denied. You may submit another appeal in {cooldown} days.");
        } catch (e) { if (e?.code !== 50007) console.error('appeal deny DM failed:', e?.message); }
      }

      const embed = EmbedBuilder.from(interaction.message.embeds[0] || { description: 'Original appeal embed missing' })
        .setColor(VB_COLORS.error)
        .setTitle('\u274C Ban Appeal \u2014 Denied');
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    // Update vote counts on buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appeal_approve_${appealerId}`).setLabel(`Approve (${approveCount}/${APPEAL_CONFIG.votesRequired})`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`appeal_deny_${appealerId}`).setLabel(`Deny (${denyCount}/${APPEAL_CONFIG.votesRequired})`).setStyle(ButtonStyle.Danger)
    );
    await interaction.editReply({ components: [row] });
    } catch (error) {
      console.error('[BanAppeals] Button error:', error);
      try {
        const errorMessage = { content: '\u274C Something went wrong processing the appeal. Please try again.', embeds: [buildHelpEmbed()], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch {}
    }
  }
});

console.log('Ban appeals system ready!');
})().catch(e => console.error('[Ban Appeals (/appeal)] startup error:', e));

// ===== Captcha Verification (/verify) =====
(async () => {
// Captcha Verification System
const { EmbedBuilder, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');

const CAPTCHA_CONFIG = {"enabled":true,"commandName":"verify","verifiedRoleId":"1557515208501755908","panelChannelId":"1557519767215144970","logChannelId":"1557529984246091836","difficulty":"easy","maxAttempts":10,"panelTitle":"Verification Required","panelDescription":"Click **Verify** below and solve the captcha to gain access to the server.","successMessage":"✅ Verified! Welcome to the server.","embedColor":"#57F287","unverifiedRoleId":"1557519715755368478"};

const crypto = require('crypto');
const CMD_NAME = "verify";

// embedColor is validated at save time, but a legacy/hand-edited snapshot could still
// carry a value discord.js's setColor would THROW on (crashing every embed path). Resolve
// to a guaranteed-valid hex here (named colors mapped to hex) so no path can ever throw.
const CAPTCHA_NAMED_COLORS = { blurple: '#5865F2', green: '#57F287', yellow: '#FEE75C', fuchsia: '#EB459E', red: '#ED4245', white: '#FFFFFF', black: '#000000', blue: '#3498DB', purple: '#9B59B6', orange: '#E67E22', grey: '#95A5A6', gray: '#95A5A6' };
function resolveColor(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  return CAPTCHA_NAMED_COLORS[s.toLowerCase()] || '#5865F2';
}
const EMBED_COLOR = resolveColor(CAPTCHA_CONFIG.embedColor);
const DIFFICULTY = CAPTCHA_CONFIG.difficulty || 'medium';
const CODE_LEN = DIFFICULTY === 'hard' ? 6 : DIFFICULTY === 'easy' ? 4 : 5;
const MAX_ATTEMPTS = Math.max(1, Number(CAPTCHA_CONFIG.maxAttempts) || 3);
const TTL_MS = 10 * 60 * 1000;
// Per-user issuance cooldown: refuse to (re)issue — and therefore to run the expensive,
// raid-amplifiable canvas render — more than once per this window. This IS the anti-raid gate.
const ISSUE_COOLDOWN_MS = 3000;

// The plaintext answer is NEVER stored in botData — only sha256(normalized answer). A leaked
// or observed captcha_pending row must not reveal the code. Compared hash-to-hash on submit.
function hashAnswer(s) {
  return crypto.createHash('sha256').update(String(s == null ? '' : s).trim().toUpperCase()).digest('hex');
}

// Canvas is baked-only. Wrap the require so a missing/broken native binary can
// NEVER crash the bot at boot — we degrade to a hard text-code challenge instead, so the
// other behaviors on this bot are completely insulated from captcha problems.
let _createCanvas = null;
try {
  _createCanvas = require('@napi-rs/canvas').createCanvas;
} catch (e) {
  console.error('[Captcha] @napi-rs/canvas unavailable — using text-code fallback:', e && e.message);
}

// Ambiguous glyphs (0/O, 1/I/L) removed so users don't fail on unreadable chars.
const CAPTCHA_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randCode(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  return s;
}

function renderCaptcha(text) {
  if (!_createCanvas) return null;
  try {
    const W = 260, H = 90;
    const canvas = _createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, W, H);

    const noiseLines = DIFFICULTY === 'hard' ? 10 : DIFFICULTY === 'medium' ? 6 : 3;
    for (let i = 0; i < noiseLines; i++) {
      ctx.strokeStyle = 'hsla(' + Math.floor(Math.random() * 360) + ',60%,60%,0.4)';
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(Math.random() * W, Math.random() * H);
      ctx.lineTo(Math.random() * W, Math.random() * H);
      ctx.stroke();
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const slot = (W - 30) / text.length;
    for (let i = 0; i < text.length; i++) {
      ctx.save();
      const x = 20 + i * slot + slot / 2;
      const y = H / 2 + (Math.random() * 14 - 7);
      ctx.translate(x, y);
      ctx.rotate((Math.random() - 0.5) * (DIFFICULTY === 'hard' ? 0.7 : 0.45));
      ctx.font = 'bold ' + (38 + Math.floor(Math.random() * 8)) + 'px Sans';
      ctx.fillStyle = 'hsl(' + Math.floor(Math.random() * 360) + ',75%,72%)';
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
    }

    const dots = DIFFICULTY === 'hard' ? 220 : DIFFICULTY === 'medium' ? 120 : 60;
    for (let i = 0; i < dots; i++) {
      ctx.fillStyle = 'hsla(' + Math.floor(Math.random() * 360) + ',60%,70%,0.5)';
      ctx.beginPath();
      ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas.toBuffer('image/png');
  } catch (e) {
    console.error('[Captcha] render error:', e && e.message);
    return null;
  }
}

// Pick a challenge: a random code plus whether we're in degraded (no-canvas) mode. The
// caller renders the image AFTER claiming the atomic issuance slot, so canvas work is gated
// by the per-user cooldown. When canvas is unavailable we degrade to a HARDER 6-char text
// code (answer space 30^6) — never the old ~13-answer math, which was trivially machine-
// solvable — and shout in the logs so an operator fixes the outage.
function makeChallenge() {
  if (_createCanvas) return { code: randCode(CODE_LEN), degraded: false };
  console.error('[captcha] canvas unavailable - degraded to text-code challenge', { reason: 'module-load-failed', difficulty: DIFFICULTY });
  return { code: randCode(6), degraded: true };
}

// ── Verify panel (persistent, deduped) ──────────────────────────────────────
function buildPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(CAPTCHA_CONFIG.panelTitle || 'Verification Required')
    .setDescription(CAPTCHA_CONFIG.panelDescription || 'Click **Verify** below and solve the captcha to gain access to the server.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('captcha_start').setLabel('Verify').setEmoji('\u2705').setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row] };
}

// Post the persistent Verify panel, and REPAIR it if it has gone missing.
//
// This deliberately no longer uses runOnce. That marker is keyed by bot+channel and
// nothing ever deletes it: the behaviour-delete cleanup only drops data types listed
// in usedDataTypes, and the marker's type is dynamic ('run_once:captcha_panel:<id>'),
// so it can never appear in a static list. Once set, the panel could never be posted
// again for that bot+channel for the life of the bot — deleting the behaviour and
// re-adding the template silently did nothing, and deleting the panel MESSAGE was
// equally unrecoverable. Prod 2026-08-19: an owner hit exactly that, was told by the
// builder that no captcha existed while the template count still said 1, and had no
// way back.
//
// Verify the ARTIFACT instead of remembering the EVENT: keep the posted message id
// and repost only when it is genuinely gone. That is still idempotent across
// redeploys — the reason runOnce was used — and additionally self-heals after a
// delete. Re-posting when the configured channel CHANGES is intentional too: the old
// channel's panel is no longer the configured one.
whenReady(async () => {
  try {
    const ch = client.channels.cache.get(CAPTCHA_CONFIG.panelChannelId);
    // Not resolvable yet: leave everything untouched so the next deploy retries,
    // exactly as returning false from runOnce used to.
    if (!ch || !isSendable(ch) || typeof ch.send !== 'function') return;
    const saved = await botData.get('_meta', 'captcha_panel', null);
    if (saved && saved.messageId && saved.channelId === CAPTCHA_CONFIG.panelChannelId) {
      const existing = await ch.messages.fetch(saved.messageId).catch(() => null);
      if (existing) return;
    }
    const msg = await ch.send(buildPanelPayload());
    if (msg && msg.id) {
      await botData.set('_meta', 'captcha_panel', {
        messageId: msg.id,
        channelId: CAPTCHA_CONFIG.panelChannelId,
        at: Date.now(),
      }, null);
    }
  } catch (e) {}
});

// Register /verify so registerCommands() pushes it to Discord. __setupCommands is
// the single registration source for builder-handled commands.
const verifyCmd = new SlashCommandBuilder()
  .setName(CMD_NAME)
  .setDescription('Verify yourself to gain access to the server');
if (typeof __setupCommands !== 'undefined') {
  __setupCommands.push(verifyCmd.toJSON());
}

async function grantVerifiedRole(interaction) {
  const guild = interaction.guild;
  const role = guild.roles.cache.get(CAPTCHA_CONFIG.verifiedRoleId)
    || await guild.roles.fetch(CAPTCHA_CONFIG.verifiedRoleId).catch(() => null);
  if (!role) return { ok: false, reason: 'The verified role no longer exists. Ask an admin to reconfigure verification.' };
  // canGrantRole is the shared runtime guard: it rejects @everyone, bot-managed
  // roles, and roles at/above my highest role (the 50013/50028 failure set).
  if (!canGrantRole(role, guild.members.me, guild.id)) {
    return { ok: false, reason: 'I cannot assign that role — it may be @everyone, bot-managed, or above my highest role. Ask an admin to move my role above it and grant Manage Roles.' };
  }
  // ⚠ TEST .roles.cache, NOT .roles. A RAW APIInteractionGuildMember has a truthy roles
  // STRING[], so testing .roles alone selects the raw object and member.roles.add() throws.
  // Only a real GuildMember carries a GuildMemberRoleManager, so .cache is what actually
  // distinguishes the two shapes — the same test ban-appeals uses. Falling through to the
  // fetch returns a real member, which is what the role add needs.
  const member = (interaction.member && interaction.member.roles && interaction.member.roles.cache)
    ? interaction.member
    : await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return { ok: false, reason: 'Could not fetch your server membership. Please try again.' };
  try {
    await member.roles.add(role);
    // Take the pending mark off in the same breath. Deliberately AFTER the grant and in its own
    // try: the grant is what verification MEANS, so a removal that fails (role deleted, moved
    // above the bot, already gone) must never turn a successful verification into a failed one.
    // It reports instead, so the owner learns their role hierarchy is wrong rather than nothing.
    const _pendingId = CAPTCHA_CONFIG.unverifiedRoleId;
    if (_pendingId && member.roles.cache.has(_pendingId)) {
      try {
        await member.roles.remove(_pendingId);
      } catch (_rmErr) {
        const _rmCode = (_rmErr && _rmErr.rawError && _rmErr.rawError.code) || (_rmErr && _rmErr.code);
        console.warn('[Captcha] could not remove the pending role:', _rmErr && _rmErr.message);
        if (_rmCode === 50013 || _rmCode === 50001) {
          try { await reportPermissionIssue(_rmErr, 'remove the unverified role', { guildId: guild && guild.id }); } catch (_e) {}
        }
      }
    }
    return { ok: true };
  } catch (err) {
    const code = (err && err.rawError && err.rawError.code) || (err && err.code);
    if (code === 50013 || code === 50001) {
      return { ok: false, reason: 'I lack permission to assign the role (I need Manage Roles and my role above the verified role).' };
    }
    console.error('[Captcha] role add error:', err && err.message);
    return { ok: false, reason: 'Failed to assign the role. Please try again in a moment.' };
  }
}

async function logVerification(interaction, ok) {
  if (!CAPTCHA_CONFIG.logChannelId) return;
  const ch = interaction.guild.channels.cache.get(CAPTCHA_CONFIG.logChannelId);
  if (!ch || !isSendable(ch) || typeof ch.send !== 'function') return;
  const embed = new EmbedBuilder()
    .setColor(ok ? '#57F287' : '#ED4245')
    .setDescription((ok ? '\u2705' : '\u274C') + ' <@' + interaction.user.id + '> ' + (ok ? 'passed' : 'failed') + ' verification')
    .setTimestamp();
  await ch.send({ embeds: [embed] }).catch(() => {});
}

client.on('interactionCreate', async (interaction) => {
  // Scope discipline: bail immediately on anything that isn't ours, and never
  // touch an interaction another handler already answered. isOpen/isModal match by
  // PREFIX because their customIds now carry a per-challenge nonce suffix
  // ('captcha_open:<nonce>' / 'captcha_modal:<nonce>').
  const isCmd = typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand() && interaction.commandName === CMD_NAME;
  const isStart = typeof interaction.isButton === 'function' && interaction.isButton() && interaction.customId === 'captcha_start';
  const isOpen = typeof interaction.isButton === 'function' && interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('captcha_open');
  const isModal = typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('captcha_modal');
  if (!isCmd && !isStart && !isOpen && !isModal) return;
  if (interaction.replied || interaction.deferred) return;

  try {
    // ⚠ inGuild() IS NOT ENOUGH, AND THAT IS NOT OBVIOUS. It is Boolean(guildId && member),
    // so it returns TRUE for the RAW APIInteractionGuildMember shape — which is exactly the case
    // where interaction.guild is null, because raw is what "guild not cached" produces. The next
    // line then threw on .id and the owner's member saw "Something went wrong" instead of the
    // sentence above. Test interaction.guild itself, which is the thing being dereferenced.
    if (!interaction.guild) {
      return interaction.reply({ content: 'Verification only works inside a server.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // START — /verify command or the panel Verify button: issue a fresh captcha.
    if (isCmd || isStart) {
      // Ack within Discord's 3s window BEFORE any slow work (botData, the captcha image
      // render). Every reply in this branch becomes an editReply against this deferred
      // (ephemeral) response — editReply does not take a flags/ephemeral field.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const role = interaction.guild.roles.cache.get(CAPTCHA_CONFIG.verifiedRoleId);
      const mem = interaction.member;
      if (role && mem && mem.roles && mem.roles.cache && typeof mem.roles.cache.has === 'function' && mem.roles.cache.has(role.id)) {
        // ⚠️ REPAIR THE ALREADY-STUCK, or this reaches nobody who has the bug. An audit found the
        // removal was only reachable from the pass branch, so a member already holding the verified
        // role short-circuited here and kept the pending mark for ever — which is exactly the
        // population in the report. Re-running /verify is the owner's natural remedy, so it has to
        // work. Guarded like the grant path: a failed removal must not become an error reply.
        try {
          const _stuckId = CAPTCHA_CONFIG.unverifiedRoleId;
          if (_stuckId && mem.roles.cache.has(_stuckId)) {
            await mem.roles.remove(_stuckId);
            return interaction.editReply({ content: '\u2705 You were already verified — I have removed the leftover role.' }).catch(() => {});
          }
        } catch (_fixErr) {
          console.warn('[Captcha] could not clear the leftover pending role:', _fixErr && _fixErr.message);
        }
        return interaction.editReply({ content: '\u2705 You are already verified!' }).catch(() => {});
      }

      // Build the challenge (cheap: code pick + hash + nonces) — but DON'T render yet. The
      // render is the raid-amplified step; it must only run once the atomic reservation below
      // confirms we actually claimed a fresh issuance slot.
      const challenge = makeChallenge();
      const nonce = crypto.randomUUID();
      const answerHash = hashAnswer(challenge.code);
      const callNonce = crypto.randomUUID();

      // ATOMIC issue (one CAS): refuse to overwrite a live lockout (a concurrent burst can't
      // clobber a just-set lock), enforce the per-user issuance cooldown, and otherwise write
      // the fresh challenge (new answerHash + nonce). Attempts survive a re-issue only when the
      // user isn't locked. The committed record carries THIS call's nonce so the outcome is read
      // back from what actually committed — a CAS retry can never report a stale one.
      const committed = await botData.update(userId, 'captcha_pending', (c) => {
        const t = Date.now();
        if (c && c.locked && c.expiresAt > t) return c;                                  // live lockout → outcome 'locked'
        if (c && c.lastIssuedAt && (t - c.lastIssuedAt) < ISSUE_COOLDOWN_MS) return c;    // too fast → outcome 'cooldown'
        return {
          answerHash,
          nonce,
          attempts: (c && !c.locked ? (c.attempts || 0) : 0),
          expiresAt: t + TTL_MS,
          locked: false,
          lastIssuedAt: t,
          _o: { r: 'issued', n: callNonce },
        };
      }, guildId);

      if (committed === null) {
        // CAS exhausted / transient store error — non-fatal, ask them to retry.
        return interaction.editReply({ content: '\u26A0\uFE0F Could not start verification right now. Please click **Verify** to try again.' }).catch(() => {});
      }
      const issued = !!(committed && committed._o && committed._o.n === callNonce && committed._o.r === 'issued');
      if (!issued) {
        if (committed.locked && committed.expiresAt > Date.now()) {
          const mins = Math.ceil((committed.expiresAt - Date.now()) / 60000);
          return interaction.editReply({ content: '\u23F3 Too many attempts. Try again in ' + mins + ' minute(s).' }).catch(() => {});
        }
        return interaction.editReply({ content: '\u23F3 Please wait a moment before requesting another captcha.' }).catch(() => {});
      }

      // Slot claimed → render now (reached at most once per cooldown window per user). A render
      // that fails here degrades loudly, same as a missing binary.
      let image = null;
      let degraded = challenge.degraded;
      if (!degraded) {
        image = renderCaptcha(challenge.code);
        if (!image) {
          console.error('[captcha] canvas unavailable - degraded to text-code challenge', { reason: 'render-failed', difficulty: DIFFICULTY });
          degraded = true;
        }
      }
      const promptText = degraded
        ? '\u26A0\uFE0F Image challenge unavailable. Type this exact code, then click **Enter Code**:\n\n**' + challenge.code + '**'
        : 'Type the characters shown in the image, then click **Enter Code**.';

      const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('\u{1F6E1}\uFE0F Verification').setDescription(promptText);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('captcha_open:' + nonce).setLabel('Enter Code').setStyle(ButtonStyle.Primary)
      );
      const payload = { embeds: [embed], components: [row] };
      if (image) {
        embed.setImage('attachment://captcha.png');
        payload.files = [new AttachmentBuilder(image, { name: 'captcha.png' })];
      }
      return interaction.editReply(payload).catch(() => {});
    }

    // OPEN — show the modal IMMEDIATELY. No botData read here: a >3s stall before showModal
    // (which cannot be deferred) causes a 10062 dead-click. The nonce rides in on this button's
    // own customId (set when the challenge was issued) and is forwarded into the modal customId;
    // the modal-submit handler re-validates the pending's presence / expiry / nonce.
    if (isOpen) {
      const nonce = interaction.customId.slice('captcha_open:'.length);
      const modal = new ModalBuilder().setCustomId('captcha_modal:' + nonce).setTitle('Verification').addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('captcha_answer').setLabel('Enter the code / answer').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(16)
        )
      );
      return interaction.showModal(modal).catch(() => {});
    }

    // MODAL — validate AND mutate in ONE atomic CAS, then grant only on a confirmed pass.
    if (isModal) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const submittedNonce = interaction.customId.slice('captcha_modal:'.length);
      const given = String(interaction.fields.getTextInputValue('captcha_answer') || '').trim().toUpperCase();
      const givenHash = hashAnswer(given);
      const callNonce = crypto.randomUUID();

      // The whole validate→mutate happens inside the reducer so the attempt increment + lockout
      // are ATOMIC (fixes the burst-bypass where parallel get→sets all saw the same attempts),
      // and a correct answer CONSUMES the pending — only the one call that atomically consumes
      // the right nonce+answer proceeds to grant, so a concurrent burst can't multi-pass.
      const committed = await botData.update(userId, 'captcha_pending', (c) => {
        const t = Date.now();
        // stale: no pending, already consumed, expired, or a mismatched (old) challenge → no change.
        if (!c || !c.answerHash || (c.expiresAt && c.expiresAt <= t) || c.nonce !== submittedNonce) return c;
        if (givenHash === c.answerHash) {
          // PASS — consume (answerHash null reads as absent to every branch). Only THIS committed
          // record carries the pass nonce, so a racing duplicate submit resolves to 'stale'.
          return { answerHash: null, nonce: null, attempts: c.attempts || 0, expiresAt: 0, locked: false, lastIssuedAt: c.lastIssuedAt || 0, _o: { r: 'pass', n: callNonce } };
        }
        const attempts = (c.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          return { answerHash: null, nonce: null, attempts, expiresAt: t + TTL_MS, locked: true, lastIssuedAt: c.lastIssuedAt || 0, _o: { r: 'locked', n: callNonce } };
        }
        return { answerHash: c.answerHash, nonce: c.nonce, attempts, expiresAt: c.expiresAt, locked: false, lastIssuedAt: c.lastIssuedAt || 0, _o: { r: 'fail', n: callNonce } };
      }, guildId);

      if (committed === null) {
        // CAS exhausted / no pending row / transient store error — non-failure; do NOT log a red fail.
        return interaction.editReply({ content: '\u23F3 Your captcha expired or the server was busy. Click **Verify** to get a new one.' }).catch(() => {});
      }
      const outcome = (committed && committed._o && committed._o.n === callNonce) ? committed._o.r : 'stale';

      if (outcome === 'pass') {
        const res = await grantVerifiedRole(interaction);
        if (!res.ok) {
          // The answer WAS correct — this is not a failed verification. Log it distinctly (a warn,
          // not a red "failed" entry) so the log channel doesn't mislead the operator.
          console.warn('[Captcha] verified but role grant failed:', res.reason);
          return interaction.editReply({ content: '\u26A0\uFE0F ' + res.reason }).catch(() => {});
        }
        await logVerification(interaction, true).catch(() => {});
        return interaction.editReply({ content: CAPTCHA_CONFIG.successMessage || '\u2705 Verified! Welcome to the server.' }).catch(() => {});
      }
      if (outcome === 'locked') {
        await logVerification(interaction, false).catch(() => {});
        return interaction.editReply({ content: '\u274C Too many failed attempts. Please wait 10 minutes, then click **Verify** to try again.' }).catch(() => {});
      }
      if (outcome === 'fail') {
        const left = Math.max(0, MAX_ATTEMPTS - (committed.attempts || 0));
        return interaction.editReply({ content: '\u274C Incorrect. Click **Verify** to get a new captcha. (' + left + ' attempt' + (left === 1 ? '' : 's') + ' left)' }).catch(() => {});
      }
      // stale — expired / wrong nonce / already consumed. Not a failure; don't log.
      return interaction.editReply({ content: '\u23F3 Your captcha expired. Click **Verify** to get a new one.' }).catch(() => {});
    }
  } catch (error) {
    console.error('[Captcha] handler error:', error && error.message);
    try {
      const content = '\u274C Something went wrong. Please click **Verify** to try again.';
      // A deferred interaction (command/start or modal path) must be resolved with
      // editReply — followUp would leave the "thinking…" deferral hanging, and
      // editReply takes no flags (ephemeral is fixed by the defer).
      if (interaction.deferred) await interaction.editReply({ content }).catch(() => {});
      else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } catch {}
  }
});

console.log('Captcha verification system ready!');
})().catch(e => console.error('[Captcha Verification (/verify)] startup error:', e));

// ===== Welcome Message (converted from declarative export) =====
client.on('guildMemberAdd', async member => { try {
} catch(e) { console.error('[Welcome]', e); } });

client.login(TOKEN);
