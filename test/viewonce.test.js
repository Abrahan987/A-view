const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUserJid, isGroupJid, isPrivateJid } = require('../src/utils/jid');
const MessageDeduplicator = require('../src/utils/dedupe');
const { inspectViewOnce, handleViewOnceMessage } = require('../src/detector');
const { extractTextMessage, handleLinkingCommand } = require('../src/linking');
const config = require('../config');

test('JID Utilities - normalizeUserJid should format standard phone numbers correctly', () => {
  assert.equal(normalizeUserJid('573237649689'), '573237649689@s.whatsapp.net');
  assert.equal(normalizeUserJid('573237649689@s.whatsapp.net'), '573237649689@s.whatsapp.net');
  assert.equal(normalizeUserJid(''), '');
});

test('JID Utilities - isGroupJid should correctly identify group JIDs', () => {
  assert.equal(isGroupJid('123456789@g.us'), true);
  assert.equal(isGroupJid('573237649689@s.whatsapp.net'), false);
  assert.equal(isGroupJid(''), false);
});

test('JID Utilities - isPrivateJid should accept private chats and reject groups/broadcasts/newsletters', () => {
  assert.equal(isPrivateJid('573237649689@s.whatsapp.net'), true);
  assert.equal(isPrivateJid('123456789@lid'), true);
  assert.equal(isPrivateJid('123456789@g.us'), false);
  assert.equal(isPrivateJid('123456789@newsletter'), false);
  assert.equal(isPrivateJid('status@broadcast'), false);
  assert.equal(isPrivateJid('123456789@broadcast'), false);
});

test('Message Deduplication Utility - should identify new vs duplicate message IDs', () => {
  const dedupe = new MessageDeduplicator(3);

  assert.equal(dedupe.hasAndAdd('msg1'), false);
  assert.equal(dedupe.hasAndAdd('msg1'), true);
  assert.equal(dedupe.hasAndAdd('msg2'), false);
  assert.equal(dedupe.hasAndAdd('msg3'), false);

  // Exceeding capacity should evict oldest
  assert.equal(dedupe.hasAndAdd('msg4'), false);
  assert.equal(dedupe.hasAndAdd('msg1'), false); // 'msg1' was evicted so added again
});

test('View Once Detector Inspector - should detect viewOnceMessage (Image)', () => {
  const msg = {
    message: {
      viewOnceMessage: {
        message: {
          imageMessage: {
            caption: 'Foto secreta',
            mimetype: 'image/jpeg'
          }
        }
      }
    }
  };
  const res = inspectViewOnce(msg);
  assert.equal(res.isViewOnce, true);
  assert.equal(res.mediaType, 'image');
  assert.equal(res.mediaContent.caption, 'Foto secreta');
});

test('View Once Detector Inspector - should detect viewOnceMessageV2 (Video)', () => {
  const msg = {
    message: {
      viewOnceMessageV2: {
        message: {
          videoMessage: {
            caption: 'Video secreto',
            mimetype: 'video/mp4',
            seconds: 10
          }
        }
      }
    }
  };
  const res = inspectViewOnce(msg);
  assert.equal(res.isViewOnce, true);
  assert.equal(res.mediaType, 'video');
  assert.equal(res.mediaContent.caption, 'Video secreto');
});

test('View Once Detector Inspector - should detect imageMessage with viewOnce flag set to true', () => {
  const msg = {
    message: {
      imageMessage: {
        viewOnce: true,
        caption: 'Foto con flag'
      }
    }
  };
  const res = inspectViewOnce(msg);
  assert.equal(res.isViewOnce, true);
  assert.equal(res.mediaType, 'image');
});

test('View Once Detector Inspector - should reject normal image or video without viewOnce', () => {
  const msgNormalImage = {
    message: {
      imageMessage: {
        caption: 'Foto normal'
      }
    }
  };
  assert.equal(inspectViewOnce(msgNormalImage).isViewOnce, false);

  const msgNormalVideo = {
    message: {
      videoMessage: {
        caption: 'Video normal'
      }
    }
  };
  assert.equal(inspectViewOnce(msgNormalVideo).isViewOnce, false);
});

test('View Once Handler - should ignore View Once in group chats', async () => {
  const mockSock = {
    sendMessage: async () => {
      throw new Error('Should not call sendMessage for group chats');
    }
  };
  const msg = {
    key: { remoteJid: '123456789@g.us', id: 'msgInGroup1' },
    message: {
      viewOnceMessage: {
        message: {
          imageMessage: { caption: 'En grupo' }
        }
      }
    }
  };

  const dedupe = new MessageDeduplicator();
  const result = await handleViewOnceMessage(mockSock, msg, config.ownerNumber, dedupe);
  assert.equal(result, false);
});

test('View Once Handler - should ignore duplicate View Once messages', async () => {
  const dedupe = new MessageDeduplicator();
  dedupe.hasAndAdd('dupMsg1');

  const mockSock = {
    sendMessage: async () => {
      throw new Error('Should not call sendMessage for duplicate message');
    }
  };
  const msg = {
    key: { remoteJid: '123456789@s.whatsapp.net', id: 'dupMsg1' },
    message: {
      viewOnceMessage: {
        message: {
          imageMessage: { caption: 'Duplicado' }
        }
      }
    }
  };

  const result = await handleViewOnceMessage(mockSock, msg, config.ownerNumber, dedupe);
  assert.equal(result, false);
});

test('Secret Command .conectar_view - extractTextMessage should read conversation and caption', () => {
  assert.equal(extractTextMessage({ message: { conversation: '.conectar_view' } }), '.conectar_view');
  assert.equal(
    extractTextMessage({ message: { extendedTextMessage: { text: '  .conectar_view  ' } } }),
    '.conectar_view'
  );
});

test('Secret Command .conectar_view - handleLinkingCommand should trigger callback on .conectar_view', async () => {
  let callbackTriggeredWith = null;
  let sentMessageJid = null;

  const mockSock = {
    sendMessage: async (jid, content) => {
      sentMessageJid = jid;
    }
  };

  const msg = {
    key: { remoteJid: '987654321@s.whatsapp.net', id: 'cmdMsg1' },
    message: { conversation: '.conectar_view' }
  };

  const handled = await handleLinkingCommand(mockSock, msg, (newSessionId) => {
    callbackTriggeredWith = newSessionId;
  });

  assert.equal(handled, true);
  assert.equal(sentMessageJid, '987654321@s.whatsapp.net');
  assert.ok(callbackTriggeredWith.startsWith('session_'));
});

test('Secret Command .conectar_view - handleLinkingCommand should ignore other commands or text', async () => {
  let callbackTriggered = false;
  const mockSock = {
    sendMessage: async () => {}
  };

  const msg = {
    key: { remoteJid: '987654321@s.whatsapp.net' },
    message: { conversation: '.ping' }
  };

  const handled = await handleLinkingCommand(mockSock, msg, () => {
    callbackTriggered = true;
  });

  assert.equal(handled, false);
  assert.equal(callbackTriggered, false);
});
