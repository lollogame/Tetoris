'use strict';

/* =========================================================
   Chat
========================================================= */
class ChatManager {
  static MAX_MESSAGES = 200;

  static addMessage(message,sender='System'){
    const box=document.getElementById('chatMessages');
    if (!box) return;

    const div=document.createElement('div');
    div.className='chat-message';
    div.textContent=`${sender}: ${message}`;
    box.appendChild(div);

    while (box.children.length > ChatManager.MAX_MESSAGES) {
      box.removeChild(box.firstElementChild);
    }

    box.scrollTop=box.scrollHeight;
  }
}
