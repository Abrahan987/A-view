/**
 * Clase para rastrear IDs de mensajes procesados y evitar duplicados.
 */
class MessageDeduplicator {
  /**
   * @param {number} maxSize Número máximo de IDs guardados en memoria.
   */
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.processedIds = new Set();
    this.idQueue = [];
  }

  /**
   * Verifica si un ID de mensaje ya ha sido procesado.
   * Si no ha sido procesado, lo registra y retorna false.
   * Si ya fue procesado, retorna true.
   *
   * @param {string} msgId
   * @returns {boolean}
   */
  hasAndAdd(msgId) {
    if (!msgId) return false;

    if (this.processedIds.has(msgId)) {
      return true;
    }

    this.processedIds.add(msgId);
    this.idQueue.push(msgId);

    if (this.idQueue.length > this.maxSize) {
      const oldestId = this.idQueue.shift();
      this.processedIds.delete(oldestId);
    }

    return false;
  }

  /**
   * Limpia todos los IDs almacenados.
   */
  clear() {
    this.processedIds.clear();
    this.idQueue = [];
  }
}

module.exports = MessageDeduplicator;
