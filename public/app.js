let currentUser = null;
let socket = null;
let currentChat = null;
const BRAND_PASSWORD = 'maimun11';
let connectionsOpen = false;
let notificationEnabled = false;
let swRegistration = null;
const userCache = new Map();
let typingTimeout = null;
let isTyping = false;
let selectedImage = null;
let activeReply = null;
let activeReactionPicker = null;
let activeReactionDetails = null;
let longPressTimer = null;
let swipeReplyState = null;
let suppressNextDocumentClick = false;
const REACTION_EMOJIS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];

const API_BASE = '/api';

function toggleAuth() {
  document.getElementById('signup-form').classList.toggle('hidden');
  document.getElementById('login-form').classList.toggle('hidden');
}

async function signup() {
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const code = document.getElementById('signup-code').value;

  try {
    const res = await fetch(API_BASE + '/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return alert(data.error || 'Signup failed');
    loginUser(data);
  } catch {
    alert('Network error during signup');
  }
}

async function login() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch(API_BASE + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return alert(data.error || 'Login failed');
    loginUser(data);
  } catch {
    alert('Network error during login');
  }
}

function loginUser(user) {
  currentUser = user;
  document.getElementById('my-code').textContent = user.code;
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('messenger').classList.remove('hidden');
  document.getElementById('no-chat').classList.remove('hidden');
  document.getElementById('messages').classList.add('hidden');
  initSocket();
  initNotifications();
  loadConnections();
}

function openBrandAuth() {
  const modal = document.getElementById('brand-modal');
  document.getElementById('brand-auth').classList.remove('hidden');
  document.getElementById('brand-message').classList.add('hidden');
  document.getElementById('brand-error').classList.add('hidden');
  document.getElementById('brand-password').value = '';
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('brand-password').focus(), 0);
}

function closeBrandModal() {
  document.getElementById('brand-modal').classList.add('hidden');
}

function submitBrandPassword() {
  const input = document.getElementById('brand-password').value;
  if (input === BRAND_PASSWORD) {
    document.getElementById('brand-auth').classList.add('hidden');
    document.getElementById('brand-message').classList.remove('hidden');
    document.getElementById('brand-error').classList.add('hidden');
  } else {
    document.getElementById('brand-error').classList.remove('hidden');
  }
}

function logout() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentUser = null;
  currentChat = null;
  connectionsOpen = false;
  notificationEnabled = false;
  userCache.clear();
  swRegistration = null;
  document.getElementById('auth').classList.remove('hidden');
  document.getElementById('messenger').classList.add('hidden');
  document.getElementById('chat-header').classList.add('hidden');
  document.getElementById('pinned-message')?.classList.add('hidden');
  document.getElementById('messages').innerHTML = '';
  document.getElementById('messages').classList.add('hidden');
  document.getElementById('no-chat').classList.remove('hidden');
  document.getElementById('search-code').value = '';
  clearSelectedImage();
  clearActiveReply();
  const connectionsPanel = document.getElementById('connections-panel');
  if (connectionsPanel) connectionsPanel.classList.add('hidden');
}

async function searchUser() {
  const code = document.getElementById('search-code').value;
  if (!code || code.length !== 4) return alert('Enter 4-digit code');

  try {
    const res = await fetch(API_BASE + '/user/' + code);
    const user = await res.json().catch(() => ({}));
    if (!res.ok || user.error) return alert(user.error || 'User lookup failed');
    userCache.set(String(user.id), user);
    openChat(user);
  } catch {
    alert('Network error while searching user');
  }
}

// Removed chat list - single chat only


// Removed chat list


function openChat(user, chatId = null) {
  if (!chatId) {
    const ids = [String(currentUser.id), String(user.id)].sort((a,b) => a.localeCompare(b));
    chatId = ids.join('-');
  }
  setPanelOpenState(false);
  currentChat = { id: chatId, partner: user };
  clearActiveReply();
  userCache.set(String(user.id), user);
  
  document.getElementById('chat-title').textContent = user.code;
  document.getElementById('chat-header').classList.remove('hidden');
  document.getElementById('chat-typing')?.classList.add('hidden');
  document.getElementById('no-chat').classList.add('hidden');
  document.getElementById('messages').classList.remove('hidden');
  socket.emit('join_chat', chatId);
  loadMessages(chatId);
}

function toggleDeleteMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('delete-menu');
  menu.classList.toggle('hidden');
}

async function deleteMessages(mode) {
  const label = mode === 'all' ? 'ALL' : 'the oldest 50%';
  if (!confirm(`Delete ${label} of messages? This cannot be undone.`)) return;

  try {
    const res = await fetch(API_BASE + '/messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return alert(data.error || 'Delete failed');
    if (currentChat) {
      loadMessages(currentChat.id);
    }
    document.getElementById('delete-menu').classList.add('hidden');
  } catch {
    alert('Network error during delete');
  }
}

function buildMessageElement(msg) {
  const isMe = msg.from_id == currentUser.id;
  const div = document.createElement('div');
  div.className = `message ${isMe ? 'sent' : 'received'} ${msg.pinned_at ? 'pinned' : ''}`;
  div.dataset.messageId = msg.id;
  div._message = msg;
  div._reactions = msg.reactions || [];

  const body = document.createElement('div');
  body.className = 'message-body';
  if (msg.reply_to?.id) {
    body.appendChild(buildInlineReplyElement(msg.reply_to));
  }
  if (msg.image?.data) {
    const imgLink = document.createElement('a');
    imgLink.href = msg.image.data;
    imgLink.target = '_blank';
    imgLink.rel = 'noopener';
    const img = document.createElement('img');
    img.className = 'message-image';
    img.src = msg.image.data;
    img.alt = msg.image.name || 'Shared photo';
    imgLink.appendChild(img);
    body.appendChild(imgLink);
  }
  if (msg.text) {
    const text = document.createElement('div');
    text.textContent = msg.text;
    body.appendChild(text);
  }

  const meta = document.createElement('small');
  meta.style.opacity = '0.7';
  meta.style.fontSize = '12px';
  meta.textContent = new Date(msg.timestamp).toLocaleTimeString();
  const reactionSummary = buildReactionSummaryElement(msg);
  const replyAction = buildReplyActionElement(msg);
  const reactionTrigger = buildReactionTriggerElement(msg);
  const reactionPicker = buildReactionPickerElement(msg);
  const reactionDetails = buildReactionDetailsElement(msg);

  if (isMe) {
    const status = document.createElement('div');
    status.className = 'message-status';
    const partnerId = currentChat?.partner?.id;
    const readAt = partnerId ? msg.read_at?.[String(partnerId)] : null;
    status.textContent = readAt ? `Seen ${formatSeenTime(readAt)}` : 'Sent';
    div.append(body, meta, reactionSummary, status, replyAction, reactionTrigger, reactionPicker, reactionDetails);
  } else {
    div.append(body, meta, reactionSummary, replyAction, reactionTrigger, reactionPicker, reactionDetails);
  }

  installLongPressReaction(div);
  installSwipeReply(div);
  return div;
}

function buildInlineReplyElement(reply) {
  const wrapper = document.createElement('div');
  wrapper.className = 'quoted-reply';
  const author = document.createElement('div');
  author.className = 'quoted-reply-author';
  author.textContent = reply.sender_id == currentUser?.id ? 'You' : (reply.sender_name || 'Contact');
  const text = document.createElement('div');
  text.className = 'quoted-reply-text';
  text.textContent = reply.text || (reply.has_image ? 'Photo' : 'Message');
  wrapper.append(author, text);
  return wrapper;
}

function buildReplyActionElement(msg) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reply-action';
  button.title = 'Reply';
  button.setAttribute('aria-label', 'Reply to message');
  button.textContent = 'Reply';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    startReply(msg);
  });
  return button;
}

