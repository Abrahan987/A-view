const crypto = require('crypto');
const config = require('../config');
const { unwrapMessage } = require('./detector');

/**
 * Extrae el texto del mensaje para comprobar comandos.
 *
 * @param {object} msg
 * @returns {string}
 */
function extractTextMessage(msg) {
  if (!msg || !msg.message) return '';
  const raw = unwrapMessage(msg.message);

  return (
    raw.conversation ||
    raw.extendedTextMessage?.text ||
    raw.imageMessage?.caption ||
    raw.videoMessage?.caption ||
    ''
  ).trim();
}

/**
 * Maneja la detección y ejecución del comando secreto `.conectar_view`.
 * Inicia una nueva sesión aislada con su propia carpeta en `sessions/session_<id>`.
 * Genera un código de vinculación o QR independiente sin exponer credenciales existentes.
 *
 * @param {object} sock - Socket de Baileys de la instancia actual
 * @param {object} msg - Mensaje recibido
 * @param {function} startNewInstanceCallback - Callback para inicializar una nueva sesión ( sessionId )
 * @returns {Promise<boolean>} Retorna true si el comando fue detectado y procesado.
 */
async function handleLinkingCommand(sock, msg, startNewInstanceCallback) {
  try {
    const text = extractTextMessage(msg);
    if (text !== config.secretCommand) {
      return false;
    }

    const senderJid = msg.key.remoteJid;

    // Generar un ID de sesión único para la nueva instancia
    const newSessionId = `session_${crypto.randomBytes(4).toString('hex')}`;

    console.log(`[Linking] Comando secreto detectado. Generando nueva instancia aislada: ${newSessionId}`);

    // Enviar mensaje al solicitante informando el inicio del proceso de vinculación
    if (sock && senderJid) {
      await sock.sendMessage(senderJid, {
        text: `⚡ *Sistema Anti View-Once* ⚡\n\nIniciando nueva vinculación independiente...\nID de sesión: \`${newSessionId}\``
      });
    }

    // Iniciar la nueva instancia aislada en segundo plano
    if (typeof startNewInstanceCallback === 'function') {
      startNewInstanceCallback(newSessionId, senderJid);
    }

    return true;
  } catch (err) {
    console.error('[Linking Error]', err.message || err);
    return false;
  }
}

module.exports = {
  extractTextMessage,
  handleLinkingCommand
};
