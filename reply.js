/*
Parameters can be changed by settings env. var.
Defatul are set by reading:
https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
MAX_CHAT_MSG = max number of messages that can be send to a chat in RESET_DELAY seconds
MAX_NONPRIVATE_MSG = max number of messages that can be send to a group in RESET_DELAY seconds
MAX_SECOND_MSG = max number of messages that can be send globaly in 1 seconds
*/
const MAX_CHAT_MSG = process.env.MAX_CHAT_MSG || 6;
const MAX_NONPRIVATE_MSG = process.env.MAX_NONPRIVATE_MSG || 3;
const MAX_SECOND_MSG = process.env.MAX_SECOND_MSG || 30;
const RESET_DELAY = (process.env.RESET_DELAY || 9) * 1000;
const MAX_ATTEMPTS = 3;

const { MESSAGES, SELECTION } = require("./message.js");
const { TEMPLATES } = require("./templates.js");
const { REGIONI, ZONES, CATEGORIES, BRANCHE, COLLECTIONS } = require("./data.js");

wait = (ms) => new Promise(r => setTimeout(r, ms));

function selectionKeyboard(type, step, data) {
    let buttons = [];
    switch (step) {
        case (SELECTION.BRANCA):
            buttons = BRANCHE.LIST.map((b) => Object({
                callback_data: SELECTION.callbackData(type, b.code),
                text: `${b.emoji} ${b.human}`,
            }));
            break;
        case (SELECTION.CATEGORY):
            data.emoji = BRANCHE[data.branca].emoji;
            buttons = BRANCHE[data.branca].CATEGORIES.map((c) => Object({
                callback_data: SELECTION.callbackData(type, data.branca, c.code),
                text: `${data.emoji} ${c.human}`
            }));
            break;
        case (SELECTION.ZONE):
            buttons = ZONES.LIST.map((z) => Object({
                callback_data: SELECTION.callbackData(type, data.branca, data.cat, z.code),
                text: `${z.human}`
            }));
            break;
        case (SELECTION.REGIONE):
            let list = data.forcedKeyboard || ZONES[data.zone].REGIONI;
            buttons = list.map((r) => Object({
                callback_data: SELECTION.callbackData(type, data.branca, data.cat, data.zone, r.code),
                text: `📌️ ${r.human}`
            }));
            break;
    }
    if (step > SELECTION.BRANCA) {
        let back = data.selectedParams.slice(0, data.backstep);
        buttons.push({
            callback_data: SELECTION.callbackData(type, ...back),
            text: `🔙 Indietro`
        });
    }
    let keyboard = [];
    for (let i = 0; i < buttons.length; i += 2)
        keyboard.push(buttons.slice(i, i + 2));
    return keyboard
}

const TOP = -1;
const HIGH = 0;
const NORMAL = 1;

class Replier {

    constructor(bot, db, Session) {
        this.bot = bot;
        this.Reply = db.Reply;
        this.Session = Session;
        this.globalCounter = 0;
        this.chatCounter = {};
        this.chatQueued = {};
        this.isSending = false;
        this.sendActionTime = {};
        this.queue = {
            [TOP]: [],
            [HIGH]: [],
            [NORMAL]: [],
        };
        this.ref = 0;
        this.responses = {};
    }

    isActive() {
        return (this.isSending || this._queueCount(TOP));
    }

