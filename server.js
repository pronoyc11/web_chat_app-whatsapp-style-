require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 6 * 1024 * 1024
});

app.use(cors());
app.use(bodyParser.json({ limit: '6mb' }));
app.use(express.static('public'));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/web_chat_app_upgraded';

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000
}).catch((err) => {
  console.error('MongoDB connection error:', err.message);
});

mongoose.connection.on('connected', () => {
  console.log('MongoDB connected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
});

function ensureDbReady(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ error: 'Database not connected. Check MONGODB_URI or Atlas network access.' });
    return false;
  }
  return true;
}

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true, trim: true },
  password_hash: { type: String, required: true },
  code: { type: String, unique: true, required: true }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  chat_id: { type: String, index: true, required: true },
  from_id: { type: String, required: true },
  text: { type: String, default: '' },
  image: {
    data: { type: String, default: '' },
    name: { type: String, default: '' },
    type: { type: String, default: '' }
  },
  reply_to: {
    id: { type: String, default: '' },
    sender_id: { type: String, default: '' },
    sender_name: { type: String, default: '' },
    text: { type: String, default: '' },
    has_image: { type: Boolean, default: false }
  },
  reactions: {
    type: [{
      emoji: { type: String, required: true },
      user_id: { type: String, required: true },
      timestamp: { type: Date, default: Date.now }
    }],
    default: []
  },
  pinned_at: { type: Date, default: null },
  pinned_by: { type: String, default: '' },
  read_by: { type: [String], default: [] },
  read_at: { type: Map, of: Date, default: {} },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Signup
app.post('/api/signup', async (req, res) => {
  if (!ensureDbReady(res)) return;
  const { email, password, code } = req.body;
  if (!/^\d{4}$/.test(code)) return res.status(400).json({ error: '4-digit code required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password_hash: hash, code });
    res.json({ id: user._id.toString(), code: user.code });
  } catch (err) {
    return res.status(400).json({ error: 'Email/code exists' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  if (!ensureDbReady(res)) return;
  const { email, password } = req.body;
  User.findOne({ email }).then(async (user) => {
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ id: user._id.toString(), code: user.code });
  }).catch(() => {
    res.status(500).json({ error: 'Server error' });
  });
});

// Search user
app.get('/api/user/:code', (req, res) => {
  if (!ensureDbReady(res)) return;
  User.findOne({ code: req.params.code }).then((user) => {
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user._id.toString(), code: user.code, email: user.email });
  }).catch(() => {
    res.status(500).json({ error: 'Server error' });
  });
});

// Get messages
app.get('/api/messages/:chatId/:userId', (req, res) => {
  if (!ensureDbReady(res)) return;
  const [id1, id2] = req.params.chatId.split('-');
  if (req.params.userId !== id1 && req.params.userId !== id2) return res.status(403).json({ error: 'Unauthorized' });
  Message.find({ chat_id: req.params.chatId }).sort({ timestamp: 1 }).lean().then((rows) => {
    res.json(rows.map((row) => ({
      id: row._id.toString(),
      chat_id: row.chat_id,
      from_id: row.from_id,
      text: row.text || '',
      image: row.image || null,
      reply_to: row.reply_to?.id ? row.reply_to : null,
      reactions: row.reactions || [],
      pinned_at: row.pinned_at || null,
      pinned_by: row.pinned_by || '',
      read_by: row.read_by || [],
      read_at: row.read_at || {},
      timestamp: row.timestamp
    })));
  }).catch(() => {
    res.status(500).json({ error: 'Server error' });
  });
});

