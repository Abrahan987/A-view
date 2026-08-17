const { jidNormalizedUser } = require('@whiskeysockets/baileys');

/**
 * Convierte un número o JID a un JID de usuario normalizado.
 * Ejemplo: '573237649689' -> '573237649689@s.whatsapp.net'
 *
 * @param {string} input
 * @returns {string}
 */
function normalizeUserJid(input) {
  if (!input) return '';
  let cleaned = String(input).trim();
  if (!cleaned.includes('@')) {
    cleaned = cleaned.replace(/\D/g, '') + '@s.whatsapp.net';
  }
  try {
    return jidNormalizedUser(cleaned);
  } catch {
    return cleaned;
  }
}

/**
 * Determina si un JID corresponde a un grupo.
 *
 * @param {string} jid
 * @returns {boolean}
 */
function isGroupJid(jid) {
  if (!jid) return false;
  return jid.endsWith('@g.us');
}

/**
 * Determina si un JID o mensaje proviene de un chat privado 1 a 1.
 * Excluye grupos (@g.us), canales (@newsletter), broadcasts (status@broadcast / @broadcast).
 *
 * @param {string} jid
 * @returns {boolean}
 */
function isPrivateJid(jid) {
  if (!jid) return false;
  const normalized = jid.toLowerCase().trim();

  if (isGroupJid(normalized)) return false;
  if (normalized.endsWith('@newsletter')) return false;
  if (normalized.endsWith('@broadcast') || normalized === 'status@broadcast') return false;

  return normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@lid');
}

module.exports = {
  normalizeUserJid,
  isGroupJid,
  isPrivateJid
};