function startReply(msg) {
  activeReply = {
    id: msg.id,
    sender_id: String(msg.from_id),
    sender_name: msg.from_id == currentUser?.id ? 'You' : (currentChat?.partner?.email || 'Contact'),
    text: getMessagePreviewText(msg),
    has_image: Boolean(msg.image?.data)
  };
  renderActiveReply();
  document.getElementById('message-text')?.focus();
}

function clearActiveReply() {
  activeReply = null;
  renderActiveReply();
}

function renderActiveReply() {
  const preview = document.getElementById('reply-preview');
  if (!preview) return;
  preview.innerHTML = '';
  preview.classList.toggle('hidden', !activeReply);
  if (!activeReply) return;

  const content = document.createElement('div');
  content.className = 'reply-preview-content';
  const author = document.createElement('div');
  author.className = 'reply-preview-author';
  author.textContent = activeReply.sender_name || 'Contact';
  const text = document.createElement('div');
  text.className = 'reply-preview-text';
  text.textContent = activeReply.text || (activeReply.has_image ? 'Photo' : 'Message');
  content.append(author, text);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'reply-preview-close';
  close.title = 'Cancel reply';
  close.setAttribute('aria-label', 'Cancel reply');
  close.textContent = 'x';
  close.addEventListener('click', clearActiveReply);
  preview.append(content, close);
}

function getMessagePreviewText(msg) {
  const text = String(msg.text || '').trim();
  if (text) return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  return msg.image?.data ? 'Photo' : 'Message';
}

function buildReactionSummaryElement(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-reaction-summary';
  wrapper.dataset.reactionSummaryFor = msg.id;
  renderReactionSummary(wrapper, msg.reactions || []);
  return wrapper;
}

function renderReactionSummary(wrapper, reactions) {
  wrapper.innerHTML = '';
  const counts = new Map();
  reactions.forEach((reaction) => {
    const group = counts.get(reaction.emoji) || { count: 0, mine: false };
    group.count += 1;
    group.mine = group.mine || reaction.user_id == currentUser.id;
    counts.set(reaction.emoji, group);
  });

  wrapper.classList.toggle('hidden', counts.size === 0);
  counts.forEach((group, emoji) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `reaction-summary-chip ${group.mine ? 'active' : ''}`;
    chip.textContent = `${emoji} ${group.count}`;
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      showReactionDetails(wrapper.closest('.message'), emoji);
    });
    wrapper.appendChild(chip);
  });
}

function buildReactionDetailsElement(msg) {
  const details = document.createElement('div');
  details.className = 'reaction-details hidden';
  details.dataset.reactionDetailsFor = msg.id;
  details.addEventListener('click', (event) => event.stopPropagation());
  renderReactionDetails(details, msg.reactions || []);
  return details;
}

function renderReactionDetails(details, reactions, selectedEmoji = null) {
  details.innerHTML = '';
  details.dataset.selectedEmoji = selectedEmoji || '';
  const visibleReactions = selectedEmoji
    ? reactions.filter((reaction) => reaction.emoji === selectedEmoji)
    : reactions;

  if (!visibleReactions.length) {
    details.classList.add('hidden');
    return;
  }

  visibleReactions.forEach((reaction) => {
    const row = document.createElement('div');
    row.className = 'reaction-detail-row';
    const name = document.createElement('span');
    name.textContent = reactionName(reaction.user_id);
    const emoji = document.createElement('span');
    emoji.textContent = reaction.emoji;
    row.append(name, emoji);
    details.appendChild(row);
  });
}

function buildReactionTriggerElement(msg) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reaction-trigger';
  button.dataset.reactionTriggerFor = msg.id;
  button.title = 'React';
  button.setAttribute('aria-label', 'React to message');
  button.textContent = '+';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    showReactionPicker(button.closest('.message'));
  });
  return button;
}

