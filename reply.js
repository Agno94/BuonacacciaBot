/*
Parameters can be changed by settings env. var.
Defatul are set by reading:
https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
MAX_FIND_RESULTS = max number of result that can be send together
MAX_CHAT_MSG = max number of messages that can be send to a chat in 7 seconds
MAX_NONPRIVATE_MSG = max number of messages that can be send to a group in 7 seconds
MAX_SECOND_MSG = max number of messages that can be send globaly in 1 seconds
*/
const MAX_FIND_RESULTS = process.env.MAX_FIND_RESULTS || 8;
const MAX_CHAT_MSG = process.env.MAX_CHAT_MSG || 6;
const MAX_NONPRIVATE_MSG = process.env.MAX_NONPRIVATE_MSG || 2;
const MAX_SECOND_MSG = process.env.MAX_GROUP_MSG || 30;
const MAX_ATTEMPTS = 3;

const { MESSAGES, SELECTION } = require("./message.js");
const { TEMPLATES } = require("./templates.js");

wait = (ms) => new Promise(r => setTimeout(r, ms));

class Replier {

    constructor(bot, Reply) {
        this.bot = bot;
        this.Reply = Reply;
        this.globalCounter = 0;
        this.chatCounter = {};
        this.chatQueued = {};
        this.privateSet = new Set();
        this.isSending = false;
        this.sendActionTime = {};
        this.queue = {
            top: [],
            normal: [],
        };
        this.ref = 0;
        this.responses = {};
    }

    isActive() {
        return (this.isSending || this.queue.top.length || this.queue.normal.length);
    }

    createMessage(type, chat, data) {
        let msg = {
            text: '',
            option: {},
            chat: chat,
        };
        let params = {};
        let keyboard = false;
        switch (type) {
            case (MESSAGES.EVENT):
                params.event = data.event;
                keyboard = [[
                    {
                        url: `https://buonacaccia.net/event.aspx?e=${data.event.bcId}`,
                        text: '🔗 Dettagli ed Iscrizione su Buonacaccia.net'
                    }
                ]];
                break;
            default:
                params = data;
        }
        if (keyboard) msg.option.reply_markup = JSON.stringify({
            inline_keyboard: keyboard
        });
        msg.text += TEMPLATES[type](params);
        //...
        if (MESSAGES.SHOW_BETA_ALERT && MESSAGES.withBetaAlertSet.has(type))
            msg.text += "\n" + TEMPLATES.BetaAlert;
        return msg
    }

    message(type, chat, data) {
        let message = this.createMessage(type, chat, data);
        let priority = MESSAGES.prioritySet.has(type);
        if (MESSAGES.HTMLSet.has(type)) message.option.parse_mode = 'HTML';
        this.ref += 1;
        message.ref = this.ref;
        if (chat.type == "private") this.privateSet.add(chat.id);
        if (priority) this.queue.top.push(message)
        else this.queue.normal.push(message);
        this.chatQueued[chat.id] = (this.chatQueued[chat.id] || 0) + 1;
        // ...
        if (!this.isSending) this._loop();
        return message.ref;
    }

    async _loop() {
        this.isSending = true;
        while (this.queue.top.length + this.queue.normal.length) {
            let time = new Date();
            let sent = 0;
            let priorityPresent = Boolean(this.queue.top.length);
            let postponed = [];
            while (
                ((this.globalCounter) < MAX_SECOND_MSG) &&
                ((this.queue.top.length && priorityPresent) || this.queue.normal.length)
            ) {
                let message = priorityPresent ?
                    this.queue.top.shift() :
                    this.queue.normal.shift();
                if (this._isSendable(message.chat.id)) {
                    this._doSend(message).then(
                        (r) => r
                        // on success
                    ).catch(
                        (e) => Object({ ok: false, error: e })
                        // on error
                    ).then(
                        this._onFinish(message.ref, message.chat.id)
                    );
                    sent += 1;
                    this.chatCounter[message.chat.id] += 1;
                    this.chatQueued[message.chat.id] -= 1;
                    this.globalCounter += 1;
                    await wait(5);
                } else {
                    postponed.push(message);
                }
                if (priorityPresent && !(this.queue.top.length)) {
                    priorityPresent = false;
                    this.queue.top = postponed;
                    postponed = [];
                }
            }
            if (priorityPresent) {
                this.queue.top = postponed.concat(this.queue.top);
            } else {
                this.queue.normal = postponed.concat(this.queue.normal);
            }
            for (let chatID in this.chatQueued) {
                if (!this.chatQueued[chatID]) delete this.chatQueued[chatID]
                else {
                    let delta = time - (this.sendActionTime[chatID] || 0);
                    console.log("delta typing action", delta);
                    if (delta > 4000) {
                        bot.sendChatAction(chatID, "typing");
                        this.sendActionTime[chatID] = time;
                    }
                }
            }
            await wait(250);
        }
        this.isSending = false;
    }

    async response(ref) {
        while (!this.responses[ref]) await wait(100);
        let response = this.responses[ref];
        //delete this.responses[ref];
        return response
    }

    _isSendable(chatID) {
        let chatLimit = this.privateSet.has(chatID) ? MAX_CHAT_MSG : MAX_NONPRIVATE_MSG;
        if (!this.chatCounter[chatID]) {
            this.chatCounter[chatID] = 0;
            return true;
        } else {
            return (this.chatCounter[chatID] < chatLimit);
        }
    }

    async _doSend(message) {
        //let message
        let tries = MAX_ATTEMPTS;
        let success = false;
        let result;
        while (tries && !success) {
            try {
                // console.log("Sending message", message);
                result = await this.bot.sendMessage(
                    message.chat.id,
                    message.text,
                    message.option);
                success = true;
            } catch (e) {
                console.error("Sender", e.name, e.message);
                tries--;
                if (!tries) {
                    return { ok: false, error: e.message };
                }
                if ((e.code == "ETELEGRAM")) {
                    let body = e.response.body;
                    console.error("ETELEGRAM", body);
                    if (body.error_code == 429) {
                        let chatID = message.chat.id;
                        this.chatQueued[chatID] = (this.chatQueued[chatID] || 0) + 1;
                        await wait(body.parameters.retry_after * 999);
                        this.chatQueued[chatID] -= 1;
                    }
                }
            }
        }
        return result;
    }

    _onFinish(ref, chatID) {
        return (function (r) {
            this.responses[ref] = r;
            delete this.sendActionTime[chatID];
            setTimeout(() => {
                this.globalCounter -= 1;
            }, 1000);
            setTimeout(() => {
                this.chatCounter[chatID] -= 1;
            }, 7000);
        }).bind(this)
    }

}

module.exports = Replier;