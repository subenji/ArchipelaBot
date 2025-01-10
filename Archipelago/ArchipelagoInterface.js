const { Client, ITEMS_HANDLING_FLAGS, SERVER_PACKET_TYPE, COMMON_TAGS } = require('archipelago.js');
const { User } = require('discord.js');
const { v4: uuid } = require('uuid');

const DEBUG = false;

class ArchipelagoInterface {
/**
   * @param textChannel discord.js TextChannel
   * @param {string} host
   * @param {Number} port
   * @param {string} slotName
   * @param {string|null} password optional
   */

  constructor(textChannel, host, port, slotName, password=null) {
    this.textChannel = textChannel;
    this.messageQueue = [];
    this.players = new Map();
    this.APClient = new Client();

    this.slotName = slotName;

    // Controls which messages should be printed to the channel
    this.showHints = true;
    this.showItems = true;
    this.showProgression = true;
    this.showChat = true;

    this.connectionInfo = {
      hostname: host,
      port,
      password,
      uuid: uuid(),
      game: '',
      name: slotName,
      items_handling: ITEMS_HANDLING_FLAGS.LOCAL_ONLY,
      tags: [COMMON_TAGS.TEXT_ONLY],
    };

    this.lastBounce;

    this.connect();
  }

  async connect(reconnect = false) {
    await this.APClient.connect(this.connectionInfo).then(() => {
      // Start handling queued messages
      if (this.queueTimeout) { clearTimeout(this.queueTimeout); }
      this.queueTimeout = setTimeout(this.queueHandler, 5000);
      if (this.bounceTimeout) { clearTimeout(this.bounceTimeout); }
      this.bounceTimeout = setTimeout(this.bounceHandler, 60000);
      this.lastBounce = Date.now();

      // Set up packet listeners
      // this.APClient.addListener(SERVER_PACKET_TYPE.PRINT, this.printHandler);
      this.APClient.addListener(SERVER_PACKET_TYPE.PRINT_JSON, this.printJSONHandler);
      this.APClient.addListener(SERVER_PACKET_TYPE.BOUNCED, this.bouncedHandler);

      // Inform the user ArchipelaBot has connected to the game
      if (!reconnect) this.textChannel.send('Connection established.');
    }).catch(async (err) => {
      console.error('Error while trying to connect with connectionInfo:');
      console.error(this.connectionInfo);
      console.error('With trace:');
      console.error(err);
      await this.textChannel.send('A problem occurred while connecting to the AP server:\n' +
        `\`\`\`${JSON.stringify(err)}\`\`\``);
      throw new Error(err);
    });
  }

