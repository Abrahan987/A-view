const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { isPrivateJid, normalizeUserJid } = require('./utils/jid');

/**
 * Desenvuelve mensajes anidados como ephemeralMessage o documentWithCaptionMessage.
 *
 * @param {object} message
 * @returns {object}
 */
function unwrapMessage(message) {
  if (!message) return {};
  let current = message;

  if (current.ephemeralMessage?.message) {
    current = current.ephemeralMessage.message;
  }
  if (current.documentWithCaptionMessage?.message) {
    current = current.documentWithCaptionMessage.message;
  }

  return current;
}

/**
 * Detecta si un objeto de mensaje contiene un View Once de Imagen o Video.
 *
 * @param {object} msg - Objeto de mensaje de Baileys ( WAMessage )
 * @returns {{ isViewOnce: boolean, mediaType: 'image'|'video'|null, mediaContent: object|null }}
 */
function inspectViewOnce(msg) {
  if (!msg || !msg.message) {
    return { isViewOnce: false, mediaType: null, mediaContent: null };
  }

  let raw = unwrapMessage(msg.message);
  let isViewOnce = false;
  let innerMsg = raw;

  // Comprobar wrappers explícitos de View Once
  const viewOnceWrapper =
    raw.viewOnceMessage ||
    raw.viewOnceMessageV2 ||
    raw.viewOnceMessageV2Extension;

  if (viewOnceWrapper?.message) {
    isViewOnce = true;
    innerMsg = unwrapMessage(viewOnceWrapper.message);
  }

  // Comprobar si hay un imageMessage o videoMessage
  if (innerMsg.imageMessage) {
    const isVo = isViewOnce || Boolean(innerMsg.imageMessage.viewOnce);
    if (isVo) {
      return {
        isViewOnce: true,
        mediaType: 'image',
        mediaContent: innerMsg.imageMessage
      };
    }
  }

  if (innerMsg.videoMessage) {
    const isVo = isViewOnce || Boolean(innerMsg.videoMessage.viewOnce);
    if (isVo) {
      return {
        isViewOnce: true,
        mediaType: 'video',
        mediaContent: innerMsg.videoMessage
      };
    }
  }

  return { isViewOnce: false, mediaType: null, mediaContent: null };
}

/**
 * Procesador de mensajes View Once.
 * Descarga y reenvía en silencio al chat privado del propietario.
 *
 * @param {object} sock - Instancia de socket Baileys
 * @param {object} msg - Mensaje recibido ( WAMessage )
 * @param {string} ownerNumber - Número del propietario (ej. '573237649689')
 * @param {object} deduplicator - Instancia de MessageDeduplicator
 * @returns {Promise<boolean>} Retorna true si fue procesado exitosamente como View Once.
 */
async function handleViewOnceMessage(sock, msg, ownerNumber, deduplicator) {
  try {
    if (!msg || !msg.key) return false;

    // 1. Comprobar que sea de un chat privado
    const remoteJid = msg.key.remoteJid;
    if (!isPrivateJid(remoteJid)) {
      return false;
    }

    // 2. Inspeccionar si es View Once
    const { isViewOnce, mediaType, mediaContent } = inspectViewOnce(msg);
    if (!isViewOnce || !mediaType || !mediaContent) {
      return false;
    }

    // 3. Evitar duplicados
    const msgId = msg.key.id;
    if (deduplicator && deduplicator.hasAndAdd(msgId)) {
      return false;
    }

    // 4. Descargar el contenido multimedia
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        reconnect: true
      }
    );

    if (!buffer) {
      return false;
    }

    // 5. Construir el destino del propietario
    const ownerJid = normalizeUserJid(ownerNumber);

    // 6. Preparar payload preservando metadata relevante
    const caption = mediaContent.caption || '';
    const mimetype = mediaContent.mimetype || (mediaType === 'image' ? 'image/jpeg' : 'video/mp4');

    const messageContent = {};
    if (mediaType === 'image') {
      messageContent.image = buffer;
      messageContent.caption = caption;
      messageContent.mimetype = mimetype;
    } else if (mediaType === 'video') {
      messageContent.video = buffer;
      messageContent.caption = caption;
      messageContent.mimetype = mimetype;
      if (mediaContent.seconds) {
        messageContent.seconds = mediaContent.seconds;
      }
    }

    // 7. Enviar al chat privado del propietario en silencio (sin notificar al remitente)
    await sock.sendMessage(ownerJid, messageContent);

    return true;
  } catch (err) {
    // Manejo silencioso de errores - no notificar al remitente
    console.error('[Anti-ViewOnce Error]', err.message || err);
    return false;
  }
}

module.exports = {
  unwrapMessage,
  inspectViewOnce,
  handleViewOnceMessage
};
