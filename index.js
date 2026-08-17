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

const config = require('./config');
const MessageDeduplicator = require('./src/utils/dedupe');
const { handleViewOnceMessage } = require('./src/detector');
const { handleLinkingCommand } = require('./src/linking');

const logger = pino({ level: 'silent' });
const activeInstances = new Map();

/**
 * Inicia una instancia de WhatsApp conectada vía Baileys.
 *
 * @param {string} sessionId ID de la sesión (ej. 'main', 'session_1234')
 * @param {string} [ownerNumber] Número o JID del propietario para esta sesión
 * @param {string} [pairingPhoneNumber] Número telefónico para solicitar código de vinculación
 * @param {string} [notifyJid] JID a donde enviar el código de vinculación por WhatsApp
 */
async function startInstance(
  sessionId = config.defaultSessionId,
  ownerNumber = config.ownerNumber,
  pairingPhoneNumber = null,
  notifyJid = null
) {
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

  // Guardar info de la sesión (propietario)
  const infoPath = path.join(sessionPath, 'info.json');
  if (!fs.existsSync(infoPath)) {
    fs.writeFileSync(infoPath, JSON.stringify({ ownerNumber, sessionId, createdAt: new Date().toISOString() }, null, 2));
  }

  // Escuchar actualización de credenciales para persistencia
  sock.ev.on('creds.update', saveCreds);

  // Escuchar eventos de conexión
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`\n=== ESCANEA EL CODIGO QR PARA VINCULAR LA SESION: ${sessionId} ===\n`);
      qrcode.generate(qr, { small: true });

      // Si se solicitó vinculación y se proporcionó número telefónico
      if (!sock.authState.creds.registered && pairingPhoneNumber) {
        try {
          setTimeout(async () => {
            const code = await sock.requestPairingCode(pairingPhoneNumber);
            console.log(`[Session ${sessionId}] Código de vinculación generado: ${code}`);
            if (notifyJid) {
              await sock.sendMessage(notifyJid, {
                text: `🔑 *CÓDIGO DE VINCULACIÓN PARA ${sessionId}:*\n\n\`${code}\`\n\nIngresa este código en WhatsApp (Dispositivos vinculados > Vincular con número de teléfono).`
              }).catch(() => {});
            }
          }, 3000);
        } catch (err) {
          console.error(`[Session ${sessionId}] Error generando código de vinculación:`, err.message);
        }
      }
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
      const handledCommand = await handleLinkingCommand(
        sock,
        msg,
        (newSessionId, requesterJid, requesterPhoneNumber) => {
          startInstance(newSessionId, requesterJid, requesterPhoneNumber, requesterJid);
        }
      );

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

/**
 * Escanea la carpeta `sessions/` e inicia todas las sesiones existentes al arrancar.
 */
async function startAllExistingSessions() {
  if (!fs.existsSync(config.sessionsDir)) {
    fs.mkdirSync(config.sessionsDir, { recursive: true });
  }

  const entries = fs.readdirSync(config.sessionsDir, { withFileTypes: true });
  const sessionFolders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  // Asegurar que la sesión principal esté en la lista
  if (!sessionFolders.includes(config.defaultSessionId)) {
    sessionFolders.unshift(config.defaultSessionId);
  }

  console.log(`[Launcher] Iniciando ${sessionFolders.length} sesión(es)...`);

  for (const sessionId of sessionFolders) {
    let sessionOwner = config.ownerNumber;
    const infoPath = path.join(config.sessionsDir, sessionId, 'info.json');

    if (fs.existsSync(infoPath)) {
      try {
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        if (info.ownerNumber) sessionOwner = info.ownerNumber;
      } catch {}
    }

    await startInstance(sessionId, sessionOwner).catch((err) => {
      console.error(`[Launcher Error] Error iniciando sesión ${sessionId}:`, err);
    });
  }
}

// Iniciar todas las sesiones registradas al ejecutar el servidor
if (require.main === module) {
  startAllExistingSessions().catch((err) => {
    console.error('[Main Error]', err);
  });
}

module.exports = {
  startInstance,
  startAllExistingSessions,
  activeInstances
};