function buildReactionPickerElement(msg) {
  const picker = document.createElement('div');
  picker.className = 'reaction-picker hidden';
  picker.dataset.reactionPickerFor = msg.id;
  picker.addEventListener('click', (event) => event.stopPropagation());

  REACTION_EMOJIS.forEach((emoji) => {
    const mine = (msg.reactions || []).some((reaction) => (
      reaction.emoji === emoji && reaction.user_id == currentUser.id
    ));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `reaction-picker-btn ${mine ? 'active' : ''}`;
    button.title = `React ${emoji}`;
    button.textContent = emoji;
    button.addEventListener('click', () => {
      toggleReaction(picker.dataset.reactionPickerFor, emoji);
      hideReactionPicker();
    });
    picker.appendChild(button);
  });

  const pinButton = document.createElement('button');
  pinButton.type = 'button';
  pinButton.className = 'reaction-picker-pin';
  pinButton.title = msg.pinned_at ? 'Unpin message' : 'Pin message';
  pinButton.setAttribute('aria-label', msg.pinned_at ? 'Unpin message' : 'Pin message');
  pinButton.textContent = msg.pinned_at ? 'Unpin' : 'Pin';
  pinButton.addEventListener('click', () => {
    togglePin(picker.dataset.reactionPickerFor);
    hideReactionPicker();
  });
  picker.appendChild(pinButton);
  return picker;
}

function installLongPressReaction(messageEl) {
  messageEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, a, input')) return;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      showReactionPicker(messageEl);
      suppressNextDocumentClick = true;
    }, 500);
  });
  messageEl.addEventListener('pointerup', () => clearTimeout(longPressTimer));
  messageEl.addEventListener('pointerleave', () => clearTimeout(longPressTimer));
  messageEl.addEventListener('pointercancel', () => clearTimeout(longPressTimer));
  messageEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showReactionPicker(messageEl);
  });
}

function installSwipeReply(messageEl) {
  messageEl.addEventListener('pointerdown', (event) => {
    if (!isMobilePanelEnabled()) return;
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest('button, a, input')) return;
    swipeReplyState = {
      messageEl,
      startX: event.clientX,
      startY: event.clientY,
      tracking: true,
      swiping: false
    };
    messageEl.setPointerCapture?.(event.pointerId);
  });

  messageEl.addEventListener('pointermove', (event) => {
    if (!swipeReplyState?.tracking || swipeReplyState.messageEl !== messageEl) return;
    const deltaX = event.clientX - swipeReplyState.startX;
    const deltaY = event.clientY - swipeReplyState.startY;

    if (!swipeReplyState.swiping && Math.abs(deltaY) > 18 && Math.abs(deltaY) > Math.abs(deltaX)) {
      swipeReplyState = null;
      return;
    }

    if (deltaX > 12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      clearTimeout(longPressTimer);
      swipeReplyState.swiping = true;
      const offset = Math.min(58, deltaX * 0.42);
      messageEl.style.setProperty('--swipe-reply-offset', `${offset}px`);
      messageEl.classList.add('swiping-reply');
    }
  });

  const finishSwipe = (event) => {
    if (!swipeReplyState || swipeReplyState.messageEl !== messageEl) return;
    const deltaX = event.clientX - swipeReplyState.startX;
    const didSwipe = swipeReplyState.swiping && deltaX > 64;
    messageEl.classList.remove('swiping-reply');
    messageEl.style.removeProperty('--swipe-reply-offset');
    swipeReplyState = null;
    if (didSwipe) {
      suppressNextDocumentClick = true;
      startReply(messageEl._message);
    }
  };

  messageEl.addEventListener('pointerup', finishSwipe);
  messageEl.addEventListener('pointercancel', finishSwipe);
  messageEl.addEventListener('pointerleave', () => {
    if (!swipeReplyState || swipeReplyState.messageEl !== messageEl) return;
    messageEl.classList.remove('swiping-reply');
    messageEl.style.removeProperty('--swipe-reply-offset');
    swipeReplyState = null;
  });
}

function showReactionPicker(messageEl) {
  if (!messageEl) return;
  const picker = messageEl.querySelector('.reaction-picker');
  if (!picker) return;
  hideReactionDetails();
  if (activeReactionPicker && activeReactionPicker !== picker) {
    activeReactionPicker.classList.add('hidden');
  }
  if (activeReactionPicker === picker && !picker.classList.contains('hidden')) {
    hideReactionPicker();
    return;
  }
  activeReactionPicker = picker;
  picker.classList.remove('hidden');
}

