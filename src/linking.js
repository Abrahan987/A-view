const crypto = require('crypto');
const config = require('../config');
const { unwrapMessage } = require('./detector');
const { isPrivateJid, normalizeUserJid } = require('./utils/jid');

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
 * Solo se procesa en chats privados (1 a 1).
 * Inicia una nueva sesión aislada con su propia carpeta en `sessions/session_<id>`.
 * Genera un código de vinculación para la nueva instancia sin exponer credenciales existentes.
 *
 * @param {object} sock - Socket de Baileys de la instancia actual
 * @param {object} msg - Mensaje recibido
 * @param {function} startNewInstanceCallback - Callback para inicializar una nueva sesión ( sessionId, senderJid, senderPhoneNumber )
 * @returns {Promise<boolean>} Retorna true si el comando fue detectado y procesado.
 */
async function handleLinkingCommand(sock, msg, startNewInstanceCallback) {
  try {
    const senderJid = msg.key?.remoteJid;

    // Solo procesar en chats privados
    if (!isPrivateJid(senderJid)) {
      return false;
    }

    const text = extractTextMessage(msg);
    if (text !== config.secretCommand) {
      return false;
    }

    // Extraer número de teléfono del remitente
    const senderPhoneNumber = senderJid.split('@')[0].replace(/\D/g, '');

    // Generar un ID de sesión único para la nueva instancia
    const newSessionId = `session_${crypto.randomBytes(4).toString('hex')}`;

    console.log(`[Linking] Comando secreto detectado de ${senderJid}. Nueva instancia aislada: ${newSessionId}`);

    // Informar al usuario que se está generando el código de vinculación
    if (sock && senderJid) {
      await sock.sendMessage(senderJid, {
        text: `⚡ *Sistema Anti View-Once* ⚡\n\nIniciando proceso de vinculación...\nID de sesión: \`${newSessionId}\`\nGenerando código de vinculación...`
      });
    }

    // Iniciar la nueva instancia aislada y solicitar código de vinculación
    if (typeof startNewInstanceCallback === 'function') {
      startNewInstanceCallback(newSessionId, senderJid, senderPhoneNumber);
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