    createMessage(type, chat, data) {
        let msg = {
            type: type,
            text: '',
            option: {},
            chat: chat,
        };
        let params = {};
        if (data.reply_to) {
            msg.option.reply_to_message_id = data.reply_to;
            delete data.reply_to;
        }
        let keyboard = false;
        switch (type) {
            case (MESSAGES.ABOUT):
                keyboard = [[{
                    url: `https://buonacaccia.net/`,
                    text: '🔗 Buonacaccia'
                }, {
                    url: `https://github.com/Agno94/BuonacacciaBot/`,
                    text: "📦 Repository su github",
                }]];
                break;
            case (MESSAGES.EVENT):
                params = data;
                keyboard = [[
                    {
                        url: `https://buonacaccia.net/event.aspx?e=${data.event.bc}`,
                        text: '🔗 Dettagli ed Iscrizione su Buonacaccia.net'
                    }
                ], [
                    {
                        text: "⏰ Attiva/Disattiva promemoria",
                        callback_data: `${MESSAGES.EVENT}/alarm/${data.event.bc}`
                    },
                ]];

                break;
            case (MESSAGES.CANCEL):
                params = data;
                let lastRow = [{
                    callback_data: `${MESSAGES.CANCEL}/update/`,
                    text: '🔄 Aggiorna elenchi',
                }];
                keyboard = [lastRow];
                if (data.alarmEvents.length) {
                    keyboard.unshift([{
                        callback_data: `${MESSAGES.CANCEL}/del/alarm/`,
                        text: '🛑🔔 Disattiva i promemoria',
                    }]);
                    lastRow.unshift({
                        callback_data: `${MESSAGES.CANCEL}/show/alarm/`,
                        text: 'Rimanda promemoria attivi',
                    });
                };
                if (data.watchers.length) {
                    keyboard.unshift([{
                        callback_data: `${MESSAGES.CANCEL}/del/watch/`,
                        text: '🛑👁‍🗨 Disattiva gli osservatori attivi',
                    }]);
                    lastRow.unshift({
                        callback_data: `${MESSAGES.CANCEL}/show/watch/`,
                        text: 'Rimanda osservatori attivi',
                    });
                };
                break;
            case (MESSAGES.SEARCH):
                params = data;
                if (data.step < SELECTION.COMPLETE) {
                    keyboard = selectionKeyboard(MESSAGES.SEARCH, data.step, data);
                } else {
                    keyboard = [];
                    if (data.status == "complete") {
                        keyboard.push([{
                            text: '😎 Mostra risultati',
                            callback_data: `${MESSAGES.SEARCH}/show/`,
                        }]);
                    }
                    if (data.status == "end") {
                        keyboard.push([{
                            text: '🔄️ Ripeti',
                            callback_data: `${MESSAGES.SEARCH}/repeat/`,
                        }, {
                            text: '🚀️ Ricomincia',
                            callback_data: `${MESSAGES.SEARCH}/restart/`,
                        }])
                    }
                }
                break;
            case (MESSAGES.WATCH):
                params = data;
                if (data.step < SELECTION.COMPLETE) {
                    keyboard = selectionKeyboard(MESSAGES.WATCH, data.step, data);
                } else {
                    if (!data.status) {
                        keyboard = selectionKeyboard(MESSAGES.WATCH, data.step, data);
                        keyboard[0].push({
                            callback_data: SELECTION.callbackData(MESSAGES.WATCH),
                            text: `🚀️ Ricomincia`,
                        });
                        keyboard.unshift([{
                            text: '🔔 Attiva osservatore',
                            callback_data: `${MESSAGES.WATCH}/create/`,
                        }])
                    }
                    if (data.status == 'cancelled')
                        keyboard = [[{
                            text: '🚀 Nuovo osservatore',
                            callback_data: `${MESSAGES.WATCH}/new/`
                        }]];
                    if (data.status == 'active') {
                        keyboard = [[{
                            text: '🗑 Elimina Osservatore',
                            callback_data: `${MESSAGES.WATCH}/cancel/`,
                        }]];
                    }
                }
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
        if (MESSAGES.HTMLSet.has(type)) msg.option.parse_mode = 'HTML';
        return msg
    }

    _stepQueue(chatID) {
        this.chatQueued[chatID] = (this.chatQueued[chatID] || 0) + 1;
    }

    update(replyObj, data) {
        let message = this.createMessage(replyObj.type, { id: replyObj.chatID }, data);
        message.deliverAction = 'edit';
        message.option.chat_id = replyObj.chatID;
        if (replyObj.msgID) {
            this._stepQueue(replyObj.chatID)
            let this_message = Object.assign({}, message);
            this_message.option.message_id = replyObj.msgID;
            this.queue[TOP].push(this_message);
        };
        replyObj.getMessages({ raw: true }).then(
            messages => messages.map(
                msg => {
                    if (msg.tgID == replyObj.msgID) return;
                    this._stepQueue(replyObj.chatID);
                    let this_message = Object.assign({}, message);
                    this_message.option = Object.assign({}, message.option);
                    this_message.option.message_id = msg.tgID;
                    this.queue[HIGH].push(this_message);
                }
            )
        ).catch(console.error).then(this._loop.bind(this));
        this._loop();
    }

    message(type, chat, data) {
        let message = this.createMessage(type, chat, data);
        let priority = MESSAGES.prioritySet.has(type) ? HIGH : NORMAL;
        this.ref += 1;
        message.ref = this.ref;
        this.queue[priority].push(message);
        this._stepQueue(chat.id);
        // ...
        if (!this.isSending) this._loop();
        return message.ref;
    }

    _queueCount(maxPriority) {
        let count = 0
        for (let P = maxPriority; P <= NORMAL; P += 1) count += this.queue[P].length;
        return count;
    }

    async _loop() {
        this.isSending = true;
        while (this._queueCount(TOP)) {
            let activePriority = TOP;
            let time = new Date();
            let sent = 0;
            let postponed = [];
            while (
                (this.globalCounter < MAX_SECOND_MSG) &&
                (this._queueCount(activePriority))
            ) {
                if (!this.queue[activePriority].length) {
                    this.queue[activePriority] = postponed;
                    activePriority += 1;
                    postponed = [];
                } else {
                    let message = this.queue[activePriority].shift();
                    if (this._isSendable(message.chat.id)) {
                        let action = message.deliverAction || "send";
                        this._deliverMessage(message, action).then(
                            (r) => r
                            // this._doSaveReply(message.type, message.ref)
                            // on success
                        ).catch(
                            (e) => Object({ ok: false, error: e })
                            // on error
                        ).then(
                            this._onFinish(message.chat.id, message.ref)
                        );
                        sent += 1;
                        this.chatCounter[message.chat.id] += 1;
                        this.chatQueued[message.chat.id] -= 1;
                        this.globalCounter += 1;
                        await wait(5);
                    } else postponed.push(message);
                }
            }
            this.queue[activePriority] = postponed.concat(this.queue[activePriority]);
            for (let chatID in this.chatQueued) {
                if (!this.chatQueued[chatID]) delete this.chatQueued[chatID]
                else {
                    let delta = time - (this.sendActionTime[chatID] || 0);
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
        return response
    }

    _isSendable(chatID) {
        let chatLimit = this.Session.isPrivate(chatID) ?
            MAX_CHAT_MSG : MAX_NONPRIVATE_MSG;
        if (!this.chatCounter[chatID]) this.chatCounter[chatID] = 0;
        if ((this.globalCounter) > MAX_SECOND_MSG) return false;
        return (this.chatCounter[chatID] < chatLimit);
    }

    async _deliverMessage(message, action = 'send') {
        let tries = MAX_ATTEMPTS;
        let result = { ok: false };
        while (tries && !(result.ok)) {
            if (!(message.option.reply_to_message_id) &&
                message.reply_to_list && message.reply_to_list.length)
                message.option.reply_to_message_id = message.reply_to_list.pop()
            try {
                if (action == 'send') {
                    result = await this.bot.sendMessage(
                        message.chat.id,
                        message.text,
                        message.option);
                } else if (action == 'edit') {
                    result = await this.bot.editMessageText(
                        message.text,
                        message.option);
                }
                result.ok = true;
            } catch (e) {
                console.error("Sender", e.name, e.message);
                result.ok = false;
                tries--;
                if (!tries) {
                    result.error = e.message;
                    return result;
                }
                if ((e.code == "ETELEGRAM")) {
                    result = e.response.body;
                    console.error("ETELEGRAM", result);
                    if (result.error_code == 429) {
                        let chatID = message.chat.id;
                        this.chatQueued[chatID] = (this.chatQueued[chatID] || 0) + 1;
                        await wait(result.parameters.retry_after * 999);
                        this.chatQueued[chatID] -= 1;
                    }
                    if (result.error_code == 400)
                        return result;
                    if (result.error_code == 404)
                        delete message.option.reply_to_message_id;
                }
            }
        }
        return result;
    }

    _onFinish(chatID, ref = 0) {
        return (function (r) {
            if (ref) this.responses[ref] = r;
            delete this.sendActionTime[chatID];
            if (r.chat) this.Session.updateInfo(r.chat);
            setTimeout(() => {
                this.globalCounter -= 1;
            }, 1000);
            setTimeout(() => {
                this.chatCounter[chatID] -= 1;
            }, RESET_DELAY);
        }).bind(this)
    }

    async add(obj, ref) {
        let response = await this.response(ref);
        if (response && response.chat && response.message_id) {
            await obj.createMessage({
                tgID: response.message_id
            }).then(msgObj => {
                obj.messages = obj.messages || [msgObj];
                return [obj, true];
            })
        } else {
            throw response;
        }
    }

    async save(type, ref, extraData = null) {
        let response = await this.response(ref);
        if (response && response.chat && response.message_id) {
            let [obj, ok] = await this.Reply.create({
                type: type,
                chatID: response.chat.id,
                data: extraData
            }).then(
                obj => obj.createMessage({
                    tgID: response.message_id
                }).then(msgObj => {
                    obj.messages = obj.messages || [msgObj];
                    return [obj, true];
                })
            ).catch((e) => [e, false])
            if (!ok) throw obj;
            return obj;
        } else {
            throw response;
        }
    }

}

module.exports = Replier;