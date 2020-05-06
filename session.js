const MAX_HOUR_MSGS = 100;
const MAX_HOUR_CBQS = 400;

class SessionManager {

    constructor() {
        this.chats = {};
        this.privateSet = new Set();
        this._onManyMessage = (id) => console.log(`Refused message from ${id}`);
        this._onManyCallback = (id) => console.log(`Refused callback from ${id}`);
        this.counterReset();
    }

    updateInfo(chat) {
        let id = chat.id;
        if (!id) return false;
        chat.name = chat.title || chat.firstname;
        if (!this.chats[id]) this.chats[id] = chat
        else Object.assign(this.chats[id], chat);
        if (chat.type == "private") this.privateSet.add(id.toString());
        if (!this.counters[id]) this.counters[id] = {
            messages: 0,
            callbacks: 0,
        };
        if (!this.chats[id].session) this.chats[id].session = {};
    }

    callback(chat, queryID) {
        if (!chat.id) return false;
        this.updateInfo(chat);
        this.counters[chat.id].callbacks += 1;
        console.log(chat.id, this.counters[chat.id].callbacks)
        if (this.counters[chat.id].callbacks > MAX_HOUR_CBQS) {
            let delta = this.counters[chat.id].callbacks - MAX_HOUR_CBQS - 1;
            this._onManyCallback(delta, chat, queryID);
            return false;
        }
        return this.chats[chat.id].session
    }

    message(chat) {
        if (!chat.id) return false;
        if (this.counters[chat.id]) console.log(chat.id, this.counters[chat.id].messages);
        this.updateInfo(chat);
        console.log(chat.id, this.counters[chat.id].messages);
        this.counters[chat.id].messages += 1;
        console.log(chat.id, this.counters[chat.id].messages);
        if (this.counters[chat.id].messages > MAX_HOUR_MSGS) {
            let delta = this.counters[chat.id].messages - MAX_HOUR_MSGS - 1;
            this._onManyMessage(delta, chat);
            return false;
        }
        return this.chats[chat.id].session
    }

    isPrivate(id) {
        return this.privateSet.has(id.toString());
    }

    chatInfo(chatID) {
        return this.chats[chatID];
    }

    onTooMany(onMessage, onCallback) {
        if (onMessage) this._onManyMessage = onMessage;
        if (onCallback) this._onManyCallback = onCallback;
    }

    counterReset() {
        this.counters = {};
        setTimeout(() => {
            this.counterReset()
        }, 30 * 1000);
    }
}

module.exports = SessionManager;
