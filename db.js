const Sequelize = require('sequelize');

const { REGIONI, ZONES, CATEGORIES, BRANCHE } = require("./data.js");
const { MESSAGES } = require("./message.js");

module.exports = function (sequelize, DateTypes) {

    sequelize.REGIONI_CHOICES = REGIONI.CHOICES;

    sequelize.CATEGORIES_CHOICES = CATEGORIES.CHOICES;

    sequelize.WATCH_REPLY = MESSAGES.WATCH;
    sequelize.SEARCH_REPLY = MESSAGES.SEARCH;
    sequelize.EVENT_REPLY = MESSAGES.EVENT;
    sequelize.CANCEL_REPLY = MESSAGES.CANCEL;

    sequelize.BC_STATUS_CHOICES = [
        'OK', 'INCOMPLETE', 'BC_ERROR', 'NET_ERROR', 'PARSE_ERROR', 'DB_ERROR', 'OTHER_ERROR'
    ]

    const BCLog = sequelize.define('bc_log', {
        status: {
            type: Sequelize.ENUM,
            values: sequelize.BC_STATUS_CHOICES,
        },
        date: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        },
        special: {
            type: Sequelize.BOOLEAN,
            defaultValue: false
        },
        events: {
            type: Sequelize.SMALLINT,
            defaultValue: 0,
        }
    }, {});

    const BCEvent = sequelize.define('bc_event', {
        bcId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            unique: true,
            field: "bc_id",
        },
        category: {
            type: Sequelize.ENUM,
            values: sequelize.CATEGORIES_CHOICES
        },
        regione: {
            type: Sequelize.ENUM,
            values: sequelize.REGIONI_CHOICES
        },
        title: { type: Sequelize.STRING(100) },
        startdate: { type: Sequelize.DATE },
        enddate: { type: Sequelize.DATE },
        subscriptiondate: { type: Sequelize.DATE },
        endsubscriptiondate: { type: Sequelize.DATE },
        cost: { type: Sequelize.SMALLINT },
        location: { type: Sequelize.STRING(50) },
        collectiondate: { type: Sequelize.DATE },
        hasBeenWatched: {
            type: Sequelize.BOOLEAN,
            defaultValue: false,
            field: "watched",
        },
    }, {});

    const Watcher = sequelize.define('watcher', {
        chatId: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "chat_id"
        },
        msgId: {
            type: Sequelize.BIGINT,
            field: "msg_id",
        },
        category: {
            type: Sequelize.ENUM,
            values: sequelize.CATEGORIES_CHOICES,
            allowNull: false,
        },
        regione: {
            type: Sequelize.ENUM,
            values: sequelize.REGIONI_CHOICES,
            allowNull: true,
        },
        expiredate: { type: Sequelize.DATE },
        date: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        },
    }, {});

    const Reply = sequelize.define('reply', {
        type: {
            type: Sequelize.ENUM,
            values: [
                sequelize.WATCH_REPLY, sequelize.SEARCH_REPLY,
                sequelize.EVENT_REPLY, sequelize.CANCEL_REPLY,
            ],
        },
        chatID: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "chat_id"
        },
        msgID: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "message_id",
        },
        data: {
            type: Sequelize.JSONB,
        },
    }, {});

    const Alarm = sequelize.define('reply', {
        warning: {
            type: Sequelize.BOOLEAN,
            defaultValue: false,
        },
        status: {
            type: Sequelize.SMALLINT,
            defaultValue: 0,
        },
    }, {});

    Alarm.belongsTo(BCEvent, { onDelete: 'cascade' });
    Alarm.belongsTo(Reply, { onDelete: 'cascade' });

    const ChatSession = sequelize.define('chat_session', {
        chatId: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "chat_id"
        },
        status: {
            type: Sequelize.JSONB,
        },
        isBanned: {
            type: Sequelize.BOOLEAN,
            defaultValue: false,
            field: "is_banned"
        },
        dailyCounter: {
            type: Sequelize.SMALLINT,
            defaultValue: 1,
            field: "counter"
        },
        date: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        }
    }, {});

    return { BCEvent, BCLog, Watcher, Reply, ChatSession }

}
