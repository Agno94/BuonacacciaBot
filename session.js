const DAY_MAX_MSGS = 400;

class SessionManager {

    constructor(ChatSession, whenBanned) {
        this.ChatSession = ChatSession;
        this._banned_set = new Set();
        // this._list = {};
        // this._id_list = [];
        this._whenBanned = whenBanned || ((id) => { console.log(id, "Banned") });
    }

    initialize() {
        this._list = {};
        this._id_list = [];
        this.ChatSession.findAll({
            where: { isBanned: true },
            attributes: ['chatId'],
        }).then(r => {
            this._banned_set = new Set(r.map((x) => x.chatId));
        }).catch(e => {
            console.log("Fetching banned list failed");
            console.log(e);
        });
    }

    isChatBanned(chatId) {
        this._banned_set.has(chatId);
    }

    async _findOrCreate(id) {
        let session = null;
        if (!this._list[id]) {
            session = (await this.ChatSession.findOrCreate({
                where: { chatId: id },
                defaults: { status: {} },
            }))[0];
            this._id_list.push(id);
            this._list[id] = session;
            session.status.temp = {};
        } else {
            session = this._list[id];
        }
        return session;
    }

    async get(id) {
        if (this.isChatBanned(id)) return false;
        let session = await this._findOrCreate(id);
        session.dailyCounter++;
        if (session.dailyCounter > DAY_MAX_MSGS) {
            let now = new Date()
            if ((now - session.date) > 3600 * 24 * 1000) {
                session.dailyCounter = 1;
                session.date = now;
            } else {
                session.isBanned = true;
                this._banned_set.add(id);
                this._whenBanned(id);
                session.save();
                return false;
            }
        }
        session.save();
        return session;
    }

    async counterReset() {
        this.saveAll();
        try {
            await this.ChatSession.update(
                { isBanned: false },
                { where: { dailyCounter: 0 } }
            )
            this.initialize();
            this.ChatSession.update({
                dailyCounter: 0,
                callbackCounter: 0,
                date: new Date(),
            }, { where: {} });
        } catch (err) {
            console.log("Error resetting counters and banned list", err);
        }
    }

    async saveAll() {
        let queries = [];
        for (const id of this._id_list) {
            delete this._list[id].status.temp;
            queries.push(this._list[id].update({
                status: this._list[id].status
            }));
        }
        for (const q of queries) await q;
        return;
    }

    callback(id) {
        this._findOrCreate(id).then((session) => {
            session.callbackCounter += 1;
            session.save();
        })
    }

    runWith(F) {
        // Run every fuction adding a session property to the incoming message
        return (async function (msg, ...Args) {
            let session = await this.get(msg.chat.id);
            if (session) {
                msg.session = session;
                msg.processed = true;
                await F(msg, ...Args);
                msg.session.update({ status: msg.session.status });
            };
        }).bind(this);
    };
}

module.exports = SessionManager;