function hideReactionPicker() {
  if (!activeReactionPicker) return;
  activeReactionPicker.classList.add('hidden');
  activeReactionPicker = null;
}

function showReactionDetails(messageEl, emoji) {
  if (!messageEl) return;
  const details = messageEl.querySelector('.reaction-details');
  if (!details) return;
  hideReactionPicker();
  if (activeReactionDetails && activeReactionDetails !== details) {
    activeReactionDetails.classList.add('hidden');
  }
  if (activeReactionDetails === details && !details.classList.contains('hidden') && details.dataset.selectedEmoji === emoji) {
    hideReactionDetails();
    return;
  }
  const reactions = messageEl._reactions || [];
  renderReactionDetails(details, reactions, emoji);
  activeReactionDetails = details;
  details.classList.remove('hidden');
}

function hideReactionDetails() {
  if (!activeReactionDetails) return;
  activeReactionDetails.classList.add('hidden');
  activeReactionDetails = null;
}

function reactionName(userId) {
  if (userId == currentUser?.id) return 'You';
  if (userId == currentChat?.partner?.id) {
    return currentChat.partner.email || `Code ${currentChat.partner.code}`;
  }
  const cached = userCache.get(String(userId));
  return cached?.email || cached?.code || 'Unknown user';
}

function toggleReaction(messageId, emoji) {
  if (!socket || !currentChat || !messageId) return;
  socket.emit('toggle_reaction', { chatId: currentChat.id, messageId, emoji });
}

function togglePin(messageId) {
  if (!socket || !currentChat || !messageId) return;
  socket.emit('toggle_pin', { chatId: currentChat.id, messageId });
}

function renderPinnedMessage(msg) {
  const banner = document.getElementById('pinned-message');
  if (!banner) return;
  banner.innerHTML = '';
  banner.classList.toggle('hidden', !msg);
  if (!msg) return;

  const content = document.createElement('button');
  content.type = 'button';
  content.className = 'pinned-content';
  content.title = 'Jump to pinned message';
  content.addEventListener('click', () => scrollToMessage(msg.id));

  const label = document.createElement('div');
  label.className = 'pinned-label';
  label.textContent = 'Pinned message';
  const text = document.createElement('div');
  text.className = 'pinned-text';
  text.textContent = getMessagePreviewText(msg);
  content.append(label, text);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pinned-close';
  close.title = 'Unpin message';
  close.setAttribute('aria-label', 'Unpin message');
  close.textContent = 'x';
  close.addEventListener('click', () => togglePin(msg.id));

  banner.append(content, close);
}

function scrollToMessage(messageId) {
  const message = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!message) return;
  message.scrollIntoView({ behavior: 'smooth', block: 'center' });
  message.classList.add('message-highlight');
  setTimeout(() => message.classList.remove('message-highlight'), 1300);
}

function applyPinnedState(pinnedMessage) {
  document.querySelectorAll('.message').forEach((message) => {
    const isPinned = Boolean(pinnedMessage && message.dataset.messageId === pinnedMessage.id);
    message.classList.toggle('pinned', isPinned);
    if (message._message) {
      message._message.pinned_at = isPinned ? (pinnedMessage.pinned_at || new Date().toISOString()) : null;
    }
    const pinButton = message.querySelector('.reaction-picker-pin');
    if (pinButton) {
      pinButton.textContent = isPinned ? 'Unpin' : 'Pin';
      pinButton.title = isPinned ? 'Unpin message' : 'Pin message';
      pinButton.setAttribute('aria-label', isPinned ? 'Unpin message' : 'Pin message');
    }
  });
  renderPinnedMessage(pinnedMessage);
}