// Delete messages (maintenance)
app.delete('/api/messages', async (req, res) => {
  if (!ensureDbReady(res)) return;
  const { mode } = req.body || {};
  if (!['half', 'all'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid delete mode' });
  }

  try {
    if (mode === 'all') {
      const result = await Message.deleteMany({});
      return res.json({ deleted: result.deletedCount });
    }

    const total = await Message.countDocuments();
    const toDelete = Math.floor(total / 2);
    if (toDelete === 0) return res.json({ deleted: 0 });

    const ids = await Message.find({}, { _id: 1 })
      .sort({ timestamp: 1 })
      .limit(toDelete)
      .lean();

    const result = await Message.deleteMany({ _id: { $in: ids.map(doc => doc._id) } });
    return res.json({ deleted: result.deletedCount });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// Mark messages as read for a user in a chat
app.post('/api/messages/read', async (req, res) => {
  if (!ensureDbReady(res)) return;
  const { chatId, userId } = req.body || {};
  if (!chatId || !userId) return res.status(400).json({ error: 'Missing chatId/userId' });
  const [id1, id2] = chatId.split('-');
  if (userId !== id1 && userId !== id2) return res.status(403).json({ error: 'Unauthorized' });
  try {
    const unread = await Message.find({
      chat_id: chatId,
      from_id: { $ne: userId },
      read_by: { $ne: userId }
    }, { _id: 1 }).lean();

    if (!unread.length) return res.json({ updated: 0, ids: [] });

    await Message.updateMany(
      { _id: { $in: unread.map(doc => doc._id) } },
      {
        $addToSet: { read_by: userId },
        $set: { [`read_at.${userId}`]: new Date() }
      }
    );

    res.json({ updated: unread.length, ids: unread.map(doc => doc._id.toString()) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get recent chats (not used in UI yet)
app.get('/api/chats/:userId', async (req, res) => {
  if (!ensureDbReady(res)) return;
  const userId = req.params.userId;
  try {
    const recent = await Message.aggregate([
      { $match: { chat_id: new RegExp(`(^${userId}-|-${userId}$)`) } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$chat_id', last_message: { $first: '$timestamp' } } },
      { $sort: { last_message: -1 } }
    ]);
    res.json(recent.map(r => ({ chat_id: r._id, last_message: r.last_message })));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get connections (users who have sent messages to this user)
app.get('/api/connections/:userId', async (req, res) => {
  if (!ensureDbReady(res)) return;
  const userId = req.params.userId;
  try {
    const rows = await Message.aggregate([
      {
        $match: {
          chat_id: new RegExp(`(^${userId}-|-${userId}$)`),
          from_id: { $ne: userId }
        }
      },
      {
        $group: {
          _id: '$from_id',
          last_message: { $max: '$timestamp' },
          unread_count: {
            $sum: {
              $cond: [{ $in: [userId, '$read_by'] }, 0, 1]
            }
          }
        }
      },
      { $sort: { last_message: -1 } }
    ]);

    const senderIds = rows.map(r => r._id);
    if (senderIds.length === 0) return res.json([]);

    const users = await User.find(
      { _id: { $in: senderIds } },
      { email: 1, code: 1 }
    ).lean();

    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    const result = rows.map(r => {
      const user = userMap.get(String(r._id));
      if (!user) return null;
      return {
        id: user._id.toString(),
        email: user.email,
        code: user.code,
        last_message: r.last_message,
        unread_count: r.unread_count || 0
      };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.io
io.on('connection', (socket) => {
  socket.on('user_join', (userId) => {
    socket.userId = userId;
    socket.join(`user:${userId}`);
  });

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
  });

  socket.on('send_message', async ({ chatId, text, image, replyTo }) => {
    const userId = socket.userId;
    if (!userId) return;
    const [id1, id2] = String(chatId || '').split('-');
    if (userId !== id1 && userId !== id2) return;
    const safeText = String(text || '').trim();
    const safeImage = image && typeof image.data === 'string' && image.data.startsWith('data:image/')
      ? {
          data: image.data,
          name: String(image.name || 'image').slice(0, 120),
          type: String(image.type || '').slice(0, 80)
        }
      : null;
    if (!safeText && !safeImage) return;

    let safeReply = null;
    try {
      if (replyTo?.id && mongoose.Types.ObjectId.isValid(replyTo.id)) {
        const original = await Message.findOne({ _id: replyTo.id, chat_id: chatId }).lean();
        if (original) {
          const originalSender = mongoose.Types.ObjectId.isValid(original.from_id)
            ? await User.findById(original.from_id, { email: 1, code: 1 }).lean()
            : null;
          safeReply = {
            id: original._id.toString(),
            sender_id: String(original.from_id),
            sender_name: String(originalSender?.email || originalSender?.code || 'Contact').slice(0, 120),
            text: String(original.text || '').trim().slice(0, 140),
            has_image: Boolean(original.image?.data)
          };
        }
      }
    } catch {
      safeReply = null;
    }

    Message.create({
      chat_id: chatId,
      from_id: userId,
      text: safeText,
      image: safeImage || undefined,
      reply_to: safeReply || undefined,
      read_by: [userId],
      read_at: { [userId]: new Date() }
    }).then((doc) => {
      const payload = {
        id: doc._id.toString(),
        chat_id: chatId,
        from_id: userId,
        text: doc.text || '',
        image: doc.image || null,
        reply_to: doc.reply_to?.id ? doc.reply_to : null,
        reactions: doc.reactions || [],
        pinned_at: doc.pinned_at || null,
        pinned_by: doc.pinned_by || '',
        read_by: doc.read_by || [],
        read_at: doc.read_at || {},
        timestamp: doc.timestamp
      };
      io.to(chatId).emit('new_message', payload);

      io.to(`user:${id1}`).emit('incoming_message', payload);
      io.to(`user:${id2}`).emit('incoming_message', payload);
    }).catch(() => {
      // ignore send errors
    });
  });

  socket.on('toggle_reaction', async ({ chatId, messageId, emoji }) => {
    const userId = socket.userId;
    if (!userId || !chatId || !messageId) return;
    if (!['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'].includes(emoji)) return;
    const [id1, id2] = chatId.split('-');
    if (userId !== id1 && userId !== id2) return;

    try {
      const message = await Message.findOne({ _id: messageId, chat_id: chatId });
      if (!message) return;

      const existingIndex = message.reactions.findIndex((reaction) => (
        reaction.user_id === userId && reaction.emoji === emoji
      ));

      message.reactions = message.reactions.filter((reaction) => reaction.user_id !== userId);
      if (existingIndex >= 0) {
        // Matching the current reaction removes it.
      } else {
        message.reactions.push({ emoji, user_id: userId, timestamp: new Date() });
      }

      await message.save();
      io.to(chatId).emit('reaction_update', {
        chat_id: chatId,
        message_id: message._id.toString(),
        reactions: message.reactions || []
      });
    } catch (err) {
      // ignore reaction errors
    }
  });

  socket.on('toggle_pin', async ({ chatId, messageId }) => {
    const userId = socket.userId;
    if (!userId || !chatId || !messageId) return;
    const [id1, id2] = String(chatId).split('-');
    if (userId !== id1 && userId !== id2) return;
    if (!mongoose.Types.ObjectId.isValid(messageId)) return;

    try {
      const message = await Message.findOne({ _id: messageId, chat_id: chatId }).lean();
      if (!message) return;

      if (message.pinned_at) {
        await Message.updateOne(
          { _id: messageId, chat_id: chatId },
          { $set: { pinned_at: null, pinned_by: '' } }
        );
        io.to(chatId).emit('pin_update', { chat_id: chatId, pinned_message: null });
        return;
      }

      const pinnedAt = new Date();
      await Message.updateMany(
        { chat_id: chatId, pinned_at: { $ne: null } },
        { $set: { pinned_at: null, pinned_by: '' } }
      );
      const updated = await Message.findOneAndUpdate(
        { _id: messageId, chat_id: chatId },
        { $set: { pinned_at: pinnedAt, pinned_by: userId } },
        { new: true }
      ).lean();

      io.to(chatId).emit('pin_update', {
        chat_id: chatId,
        pinned_message: {
          id: updated._id.toString(),
          chat_id: updated.chat_id,
          from_id: updated.from_id,
          text: updated.text || '',
          image: updated.image || null,
          reply_to: updated.reply_to?.id ? updated.reply_to : null,
          reactions: updated.reactions || [],
          pinned_at: updated.pinned_at || null,
          pinned_by: updated.pinned_by || '',
          read_by: updated.read_by || [],
          read_at: updated.read_at || {},
          timestamp: updated.timestamp
        }
      });
    } catch {
      // ignore pin errors
    }
  });

  socket.on('mark_read', async ({ chatId, userId }) => {
    if (!chatId || !userId) return;
    if (socket.userId !== userId) return;
    const [id1, id2] = chatId.split('-');
    if (userId !== id1 && userId !== id2) return;
    try {
      const unread = await Message.find({
        chat_id: chatId,
        from_id: { $ne: userId },
        read_by: { $ne: userId }
      }, { _id: 1 }).lean();

      if (!unread.length) return;

      const readAt = new Date();
      await Message.updateMany(
        { _id: { $in: unread.map(doc => doc._id) } },
        {
          $addToSet: { read_by: userId },
          $set: { [`read_at.${userId}`]: readAt }
        }
      );

      io.to(chatId).emit('read_update', {
        chat_id: chatId,
        reader_id: userId,
        message_ids: unread.map(doc => doc._id.toString()),
        read_at: readAt
      });
    } catch (err) {
      // ignore read errors
    }
  });

  socket.on('typing_start', ({ chatId }) => {
    const userId = socket.userId;
    if (!chatId || !userId) return;
    socket.to(chatId).emit('typing_update', { chat_id: chatId, user_id: userId, typing: true });
  });

  socket.on('typing_stop', ({ chatId }) => {
    const userId = socket.userId;
    if (!chatId || !userId) return;
    socket.to(chatId).emit('typing_update', { chat_id: chatId, user_id: userId, typing: false });
  });
});



const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Messenger server on port ${PORT}`);
});