  /**
   * Send queued messages to the TextChannel in batches of five or less
   * @returns {Promise<void>}
   */
  queueHandler = async () => {
    let messages = [];

    for (let message of this.messageQueue) {
      switch(message.type) {
        case 'hint':
        // Ignore hint messages if they should not be displayed
          if (!this.showHints) { continue; }

          // Replace player names with Discord User objects
          for (let alias of this.players.keys()) {
            if (message.content.includes(alias)) {
              message.content = message.content.replace(alias, this.players.get(alias));
            }
          }
          break;

        case 'item':
        // Ignore item messages if they should not be displayed
          if (!this.showItems) { continue; }
          break;

        case 'progression':
        // Ignore progression messages if they should not be displayed
          if (!this.showProgression) { continue; }
          break;

        case 'chat':
        // Ignore chat messages if they should not be displayed
          if (!this.showChat) { continue; }
          break;

        default:
          console.warn(`Ignoring unknown message type: ${message.type}`);
          break;
      }

      messages.push(message.content);
    }

    // Clear the message queue
    this.messageQueue = [];

    // Send messages to TextChannel in batches of five, spaced two seconds apart to avoid rate limit
    while (messages.length > 0) {
      await this.textChannel.send(messages.splice(0, 5).join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Set timeout to run again after five seconds
    if (this.queueTimeout) { clearTimeout(this.queueTimeout); }
    this.queueTimeout = setTimeout(this.queueHandler, 5000);
  };

  /**
   * Listen for a print packet and add that message to the message queue
   * @param {Object} packet
   * @returns {Promise<void>}
   */
  printHandler = async (packet) => {
    this.messageQueue.push({
      type: packet.text.includes('[Hint]') ? 'hint' : 'chat',
      content: packet.text,
    });
  };

  /**
   * Listen for a printJSON packet, convert it to a human-readable format, and add the message to the queue
   * @param {Object} packet
   * @param {String} rawMessage
   * @returns {Promise<void>}
   */
  printJSONHandler = async (packet, rawMessage) => {
    let message = { type: 'chat', content: '', };

    this.APClient.timeoutid == Date.now();

    if (!['ItemSend', 'ItemCheat', 'Hint', 'Chat', 'ServerChat'].includes(packet.type)) {
      message.content = rawMessage;
      this.messageQueue.push(message);
      return;
    }

    if (packet.type == 'ServerChat') {
      message.content = 'SERVER: '+rawMessage;
      this.messageQueue.push(message);
      return;
    }

    if (packet.type == 'Chat') {
      message.content = this.APClient.players.alias(packet.slot)+': '+rawMessage;
      this.messageQueue.push(message);
      return;
    }

    packet.data.forEach((part) => {
      // Plain text parts do not have a "type" property
      if (!part.hasOwnProperty('type') && part.hasOwnProperty('text')) {
        message.content += part.text;
        return;
      }

      switch(part.type){
        case 'player_id':
          message.content += '**'+this.APClient.players.alias(parseInt(part.text, 10))+'**';
          break;

        case 'item_id':
          const itemName = this.APClient.players.get(packet.receiving).item(parseInt(part.text, 10));
          message.content += `**${itemName}**`;

          // Identify this message as containing an item
          if (message.type !== 'progression') { message.type = 'item'; }

          // Identify if this message contains a progression item
          if (part?.flags & 0b001 > 0) { message.type = 'progression'; }
          break;

        case 'location_id':
          const locationName = this.APClient.players.get(packet.item.player).location(parseInt(part.text, 10));
          message.content += `**${locationName}**`;
          break;

        case 'color':
          message.content += part.text;
          break;

        default:
          console.warn(`Ignoring unknown message type ${part.type} with text "${part.text}".`);
          return;
      }
    });

    // Identify hint messages
    if (rawMessage.includes('[Hint]')) { message.type = 'hint'; }

    this.messageQueue.push(message);
  };

  bounceHandler = async () => {
    /*if (Date.now() - this.lastBounce > 5*60*1000) {
      if (DEBUG) console.log(`Ping failed: last ping received was ${(Date.now() - this.lastBounce) / 1000}s ago.`);
      await this.reconnect();
      return;
    }*/

    const packet = {
      cmd: 'Bounce',
      //games: [this.gameName];
      slots: [this.APClient.data.slot],
      data: 'Ping'
    };
    this.APClient.send(packet);
    if (DEBUG) console.log(`sent packet: ${JSON.stringify(packet)}`);

    if (this.checkPingTimeout) { clearTimeout(this.checkPingTimeout); }
    this.checkPingTimeout = setTimeout(this.checkPing, 5000);
    if (this.bounceHandlerTimeout) { clearTimeout(this.bounceHandlerTimeout); }
    this.bounceHandlerTimeout = setTimeout(this.bounceHandler, 60000);
  };

  /**
    * @param {Object} packet
    * @returns {Promise<void>}
    */
  bouncedHandler = async (packet) => {
    if (DEBUG) console.log(`recv packet: ${JSON.stringify(packet)}`);
    if (packet.slots.includes(this.APClient.data.slot) && packet.data === 'Ping') {
      if (DEBUG) console.log('got ping');
      this.lastBounce = Date.now();
      clearTimeout(this.checkPingTimeout);
      this.checkPingTimeout = null;
    }
    return;
  };

  checkPing = async () => {
    const dt = Date.now() - this.lastBounce;
    if (dt < 9000) {
      if (this.checkPingTimeout) { clearTimeout(this.checkPingTimeout); }
      this.checkPingTimeout = setTimeout(this.checkPing, 5000);
      return;
    }
    
    if (DEBUG) console.log(`no Ping response: last ping received was ${dt / 1000}s ago.`);
    if (DEBUG) console.log(`archipelago.js status: ${this.APClient.status}`);
    const packet = {
      cmd: 'Bounce',
      //games: [this.gameName];
      slots: [this.APClient.data.slot],
      data: 'Ping'
    };
    if (dt < 30000) {
      if (DEBUG) console.log('retrying (10s)...');
      this.APClient.send(packet);
      if (this.checkPingTimeout) { clearTimeout(this.checkPingTimeout); }
      this.checkPingTimeout = setTimeout(this.checkPing, 10000);
      return;
    }
    if (dt < 60000) {
      if (DEBUG) console.log('retrying (30s)...');
      this.APClient.send(packet);
      if (this.checkPingTimeout) { clearTimeout(this.checkPingTimeout); }
      this.checkPingTimeout = setTimeout(this.checkPing, 30000);
      return;
    }
    if (DEBUG) console.log('Connection failed. Reconnecting...');
    await this.reconnect();
    return;
  };

  /**
   * Associate a Discord user with a specified alias
   * @param {string} alias
   * @param {User} discordUser
   * @returns {*}
   */
  setPlayer = (alias, discordUser) => this.players.set(alias, discordUser);

  /**
   * Disassociate a Discord user with a specified alias
   * @param alias
   * @returns {boolean}
   */
  unsetPlayer = (alias) => this.players.delete(alias);

  /**
   * Determine the status of the ArchipelagoClient object
   * @returns {ConnectionStatus}
   */
  getStatus = () => this.APClient.status;

  /** Close the WebSocket connection on the ArchipelagoClient object */
  disconnect = () => {
    clearTimeout(this.queueTimeout);
    clearTimeout(this.bounceTimeout);
    clearTimeout(this.checkPingTimeout);
    clearTimeout(this.bounceHandlerTimeout);
    this.queueTimeout = null;
    this.bounceTimeout = null;
    this.checkPingTimeout = null;
    this.bounceHandlerTimeout = null;

    this.APClient.removeListener(SERVER_PACKET_TYPE.PRINT_JSON, this.printJSONHandler);
    this.APClient.removeListener(SERVER_PACKET_TYPE.BOUNCED, this.bouncedHandler);

    this.APClient.disconnect();
  };

  reconnect = async () => {
    //await this.textChannel.send('Lost connection to multiworld. Reconnecting...');
    this.disconnect();

    let attempts = 0;
    let timeout = 1;

    do {
      try {
        await new Promise(r => setTimeout(r, timeout*1000));
        await this.connect(true);
        break;
      } catch (e) {
        attempts++;
        timeout*timeout;

        if (attempts == 5) {
          await this.textChannel.send('Unable to reconnect after 5 retries. Run /ap-disconnect and try again.');
        }
      }
    } while (attempts < 5);
  };
}

module.exports = ArchipelagoInterface;