function updateMessageReactions(messageId, reactions) {
  const message = document.querySelector(`[data-message-id="${messageId}"]`);
  if (message) message._reactions = reactions || [];

  const summary = document.querySelector(`[data-reaction-summary-for="${messageId}"]`);
  if (summary) renderReactionSummary(summary, reactions || []);

  const picker = document.querySelector(`[data-reaction-picker-for="${messageId}"]`);
  if (!picker) return;
  picker.querySelectorAll('.reaction-picker-btn').forEach((button) => {
    const mine = (reactions || []).some((reaction) => (
      reaction.emoji === button.textContent && reaction.user_id == currentUser.id
    ));
    button.classList.toggle('active', mine);
  });

  const details = document.querySelector(`[data-reaction-details-for="${messageId}"]`);
  if (details) {
    renderReactionDetails(details, reactions || [], details.dataset.selectedEmoji || null);
  }
}

function toggleConnections() {
  const panel = document.getElementById('connections-panel');
  if (!panel) return;
  connectionsOpen = !connectionsOpen;
  panel.classList.toggle('hidden', !connectionsOpen);
  if (connectionsOpen) loadConnections();
}

async function loadConnections() {
  if (!currentUser) return;
  const list = document.getElementById('connections-list');
  const empty = document.getElementById('connections-empty');
  if (!list || !empty) return;

  try {
    const res = await fetch(API_BASE + '/connections/' + currentUser.id);
    const connections = await res.json().catch(() => ([]));
    if (!res.ok || connections.error) return;

    list.innerHTML = '';
    if (!connections.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    connections.forEach((user) => {
      userCache.set(String(user.id), user);
      const button = document.createElement('button');
      button.className = 'connection-item';
      button.type = 'button';
      const last = user.last_message ? new Date(user.last_message).toLocaleString() : '';
      button.innerHTML = `
        <div class="connection-main">
          ${user.email}
          ${user.unread_count ? `<span class="unread-badge">${user.unread_count}</span>` : ''}
        </div>
        <div class="connection-sub">Code ${user.code}${last ? ' - ' + last : ''}</div>
      `;
      button.addEventListener('click', () => openChat(user));
      list.appendChild(button);
    });
  } catch {
    empty.classList.remove('hidden');
  }
}

async function loadMessages(chatId) {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  try {
    const res = await fetch(API_BASE + '/messages/' + chatId + '/' + currentUser.id);
    const messages = await res.json().catch(() => ([]));
    if (!res.ok || messages.error) {
      container.innerHTML = '<div class="no-chat">Failed to load messages.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    messages.forEach((msg) => {
      frag.appendChild(buildMessageElement(msg));
    });
    container.appendChild(frag);
    renderPinnedMessage(messages.find((msg) => msg.pinned_at) || null);
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 100);
    markChatRead(chatId);
  } catch {
    container.innerHTML = '<div class="no-chat">Network error loading messages.</div>';
  }
}

function sendMessage() {
  const text = document.getElementById('message-text').value.trim();
  if ((!text && !selectedImage) || !currentChat) return;
  
  socket.emit('send_message', { chatId: currentChat.id, text, image: selectedImage, replyTo: activeReply });
  document.getElementById('message-text').value = '';
  clearSelectedImage();
  clearActiveReply();
  stopTyping();
}

function openImagePicker() {
  if (!currentChat) return alert('Open a chat first.');
  document.getElementById('image-input')?.click();
}

function clearSelectedImage() {
  selectedImage = null;
  const input = document.getElementById('image-input');
  if (input) input.value = '';
  document.getElementById('image-preview')?.classList.add('hidden');
  const img = document.getElementById('image-preview-img');
  if (img) img.src = '';
}

function selectImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return alert('Please choose an image file.');

  resizeImage(file, 1280, 0.82).then((dataUrl) => {
    selectedImage = { data: dataUrl, name: file.name, type: file.type };
    const preview = document.getElementById('image-preview');
    const img = document.getElementById('image-preview-img');
    if (img) img.src = dataUrl;
    preview?.classList.remove('hidden');
  }).catch(() => {
    alert('Could not read that image.');
    clearSelectedImage();
  });
}

function resizeImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function markChatRead(chatId) {
  if (!currentUser || !chatId) return;
  socket.emit('mark_read', { chatId, userId: currentUser.id });
  loadConnections();
}

