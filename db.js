const Sequelize = require('sequelize');

const { REGIONI, ZONES, CATEGORIES, BRANCHE } = require("./data.js");

module.exports = function (sequelize, DateTypes) {

    sequelize.REGIONI_CHOICES = REGIONI.CHOICES;

    sequelize.CATEGORIES_CHOICES = CATEGORIES.CHOICES;

    const BCLog = sequelize.define('bc_log', {
        status: {
            type: Sequelize.ENUM,
            values: [
                'OK', 'INCOMPLETE', 'DOWN', 'NET_ERROR', 'PARSE_ERROR', 'DB_ERROR', 'OTHER_ERROR'
            ]
        },
        date: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        },
        special: {
            type: Sequelize.BOOLEAN,
            defaultValue: false
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

    const EventReply = sequelize.define('event_reply', {
        chatId: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "chat_id"
        },
        msgId: {
            type: Sequelize.BIGINT,
            allowNull: false,
            field: "message_id",
        },
        status: {
            type: Sequelize.ENUM,
            values: [
                "Silent", "Expired", "Alert"
            ],
            defaultValue: "Silent",
        },
    }, {});

    EventReply.belongsTo(BCEvent, { onDelete: 'cascade' });

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

    return { BCEvent, BCLog, Watcher, EventReply, ChatSession }

}
