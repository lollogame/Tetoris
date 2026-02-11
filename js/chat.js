'use strict';

/* =========================================================
   Chat
========================================================= */
class ChatManager {
  static addMessage(message,sender='System'){
    const box=document.getElementById('chatMessages');
    const div=document.createElement('div');
    div.className='chat-message';
    div.textContent=`${sender}: ${message}`;
    box.appendChild(div);
    box.scrollTop=box.scrollHeight;
  }
}