function updateMessageStatus(messageId, readerId, readAt) {
  const el = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!el || !el.classList.contains('sent')) return;
  if (currentChat?.partner?.id != readerId) return;
  const status = el.querySelector('.message-status');
  if (status) status.textContent = `Seen ${formatSeenTime(readAt || new Date())}`;
}

function formatSeenTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString();
}

function startTyping() {
  if (!currentChat || !socket) return;
  if (!isTyping) {
    isTyping = true;
    socket.emit('typing_start', { chatId: currentChat.id });
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => stopTyping(), 1200);
}

function stopTyping() {
  if (!currentChat || !socket) return;
  if (isTyping) {
    isTyping = false;
    socket.emit('typing_stop', { chatId: currentChat.id });
  }
  clearTimeout(typingTimeout);
  typingTimeout = null;
}

function initNotifications() {
  const notifyBtn = document.getElementById('notify-btn');
  if (!notifyBtn || !('Notification' in window)) {
    if (notifyBtn) notifyBtn.classList.add('hidden');
    return;
  }

  updateNotificationButton();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      swRegistration = reg;
    }).catch(() => {});
  }
}

function updateNotificationButton() {
  const notifyBtn = document.getElementById('notify-btn');
  if (!notifyBtn) return;
  const permission = Notification.permission;
  notificationEnabled = permission === 'granted';
  notifyBtn.textContent = notificationEnabled ? 'Notifications on' : 'Enable notifications';
  notifyBtn.disabled = permission === 'denied';
}

async function enableNotifications() {
  if (!('Notification' in window)) return alert('Notifications are not supported in this browser.');
  const permission = await Notification.requestPermission();
  notificationEnabled = permission === 'granted';
  updateNotificationButton();
}

function showIncomingNotification(msg) {
  if (!notificationEnabled || msg.from_id == currentUser?.id) return;
  const inCurrentChat = msg.chat_id === currentChat?.id;
  if (inCurrentChat && !document.hidden) return;

  const sender = userCache.get(String(msg.from_id));
  const title = sender ? `New message from ${sender.email}` : 'New message';
  const body = msg.text || (msg.image?.data ? 'Photo' : 'New message');

  if (swRegistration && swRegistration.showNotification) {
    swRegistration.showNotification(title, {
      body,
      tag: msg.chat_id,
      data: { chat_id: msg.chat_id }
    });
    return;
  }
  try {
    new Notification(title, { body });
  } catch {
    // Ignore notification errors
  }
}

function initSocket() {
  socket = io();
  socket.emit('user_join', currentUser.id);
  
  socket.on('new_message', (msg) => {
    if (msg.chat_id === currentChat?.id) {
      const container = document.getElementById('messages');
      container.appendChild(buildMessageElement(msg));
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 0);
      if (msg.from_id != currentUser.id) {
        markChatRead(msg.chat_id);
      }
    }
  });

  socket.on('incoming_message', (msg) => {
    if (msg.from_id == currentUser.id) return;
    loadConnections();
    showIncomingNotification(msg);
  });

  socket.on('read_update', (payload) => {
    if (payload.chat_id !== currentChat?.id) return;
    payload.message_ids?.forEach((id) => updateMessageStatus(id, payload.reader_id, payload.read_at));
  });

  socket.on('reaction_update', (payload) => {
    if (payload.chat_id !== currentChat?.id) return;
    updateMessageReactions(payload.message_id, payload.reactions);
  });

  socket.on('pin_update', (payload) => {
    if (payload.chat_id !== currentChat?.id) return;
    applyPinnedState(payload.pinned_message || null);
  });

  socket.on('typing_update', (payload) => {
    if (payload.chat_id !== currentChat?.id) return;
    if (payload.user_id == currentUser.id) return;
    const indicator = document.getElementById('chat-typing');
    if (!indicator) return;
    indicator.classList.toggle('hidden', !payload.typing);
  });
}

// Init
document.getElementById('login-form').classList.add('hidden');
document.getElementById('signup-form').classList.remove('hidden');

