const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

const config = require('../config');
const MessageDeduplicator = require('./utils/dedupe');
const { handleViewOnceMessage } = require('./detector');
const { handleLinkingCommand } = require('./linking');

const logger = pino({ level: 'silent' });
const activeInstances = new Map();

/**
 * Inicia una instancia de WhatsApp conectada vía Baileys.
 *
 * @param {string} sessionId ID de la sesión (ej. 'main', 'session_1234')
 * @param {string} [ownerNumber] Número o JID de propietario (por defecto usa config.ownerNumber)
 */
async function startInstance(sessionId = config.defaultSessionId, ownerNumber = config.ownerNumber) {
  if (activeInstances.has(sessionId)) {
    console.log(`[Session ${sessionId}] La sesión ya está activa.`);
    return activeInstances.get(sessionId);
  }

  const sessionPath = path.join(config.sessionsDir, sessionId);
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    generateHighQualityLinkPreview: false,
    syncFullHistory: false
  });

  const deduplicator = new MessageDeduplicator(1000);

  // Escuchar actualización de credenciales para persistencia
  sock.ev.on('creds.update', saveCreds);

  // Escuchar eventos de conexión
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`\n=== ESCANEA EL CODIGO QR PARA VINCULAR LA SESION: ${sessionId} ===\n`);
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log(`[Session ${sessionId}] Conexión establecida con éxito.`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[Session ${sessionId}] Conexión cerrada. Código: ${statusCode}. Reconectando: ${shouldReconnect}`);
      activeInstances.delete(sessionId);

      if (shouldReconnect) {
        setTimeout(() => {
          startInstance(sessionId, ownerNumber);
        }, 5000);
      } else {
        console.log(`[Session ${sessionId}] Sesión cerrada permanentemente (Logged out).`);
      }
    }
  });

  // Escuchar mensajes entrantes
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (!msg.message) continue;

      // 1. Verificar si es el comando secreto .conectar_view
      const handledCommand = await handleLinkingCommand(sock, msg, (newSessionId, newOwnerJid) => {
        startInstance(newSessionId, newOwnerJid || ownerNumber);
      });

      if (handledCommand) {
        continue;
      }

      // 2. Si no es del usuario propio (evitar bucle si me lo auto-envío) y es privado
      if (msg.key.fromMe) continue;

      // 3. Procesar si es mensaje View Once
      await handleViewOnceMessage(sock, msg, ownerNumber, deduplicator);
    }
  });

  activeInstances.set(sessionId, sock);
  return sock;
}

// Iniciar sesión principal al ejecutar
if (require.main === module) {
  startInstance(config.defaultSessionId, config.ownerNumber).catch((err) => {
    console.error('[Main Error]', err);
  });
}

module.exports = {
  startInstance,
  activeInstances
};