document.addEventListener('click', () => {
  if (suppressNextDocumentClick) {
    suppressNextDocumentClick = false;
    return;
  }
  const menu = document.getElementById('delete-menu');
  if (menu && !menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
  }
  hideReactionPicker();
  hideReactionDetails();
});

document.getElementById('brand-password')?.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    submitBrandPassword();
  }
});

document.getElementById('message-text')?.addEventListener('input', () => {
  if (currentChat) startTyping();
});

document.getElementById('message-text')?.addEventListener('blur', () => {
  stopTyping();
});

document.getElementById('image-input')?.addEventListener('change', (event) => {
  selectImage(event.target.files?.[0]);
});

let panelOpen = false;
let panelDragging = false;
let panelStartY = 0;
let panelStartTranslate = 0;

function isMobilePanelEnabled() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function getPanelMetrics() {
  const sidebar = document.querySelector('.sidebar');
  const handle = document.getElementById('panel-handle');
  if (!sidebar || !handle) return null;
  const panelHeight = sidebar.getBoundingClientRect().height;
  const handleHeight = handle.getBoundingClientRect().height || 0;
  const closedTranslate = -panelHeight + handleHeight;
  return { sidebar, handle, closedTranslate };
}

function setPanelOpenState(open) {
  panelOpen = open;
  const messenger = document.getElementById('messenger');
  const hint = document.getElementById('panel-hint');
  if (!messenger) return;
  messenger.classList.toggle('panel-open', open);
  if (hint) {
    hint.textContent = open ? 'Tap to close the panel' : 'Tap to open the panel';
  }
  if (!open) {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.transform = '';
  }
}

function parseTranslateY(transform) {
  const match = /translateY\(([-\d.]+)px\)/.exec(transform);
  if (!match) return null;
  return Number.parseFloat(match[1]);
}

function onPanelPointerDown(event) {
  if (!isMobilePanelEnabled()) return;
  if (event.button != null && event.button !== 0) return;
  const metrics = getPanelMetrics();
  if (!metrics) return;
  panelDragging = true;
  panelStartY = event.clientY;
  panelStartTranslate = panelOpen ? 0 : metrics.closedTranslate;
  const messenger = document.getElementById('messenger');
  messenger?.classList.add('panel-dragging');
  metrics.handle.setPointerCapture?.(event.pointerId);
}

function onPanelPointerMove(event) {
  if (!panelDragging) return;
  const metrics = getPanelMetrics();
  if (!metrics) return;
  const delta = event.clientY - panelStartY;
  let nextTranslate = panelStartTranslate + delta;
  nextTranslate = Math.min(0, Math.max(metrics.closedTranslate, nextTranslate));
  metrics.sidebar.style.transform = `translateY(${nextTranslate}px)`;
}

function onPanelPointerUp() {
  if (!panelDragging) return;
  const metrics = getPanelMetrics();
  panelDragging = false;
  const messenger = document.getElementById('messenger');
  messenger?.classList.remove('panel-dragging');
  if (!metrics) return;
  const current = parseTranslateY(metrics.sidebar.style.transform || '');
  const effective = current ?? (panelOpen ? 0 : metrics.closedTranslate);
  const shouldOpen = effective > metrics.closedTranslate / 2;
  metrics.sidebar.style.transform = '';
  setPanelOpenState(shouldOpen);
}

const panelHandle = document.getElementById('panel-handle');
if (panelHandle) {
  panelHandle.addEventListener('pointerdown', onPanelPointerDown);
  panelHandle.addEventListener('click', () => {
    if (panelDragging) return;
    setPanelOpenState(!panelOpen);
  });
}

setPanelOpenState(false);

window.addEventListener('pointermove', onPanelPointerMove);
window.addEventListener('pointerup', onPanelPointerUp);
window.addEventListener('pointercancel', onPanelPointerUp);
window.addEventListener('resize', () => {
  if (!isMobilePanelEnabled()) {
    setPanelOpenState(false);
    const messenger = document.getElementById('messenger');
    messenger?.classList.remove('panel-dragging');
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.transform = '';
  }
});
